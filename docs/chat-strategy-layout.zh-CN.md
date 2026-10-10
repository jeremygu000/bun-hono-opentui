# 把三种 chat strategy 摆明白：按完整调用链拆文件

[English version](./chat-strategy-layout.en.md)

这次调整的起点是一个阅读问题：打开后端的 strategy 文件，很难一眼看明白每个 strategy 做了什么，以及它们有什么区别。

以前 `chat-strategies.ts` 同时包含 registry、`sdk(responseStrategy)` 工厂、direct HTTP request；SDK response 又放在 `chat-response-strategies.ts` 的第二个 registry。想读 `sdk-text`，需要先找到 `sdk("text")`，再顺着工厂和 response registry 跳转。代码行数不多，但一条完整流程被切成了几段。

## 1. 新结构怎么读

所有路径以下面的目录为起点：`apps/server/src/lib/`。

```text
chat-strategies.ts                只负责 assembly / registry
chat-strategies/
  sdk-ui-strategy.ts              AI SDK -> UIMessage SSE
  sdk-text-strategy.ts            AI SDK -> plain text
  direct-text-strategy.ts         HTTP fetch -> upstream SSE parser -> plain text
  direct-text-strategy.util.ts    direct-text 专用的 upstream SSE parser
  direct-text-strategy.util.test.ts  parser tests
  sdk-support.ts                 SDK input conversion + model response log
  types.ts                       handler contract + dependency types
chat-input.ts                    HTTP body -> validated ChatInput
provider-config.ts               provider 配置选择 + SDK chat model 创建
```

阅读时，先选一个 `*-strategy.ts`。每个文件都展开自己的 model invocation 和 response creation，不再通过 `sdk("ui" / "text")` 参数间接决定行为。原来的 `chat-response-strategies.ts` 已删除，response code 搬回对应 strategy。

`chat-strategies.ts` 保留 `createChatStrategies` 的接口，返回三种 factory 创建的 handler。`app.ts`、typed RPC、CLI strategy 配置因此仍使用同一个入口。

## 2. 三条链路放在一起看

```text
POST /chat
  -> zValidator(chatBodySchema)
  -> parseChatInput
  -> registry[body.strategy](input, signal)
       |
       + sdk-ui
       |   prepareSdkInput -> streamText
       |   -> toUIMessageStream -> createUIMessageStreamResponse
       |
       + sdk-text
       |   prepareSdkInput -> streamText -> error-check TransformStream
       |   -> toTextStream -> createTextStreamResponse
       |
       + direct-text
           prompt/history -> OpenAI-compatible messages
           -> fetch /chat/completions -> OpenaiTextStream -> Response(text/plain)
```

### sdk-ui：保留结构化 UI protocol

`createSdkUiStrategy` 接收 `model` 和 `config`。prompt 直接作为 SDK prompt，history 经 `convertToModelMessages` 转换。调用 `streamText` 时传入 request signal；`onEnd` 通过 `finalStep.response` 记录 model metadata。

输出调用 `toUIMessageStream` 和 `createUIMessageStreamResponse`。CLI 收到的是 UIMessage SSE，例如 `text-start`、`text-delta`、`text-end` 以及 lifecycle/error events，而不是直接拼接的答案文本。这适合 `DefaultChatTransport` 和 `useCompletion` 的 `data` protocol。

### sdk-text：SDK 调模型，但出口只给文本

`createSdkTextStrategy` 的 input conversion、`streamText`、signal 和 model log 与 `sdk-ui` 一样。差别就在调用之后：先检查 SDK stream 中的 `error` part，再用 `toTextStream` 提取文本，最后 `createTextStreamResponse` 返回 UTF-8 plain text。

为什么不能直接提取文本？因为 SDK 的 in-band error 可能被文本筛选丢掉，客户端会把半截答案当成成功。这里的 `TransformStream` 遇到 error 就 throw，让 reader 失败。response 已开始之后，这不是重新返回一个 HTTP error status，也没有 SSE error envelope。

### direct-text：连上游协议也由项目自己处理

`createDirectTextStrategy` 接收 `config` 和可注入的 `fetchUpstream`，不依赖 `LanguageModel`。prompt 映射成 user message；history 保留 role，并把 text parts 拼成 content。empty parts 或 non-text parts 返回 HTTP 400。

它明确构造 `/chat/completions` request：Bearer header、model、`stream: true`、messages；OpenRouter 时附加 `reasoning: { enabled: false }`。request signal 和 60 秒 timeout 合并。上游 HTTP error 保留 status/body；成功 response body 交给 `OpenaiTextStream`，最终返回 plain text。

`OpenaiTextStream` 仍负责跨 chunk buffering、UTF-8 decoding、`data:` payload、`[DONE]` 和错误处理。它只服务于 direct-text，因此从原来的 `lib/openai-text-stream.ts` 搬到相邻的 `direct-text-strategy.util.ts`，对应 tests 也一起搬迁。它是当前 OpenAI-compatible 单行 data event parser，不是完整支持所有 multiline SSE 的通用 parser。这次没有重写 parser。

## 3. 为什么保留一点重复

两个 SDK strategy 各写一次 `streamText` options，是有意的。打开文件就能确认 model、signal、callback 和 response protocol；不用再理解一个带 mode 参数的万能工厂。

只抽走不决定 strategy 行为的小 helper：`prepareSdkInput` 转 input，`logModelResponse` 记录 metadata。`types.ts` 区分 `SdkStrategyDependencies` 与 `DirectStrategyDependencies`，因此 direct strategy 的签名也能说明它不使用 SDK model。

如果以后增加 tool handling 或不同 provider options，直接在相应 strategy 文件修改。只有确实共同、而且抽走后不影响完整流程阅读的部分，才适合继续共享。

## 4. 前端页面也按用途收敛

CLI 删除了 `llm-test-screen.tsx`、`llm-hybrid-screen.tsx` 和对应 route wrappers、router entries、route constants、导航项。单轮 prompt 统一进入 `/llm`，多轮 history 仍进入 `/chat`。strategy 是配置维度，不再需要为每个后端实现保留一个页面。

CLI 的 `CHAT_STRATEGY` 选择 `sdk-ui`、`sdk-text` 或 `direct-text`，默认是 `sdk-ui`。修改 CLI env 后重启 `bun run dev:cli`。同一个 `/llm` 页面会把选择写入 `POST /chat` request 的 `strategy`：`sdk-ui` 使用 `useCompletion` 的 `data` protocol，另外两种使用 `text` protocol。`/chat` 同样读取该 env，分别选择 `DefaultChatTransport` 或 `TextStreamChatTransport`。

页面显示当前 strategy，便于确认实际配置。移除的 `/llm-test`、`/llm-hybrid` 不再是有效 route；选择后端实现直接通过 env 完成。

## 5. 验证与记录

配置入口也从 `ai-config.ts` 改名为 `provider-config.ts`。它通过 zod 读取 `AI_PROVIDER`、`AI_MODEL` 和 API key，选择 provider 的 baseURL/default model，再用 `createOpenAI` 创建 SDK chat model。这个职责比单纯的 model 参数更宽，所以使用 provider 命名。导出 `providerConfig` 表示已选配置，`chatModel` 表示 SDK model instance；`app.ts` 将它们注入 registry，`index.ts` 用配置打印启动日志。env 名称与 default values 不变。

全 workspace `bun run typecheck` 和现有 strategy、parser、CLI transport tests 均通过：11 pass、0 fail。测试验证 prompt/history、default strategy、validation、输出协议和 error paths；没有为了文件搬迁添加仅镜像实现的测试。

启动后端并请求 `http://localhost:3000/health` 也返回 `{"status":"ok"}`。这次没有调用真实 provider，也没有做交互式 terminal 验证。

之前的 [strategy refactor 文档](./chat-strategy-refactor.zh-CN.md) 保留原来的结构作为历史记录；这篇记录新的文件布局。API request schema、strategy names、CLI env 和 response contracts 都延续原有实现。

| 对比点 | sdk-ui | sdk-text | direct-text |
| --- | --- | --- | --- |
| 完整实现文件 | `sdk-ui-strategy.ts` | `sdk-text-strategy.ts` | `direct-text-strategy.ts` |
| 调用上游 | AI SDK `streamText` | AI SDK `streamText` | `fetchUpstream` |
| 上游解析 | AI SDK provider | AI SDK provider | `OpenaiTextStream` |
| 返回协议 | UIMessage SSE | plain text | plain text |
| stream error | UI protocol error event | throw，让 reader 失败 | parser 让 reader 失败 |
| 与另一方案的核心区别 | 比 sdk-text 多结构化 event | 比 sdk-ui 少 event；比 direct-text 多 SDK abstraction | 手写上游 request 和 parser；history 限 text |
