# Learning notes: how the four pages work with the LLM backend

[中文版](./llm-streaming-notes.zh-CN.md)

Here's the question we're trying to answer: after you press Enter in the CLI, where does your prompt go, and how does the model's answer make its way onto the screen a little at a time?

We'll walk through `/llm`, `/llm-test`, `/llm-hybrid`, and `/chat` using the code in this repository. The frontend here is an OpenTUI + React CLI. The backend is Hono running on Bun. It's not a browser app, but React hooks, HTTP requests, and ReadableStreams still work much the same way.

These notes match the currently installed `ai@7.0.91`. APIs such as `result.stream`, `toUIMessageStream`, and `toTextStream` come from that version. Tutorials for other versions may use different APIs. The protocol samples below are illustrations; the actual chunks and their order depend on the response.

## 1. Match each page to its API

| CLI route | Component | Hono API | How the CLI sends the request | What the CLI receives |
| --- | --- | --- | --- | --- |
| `/llm` | `LlmScreen` | `POST /api/llm` | The request is sent inside `useCompletion` | UIMessage stream over SSE |
| `/llm-test` | `LlmTestScreen` | `POST /llm-test` | Hono typed RPC `$post` | UTF-8 plain text stream |
| `/llm-hybrid` | `LlmHybridScreen` | `POST /llm-hybrid` | Hono typed RPC `$post` | UTF-8 plain text stream |
| `/chat` | `ChatScreen` | `POST /api/chat` | `useChat` + `DefaultChatTransport` | UIMessage stream over SSE |

CLI routes and API paths are separate things. `/llm` identifies a page in React Router's memory router; its HTTP request goes to `/api/llm`. The other two demo routes happen to share their names with their endpoints, but that's not a general rule.

There are three approaches to keep in mind:

1. **SDK + UIMessage stream**: `/llm`, plus its multi-turn counterpart, `/chat`.
2. **Direct fetch + manual upstream SSE parsing + plain text**: `/llm-test`.
3. **SDK model invocation + plain text + a manual client stream reader**: `/llm-hybrid`.

These aren't three different models. They share the same provider/model configuration. The main difference is who calls the model and who handles the stream.

## 2. The shared foundation: addresses, provider, and schemas

### 2.1 What Hono typed RPC actually does

[`apps/cli/src/lib/client.ts`](../apps/cli/src/lib/client.ts) is small:

```ts
import { hc } from "hono/client";
import type { AppType } from "@bun-hono-opentui/server/app";

export const api = hc<AppType>(Bun.env.API_URL ?? "http://localhost:3000");
```

`AppType` comes from [`apps/server/src/app.ts`](../apps/server/src/app.ts). It gives the CLI TypeScript information about routes and request parameters. The type-only import and the server's `./app` export keep the server bootstrap out of the CLI bundle.

Typed RPC **doesn't automatically interpret a stream or validate all incoming data at runtime**.

- `/llm-test` and `/llm-hybrid` use `$post({ json: ... })`. RPC handles the URL, JSON serialization, and request typing.
- `/llm` and `/chat` only use `$url().toString()` to obtain the API URL. An AI SDK hook or transport sends the actual request.
- A plain text response still needs to be read through `response.body`. Using RPC doesn't turn it into JSON or a complete completion string.

### 2.2 All four endpoints share their model configuration

[`apps/server/src/lib/ai-config.ts`](../apps/server/src/lib/ai-config.ts) defines:

| `AI_PROVIDER` | `baseURL` | API key variable | Default model |
| --- | --- | --- | --- |
| `openrouter`, the current code default | `https://openrouter.ai/api/v1` | `OPENAI_API_KEY` | `nvidia/nemotron-3.5-lightning:free` |
| `deepseek` | `https://api.deepseek.com` | `DEEPSEEK_API_KEY` | `deepseek-flash` |

`AI_MODEL` overrides the selected provider's default model. The CLI's `API_URL` selects the Hono server address, not the provider address. API keys stay on the server; the CLI doesn't need them.

The SDK path uses:

```ts
const provider = createOpenAI({
  baseURL: aiConfig.baseURL,
  apiKey: aiConfig.apiKey,
});

export const aiModel = provider.chat(aiConfig.model);
```

`createOpenAI` is an adapter for an OpenAI-compatible API. Its name doesn't mean the actual model must be an OpenAI model.

### 2.3 What the shared schemas validate

[`packages/shared/src/index.ts`](../packages/shared/src/index.ts) defines:

```ts
const promptSchema = z.object({
  prompt: z.string().min(1).max(2000),
});

const chatBodySchema = z.object({
  messages: z.array(z.unknown()).min(1),
});

const chatStateSchema = z.object({
  prompt: z.string(),
});
```

Error messages are omitted here, but the constraints match the source. A few details matter:

- `promptSchema` expects `{ prompt: "..." }`, not a bare string. Wrap the value received from OpenTUI's `onSubmit` in an object first.
- Prompt length must be 1–2000. There is **no `.trim()`** in this schema. An empty string fails, but a whitespace-only string currently passes.
- `chatBodySchema` only checks that `messages` is a non-empty array. It doesn't fully validate each UIMessage or part. The later `as UIMessage[]` is a TypeScript cast, not runtime validation.
- `chatStateSchema` checks React Router's `location.state`. It's not the HTTP body schema for `/api/chat`.
- The server uses `zValidator("json", promptSchema)` for `/llm-test` and `/llm-hybrid`. `/api/llm` and `/api/chat` call `safeParse` inside their handlers.

## 3. Two request hops, two downstream protocols

A generation takes at least two hops:

```text
CLI ── HTTP request ──> Hono ── HTTP request ──> provider
CLI <── response stream ─ Hono <── upstream stream ─ provider
```

**The provider → Hono format does not have to match the Hono → CLI format.** That's a big part of what these demos help us see.

### 3.1 UIMessage stream: SSE framing around JSON events

`/api/llm` and `/api/chat` return these headers:

```http
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
x-vercel-ai-ui-message-stream: v1
x-accel-buffering: no
```

A typical text response looks roughly like this:

```text
data: {"type":"start"}

data: {"type":"start-step"}

data: {"type":"text-start","id":"text-0"}

data: {"type":"text-delta","id":"text-0","delta":"Hello"}

data: {"type":"text-delta","id":"text-0","delta":" world"}

data: {"type":"text-end","id":"text-0"}

data: {"type":"finish-step"}

data: {"type":"finish","finishReason":"stop"}

data: [DONE]

```

Here's how to read it:

- `data: ...` followed by a blank line is SSE framing, not assistant text.
- `text-delta.delta` contains newly generated text. Its `id` associates it with a text part.
- A `start` event may carry an optional `messageId`. These handlers don't provide a custom message ID generator, so don't assume every start event includes one.
- `start-step` / `finish-step` describe a model step. `finish` carries message completion information. `[DONE]` marks the end of the SSE stream.
- If the model provides reasoning, `toUIMessageStream` can forward reasoning events by default. A text-only UI doesn't imply a text-only protocol.
- The stream may include `{"type":"error","errorText":"..."}`. These handlers don't customize `onError`; relevant server error details are replaced with `An error occurred.` by the SDK's default behavior.

OpenAI-compatible providers also commonly use SSE, but their payload usually contains `choices[0].delta.content`, not `type: "text-delta"`. **Matching framing doesn't mean matching JSON schemas.**

This is a streaming fetch response to a POST request. The CLI isn't using `EventSource` to subscribe to a GET endpoint.

### 3.2 Plain text stream: text without an event envelope

Successful `/llm-test` and `/llm-hybrid` responses have:

```http
Content-Type: text/plain; charset=utf-8
```

The body itself is simply:

```text
Hello world
```

The network might deliver `Hel`, then `lo `, then `world`. That's only an illustration: a network chunk is not necessarily a token, a sentence, an SSE event, or even a complete UTF-8 character.

A plain text stream has no `data:` prefix, JSON envelope, or `[DONE]` marker. The CLI knows it's finished when `reader.read()` returns `done: true`.

It's easy to display, but it doesn't carry message IDs, finish reasons, reasoning, tool calls, usage, or structured error events. Adding those later would require a richer protocol.

### 3.3 ASCII flow diagrams for all four paths

Follow the request toward the provider, then follow the response back. `provider SSE` below means the upstream stream handled by the current OpenAI-compatible integration, not UIMessage SSE.

**`/llm`: the SDK handles both ends**

```text
REQUEST
[CLI input] -> complete(prompt) -> useCompletion
                                      |
                          POST /api/llm { prompt }
                                      v
                              [Hono: readPrompt]
                                      |
                              streamText(aiModel)
                                      v
                                  [provider]

RESPONSE
[provider SSE] -> [SDK adapter] -> result.stream
                                      |
                              toUIMessageStream
                                      |
                        createUIMessageStreamResponse
                                      |
                              UIMessage SSE
                                      v
                      [useCompletion: text-delta.delta]
                                      |
                           completion -> [CLI text]
```

**`/llm-test`: parse upstream SSE ourselves**

```text
REQUEST
[CLI input] -> promptSchema.safeParse({ prompt: input })
                                      |
                         typed RPC POST /llm-test
                                      v
                               [Hono: zValidator]
                                      |
                      fetch POST /chat/completions
                                      v
                                  [provider]

RESPONSE
[provider SSE] -> OpenaiTextStream
                       |
                 buffer + JSON + zod
                       |
              choices[0].delta.content
                       |
                 UTF-8 plain text
                       v
            [CLI reader + TextDecoder]
                       |
           setCompletion -> [CLI text]
```

**`/llm-hybrid`: SDK invocation, manual client text reading**

```text
REQUEST
[CLI input] -> promptSchema.safeParse({ prompt: input })
                                      |
                       typed RPC POST /llm-hybrid
                                      v
                               [Hono: zValidator]
                                      |
                              streamText(aiModel)
                                      v
                                  [provider]

RESPONSE
[provider SSE] -> [SDK adapter] -> result.stream
                                      |
                          toTextStream (text-delta only)
                                      |
                           createTextStreamResponse
                                      |
                              UTF-8 plain text
                                      v
                           [CLI reader + TextDecoder]
                                      |
                          setCompletion -> [CLI text]
```

**`/chat`: send history and update the assistant message**

```text
INITIAL ENTRY
[Home textarea] -> navigate('/chat', { state: { prompt } })
                                      |
                         chatStateSchema.safeParse
                                      |
                         initialMessages -> sendMessage()

REQUEST
[Chat input] -> sendMessage({ text }) -> [useChat: messages]
                                               |
                                     DefaultChatTransport
                                               |
                              POST /api/chat { messages, ... }
                                               v
                                    [Hono: chatBodySchema]
                                               |
                                    convertToModelMessages
                                               |
                                  streamText({ messages })
                                               v
                                           [provider]

RESPONSE
[provider SSE] -> [SDK adapter] -> result.stream
                                      |
                              toUIMessageStream
                                      |
                        createUIMessageStreamResponse
                                      |
                              UIMessage SSE
                                      v
                [DefaultChatTransport + useChat: update messages]
                                      |
                         text parts -> [CLI message list]
                                      |
                      next request sends current history
```

That history loop lives in the CLI's messages state. The server doesn't retrieve history from a database using `chat-demo`. Of these four response paths, only `/llm-test` uses the project's own upstream parser; the SDK adapter handles the other three.

## 4. `/llm`: let the SDK call the model and update the completion

### 4.1 CLI: one prompt, one completion

The source is [`llm-screen.tsx`](../apps/cli/src/components/llm-screen.tsx):

```ts
const { completion, complete, isLoading, error } = useCompletion({
  api: api.api.llm.$url().toString(),
});
```

As the user edits the input, the component updates React state and `promptRef.current`. On submit, it calls `complete(promptRef.current)` unless a generation is already loading. The hook sends the request, reads the stream, and places the accumulated text in `completion`. React then renders it.

This page doesn't maintain message history. Submitting two prompts means two independent generations; the previous answer isn't automatically included in the next request.

### 4.2 CLI → Hono request

```http
POST /api/llm
Content-Type: application/json
```

```json
{
  "prompt": "Explain Hono in one sentence."
}
```

`useCompletion` builds this body internally. This page doesn't configure extra body fields. The server's `readPrompt` reads JSON and calls `promptSchema.safeParse`. Invalid JSON or schema failure produces HTTP 400 with `{ "error": "..." }`.

### 4.3 Hono: turn the SDK stream into a UIMessage stream

```ts
const result = streamText({ model: aiModel, prompt: body.prompt });

return createUIMessageStreamResponse({
  stream: toUIMessageStream({ stream: result.stream }),
});
```

Think of this as three steps:

1. `streamText` calls the provider and turns its upstream response into SDK stream parts.
2. `toUIMessageStream` turns those parts into UIMessage chunks such as `text-delta`.
3. `createUIMessageStreamResponse` wraps the chunks in an SSE HTTP response.

`useCompletion` currently defaults to `streamProtocol: "data"`. In this installed version, that means parsing UIMessage SSE and appending `text-delta.delta` to the completion. An error event becomes a hook error. Don't confuse this with the older data stream encodings shown in some tutorials.

The pair matches: the server emits UIMessage streams, and the hook reads UIMessage streams. Switching only the server to plain text without changing the hook's protocol would break that match.

## 5. `/llm-test`: call the provider yourself and extract text from SSE

This approach is useful for seeing HTTP and streaming directly because it doesn't use the AI SDK to invoke the model.

### 5.1 CLI → Hono request

In [`llm-test-screen.tsx`](../apps/cli/src/components/llm-test-screen.tsx), submission begins with:

```ts
const parsed = promptSchema.safeParse({ prompt: input });
if (!parsed.success) {
  // Display a validation error; don't send a request.
  return;
}

const response = await api["llm-test"].$post({ json: parsed.data });
```

The outgoing request is:

```http
POST /llm-test
Content-Type: application/json
```

```json
{
  "prompt": "Explain Hono in one sentence."
}
```

The server's `zValidator` validates it again. Schema validation failures normally return HTTP 400 with the middleware's validation result JSON; malformed JSON is also rejected by the middleware. Don't assume the error body matches `/api/llm`'s `{ error }` shape. The CLI currently displays non-2xx responses by reading `response.text()`.

### 5.2 Hono → provider request

Here the server explicitly calls:

```text
POST ${aiConfig.baseURL}/chat/completions
```

With OpenRouter, that's `https://openrouter.ai/api/v1/chat/completions`. Headers:

```http
Authorization: Bearer <server-side API key>
Content-Type: application/json
```

Example body:

```json
{
  "model": "nvidia/nemotron-3.5-lightning:free",
  "stream": true,
  "reasoning": { "enabled": false },
  "messages": [
    { "role": "user", "content": "Explain Hono in one sentence." }
  ]
}
```

`model` comes from the runtime configuration. The `reasoning` field is only added when `AI_PROVIDER === "openrouter"`. The SDK calls in the other demos and `/chat` don't explicitly set that option, so their upstream requests shouldn't be assumed to be identical to this direct request.

`AbortSignal.timeout(60_000)` sets a 60-second timeout on the upstream fetch. That's not a CLI timeout or a promise that a generation can run indefinitely.

### 5.3 Provider → Hono: OpenAI-compatible SSE

An illustrative upstream response:

```text
data: {"choices":[{"delta":{"role":"assistant"}}]}

data: {"choices":[{"delta":{"content":"Hello"}}]}

data: {"choices":[{"delta":{"content":" world"}}]}

data: {"choices":[{"delta":{},"finish_reason":"stop"}]}

data: [DONE]

```

[`OpenaiTextStream`](../apps/server/src/lib/openai-text-stream.ts) processes this upstream stream:

1. Read bytes with `getReader()` and decode incrementally using `TextDecoder`.
2. Keep incomplete lines in a buffer, since a network chunk might cut through a JSON object.
3. Process lines beginning with `data:` and skip comments or other lines.
4. Stop at `[DONE]`; otherwise call `JSON.parse` and validate the chunk's boundary shape with zod.
5. Extract `choices[0].delta.content`, encode it as UTF-8 with `TextEncoder`, and send those bytes downstream.
6. Ignore role-only, reasoning-only, usage-only, and other chunks without content. Reading must continue even when a chunk doesn't contain displayable text.

This isn't a general-purpose parser supporting every SSE feature. It targets the common single-line JSON `data:` format used here and only extracts text from the first choice. Finish reasons, usage, model metadata, and reasoning aren't forwarded to the CLI.

The helper also has a 60-second inactivity timeout for each upstream read. A chunk-level `error.message`, JSON/schema parsing failure, timeout, or a stream with no text is logged as `[AI /llm-test] ...` and causes the downstream stream to error. On completion or failure, it attempts to cancel the upstream reader and release its lock.

If the upstream initially returns a non-2xx status, the server forwards its response text and status. If it has a successful status but no body, the server returns 502. Once text is already streaming, a later error can't replace the HTTP status; it becomes a stream error, not an SSE error event.

### 5.4 Hono → CLI: it's plain text now

```ts
return new Response(OpenaiTextStream(upstream.body), {
  headers: { "Content-Type": "text/plain; charset=utf-8" },
});
```

The CLI **doesn't need to parse SSE again**. It only reads bytes, decodes them, and accumulates text. `routeFocused` starts as `false`, giving the prompt input focus. Tab switches between the prompt input and RouteInput. The submit handler checks `isLoading` to prevent overlapping generations.

## 6. `/llm-hybrid`: keep the SDK on the server, read plain text in the CLI

The source is [`llm-hybrid-screen.tsx`](../apps/cli/src/components/llm-hybrid-screen.tsx). Its CLI workflow closely resembles `/llm-test`: shared schema validation, typed RPC, manual `completion` / `isLoading` / `error` state, and Tab-based focus switching.

### 6.1 CLI → Hono request

```http
POST /llm-hybrid
Content-Type: application/json
```

```json
{
  "prompt": "Explain Hono in one sentence."
}
```

The call is:

```ts
await api["llm-hybrid"].$post({ json: parsed.data });
```

The server also uses `zValidator("json", promptSchema)` and reads the validated body through `c.req.valid("json")`. This lets Hono typed RPC infer the `json` request parameter too.

### 6.2 Hono: keep only text from the SDK stream

```ts
const result = streamText({ model: aiModel, prompt: body.prompt });

return createTextStreamResponse({
  stream: toTextStream({ stream: result.stream }),
});
```

`streamText` still handles the provider call and upstream parsing. But it doesn't become UIMessage SSE this time:

- `toTextStream` selects `part.text` from SDK `text-delta` parts.
- `createTextStreamResponse` encodes the text as UTF-8 and returns `text/plain; charset=utf-8`.

An important detail in this version: `toTextStream` only selects text deltas. It doesn't turn other parts into text. SDK in-band error parts, finish reasons, and reasoning therefore don't reach the CLI as structured information. An underlying stream failure may still reject the reader. If an error only appears as a filtered-out part, the CLI may receive no text or a partial answer. The empty-result check catches “no text,” but receiving some text doesn't prove the answer completed successfully.

### 6.3 How both plain text pages read the stream

Both currently use code like this:

```ts
if (!response.ok || !response.body) {
  throw new Error(await response.text());
}

const reader = response.body.getReader();
const decoder = new TextDecoder();
let result = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  result += decoder.decode(value, { stream: true });
  setCompletion(result);
}

result += decoder.decode();
if (!result.trim()) {
  throw new Error("Model returned no text. Please retry or switch models.");
}
setCompletion(result);
```

Why `{ stream: true }`? UTF-8 bytes for a character can span chunks, especially for languages such as Chinese. The decoder needs to retain incomplete bytes and finish decoding them when the next chunk arrives. The final `decoder.decode()` flushes that state and shouldn't be skipped.

Why call `setCompletion(result)` each time? We want to render as text arrives, not wait for EOF. `catch` puts the error into UI state, and `finally` resets `isLoading` to `false`. Neither plain text page currently has an AbortController, a stop button, or conversation history.

## 7. `/chat`: the same protocol family as `/llm`, but messages replace a string

### 7.1 Bringing the initial prompt over from the home page

The home page's [`PromptTextarea`](../apps/cli/src/components/prompt-textarea.tsx) reads the textarea's `plainText` and calls:

```ts
navigate(routes.chat, { state: { prompt } });
```

[`ChatScreen`](../apps/cli/src/components/chat-screen.tsx) validates it with `chatStateSchema.safeParse(location.state)`. A valid prompt becomes an initial UIMessage:

```json
{
  "id": "user-1",
  "role": "user",
  "parts": [
    { "type": "text", "text": "Explain Hono in one sentence." }
  ]
}
```

A `useEffect` calls `sendMessage()` without arguments once to submit those existing initial messages. `hasSentInitialPrompt` guards against duplicate submission. Opening `/chat` directly without an initial prompt starts with an empty messages array and waits for user input.

### 7.2 CLI: useChat + DefaultChatTransport

```ts
const transport = new DefaultChatTransport({
  api: api.api.chat.$url().toString(),
});

const { messages, sendMessage, status, error, stop } = useChat({
  id: "chat-demo",
  messages: initialMessages,
  transport,
});
```

The actual component keeps the transport stable with `useMemo`. On submit, it trims the input and rejects empty messages or submissions during `submitted` / `streaming`. It then clears the input and calls `sendMessage({ text })`.

`useChat` manages a messages array, not a single completion string. The transport sends the current history to the server. The hook parses UIMessage events and gradually fills in the assistant's text part.

### 7.3 CLI → Hono request

```http
POST /api/chat
Content-Type: application/json
```

A first ordinary submission can look like this:

```json
{
  "id": "chat-demo",
  "messages": [
    {
      "id": "user-message-1",
      "role": "user",
      "parts": [{ "type": "text", "text": "What is Hono?" }]
    }
  ],
  "trigger": "submit-message"
}
```

`DefaultChatTransport` includes `id`, `messages`, `trigger`, and an optional `messageId` by default. For a new message, `messageId` is usually undefined and omitted by JSON serialization. Submitting an existing initial message can include it. The IDs above are illustrative; the actual home-page initial message uses `user-1`.

On the second turn, the request doesn't just send the newest sentence. It looks more like:

```json
{
  "id": "chat-demo",
  "messages": [
    { "id": "u1", "role": "user", "parts": [{ "type": "text", "text": "What is Hono?" }] },
    { "id": "a1", "role": "assistant", "parts": [{ "type": "text", "text": "Hono is a web framework." }] },
    { "id": "u2", "role": "user", "parts": [{ "type": "text", "text": "Can it run on Bun?" }] }
  ],
  "trigger": "submit-message"
}
```

The server currently only uses the validated `messages`. Its handler doesn't use `id`, `trigger`, or `messageId` to implement session or regeneration behavior, and there's no database-backed history. The context comes mainly from the CLI resending its messages on every request.

### 7.4 Hono: convert UIMessage into ModelMessage

```ts
const modelMessages = await convertToModelMessages(
  parsed.data.messages as UIMessage[],
);

const result = streamText({
  model: aiModel,
  messages: modelMessages,
  onEnd: ({ response }) => {
    // Log the requested model and response.modelId.
  },
});

return createUIMessageStreamResponse({
  stream: toUIMessageStream({ stream: result.stream }),
});
```

`UIMessage` is a UI-oriented shape with `id`, `parts`, and other fields. `convertToModelMessages` converts it into the representation used for model input. For text-only messages, you can think of this as translating text parts into user/assistant content the model can consume. It doesn't mean every UIMessage can be forwarded unchanged as an OpenAI request message.

Invalid JSON or missing/empty `messages` produces HTTP 400 with `{ "error": "..." }`. Since the schema only checks the outer array, invalid nested messages can still fail during conversion or later processing; they aren't guaranteed a validation 400 response.

The response uses the same UIMessage SSE protocol as `/api/llm`. The distinction is on the client: `useCompletion` builds a text string, while `useChat` maintains UIMessage history and message lifecycle. `ChatScreen` currently renders only `part.type === "text"`. No tools are configured, and reasoning/tool/source parts aren't displayed.

### 7.5 Status, stop, and model logging

- `submitted`: the request has been submitted and is waiting for a response.
- `streaming`: the assistant response is arriving.
- `ready`: another message can be sent.
- `error`: something failed; the UI displays the hook's error message.

The `[ press Esc to stop ]` text currently calls `stop()` through its **mouse handler**. The component's keyboard handler only handles `q`; it doesn't bind Esc. So pressing Esc doesn't trigger stop through this component despite the label. The hook's `stop()` aborts the client request, but this code doesn't guarantee the provider generation immediately stops too.

Only `/api/chat` has model comparison logging:

```text
[AI /api/chat] provider=... requestedModel=... responseModel=... modelIdMatch=... responseId=...
```

A match uses `console.log`; a mismatch uses `console.warn`. These values come from response metadata. An assistant's claim about its own model identity isn't a reliable configuration check. The other endpoints don't currently have this onEnd log.

## 8. Observe the requests and streams yourself

Open two terminals at the repository root:

```sh
bun run dev:server
```

```sh
bun run dev:cli
```

Check the server first:

```sh
curl http://localhost:3000/health
```

Then inspect the streams with `curl -N`. `-N` disables curl's own output buffering so it's easier to observe incremental output. It doesn't guarantee one network chunk per token.

```sh
curl -N http://localhost:3000/api/llm \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Explain Hono in one sentence."}'

curl -N http://localhost:3000/llm-test \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Explain Hono in one sentence."}'

curl -N http://localhost:3000/llm-hybrid \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Explain Hono in one sentence."}'

curl -N http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"id":"u1","role":"user","parts":[{"type":"text","text":"Explain Hono in one sentence."}]}]}'
```

The minimal chat body has no `id` or `trigger`, and still passes the current server schema. Those fields come from the default transport; they aren't required by this handler. Add curl's `-i` flag to see response headers as well.

Expect `data:` events from `/api/llm` and `/api/chat`, and only answer text from the other two. To check boundary validation, set the three prompt endpoints' prompt to `""`, or set chat's messages to `[]`.

A stream ending doesn't always mean the model completed a successful answer. Errors can occur after HTTP 200 is already sent. UIMessage streams have error events; plain text streams don't have that envelope. When debugging, check the status, Content-Type, body, and server log together.

Another timeout setting lives in [`apps/server/src/index.ts`](../apps/server/src/index.ts): the Bun bootstrap uses `idleTimeout: 0` to disable the server's idle timer. That's separate from the direct fetch's 60-second timeout and the helper's 60-second read timeout.

## 9. A suggested source-reading order

1. [`router.tsx`](../apps/cli/src/router.tsx): identify the CLI page routes.
2. [`client.ts`](../apps/cli/src/lib/client.ts): check the Hono address and typed RPC setup.
3. [`shared/index.ts`](../packages/shared/src/index.ts): inspect request shapes and validation boundaries.
4. [`llm-screen.tsx`](../apps/cli/src/components/llm-screen.tsx) → `/api/llm` in [`app.ts`](../apps/server/src/app.ts): follow the SDK pairing across both sides.
5. [`llm-test-screen.tsx`](../apps/cli/src/components/llm-test-screen.tsx) → `/llm-test` → [`openai-text-stream.ts`](../apps/server/src/lib/openai-text-stream.ts): follow upstream SSE being converted into plain text.
6. [`llm-hybrid-screen.tsx`](../apps/cli/src/components/llm-hybrid-screen.tsx) → `/llm-hybrid`: see how SDK invocation and a manual stream reader fit together.
7. [`chat-screen.tsx`](../apps/cli/src/components/chat-screen.tsx) → `/api/chat`: study UIMessage, history, and lifecycle.

To verify SDK protocol details, look inside the locally installed package at `ai/src/ui/call-completion-api.ts`, `ai/src/ui/http-chat-transport.ts`, `ai/src/ui-message-stream/`, and `ai/src/text-stream/`. The behavior described here was checked against the installed version; it's worth checking again after an upgrade.

## 10. Final comparison: the three approaches

What they share: all go through Hono, use the same provider/model configuration, and update the UI incrementally. All three LLM demos accept `{ prompt }` and don't automatically maintain multi-turn history. `/chat` is the multi-turn application of the first approach.

| Aspect | SDK + UIMessage stream: `/llm`, extended by `/chat` | Direct fetch + plain text: `/llm-test` | SDK + plain text: `/llm-hybrid` |
| --- | --- | --- | --- |
| CLI → Hono request | `/llm`: `useCompletion` sends `{ prompt }`; `/chat`: transport sends `{ messages, id, trigger, ... }` | Typed RPC `$post` sends `{ prompt }` | Typed RPC `$post` sends `{ prompt }` |
| Who calls the provider | `streamText` + `aiModel` | The server fetches `/chat/completions` directly | `streamText` + `aiModel` |
| Who parses the upstream stream | SDK adapter | `OpenaiTextStream` manually processes single-line JSON SSE | SDK adapter |
| Hono → CLI protocol | UIMessage JSON events over SSE; `text/event-stream` | UTF-8 plain text; `text/plain; charset=utf-8` | UTF-8 plain text; `text/plain; charset=utf-8` |
| How the CLI consumes it | Automatic parsing in `useCompletion` / `useChat` | Manual `getReader()` + `TextDecoder` + state | Manual `getReader()` + `TextDecoder` + state |
| Who owns UI state | Hooks own the main generation/message state | Component manages completion/loading/error | Component manages completion/loading/error |
| History | None in `/llm`; `/chat` sends current messages each time; no server database history | None; one user prompt per request | None; one prompt per request |
| Information beyond answer text | Protocol can represent lifecycle, reasoning, tool/data events, etc.; current UI mainly displays text and configures no tools | Only first-choice content is forwarded; other information is discarded | `toTextStream` keeps only text deltas; other information is discarded |
| Error delivery | Validation HTTP errors; generation errors can use UIMessage error events with generic details by default | Upstream HTTP status/text can be forwarded; helper uses stream errors after streaming starts; no error envelope | Validation HTTP errors; underlying stream failures can reject; SDK in-band error parts are filtered out |
| Stop / timeout | `/chat` exposes `stop()`, currently invoked by a mouse handler; no Esc binding; Bun idle timer disabled | 60-second upstream fetch timeout + 60-second timeout per helper read; no CLI stop | No CLI stop; no explicit handler timeout; Bun idle timer disabled |
| Current provider-specific option | SDK calls don't explicitly disable reasoning | OpenRouter request sets `reasoning.enabled = false` | SDK calls don't explicitly disable reasoning |
| Changing providers | OpenAI-compatible configuration is centralized in `ai-config`; another protocol still needs another adapter | Check and adapt the endpoint, request body, and SSE parser yourself | SDK handles invocation adaptation; the CLI's plain text reader can usually stay |
| What it's useful for | Learning SDK hooks and UIMessage lifecycle; multi-turn chat or UIs needing richer events | Learning real HTTP, SSE parsing, and stream lifecycle; a clearly defined compatible API integration | Separating model invocation from UI consumption; SDK on the server with a text-only CLI |
