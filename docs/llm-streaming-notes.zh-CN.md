# 学习笔记：四个页面怎么和 LLM backend 配合

[English version](./llm-streaming-notes.en.md)

这篇笔记想解决一个很具体的问题：在 CLI 里按下 Enter 之后，prompt 到底去了哪里？model 返回的东西又是怎么一点点出现在屏幕上的？

我们按这个仓库的实际代码来走一遍 `/llm`、`/llm-test`、`/llm-hybrid`、`/chat`。这里的 frontend 是 OpenTUI + React CLI，backend 是跑在 Bun 上的 Hono。不是 browser app，但 React hook、HTTP request、ReadableStream 这些概念照样适用。

本文对应当前安装的 `ai@7.0.91`。代码示例里的 `result.stream`、`toUIMessageStream`、`toTextStream` 都来自这个版本；网上其他版本的教程可能写法不一样。协议示例是帮助理解的示意，chunk 内容和出现顺序以实际 response 为准。

## 1. 先把四个页面和四个 API 对上

| CLI route | Component | Hono API | CLI 怎么发 request | CLI 收到什么 |
| --- | --- | --- | --- | --- |
| `/llm` | `LlmScreen` | `POST /api/llm` | `useCompletion` 内部发 request | UIMessage stream，SSE |
| `/llm-test` | `LlmTestScreen` | `POST /llm-test` | Hono typed RPC `$post` | UTF-8 plain text stream |
| `/llm-hybrid` | `LlmHybridScreen` | `POST /llm-hybrid` | Hono typed RPC `$post` | UTF-8 plain text stream |
| `/chat` | `ChatScreen` | `POST /api/chat` | `useChat` + `DefaultChatTransport` | UIMessage stream，SSE |

注意，CLI route 和 API path 是两套东西。`/llm` 是 React Router memory router 中的页面地址，真正的 HTTP request 发给 `/api/llm`。而 `/llm-test`、`/llm-hybrid` 刚好两边同名，不代表所有页面都遵循这个规则。

可以先记住三种方案：

1. **SDK + UIMessage stream**：`/llm`，以及把它扩展成多轮会话的 `/chat`。
2. **直接 fetch + 自己处理 upstream SSE + plain text**：`/llm-test`。
3. **SDK 调 model + plain text + 自己读 stream**：`/llm-hybrid`。

这三个方案并不是三种 model。它们用的是同一套 provider/model 配置，主要区别在于谁负责调 model、谁负责处理 stream。

## 2. 共同底座：地址、provider、schema

### 2.1 Hono typed RPC 到底负责什么

[`apps/cli/src/lib/client.ts`](../apps/cli/src/lib/client.ts) 很短：

```ts
import { hc } from "hono/client";
import type { AppType } from "@bun-hono-opentui/server/app";

export const api = hc<AppType>(Bun.env.API_URL ?? "http://localhost:3000");
```

`AppType` 来自 [`apps/server/src/app.ts`](../apps/server/src/app.ts)。它让 CLI 能拿到 route、request 参数等 TypeScript 信息。`import type` 和 server 的 `./app` export 让 CLI 不需要把启动 server 的代码带进来。

不过 typed RPC **不会自动帮你解读 stream，也不会在 runtime 自动校验所有数据**。

- `/llm-test` 和 `/llm-hybrid` 用 `$post({ json: ... })`，RPC 负责 URL、JSON serialization 和 request 类型。
- `/llm` 和 `/chat` 只用 `$url().toString()` 拿到 API URL，真正发 request 的是 AI SDK 的 hook/transport。
- plain text response 仍然要自己读 `response.body`；不能因为用了 RPC 就对它调用 `response.json()`，更不能指望它变成一条完整 completion。

### 2.2 四个 endpoint 用同一套 model 配置

[`apps/server/src/lib/ai-config.ts`](../apps/server/src/lib/ai-config.ts) 负责配置：

| `AI_PROVIDER` | `baseURL` | API key variable | 默认 model |
| --- | --- | --- | --- |
| `openrouter`，当前代码默认值 | `https://openrouter.ai/api/v1` | `OPENAI_API_KEY` | `nvidia/nemotron-3.5-lightning:free` |
| `deepseek` | `https://api.deepseek.com` | `DEEPSEEK_API_KEY` | `deepseek-flash` |

`AI_MODEL` 可以覆盖默认 model。CLI 的 `API_URL` 选的是 Hono server 地址，不是 provider 地址。API key 留在 server，CLI 不需要持有它。

SDK 路径的配置是：

```ts
const provider = createOpenAI({
  baseURL: aiConfig.baseURL,
  apiKey: aiConfig.apiKey,
});

export const aiModel = provider.chat(aiConfig.model);
```

这里的 `createOpenAI` 是 OpenAI-compatible API adapter。名字里有 OpenAI，不代表你实际用的 model 一定来自 OpenAI。

### 2.3 shared schema 校验到哪一层

[`packages/shared/src/index.ts`](../packages/shared/src/index.ts) 定义：

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

这里省略了 error message，约束和源码一致。几个细节别漏掉：

- `promptSchema` 接收 `{ prompt: "..." }`，不是一个裸 string。OpenTUI `onSubmit` 给的 value 要先包成 object。
- prompt 长度是 1～2000，**没有 `.trim()`**。空 string 不通过，但纯空格目前会通过。
- `chatBodySchema` 只检查 `messages` 是非空 array，没有完整校验每个 UIMessage 或每个 part。后面的 `as UIMessage[]` 是 TypeScript cast，不是 runtime validation。
- `chatStateSchema` 用来检查 React Router `location.state`，它不是 `/api/chat` 的 HTTP body schema。
- `/llm-test`、`/llm-hybrid` 在 server 用 `zValidator("json", promptSchema)`；`/api/llm`、`/api/chat` 则在 handler 内手动 `safeParse`。

## 3. 先理解两跳 request 和两种下游协议

每次 generation 至少经过两跳：

```text
CLI ── HTTP request ──> Hono ── HTTP request ──> provider
CLI <── response stream ─ Hono <── upstream stream ─ provider
```

**provider → Hono 的格式，不一定等于 Hono → CLI 的格式。** 这正是三个 demo 值得一起看的地方。

### 3.1 UIMessage stream：SSE 是外壳，JSON event 是内容

`/api/llm` 和 `/api/chat` 的 response 使用这些 headers：

```http
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
x-vercel-ai-ui-message-stream: v1
x-accel-buffering: no
```

一个典型的 text response 大概长这样：

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

读这个示例时要抓住几件事：

- `data: ...` 加空行是 SSE framing，不是 assistant 正文。
- `text-delta.delta` 才是新增的文字；`id` 用来关联同一个 text part。
- `start` 可以带 optional `messageId`，当前 handler 没有自定义 message ID generator；不要假定每个 start event 都带它。
- `start-step` / `finish-step` 表示 model step；`finish` 表示 message 的结束信息；`[DONE]` 是 SSE stream 的结束 marker。
- 若 model 提供 reasoning，默认 `toUIMessageStream` 也可传出 reasoning events。当前 UI 只展示 text，不意味着 stream 永远只有 text events。
- stream 里也可以有 `{"type":"error","errorText":"..."}`。当前没有自定义 `onError`，SDK 默认会把相关 error detail 转成 `An error occurred.`。

同样叫 SSE，OpenAI-compatible provider 的 SSE payload 常见的是 `choices[0].delta.content`，而这里是 `type: "text-delta"`。**外壳一样，不代表里面的 JSON schema 一样。**

这是对 POST response body 的 streaming fetch，不是 CLI 用 `EventSource` 去订阅一个 GET endpoint。

### 3.2 plain text stream：只有文字，没有 event envelope

`/llm-test` 和 `/llm-hybrid` 成功时返回：

```http
Content-Type: text/plain; charset=utf-8
```

response body 就是：

```text
Hello world
```

网络可能先送来 `Hel`，再送来 `lo `，最后送来 `world`。但这个切分只是示意：一个 network chunk 不等于一个 token、一句话、一个 SSE event，甚至不保证是完整的 UTF-8 character。

plain text stream 没有 `data:`、没有 JSON envelope、没有 `[DONE]`。CLI 通过 `reader.read()` 返回 `done: true` 知道读完了。

它很容易显示，但也不会替你传递 message ID、finish reason、reasoning、tool call、usage 或结构化 error event。以后想传这些，需要另行设计协议。

### 3.3 四条调用链的 ASCII 流程图

先看 request 往哪里走，再从 provider 顺着 response 走回来。下面 `provider SSE` 表示当前 OpenAI-compatible adapter 对接的 upstream stream，不是 UIMessage SSE。

**`/llm`：SDK 两端配合**

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

**`/llm-test`：自己处理 upstream SSE**

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

**`/llm-hybrid`：SDK 调 model，CLI 自己读文字**

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

**`/chat`：把 history 一起发过去，再更新 assistant message**

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

这里的“循环”发生在 CLI 的 messages state 中；server 不是靠 `chat-demo` 从数据库取 history。四条 response 链里，只有 `/llm-test` 的 upstream parser 是项目自己写的，另外三条都由 SDK adapter 接手。

## 4. `/llm`：让 SDK 从调 model 到更新 completion 都帮你做

### 4.1 CLI：一个 prompt，一条 completion

源码在 [`llm-screen.tsx`](../apps/cli/src/components/llm-screen.tsx)：

```ts
const { completion, complete, isLoading, error } = useCompletion({
  api: api.api.llm.$url().toString(),
});
```

用户改 input 时，component 同步更新 React state 和 `promptRef.current`。提交时，如果没有正在 loading，就执行 `complete(promptRef.current)`。hook 发 request、读取 stream，并把累计文字放进 `completion`；React 再把它画出来。

这个页面没有维护 message history。连续提交两次 prompt，就是两次独立 generation，不会自动把上一次回答带给 model。

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

这是 `useCompletion` 内部生成的 body。当前页面没有配置额外 body field。server 的 `readPrompt` 读取 JSON 后用 `promptSchema.safeParse` 校验；invalid JSON 或 schema 不通过时，返回 HTTP 400 和 `{ "error": "..." }`。

### 4.3 Hono：SDK stream 转成 UIMessage stream

```ts
const result = streamText({ model: aiModel, prompt: body.prompt });

return createUIMessageStreamResponse({
  stream: toUIMessageStream({ stream: result.stream }),
});
```

可以把它分成三步：

1. `streamText` 调 provider，把 upstream response 变成 SDK 的 stream parts。
2. `toUIMessageStream` 把 SDK parts 变成 UIMessage chunks，比如 `text-delta`。
3. `createUIMessageStreamResponse` 把这些 chunks 包成 SSE HTTP response。

当前 `useCompletion` 默认 `streamProtocol` 是 `"data"`。在这个已安装版本里，它解析的正是 UIMessage SSE，然后把 `text-delta.delta` 拼进 completion；碰到 error event 会设置 error。不要把它误认为旧教程中的另一套 data stream 编码。

这一路的搭配是闭合的：server 输出 UIMessage stream，hook 按 UIMessage stream 读。如果只把 server 换成 plain text，而不调整 hook protocol，就对不上了。

## 5. `/llm-test`：自己调 provider，再把 SSE 拆成文字

这个方案很适合用来观察 HTTP 和 stream 本身，因为它没有使用 AI SDK 来调 model。

### 5.1 CLI → Hono request

源码在 [`llm-test-screen.tsx`](../apps/cli/src/components/llm-test-screen.tsx)。提交后先做：

```ts
const parsed = promptSchema.safeParse({ prompt: input });
if (!parsed.success) {
  // 展示 validation error，不发送 request
  return;
}

const response = await api["llm-test"].$post({ json: parsed.data });
```

发出的 request：

```http
POST /llm-test
Content-Type: application/json
```

```json
{
  "prompt": "Explain Hono in one sentence."
}
```

server 的 `zValidator` 再校验一次。schema validation failure 通常返回 HTTP 400 和 middleware 的 validation result JSON，malformed JSON 也会被 middleware 拒绝；它的 error body 不要假定和 `/api/llm` 的 `{ error }` 相同。CLI 当前统一读 `response.text()` 展示非 2xx response。

### 5.2 Hono → provider request

这次 server 明确调用：

```text
POST ${aiConfig.baseURL}/chat/completions
```

OpenRouter 配置下，就是 `https://openrouter.ai/api/v1/chat/completions`。headers：

```http
Authorization: Bearer <server-side API key>
Content-Type: application/json
```

body 示例：

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

`model` 用运行时配置值；`reasoning` 只在 `AI_PROVIDER === "openrouter"` 时加入。当前另外两个 LLM demo 和 `/chat` 的 SDK 调用没有显式传这个 option，所以不能认为它们与 direct fetch 的 upstream body 完全相同。

这里有 `AbortSignal.timeout(60_000)`，用于给 upstream fetch 设置 60 秒 timeout。它不是 CLI 的 timeout，也不是保证整个会话能无限持续。

### 5.3 provider → Hono：OpenAI-compatible SSE

upstream 常见 payload 示意：

```text
data: {"choices":[{"delta":{"role":"assistant"}}]}

data: {"choices":[{"delta":{"content":"Hello"}}]}

data: {"choices":[{"delta":{"content":" world"}}]}

data: {"choices":[{"delta":{},"finish_reason":"stop"}]}

data: [DONE]

```

[`OpenaiTextStream`](../apps/server/src/lib/openai-text-stream.ts) 负责处理这条 upstream stream：

1. `getReader()` 读取 bytes，用 `TextDecoder` 持续 decode。
2. 用 buffer 保留还没收完整的 line，避免 network chunk 从 JSON 中间切开。
3. 只处理以 `data:` 开头的 line，跳过 comment 和其他 line。
4. 遇到 `[DONE]` 就结束；否则先 `JSON.parse`，再用 zod 检查 chunk 的边界 shape。
5. 取 `choices[0].delta.content`，用 `TextEncoder` 编成 UTF-8 bytes 向下游发送。
6. role-only、reasoning-only、usage-only 等不含 content 的 chunk 不展示；读取不能因为没文字就提前停下。

这不是一个完整支持所有 SSE 特性的通用 parser。它面向这里常见的单行 JSON `data:` 格式，只取第一个 choice 的 text。`finish_reason`、usage、model metadata、reasoning 等信息不会转发给 CLI。

helper 每次 upstream read 还有 60 秒 inactivity timeout。若收到 chunk-level `error.message`、JSON/schema 解析失败、timeout，或者整个 stream 没有 text，它会记录 `[AI /llm-test] ...` 并让下游 stream error。无论正常结束还是失败，它都会尝试 cancel upstream reader 并 release lock。

如果 upstream 一开始就返回非 2xx，server 会把 response text 和 status 转给 CLI；如果 upstream 是成功 status 但没有 body，server 返回 502。已经开始发送 text 之后发生的 error，不能再改成一个新的 HTTP status；这里会走 stream error，而不是补一段 SSE error event。

### 5.4 Hono → CLI：已经是 plain text

```ts
return new Response(OpenaiTextStream(upstream.body), {
  headers: { "Content-Type": "text/plain; charset=utf-8" },
});
```

所以 CLI **不用再 parse SSE**。它只需要读 bytes、decode、累计文字。`/llm-test` 的 `routeFocused` 默认是 `false`，prompt input 默认拿到 focus；Tab 会在 prompt input 和 RouteInput 之间切换。Enter 提交时有 `isLoading` guard，避免重复发起 generation。

## 6. `/llm-hybrid`：server 保留 SDK，CLI 自己读 plain text

源码在 [`llm-hybrid-screen.tsx`](../apps/cli/src/components/llm-hybrid-screen.tsx)。它的 CLI 流程与 `/llm-test` 很接近：shared schema 校验、typed RPC 发 request、自己管理 `completion` / `isLoading` / `error`、Tab 切换 focus。

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

调用代码是：

```ts
await api["llm-hybrid"].$post({ json: parsed.data });
```

server 同样通过 `zValidator("json", promptSchema)` 校验，然后用 `c.req.valid("json")` 取 validated body。这也让 Hono typed RPC 能推断 `json` request 参数。

### 6.2 Hono：SDK stream 只留下 text

```ts
const result = streamText({ model: aiModel, prompt: body.prompt });

return createTextStreamResponse({
  stream: toTextStream({ stream: result.stream }),
});
```

`streamText` 仍负责 provider 调用和 upstream stream parsing。不同的是，这次不转 UIMessage SSE：

- `toTextStream` 从 SDK stream parts 中只取 `text-delta` 的 `part.text`。
- `createTextStreamResponse` 用 UTF-8 encoding 输出 `text/plain; charset=utf-8`。

特别留意当前版本的 `toTextStream`：它只筛选 text-delta，不会把其他 part 变成 text。于是 SDK 的 in-band error part、finish reason、reasoning 等不会作为结构化信息到达 CLI。若底层 stream 自身 error，reader 仍可能 reject；若 error 仅表现为被过滤的 part，则 CLI 可能读到空结果，或只读到一段 partial text。当前空结果检查能发现“没有 text”，但不能证明已有 text 就一定完整。

### 6.3 两个 plain text 页面怎么读 stream

两边目前都使用类似代码：

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

为什么要 `{ stream: true }`？因为一个中文 character 的 UTF-8 bytes 可能跨两个 chunk。让 decoder 保留中间状态，下一次 bytes 到了再拼完整，才不会出现乱码。最后无参数 `decoder.decode()` 是 flush，不应该省略。

为什么每次 `setCompletion(result)`？因为我们想边收到边画，不是等 EOF 后才显示整段。`catch` 把 error 放到 UI，`finally` 把 `isLoading` 设回 `false`。这两个页面目前没有 AbortController 或 stop 按钮，也没有会话 history。

## 7. `/chat`：协议和 `/llm` 同类，但数据从 string 变成 messages

### 7.1 初始 prompt 怎么从首页带过来

首页 [`PromptTextarea`](../apps/cli/src/components/prompt-textarea.tsx) 读取 textarea 的 `plainText`，然后：

```ts
navigate(routes.chat, { state: { prompt } });
```

[`ChatScreen`](../apps/cli/src/components/chat-screen.tsx) 用 `chatStateSchema.safeParse(location.state)` 检查它。成功时，把 prompt 变成初始 UIMessage：

```json
{
  "id": "user-1",
  "role": "user",
  "parts": [
    { "type": "text", "text": "Explain Hono in one sentence." }
  ]
}
```

`useEffect` 调一次无参数 `sendMessage()`，让已有 initial messages 发送出去；`hasSentInitialPrompt` guard 避免重复触发。直接打开 `/chat` 没有 initial prompt 时，messages 从空 array 开始，等用户输入。

### 7.2 CLI：useChat + DefaultChatTransport

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

源码里 transport 用 `useMemo` 保持稳定。用户提交时会先 `trim()`，空内容或正在 `submitted` / `streaming` 就不发；随后清空 input，调用 `sendMessage({ text })`。

`useChat` 管理的是 messages array，而不是单个 completion string。transport 把当前 history 一起发给 server，hook 解析 UIMessage events，把 assistant text part 一点点补全。

### 7.3 CLI → Hono request

```http
POST /api/chat
Content-Type: application/json
```

第一次普通提交的 body 可以是：

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

`DefaultChatTransport` 默认构造 `id`、`messages`、`trigger`、optional `messageId`。新 message 的 `messageId` 通常是 undefined，JSON serialization 会省略它；发送已有 initial message 时可以带它。上面的 ID 是示意，首页 initial message 的实际 ID 是 `user-1`。

第二轮不是只发送新一句话，而是类似：

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

server 当前只使用 validated `messages`。`id`、`trigger`、`messageId` 没有在 handler 中驱动 session 或 regeneration 逻辑，也没有数据库 history；上下文主要由 CLI 每次重新发送。

### 7.4 Hono：UIMessage 转成 ModelMessage

```ts
const modelMessages = await convertToModelMessages(
  parsed.data.messages as UIMessage[],
);

const result = streamText({
  model: aiModel,
  messages: modelMessages,
  onEnd: ({ response }) => {
    // 记录 requested model 和 response.modelId
  },
});

return createUIMessageStreamResponse({
  stream: toUIMessageStream({ stream: result.stream }),
});
```

`UIMessage` 是给 UI 使用的 shape，有 `id`、`parts` 等；`convertToModelMessages` 把它转换成 model API 需要的 message 表达。对纯 text message，可以理解为把 text parts 变成 model 能消费的 user/assistant content，但不能直接把所有 UIMessage 当作 OpenAI request message 原样转发。

如果 invalid JSON 或 `messages` 缺失/空 array，handler 返回 HTTP 400 和 `{ "error": "..." }`。由于 schema 只验证 array 外层，嵌套 message 不合法仍可能在转换或后续处理时失败，并不保证统一返回 validation 400。

response 协议和 `/api/llm` 相同，都是 UIMessage SSE。差别在于 `useCompletion` 只拼出 text string，`useChat` 会维护完整的 UIMessage history 和 message lifecycle。当前 `ChatScreen` 只渲染 `part.type === "text"`，没有配置 tools，也没有展示 reasoning/tool/source part。

### 7.5 status、stop 和 model logging

- `submitted`：request 已提交，正在等待 response。
- `streaming`：正在接收 assistant response。
- `ready`：可以继续发送。
- `error`：发生 error，UI 会显示 hook 的 error message。

当前 `[ press Esc to stop ]` text 的 **mouse handler** 会调用 `stop()`；component 的 keyboard handler 只处理 `q`，没有绑定 Esc。所以按字面提示按 Esc，目前不会由这段代码触发 stop。hook 的 `stop()` 会 abort client request，但这不等于代码已保证 provider generation 立即取消。

只有 `/api/chat` 配了 model 对照 logging：

```text
[AI /api/chat] provider=... requestedModel=... responseModel=... modelIdMatch=... responseId=...
```

相同用 `console.log`，不同用 `console.warn`。这些值是 response metadata；assistant 正文里“我是什么 model”的自述不是可靠的配置检查。其余 endpoint 当前没有这条 onEnd logging。

## 8. 怎么自己观察 request 和 stream

从 repo root 开两个 terminal：

```sh
bun run dev:server
```

```sh
bun run dev:cli
```

先检查 server：

```sh
curl http://localhost:3000/health
```

再用 `curl -N` 看 stream。`-N` 是关闭 curl 自己的 output buffering，方便观察边生成边输出；它不能保证每个 token 都单独到达。

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

`/api/chat` 的这个最小 body 没有 `id` 和 `trigger`，也能通过当前 server schema；它们是默认 transport 带的 field，不是当前 handler 的必填项。加上 curl 的 `-i` 可以一起查看 response headers。

预期：`/api/llm` 和 `/api/chat` 能看到 `data:` events；另外两个只看到正文。要检查边界 validation，可以把三个 prompt endpoint 的 prompt 改成 `""`，把 chat 的 messages 改成 `[]`。

stream 结束和 model 成功生成完整答案不是完全同一件事：HTTP status 已经是 200 后仍可能发生 stream error。UIMessage stream 有自己的 error event；plain text 则没有这种 envelope。debug 时要同时看 status、Content-Type、body 和 server log。

另一个容易混淆的 timeout 在 [`apps/server/src/index.ts`](../apps/server/src/index.ts)：Bun bootstrap 设置 `idleTimeout: 0`，关闭 server 的 idle timer。它和 direct fetch 的 60 秒 timeout、helper 的 60 秒 read timeout 是不同层的设置。

## 9. 对着源码复习时，建议按这个顺序读

1. [`router.tsx`](../apps/cli/src/router.tsx)：确认 CLI page routes。
2. [`client.ts`](../apps/cli/src/lib/client.ts)：确认 Hono server 地址与 typed RPC。
3. [`shared/index.ts`](../packages/shared/src/index.ts)：确认 body shape 和 validation 边界。
4. [`llm-screen.tsx`](../apps/cli/src/components/llm-screen.tsx) → [`app.ts`](../apps/server/src/app.ts) 的 `/api/llm`：理解 SDK 两端配合。
5. [`llm-test-screen.tsx`](../apps/cli/src/components/llm-test-screen.tsx) → `/llm-test` → [`openai-text-stream.ts`](../apps/server/src/lib/openai-text-stream.ts)：理解 upstream SSE 到 plain text 的转换。
6. [`llm-hybrid-screen.tsx`](../apps/cli/src/components/llm-hybrid-screen.tsx) → `/llm-hybrid`：看 SDK 和手动 stream reader 怎么拼起来。
7. [`chat-screen.tsx`](../apps/cli/src/components/chat-screen.tsx) → `/api/chat`：理解 UIMessage、history 和 lifecycle。

如果要核对 SDK protocol 的细节，可以看本地安装 package 的 `ai/src/ui/call-completion-api.ts`、`ai/src/ui/http-chat-transport.ts`、`ai/src/ui-message-stream/` 和 `ai/src/text-stream/`。这里的行为已经按安装版本核对过；升级后值得重新看一遍。

## 10. 最后比较：三个方案的异同

共同点先说一句：都经过 Hono、使用同一套 provider/model 配置、支持逐步更新 UI；三个 LLM demo 都接收 `{ prompt }`，都没有自动维护多轮 history。`/chat` 是第一种方案的多轮应用。

| 比较项 | SDK + UIMessage stream：`/llm`，扩展为 `/chat` | Direct fetch + plain text：`/llm-test` | SDK + plain text：`/llm-hybrid` |
| --- | --- | --- | --- |
| CLI → Hono request | `/llm` 用 `useCompletion` 发 `{ prompt }`；`/chat` 用 transport 发 `{ messages, id, trigger, ... }` | typed RPC `$post` 发 `{ prompt }` | typed RPC `$post` 发 `{ prompt }` |
| 谁调用 provider | `streamText` + `aiModel` | server 自己 `fetch` `/chat/completions` | `streamText` + `aiModel` |
| 谁处理 upstream stream | SDK adapter | `OpenaiTextStream` 手动处理单行 JSON SSE | SDK adapter |
| Hono → CLI protocol | UIMessage JSON events + SSE；`text/event-stream` | UTF-8 plain text；`text/plain; charset=utf-8` | UTF-8 plain text；`text/plain; charset=utf-8` |
| CLI 怎么消费 | `useCompletion` / `useChat` 自动解析 | 自己 `getReader()` + `TextDecoder` + state | 自己 `getReader()` + `TextDecoder` + state |
| 谁维护 UI state | hook 负责主要 generation/message state | component 自己维护 completion/loading/error | component 自己维护 completion/loading/error |
| history | `/llm` 没有；`/chat` 每次发送当前 messages；server 无数据库 history | 没有，每次只有一个 user prompt | 没有，每次只有一个 prompt |
| 除正文外的信息 | protocol 可表达 lifecycle、reasoning、tool/data 等；当前 UI 主要展示 text，未配置 tools | 只转发第一个 choice 的 content；其他信息丢弃 | `toTextStream` 只保留 text-delta；其他信息丢弃 |
| error 传递 | validation HTTP error；generation error 可通过 UIMessage error event，默认 detail 被泛化 | upstream HTTP status/text 可转发；开始 streaming 后 helper 用 stream error；无 error envelope | validation HTTP error；底层 stream error 可 reject；SDK in-band error part 被 text filter 丢弃 |
| stop / timeout | `/chat` 暴露 `stop()`，当前 mouse handler 可调用；没有 Esc binding；Bun idle timer 关闭 | upstream fetch 60 秒 timeout + helper 每次 read 60 秒 timeout；CLI 没有 stop | CLI 没有 stop；handler 没有显式配置 timeout；Bun idle timer 关闭 |
| 当前 provider-specific option | SDK 调用未显式禁用 reasoning | OpenRouter request 显式 `reasoning.enabled = false` | SDK 调用未显式禁用 reasoning |
| 改 provider 时 | OpenAI-compatible 配置集中在 `ai-config`；不同 protocol 的 provider 仍需换 adapter | request body、endpoint、SSE parser 都要自己检查适配 | 调 model 的适配由 SDK 接手，CLI plain text reader 通常可保留 |
| 更适合学什么 / 用在哪里 | 学 SDK hook、UIMessage lifecycle；适合多轮 chat 或需要 richer events 的 UI | 学真实 HTTP、SSE parsing、stream lifecycle；适合很明确的兼容 API 集成 | 学分离 model invocation 和 UI consumption；适合 server 想用 SDK、CLI 只需要文字的场景 |
