# 学习笔记：从四个 endpoint 到一个 `/chat`，strategy 怎么贯穿前后端

[English version](./chat-strategy-refactor.en.md)

这篇接着之前的 [LLM streaming 笔记](./llm-streaming-notes.zh-CN.md) 往下讲。之前我们把不同方案放在不同 endpoint 上，方便分别学习；这次把它们收进同一个 API，让 frontend 通过 env 选择方案。

我们不只看“改了哪些文件”，而是从 CLI 按下 Enter 开始，走完 request、validation、strategy dispatch、provider invocation、response stream、frontend state 更新这条链路。例子对应这次 refactor 的代码，以及安装的 `ai@7.0.91`。SSE 例子是示意，不是承诺每次都会出现完全相同的 events。

## 1. 先把数量讲清楚：之前四个 endpoint，现在三个 strategy

之前是 **四个 endpoint、三种方案**，不是四种方案。

| 之前的 HTTP endpoint | 之前的输入 | 方案 | 现在的 strategy |
| --- | --- | --- | --- |
| `/api/llm` | `prompt` | SDK + UIMessage SSE | `sdk-ui` |
| `/api/chat` | `messages` | SDK + UIMessage SSE | `sdk-ui` |
| `/llm-test` | `prompt` | direct fetch + upstream SSE parser + plain text | `direct-text` |
| `/llm-hybrid` | `prompt` | SDK + plain text | `sdk-text` |

`/api/llm` 和 `/api/chat` 主要差在输入是不是 history。它们的 provider invocation 和 downstream protocol 是同一套，所以没有必要算成两个 strategy。

现在 backend 只保留一个 generation endpoint：

```text
POST /chat
```

旧的四个 generation endpoint 被移除了，没有 compatibility alias。`GET /` 和 `GET /health` 仍然存在。

不过 **CLI route 还保留四个**：`/llm`、`/llm-test`、`/llm-hybrid`、`/chat`。这些是 React Router memory router 的页面入口，不是 server endpoint。名字相似，也要把这两层分开看。

## 2. 这次真正拆开的是什么

把一个 request 想成三个问题，事情就简单了：

1. **输入是什么？** 单次 `prompt`，还是多轮 `messages`？
2. **谁去调 provider？** AI SDK，还是我们直接 `fetch`？
3. **CLI 收什么？** UIMessage SSE，还是 plain text？

`strategy` 是后两个问题的一个预设组合，输入格式是独立的。

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

这里不是让每个 strategy 使用一个不同 model。`AI_PROVIDER` 和 `AI_MODEL` 仍由 server 配置，三种 strategy 使用同一套 provider/model 选择。

也不是一个任意组合系统。当前 API 只暴露这三个名字，没有 `direct-ui`，也没有让调用方随意提交一个 `invocation` + `protocol` 组合。代码把 SDK 的 response adapter 分开了，方便共享，但公共 contract 仍然是三个明确的 preset。

## 3. 为什么说是类似 Strategy Pattern，而不是一堆 if/else

关键在于：route 不需要知道每个方案内部怎么调 model、怎么转 stream。

[`apps/server/src/app.ts`](../apps/server/src/app.ts) 里，route 做的是：

```ts
.post("/chat", zValidator("json", chatBodySchema), async (c) => {
  const body = c.req.valid("json");
  const input = await parseChatInput(body);
  return strategies[body.strategy](input, c.req.raw.signal);
});
```

看这个 handler 时，只要理解三步：validation、整理 input、选择 handler。它不再包含 provider headers、OpenAI-compatible request body、SSE parsing 等细节。

[`chat-strategies.ts`](../apps/server/src/lib/chat-strategies.ts) 返回 registry：

```ts
return {
  "sdk-ui": sdk("ui"),
  "direct-text": directText,
  "sdk-text": sdk("text"),
};
```

所有 handler 都遵守同一个内部 contract：

```ts
type ChatHandler = (input: ChatInput, signal: AbortSignal) => Promise<Response>;
```

这就是这里的 Strategy Pattern 核心：同一个入口、同一种调用方式，替换内部行为。没有为了形式加 class hierarchy；用 function factory 和 object registry 已经够了。

`createChatStrategies({ model, config, fetchUpstream })` 接收依赖，`createApp(strategies)` 接收 registry。这样测试可以传 mock model 或 fake fetch，而不是每次都访问真实 provider。

## 4. `/chat` 的 request contract：两个输入分支

### 4.1 单次 `prompt`

```json
{
  "strategy": "sdk-ui",
  "prompt": "用一句话解释 ReadableStream"
}
```

`promptSchema` 要求 string 长度为 1 到 2000。它没有 `.trim()`，所以纯空白 string 也可能通过 schema；不要把“长度至少 1”理解成“内容一定有意义”。

三个 prompt 页面会在发 request 前用 `promptSchema.safeParse({ prompt: value })` 检查 imperative input 的值，server 再检查一次。CLI validation 是让用户尽早看到问题，server validation 才是 API boundary。

### 4.2 多轮 `messages`

```json
{
  "strategy": "sdk-text",
  "messages": [
    {
      "id": "u1",
      "role": "user",
      "parts": [{ "type": "text", "text": "我正在学 Hono" }]
    },
    {
      "id": "a1",
      "role": "assistant",
      "parts": [{ "type": "text", "text": "那我们先从 route 开始。" }]
    },
    {
      "id": "u2",
      "role": "user",
      "parts": [{ "type": "text", "text": "它和 middleware 怎么配合？" }]
    }
  ]
}
```

这里是 **UIMessage** 格式：`id`、`role`、`parts`。不是 provider 的 `{ role, content }` 格式，也不是 `ModelMessage`。把 history 发给 backend 后，由 strategy 转成对应的 provider input。

schema 首先要求 `messages` 是 non-empty array。内部 element 暂时保留为 `unknown`，之后在 server 用 `safeValidateUIMessages` 检查完整 UIMessage shape；不是把 `unknown[]` 强行 cast 成 `UIMessage[]`。

### 4.3 只能选一个输入，strategy 可以省略

下面这个 request 是错误的：

```json
{ "prompt": "你好", "messages": [{ "id": "u1", "role": "user", "parts": [] }] }
```

两个分支分别用 `z.never().optional()` 排除另一种输入，所以它会返回 HTTP 400。缺少输入、空 `messages`、非法 strategy 也会失败。

省略 strategy 则使用 `sdk-ui`：

```json
{ "prompt": "你好" }
```

注意，`sdk-ui` 有 **两处默认值**：CLI env 默认值和 server request schema 默认值。正常 CLI request 会明确带 strategy；直接 curl 省略它时，server 仍有合理默认行为。

## 5. Validation 实际经过了几层

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

[`packages/shared/src/index.ts`](../packages/shared/src/index.ts) 是 request schema 和 strategy enum 的共同来源。`ChatStrategy` 用 `z.infer` 得到，避免手写另一套 union。

[`chat-input.ts`](../apps/server/src/lib/chat-input.ts) 则负责内部输入：

```ts
type ChatInput = { prompt: string } | { messages: UIMessage[] };
```

这样 route 的 `strategy` 不会一路传到每个 provider adapter。strategy 已经选完了，handler 只需要输入和 abort signal。

SDK history validation 失败时，当前实现抛出 `HTTPException(400, { message: "Invalid UIMessage history" })`。Hono 默认把它作为 HTTP error response 处理。它和 zValidator 的 validation response 不是统一的自定义 JSON envelope。

## 6. `sdk-ui`：SDK 调 model，UIMessage SSE 回 CLI

这是推荐默认方案。先看完整链路：

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

单次输入直接传 `prompt`；history 先经过 `convertToModelMessages`。这一步是 format conversion，不负责 server-side conversation persistence。

response adapter 的核心是：

```ts
createUIMessageStreamResponse({
  stream: toUIMessageStream({ stream }),
});
```

response 是 `text/event-stream`，SDK 还会带 `x-vercel-ai-ui-message-stream: v1` 等 headers。示意 payload：

```text
data: {"type":"text-start","id":"t1"}

data: {"type":"text-delta","id":"t1","delta":"你好"}

data: {"type":"text-end","id":"t1"}

data: {"type":"finish"}

data: [DONE]
```

这里的 `text-delta.delta` 才是新增文本。`data:`、JSON、event type 都是 protocol，不是回答正文。

`useCompletion` 的 `streamProtocol: "data"` 在当前 SDK 版本里消费 UIMessage SSE 的文本 events；`useChat` 使用 `DefaultChatTransport`，按这些 events 更新 UIMessage state。虽然名字叫 `data`，不能据此去套旧版本的 numbered data-stream 教程。

选择它的主要理由是保留结构化信息。以后如果需要 reasoning/tool UI，UIMessage protocol 有这类表达能力。但 **当前 ChatScreen 只 render text parts**，并没有已经实现 tools、持久化或者完整 reasoning 展示。

## 7. `sdk-text`：还是 SDK，只把下游 response 简化成文本

这一条和 `sdk-ui` 共享同一个 `sdk(...)` factory，所以 request preparation、history conversion、`streamText`、model metadata logging 都是一套。

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

[`chat-response-strategies.ts`](../apps/server/src/lib/chat-response-strategies.ts) 里，`toTextStream` 只保留 text deltas。response 大致是：

```http
Content-Type: text/plain; charset=utf-8

你好，今天我们来看看 stream。
```

实际传输还是一块块 bytes，不是等完整回答结束后才一次发送。网络 chunk boundary 不等于 token boundary，也不等于一个汉字的 boundary。

为什么前面还有一个 error guard？因为 SDK error 可能作为 `result.stream` 中的 `error` part 出现。单纯 `toTextStream` 会把非 text parts 过滤掉，让部分回答看起来像正常结束。

现在遇到 `part.type === "error"` 会 throw，让 plain-text stream 失败，而不是悄悄把错误吃掉。已经发送的 HTTP 200 不能再变成 500；client 会在读 body 时遇到 stream/network error。

reasoning、usage、tool events 等结构化内容不会作为 plain text 一起返回。`TextStreamChatTransport` 会把文本重新包装成 frontend 的 text UIMessage events，方便 `useChat` 工作；这不是把被丢掉的信息还原回来。

## 8. `direct-text`：自己构造 provider request，自己拆 upstream SSE

这条完全绕过 `streamText` 的 invocation，直接访问：

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

示意 upstream body：

```json
{
  "model": "<server-selected-model>",
  "stream": true,
  "reasoning": { "enabled": false },
  "messages": [{ "role": "user", "content": "你好" }]
}
```

`reasoning: { enabled: false }` 仅在 provider 为 `openrouter` 时添加。SDK 两个 strategy 没有显式添加相同 option，所以“同一 model”不表示每个 upstream option 都完全相同。

### 8.1 history 为什么只接受 text parts

当前 direct adapter 只实现 text conversation mapping。它保留 role，把一个 message 的 text parts 顺序拼接成 `content`，不额外插入 separator。

如果 parts 为空，或包含 file、reasoning、tool、step marker 等非 text part，就返回 HTTP 400：

```text
direct-text only supports messages with text parts
```

这是明确的 adapter scope。即使某个 UIMessage 能通过 SDK validation，也不代表 direct adapter 能处理。`TextStreamChatTransport` 产生的常规纯文本 history 符合这个 scope。

### 8.2 parser 真正在做什么

[`openai-text-stream.ts`](../apps/server/src/lib/openai-text-stream.ts) 做的是：

1. 用 `TextDecoder` 的 streaming mode 解码 bytes，保留跨 chunk 的 UTF-8 状态。
2. 把尚未读完整的一行留在 buffer，下一次再拼上。
3. 查找 `data:` 行，对 JSON payload 用 Zod 检查 shape。
4. 跳过 comments、role-only chunks、reasoning-only chunks 等没有 content 的数据。
5. 只提取 `choices[0].delta.content`，再 encode 为下游 bytes。
6. 遇到 `[DONE]` 或 EOF 结束；始终没收到 text 则报错。
7. 在 cleanup/cancel 时 cancel reader 并 release lock。

它是针对当前 OpenAI-compatible chunk 格式的 adapter，不是支持所有 SSE event 用法的通用 parser。比如当前逻辑按单行 `data:` JSON 来解析，没有实现任意 multi-line SSE data 合并，也只取第一个 choice。

遇到 comment 或 reasoning-only chunk 时，parser 会继续读到 text 或结束。不要在没有 enqueue 任何内容时就轻易结束一次 pull，否则可能让下游 reader 等不到后续有效文本。

## 9. env 谁负责读？默认值在哪里？

### 9.1 strategy 是 CLI 配置，provider/model 是 server 配置

新增的 [`apps/cli/.env.example`](../apps/cli/.env.example) 给出了：

```dotenv
API_URL=http://localhost:3000
CHAT_STRATEGY=sdk-ui
```

你可以在 `apps/cli/.env` 中配置，修改后重启 CLI。也可以在 repository root 为单次运行指定：

```sh
CHAT_STRATEGY=sdk-ui bun run dev:cli
CHAT_STRATEGY=direct-text bun run dev:cli
CHAT_STRATEGY=sdk-text bun run dev:cli
```

server 的 `AI_PROVIDER`、`AI_MODEL` 和 credentials 继续归 server；它们不会随着 CLI strategy 改成另一套 model。

当前不是 server 读取 `CHAT_STRATEGY` 并强制所有 request 使用它，而是 CLI 读取 env，把 strategy 放进每个 request，server 根据 request dispatch。直接调用 API 的用户可以逐次选择。

### 9.2 CLI 配置只在 module 初始化时解析

[`chat-config.ts`](../apps/cli/src/lib/chat-config.ts) 的逻辑很短：

```ts
export const chatStrategy = chatStrategySchema
  .default("sdk-ui")
  .parse(Bun.env.CHAT_STRATEGY);

export const completionStreamProtocol =
  chatStrategy === "sdk-ui" ? "data" : "text";
```

没有配置时才走 default。拼错值、空 string 都不是“自动 fallback”，而是启动 validation 失败。这样不会因为 env 写错，让 frontend 用了错误的 parser 却还以为配置成功。

这也不是页面内的 live strategy picker。页面显示当前 strategy，但切换 env 后需要重新启动 CLI。

## 10. SDK hook 和 typed Hono RPC 怎么接起来

`useCompletion` 和 chat transport 都希望拿到一个 fetch-shaped function，但项目希望跨 server/CLI 的调用仍通过 typed RPC。

[`chat-transport.ts`](../apps/cli/src/lib/chat-transport.ts) 里的 `chatFetch` 就是 bridge：

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

几个容易忽略的细节：

- adapter 只服务 `/chat`，不是 general-purpose fetch。传入的 URL 不决定最终 destination，typed client 的 `api.chat` 才决定。
- 当前 SDK 用 string body 发送 JSON；adapter 从这个 body 解析 request。它没有实现所有可能的 Request/BodyInit 形式。
- SDK 可能带 `id`、`trigger`、`messageId` 等 metadata。共享 schema 没有声明这些字段，Zod object parsing 会剥掉它们；server 当前不使用这些字段。
- `new Response(...)` 不会把 stream 全部读完，也不会把 response 转为 JSON。它保留 body stream、status 和 headers，让 SDK 接着读。
- Bun 的 `typeof fetch` 包含 `preconnect`，adapter 通过 `Object.assign` 带上该 property 来满足类型要求；不表示每次 request 都额外执行 preconnect。
- typed RPC 提供 compile-time inference，不代替 runtime validation。两者在这里各做各的事。

`createChatTransport()` 根据 strategy 返回 `DefaultChatTransport` 或 `TextStreamChatTransport`，都使用这个 bridge。单次 completion 则直接使用 `chatFetch`，同时设好 `streamProtocol`。

## 11. 三个 prompt 页面为什么共享 `PromptScreen`

之前这三个页面的不同，主要就是 request endpoint 和 response reader。现在 endpoint 和 strategy 都统一配置了，再保留三套 submit/stream state 就会重复。

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

wrapper 只传页面标题和 active nav。比如：

```tsx
return <PromptScreen title="LLM Hybrid" active="llmHybrid" />;
```

所以现在进入 `/llm-test` 并不自动选择 direct fetch；进入 `/llm-hybrid` 也不自动选择 SDK plain text。页面名字是保留下来的入口，**env 才决定实际方案**。

共享组件负责 prompt state、input validation、`completion`、loading/error UI、Tab focus 切换和 Esc stop。它发的是单次 `prompt`，没有把上一次 completion 自动放进下一次 request。

SDK 负责消费 stream 后更新 `completion`；组件不再手写 reader loop。三个 strategy 都能通过相应的 `data`/`text` mode 使用同一套 UI。

## 12. `/chat` 的多轮 history 具体怎么走

`ChatScreen` 先用 `chatStateSchema.safeParse(location.state)` 读取从 home 带来的 initial prompt。成功且非空时，把它放进 initial user UIMessage。

`useEffect` 调 `sendMessage()` 发送已有 initial history，而不是又插入一次同样的 user message。`hasSentInitialPrompt` ref 防止同一次 mount 的 effect 重复发送。

后续 Enter 调 `sendMessage({ text })`。`useChat` 维护 frontend message state，transport 把 history 发给 `/chat`。server 根据这次 history 调 model，再把 assistant response 返回。

```text
frontend history                     server
[user 1] --------------------------> call model
[user 1, assistant 1] <------------- stream answer 1
       |
append user 2
       |
[user 1, assistant 1, user 2] ------> call model with full history
```

当前没有 server session store，没有数据库 conversation persistence，也没有凭 `chat-demo` 在 server 查历史。`id` 等 metadata 被共享 schema 去掉了；上下文来自 request 的 `messages`。

ChatScreen 只 render text parts，使用 status 判断 `submitted`/`streaming`，避免生成过程中又提交一条。chat input 会先 `.trim()`；单次 prompt schema 本身则不 trim。history branch 没有应用单次 prompt 的 2000 字符上限，也没有新增总 history 长度限制。

## 13. 错误、timeout、stop：三种方案并不完全一样

### 13.1 response 开始前

| 场景 | 当前行为 |
| --- | --- |
| 不合法的外层 body/strategy | zValidator 返回 HTTP 400 |
| 不合法的 UIMessage history | HTTP 400，`Invalid UIMessage history` |
| direct strategy 收到非 text parts | HTTP 400，明确说明限制 |
| direct upstream 返回 429/其他 error status | 转发 upstream body/status |
| direct upstream 成功但没有 body | 返回 502 |

这不是一个统一 error JSON schema。CLI SDK consumer 会把 HTTP error body 作为 error 信息处理，具体格式取决于发生问题的层。

### 13.2 response 已经开始后

- `sdk-ui`：SDK 可发送 UIMessage error event，默认不会直接把任意 server error 细节全部发给用户。
- `sdk-text`：error guard 让 stream 失败，避免过滤错误后假装成功。
- `direct-text`：parser 对 upstream `error.message`、不合法 JSON/chunk、无 text 结果等报错，error downstream stream。

plain text 没有与普通文本分离的 error event。不要在 stream 已经开始后把一个 JSON error 接在回答后面，那只会变成回答正文。

### 13.3 timeout 的两层含义

direct fetch 使用：

```ts
AbortSignal.any([signal, AbortSignal.timeout(60_000)])
```

这个 timeout 从 signal 创建时开始计算，不只是等 HTTP headers 的 timeout；upstream body 还在读时也可能被 abort。

parser 还对每次 `reader.read()` 设了 60 秒 timeout。这是等下一个 chunk 的 timeout，和总请求 deadline 是两回事。direct path 当前同时有这两个机制。

SDK path 把 request signal 传给 `streamText`，没有在这次 wrapper 中显式加同样的 60 秒 deadline。server bootstrap 的 `idleTimeout: 0` 也仍保留；禁用 Bun server idle timeout 不等于所有 provider/adapter timeout 都不存在。

### 13.4 Esc stop 和退出

prompt 页面和 chat 页面都把 Esc 接到 SDK `stop()`。abort signal 从 hook/transport 经过 `chatFetch`、RPC、Hono request signal，再传给 SDK invocation 或 direct fetch。

这条链路让取消有机会传到 upstream，但实际 provider 是否立即停止计算，取决于连接和 provider 行为。它也不是 server persistence 操作，不会“删除一条已保存的 conversation”。

退出 OpenTUI 仍通过 `renderer.destroy()`，恢复 terminal state。

## 14. model metadata logging 能证明什么

两个 SDK strategy 共用 `onEnd` logging：

```text
[AI /chat] provider=... requestedModel=... responseModel=...
modelIdMatch=... responseId=...
```

它比较配置的 model ID 和 response metadata 的 model ID。匹配用 `console.log`，不匹配用 `console.warn`。

这对排查配置有用，但不意味着 model 在正文自称的名字就是可信身份，也不是 backend deployment 的独立证明。direct strategy 当前没有同样的 metadata comparison logging；它只解析回答所需的 chunk fields。

## 15. 文件地图：需要改行为时去哪找

| 文件 | 职责 |
| --- | --- |
| `packages/shared/src/index.ts` | strategy enum、request schema、类型 |
| `apps/server/src/app.ts` | `/chat` route、validation middleware、dispatch |
| `apps/server/src/lib/chat-input.ts` | UIMessage runtime validation、内部 input |
| `apps/server/src/lib/chat-strategies.ts` | invocation、registry、history mapping |
| `apps/server/src/lib/chat-response-strategies.ts` | SDK stream 的 UI/text response adapter |
| `apps/server/src/lib/openai-text-stream.ts` | direct upstream SSE 到 text bytes |
| `apps/server/src/lib/ai-config.ts` | provider/model/credentials 选择 |
| `apps/cli/src/lib/client.ts` | typed Hono RPC client |
| `apps/cli/src/lib/chat-config.ts` | env strategy 和 completion protocol |
| `apps/cli/src/lib/chat-transport.ts` | typed RPC bridge 和 transport factory |
| `apps/cli/src/components/prompt-screen.tsx` | 单次 prompt UI 和 completion |
| `apps/cli/src/components/chat-screen.tsx` | 多轮 history UI 和 useChat |

要加第四个 strategy，通常不只是往 enum 添一个名字。还要实现 handler、决定 response protocol、更新 CLI consumer 选择、补测试和对应的双语文档。当前 CLI 用“`sdk-ui` 走 data，其他走 text”的映射，新增 protocol 时尤其要一起检查。

## 16. 自己验证一遍

从 repository root：

```sh
bun run typecheck
bun test apps/server/src/lib apps/cli/src/lib/chat-transport.test.ts
```

本次执行结果为 11 tests passed。覆盖的重点是：

- SDK 两种 response strategy 都能接受 prompt/history。
- direct strategy 正确构造 OpenAI-compatible request，保留 history role/content。
- 非法 request 在调用 model 前失败；省略 strategy 时使用 `sdk-ui`。
- direct upstream HTTP error 保留 status。
- SDK text path 不会悄悄忽略 in-band error。
- 三种 CLI transport 真正消费对应的 SSE/plain text，得到同样的文本，而不是只检查 factory 返回类型。
- 原有 parser tests 覆盖 comments、role/reasoning-only chunks、fragmented event、EOF、error 和 empty result。

测试里的 provider 是 mock，不会验证真实 model 的可用性，也没有自动化终端 UI 点击测试。本次另启动了真实 server，`GET /health` 返回 `{"status":"ok"}`；health 证明 server 可服务，不证明 provider 可生成。

想看 wire format，可以先启动 server：

```sh
bun run dev:server
```

然后分别调用：

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

第一条应该看到 UIMessage SSE，后两条应该看到 plain text。真实 provider 仍需要有效 credentials，并且可能返回 rate limit 或其他 upstream error。

## 17. 最后把三种方案放在一起

| 对比项 | `sdk-ui` | `direct-text` | `sdk-text` |
| --- | --- | --- | --- |
| 默认推荐 | **是** | 否 | 否 |
| model invocation | AI SDK | direct OpenAI-compatible fetch | AI SDK |
| prompt/history | 支持 | 支持 text-only history | 支持 |
| history conversion | `convertToModelMessages` | 自己 mapping role/content | `convertToModelMessages` |
| 下游 protocol | UIMessage SSE | UTF-8 plain text | UTF-8 plain text |
| frontend chat consumer | `DefaultChatTransport` | `TextStreamChatTransport` | `TextStreamChatTransport` |
| frontend completion mode | `data` | `text` | `text` |
| stream parsing 主要责任 | SDK | server 手写 upstream parser，CLI text consumer | SDK |
| 保留结构化 events | 是，UI 是否 render 是另一回事 | 否 | 否 |
| in-band error | UIMessage error event | downstream stream failure | downstream stream failure |
| wrapper 的显式 60 秒 deadline | 没有 | 有，另有 read timeout | 没有 |
| model metadata comparison | 有 | 没有 | 有 |
| 更适合 | 默认 chat、未来结构化 UI | 学习/debug upstream wire format | 只需要文本但想保留 SDK invocation |

最重要的 mental model 是：**API path 统一了，不代表 stream protocol 相同；strategy 统一选择了，不代表 history 和 prompt 是同一种 input。** backend handler 和 frontend consumer 必须一起对齐，才是真正能用的 refactor。
