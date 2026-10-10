# Learning Notes: From Four Endpoints to One `/chat`, with Strategies Across the Stack

[中文版](./chat-strategy-refactor.zh-CN.md)

This picks up where the earlier [LLM streaming notes](./llm-streaming-notes.en.md) left off. We originally put each approach behind a separate endpoint to make it easier to study. This refactor brings them into one API and lets the frontend choose an approach through an environment variable.

Let's go beyond a list of changed files. We'll follow a request from pressing Enter in the CLI through validation, strategy dispatch, provider invocation, response streaming, and frontend state updates. The examples reflect this refactor and the installed `ai@7.0.91`. SSE examples are illustrations, not a guarantee that every response will contain exactly the same events.

## 1. Get the count right: four old endpoints, three strategies

We had **four endpoints and three approaches**, not four approaches.

| Previous HTTP endpoint | Previous input | Approach | New strategy |
| --- | --- | --- | --- |
| `/api/llm` | `prompt` | SDK + UIMessage SSE | `sdk-ui` |
| `/api/chat` | `messages` | SDK + UIMessage SSE | `sdk-ui` |
| `/llm-test` | `prompt` | Direct fetch + upstream SSE parser + plain text | `direct-text` |
| `/llm-hybrid` | `prompt` | SDK + plain text | `sdk-text` |

The main difference between `/api/llm` and `/api/chat` was whether the input included history. Their provider invocation and downstream protocol were the same, so they don't need separate strategies.

The backend now has one generation endpoint:

```text
POST /chat
```

The four old generation endpoints were removed, with no compatibility aliases. `GET /` and `GET /health` still exist.

However, **the CLI still has four routes**: `/llm`, `/llm-test`, `/llm-hybrid`, and `/chat`. Those are page entries in React Router's memory router, not server endpoints. Similar names don't make them the same layer.

## 2. What did we actually separate?

Think of each request as three questions:

1. **What's the input?** A single `prompt`, or a multi-turn `messages` array?
2. **Who calls the provider?** The AI SDK, or our own `fetch`?
3. **What does the CLI receive?** UIMessage SSE, or plain text?

A `strategy` is a preset combination of the last two answers. The input format is separate.

```text
                       POST /chat
                            |
                   prompt OR messages
                            |
                    strategy registry
              +-------------+-------------+
              |             |             |
           sdk-ui       direct-text     sdk-text
              |             |             |
           AI SDK       direct fetch    AI SDK
              |             |             |
         UIMessage SSE   plain text    plain text
```

These aren't three different models. The server still selects `AI_PROVIDER` and `AI_MODEL`, and all three strategies use that provider/model configuration.

This also isn't an arbitrary combination system. The public API exposes only these three names. There's no `direct-ui`, and callers don't submit any combination of `invocation` and `protocol` they like. The SDK response adapters are separated internally for reuse, while the public contract remains three explicit presets.

## 3. Why call this a Strategy Pattern instead of a pile of conditionals?

The important part is that the route doesn't need to know how each approach invokes a model or transforms a stream.

In [`apps/server/src/app.ts`](../apps/server/src/app.ts), the route looks like this:

```ts
.post("/chat", zValidator("json", chatBodySchema), async (c) => {
  const body = c.req.valid("json");
  const input = await parseChatInput(body);
  return strategies[body.strategy](input, c.req.raw.signal);
});
```

There are just three things to understand here: validate, prepare the input, and select a handler. Provider headers, OpenAI-compatible request bodies, and SSE parsing no longer live inside the route.

[`chat-strategies.ts`](../apps/server/src/lib/chat-strategies.ts) returns a registry:

```ts
return {
  "sdk-ui": sdk("ui"),
  "direct-text": directText,
  "sdk-text": sdk("text"),
};
```

Every handler has the same internal contract:

```ts
type ChatHandler = (input: ChatInput, signal: AbortSignal) => Promise<Response>;
```

That's the useful part of the Strategy Pattern here: one entry point, one calling convention, replaceable behavior. We don't need a class hierarchy just to make it look like a pattern. A function factory and an object registry do the job.

`createChatStrategies({ model, config, fetchUpstream })` receives its dependencies, and `createApp(strategies)` receives the registry. Tests can inject a mock model or fake fetch instead of calling a real provider every time.

## 4. The `/chat` request contract: two input branches

### 4.1 A single `prompt`

```json
{
  "strategy": "sdk-ui",
  "prompt": "Explain ReadableStream in one sentence"
}
```

`promptSchema` requires a string between 1 and 2000 characters. It doesn't call `.trim()`, so a whitespace-only string can pass. “At least one character” doesn't mean “meaningful content.”

The three prompt pages validate imperative input with `promptSchema.safeParse({ prompt: value })` before sending, and the server validates again. CLI validation gives early feedback; server validation protects the API boundary.

### 4.2 Multi-turn `messages`

```json
{
  "strategy": "sdk-text",
  "messages": [
    {
      "id": "u1",
      "role": "user",
      "parts": [{ "type": "text", "text": "I'm learning Hono" }]
    },
    {
      "id": "a1",
      "role": "assistant",
      "parts": [{ "type": "text", "text": "Let's start with routes." }]
    },
    {
      "id": "u2",
      "role": "user",
      "parts": [{ "type": "text", "text": "How do they work with middleware?" }]
    }
  ]
}
```

This is the **UIMessage** format: `id`, `role`, and `parts`. It isn't the provider's `{ role, content }` format, and it isn't `ModelMessage`. The backend strategy converts the history into the appropriate provider input.

The shared schema first requires a non-empty array. Its elements remain `unknown` at that stage. The server then uses `safeValidateUIMessages` to validate the nested UIMessage structure; it doesn't cast `unknown[]` into `UIMessage[]` and hope for the best.

### 4.3 Choose exactly one input; strategy is optional

This request is invalid:

```json
{ "prompt": "Hello", "messages": [{ "id": "u1", "role": "user", "parts": [] }] }
```

Each schema branch uses `z.never().optional()` to exclude the other input, so this returns HTTP 400. Missing input, an empty `messages` array, or an unknown strategy also fails.

Omitting the strategy selects `sdk-ui`:

```json
{ "prompt": "Hello" }
```

There are **two defaults**: the CLI environment default and the server request-schema default. Normal CLI requests include an explicit strategy. A direct curl request that leaves it out still has a reasonable default.

## 5. How many validation layers does a request pass through?

```text
imperative input / React Router location.state
                   |
        CLI promptSchema / chatStateSchema
                   |
          SDK hook builds request body
                   |
         chatFetch: chatBodySchema.safeParse
                   |
         typed Hono RPC api.chat.$post
                   |
        server zValidator(chatBodySchema)
                   |
               parseChatInput
            +------+------+
            |             |
          prompt        messages
            |             |
            |      safeValidateUIMessages
            +------+------+
                   |
          validated internal ChatInput
                   |
            strategy-specific checks
```

[`packages/shared/src/index.ts`](../packages/shared/src/index.ts) is the common source for the request schema and strategy enum. `ChatStrategy` comes from `z.infer`, rather than a second manually maintained union.

[`chat-input.ts`](../apps/server/src/lib/chat-input.ts) prepares the internal input:

```ts
type ChatInput = { prompt: string } | { messages: UIMessage[] };
```

The strategy name doesn't need to travel through every provider adapter. By then, a handler has already been selected, and it needs only the input and abort signal.

If SDK history validation fails, the implementation throws `HTTPException(400, { message: "Invalid UIMessage history" })`. Hono handles that as an HTTP error response. This isn't the same response format as zValidator's validation error, and there isn't a custom unified JSON error envelope.

## 6. `sdk-ui`: SDK invocation, UIMessage SSE back to the CLI

This is the recommended default. Here's the full path:

```text
CLI PromptScreen                    CLI ChatScreen
 useCompletion(data)                 useChat
         |                               |
         |                       DefaultChatTransport
         +---------------+---------------+
                         |
                      chatFetch
                         |
                  api.chat.$post
                         |
                     POST /chat
                         |
                 strategy = sdk-ui
                         |
              prompt OR validated UIMessage[]
                         |
        [history: convertToModelMessages]
                         |
                  streamText(aiModel)
                         |
                    result.stream
                         |
                  toUIMessageStream
                         |
             createUIMessageStreamResponse
                         |
                  UIMessage SSE bytes
                         |
                 SDK stream consumer
                         |
              completion / messages state
                         |
                     OpenTUI render
```

A single prompt is passed as `prompt`. History first goes through `convertToModelMessages`. That's format conversion, not server-side conversation persistence.

The response adapter is essentially:

```ts
createUIMessageStreamResponse({
  stream: toUIMessageStream({ stream }),
});
```

The response uses `text/event-stream`, and the SDK adds headers such as `x-vercel-ai-ui-message-stream: v1`. An illustrative payload:

```text
data: {"type":"text-start","id":"t1"}

data: {"type":"text-delta","id":"t1","delta":"Hello"}

data: {"type":"text-end","id":"t1"}

data: {"type":"finish"}

data: [DONE]
```

The `text-delta.delta` field contains the new text. The `data:` prefix, JSON structure, and event type are protocol framing, not part of the answer.

In the installed SDK version, `useCompletion` with `streamProtocol: "data"` consumes the text events in UIMessage SSE. `useChat` uses `DefaultChatTransport` to update UIMessage state from those events. Don't take the name `data` as a reason to follow an older numbered data-stream tutorial.

The main reason to choose this strategy is that it preserves structured information. UIMessage streams have room for reasoning and tool UI later. But **the current ChatScreen renders only text parts**. This refactor doesn't already implement tools, persistence, or complete reasoning display.

## 7. `sdk-text`: same SDK invocation, a simpler downstream response

This shares the `sdk(...)` factory with `sdk-ui`, so request preparation, history conversion, `streamText`, and model-metadata logging use the same path.

```text
prompt / UIMessage history
             |
    same SDK invocation path
             |
       streamText(aiModel)
             |
         result.stream
             |
    TransformStream error guard
             |
         toTextStream
             |
   createTextStreamResponse
             |
       UTF-8 plain text
        +----+----+
        |         |
useCompletion   TextStreamChatTransport
  (text)              |
        |           useChat
        +----+----+
             |
        OpenTUI render
```

In [`chat-response-strategies.ts`](../apps/server/src/lib/chat-response-strategies.ts), `toTextStream` keeps only text deltas. The response looks roughly like this:

```http
Content-Type: text/plain; charset=utf-8

Hello, let's take a look at streams.
```

It's still sent incrementally as bytes, not held until the entire answer finishes. A network chunk boundary isn't necessarily a token boundary or a character boundary.

Why put an error guard before `toTextStream`? An SDK failure can arrive as an `error` part in `result.stream`. Plain `toTextStream` filters out non-text parts, which could make a partial answer look like it ended successfully.

Now an `error` part throws, failing the plain-text stream instead of silently losing the error. An HTTP 200 that's already been sent can't turn into a 500; the client encounters a stream or network error while reading the body.

Structured reasoning, usage, and tool events aren't returned as plain text. `TextStreamChatTransport` wraps the text back into frontend text UIMessage events so `useChat` can work with it. That doesn't recover the information discarded on the server.

## 8. `direct-text`: build the provider request ourselves, parse upstream SSE ourselves

This bypasses `streamText` for invocation and calls:

```text
${aiConfig.baseURL}/chat/completions
```

```text
CLI text-mode consumer
          |
      POST /chat
          |
 strategy = direct-text
          |
 prompt -> [{ role: "user", content: prompt }]
 history -> text-only { role, content }[]
          |
 direct fetch to provider /chat/completions
          |
 OpenAI-compatible SSE
          |
     OpenaiTextStream
   decode / buffer / parse / validate
          |
 choices[0].delta.content only
          |
   UTF-8 plain text response
          |
 useCompletion(text) / TextStreamChatTransport
```

An illustrative upstream request body:

```json
{
  "model": "<server-selected-model>",
  "stream": true,
  "reasoning": { "enabled": false },
  "messages": [{ "role": "user", "content": "Hello" }]
}
```

`reasoning: { enabled: false }` is added only for the `openrouter` provider. The SDK strategies don't explicitly add the same option. “Same model” doesn't mean every upstream option is identical.

### 8.1 Why does history support only text parts?

The direct adapter currently implements text-conversation mapping only. It preserves the role and concatenates the text parts of each message into `content`, without adding separators.

If a message has no parts, or includes a file, reasoning, tool, step marker, or other non-text part, it returns HTTP 400:

```text
direct-text only supports messages with text parts
```

That's the adapter's explicit scope. Passing SDK UIMessage validation doesn't mean the direct adapter can handle every part. Ordinary text history produced by `TextStreamChatTransport` fits this scope.

### 8.2 What does the parser actually do?

[`openai-text-stream.ts`](../apps/server/src/lib/openai-text-stream.ts) does the following:

1. Decode bytes with `TextDecoder` in streaming mode, preserving UTF-8 state across chunks.
2. Keep an unfinished line in a buffer and append the next chunk.
3. Find `data:` lines and validate their parsed JSON shape with Zod.
4. Skip comments, role-only chunks, reasoning-only chunks, and other chunks without content.
5. Extract only `choices[0].delta.content` and encode it into downstream bytes.
6. Finish on `[DONE]` or EOF; fail if no text ever arrived.
7. Cancel the reader and release its lock during cleanup or cancellation.

This is an adapter for the current OpenAI-compatible chunk format, not a universal SSE parser. For example, it parses JSON from individual `data:` lines, doesn't combine arbitrary multi-line SSE data, and takes only the first choice.

When it receives a comment or reasoning-only chunk, it keeps reading until text arrives or the stream ends. Finishing a pull too early without enqueuing anything can leave the downstream reader waiting for useful text.

## 9. Who reads the environment variable, and where are the defaults?

### 9.1 Strategy belongs to the CLI; provider and model belong to the server

The new [`apps/cli/.env.example`](../apps/cli/.env.example) contains:

```dotenv
API_URL=http://localhost:3000
CHAT_STRATEGY=sdk-ui
```

Configure it in `apps/cli/.env` and restart the CLI after editing. Or choose a strategy for one run from the repository root:

```sh
CHAT_STRATEGY=sdk-ui bun run dev:cli
CHAT_STRATEGY=direct-text bun run dev:cli
CHAT_STRATEGY=sdk-text bun run dev:cli
```

The server still owns `AI_PROVIDER`, `AI_MODEL`, and credentials. Changing the CLI strategy doesn't select a different model configuration.

The server isn't reading `CHAT_STRATEGY` and forcing it on every request. The CLI reads the environment variable, puts the strategy into each request, and the server dispatches based on that request. Direct API callers can select a strategy per request.

### 9.2 CLI configuration is parsed at module initialization

[`chat-config.ts`](../apps/cli/src/lib/chat-config.ts) is short:

```ts
export const chatStrategy = chatStrategySchema
  .default("sdk-ui")
  .parse(Bun.env.CHAT_STRATEGY);

export const completionStreamProtocol =
  chatStrategy === "sdk-ui" ? "data" : "text";
```

Only an absent value uses the default. A typo or an empty string isn't an automatic fallback; it fails startup validation. That prevents a bad setting from quietly selecting the wrong response parser.

This isn't a live strategy picker inside a page. Pages display the active strategy, but changing the environment variable requires restarting the CLI.

## 10. How do SDK hooks and typed Hono RPC fit together?

`useCompletion` and chat transports expect a fetch-shaped function. The project also wants server/CLI requests to go through typed RPC.

`chatFetch` in [`chat-transport.ts`](../apps/cli/src/lib/chat-transport.ts) bridges the two:

```text
SDK hook / transport
      |
fetch-shaped call(url, { body, signal })
      |
chatFetch
  JSON.parse -> unknown
  chatBodySchema.safeParse
      |
api.chat.$post({ json: parsed.data }, { init: { signal } })
      |
Hono ClientResponse
      |
new Response(body, { status, statusText, headers })
      |
SDK reads stream normally
```

A few details worth noticing:

- This adapter serves `/chat`; it isn't a general-purpose fetch implementation. The passed URL doesn't determine the destination. The typed client's `api.chat` does.
- The current SDK sends JSON as a string body, which the adapter parses. It doesn't support every possible Request or BodyInit form.
- The SDK can include metadata such as `id`, `trigger`, and `messageId`. The shared schema doesn't declare those fields, so Zod object parsing strips them. The server doesn't currently use them.
- `new Response(...)` doesn't consume the entire stream or convert it into JSON. It preserves the body stream, status, and headers for the SDK to read.
- Bun's `typeof fetch` includes `preconnect`. The adapter attaches that property with `Object.assign` to satisfy the type; this doesn't mean every request performs an extra preconnect operation.
- Typed RPC provides compile-time inference, not runtime validation. Both have their own jobs here.

`createChatTransport()` selects `DefaultChatTransport` or `TextStreamChatTransport` based on the strategy. Both use this bridge. Single-prompt completion uses `chatFetch` directly, with the matching `streamProtocol`.

## 11. Why do the three prompt pages share `PromptScreen`?

Previously, their main differences were the request endpoint and response reader. Now both the endpoint and strategy configuration are shared, maintaining three submit/stream-state implementations would just repeat work.

```text
/llm ---------> LlmScreen -----------+
/llm-test ----> LlmTestScreen -------+--> PromptScreen
/llm-hybrid --> LlmHybridScreen -----+      |
                                   title / active nav
                                          |
                                  useCompletion
                                          |
                                  env-selected strategy
```

Each wrapper passes only its title and active navigation entry. For example:

```tsx
return <PromptScreen title="LLM Hybrid" active="llmHybrid" />;
```

Opening `/llm-test` no longer automatically selects direct fetch. Opening `/llm-hybrid` doesn't automatically select SDK plain text either. The page names remain navigation entries; **the environment variable determines the actual approach**.

The shared component handles prompt state, input validation, completion, loading/error UI, Tab focus switching, and Esc stop. It sends a single `prompt`, without automatically including the previous completion in the next request.

The SDK reads the stream and updates `completion`; the component no longer implements its own reader loop. All three strategies use the same UI with the appropriate `data` or `text` mode.

## 12. How does `/chat` carry multi-turn history?

`ChatScreen` first reads the initial prompt from home with `chatStateSchema.safeParse(location.state)`. If it's valid and non-empty, it becomes an initial user UIMessage.

An effect calls `sendMessage()` to send that existing history, rather than inserting the same user message again. The `hasSentInitialPrompt` ref prevents repeated sends from the effect during that mount.

Later Enter submissions call `sendMessage({ text })`. `useChat` maintains frontend message state, and the transport sends history to `/chat`. The server invokes the model with the submitted history and streams the assistant response back.

```text
frontend history                     server
[user 1] --------------------------> call model
[user 1, assistant 1] <------------- stream answer 1
       |
append user 2
       |
[user 1, assistant 1, user 2] ------> call model with full history
```

There is currently no server session store or database conversation persistence. The server doesn't look up history by `chat-demo`. Metadata such as `id` is stripped by the shared schema; context comes from the request's `messages`.

ChatScreen renders only text parts. It uses the `submitted`/`streaming` statuses to avoid sending another message while generation is running. Chat input is trimmed before sending, while the single-prompt schema doesn't trim. The history branch doesn't apply the single-prompt 2000-character limit, and this refactor doesn't add a total-history size limit.

## 13. Errors, timeouts, and stopping aren't identical across strategies

### 13.1 Before a response starts

| Situation | Current behavior |
| --- | --- |
| Invalid outer body or strategy | zValidator returns HTTP 400 |
| Invalid UIMessage history | HTTP 400, `Invalid UIMessage history` |
| Non-text parts sent to direct strategy | HTTP 400 explaining the restriction |
| Direct upstream returns 429 or another error status | Forward upstream body and status |
| Direct upstream succeeds without a body | Return 502 |

There isn't a unified error JSON schema. CLI SDK consumers treat an HTTP error body as error information; the exact format depends on the layer that failed.

### 13.2 After a response starts

- `sdk-ui`: the SDK can send a UIMessage error event, with defaults that don't expose arbitrary server error details directly.
- `sdk-text`: the error guard fails the stream instead of filtering out errors and pretending generation succeeded.
- `direct-text`: the parser fails the downstream stream for upstream `error.message`, invalid JSON/chunks, or a result with no text.

Plain text has no separate error event. Appending JSON after a response has started would simply turn that JSON into part of the answer.

### 13.3 Two different timeout concepts

Direct fetch uses:

```ts
AbortSignal.any([signal, AbortSignal.timeout(60_000)])
```

This timeout starts when the signal is created. It isn't just a timeout for receiving HTTP headers; it can also abort while the upstream body is still being read.

The parser separately sets a 60-second timeout around each `reader.read()`. That's a timeout for waiting for the next chunk, not the same thing as a total-request deadline. The direct path currently has both mechanisms.

The SDK path passes the request signal to `streamText` but doesn't explicitly add the same 60-second deadline in this wrapper. The server bootstrap still uses `idleTimeout: 0`. Disabling Bun's server idle timeout doesn't remove provider or adapter timeouts.

### 13.4 Esc stop and exiting

Both prompt and chat pages connect Esc to the SDK's `stop()`. The abort signal travels from the hook or transport through `chatFetch`, RPC, and the Hono request signal, then into SDK invocation or direct fetch.

This gives cancellation a path to the upstream request. Whether a provider immediately stops computation depends on connection and provider behavior. Stopping isn't a persistence operation, and it doesn't delete a stored conversation.

Exiting OpenTUI still calls `renderer.destroy()` to restore terminal state.

## 14. What does model-metadata logging prove?

Both SDK strategies share `onEnd` logging:

```text
[AI /chat] provider=... requestedModel=... responseModel=...
modelIdMatch=... responseId=...
```

It compares the configured model ID with the response metadata's model ID. A match uses `console.log`; a mismatch uses `console.warn`.

That's useful for debugging configuration. It doesn't make a model's self-description in the answer a trustworthy identity check, and it isn't independent proof of the backend deployment. The direct strategy doesn't currently perform this metadata comparison; it parses the chunk fields needed for text output.

## 15. File map: where to look when changing behavior

| File | Responsibility |
| --- | --- |
| `packages/shared/src/index.ts` | Strategy enum, request schema, types |
| `apps/server/src/app.ts` | `/chat` route, validation middleware, dispatch |
| `apps/server/src/lib/chat-input.ts` | UIMessage runtime validation, internal input |
| `apps/server/src/lib/chat-strategies.ts` | Invocation, registry, history mapping |
| `apps/server/src/lib/chat-response-strategies.ts` | UI/text response adapters for SDK streams |
| `apps/server/src/lib/openai-text-stream.ts` | Direct upstream SSE to text bytes |
| `apps/server/src/lib/ai-config.ts` | Provider, model, and credential selection |
| `apps/cli/src/lib/client.ts` | Typed Hono RPC client |
| `apps/cli/src/lib/chat-config.ts` | Environment strategy and completion protocol |
| `apps/cli/src/lib/chat-transport.ts` | Typed RPC bridge and transport factory |
| `apps/cli/src/components/prompt-screen.tsx` | Single-prompt UI and completion |
| `apps/cli/src/components/chat-screen.tsx` | Multi-turn history UI and useChat |

Adding a fourth strategy usually means more than adding a name to the enum. You also need a handler, a response protocol decision, a matching CLI consumer, tests, and bilingual documentation. The CLI currently maps `sdk-ui` to data mode and everything else to text mode, so adding a new protocol needs particular care there.

## 16. Try the verification yourself

From the repository root:

```sh
bun run typecheck
bun test apps/server/src/lib apps/cli/src/lib/chat-transport.test.ts
```

This refactor's run passed 11 tests. The important coverage includes:

- Both SDK response strategies accept prompts and history.
- The direct strategy constructs the expected OpenAI-compatible request and preserves history roles/content.
- Invalid requests fail before model invocation; an omitted strategy defaults to `sdk-ui`.
- Direct upstream HTTP errors preserve the status.
- The SDK text path doesn't silently ignore in-band errors.
- All three CLI transports actually consume their matching SSE/plain-text response and produce the expected text, rather than just checking which object the factory returns.
- Existing parser tests cover comments, role/reasoning-only chunks, fragmented events, EOF, errors, and empty results.

The tests use mock providers. They don't prove that a real model is available, and they don't automate terminal UI interactions. A real server was also started, and `GET /health` returned `{"status":"ok"}`. Health proves the server can serve a request, not that a provider can generate an answer.

To inspect the wire format, start the server:

```sh
bun run dev:server
```

Then call each strategy:

```sh
curl -N -i http://localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d '{"strategy":"sdk-ui","prompt":"Say hello briefly"}'

curl -N -i http://localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d '{"strategy":"sdk-text","prompt":"Say hello briefly"}'

curl -N -i http://localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d '{"strategy":"direct-text","prompt":"Say hello briefly"}'
```

The first should show UIMessage SSE; the other two should show plain text. A real provider still needs valid credentials and can return rate limits or other upstream errors.

## 17. Put the three strategies side by side

| Comparison | `sdk-ui` | `direct-text` | `sdk-text` |
| --- | --- | --- | --- |
| Recommended default | **Yes** | No | No |
| Model invocation | AI SDK | Direct OpenAI-compatible fetch | AI SDK |
| Prompt/history | Supported | Text-only history supported | Supported |
| History conversion | `convertToModelMessages` | Manual role/content mapping | `convertToModelMessages` |
| Downstream protocol | UIMessage SSE | UTF-8 plain text | UTF-8 plain text |
| Frontend chat consumer | `DefaultChatTransport` | `TextStreamChatTransport` | `TextStreamChatTransport` |
| Frontend completion mode | `data` | `text` | `text` |
| Main parsing responsibility | SDK | Handwritten upstream parser on server, text consumer on CLI | SDK |
| Structured events preserved | Yes; rendering them is a separate decision | No | No |
| In-band errors | UIMessage error event | Downstream stream failure | Downstream stream failure |
| Explicit 60-second wrapper deadline | None added | Yes, plus a read timeout | None added |
| Model-metadata comparison | Yes | No | Yes |
| Best fit | Default chat and future structured UI | Learning/debugging the upstream wire format | Text-only output while keeping SDK invocation |

The mental model to keep is: **one API path doesn't mean one stream protocol, and one strategy selection doesn't make history and prompt the same input format.** The backend handler and frontend consumer have to agree for the refactor to work end to end.
