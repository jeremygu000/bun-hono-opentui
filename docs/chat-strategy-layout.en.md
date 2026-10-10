# Making the Three Chat Strategies Readable: One Complete Flow per File

[中文版](./chat-strategy-layout.zh-CN.md)

This change starts with a readability problem: opening the backend strategy code didn't make it obvious what each strategy did or how it differed from the others.

Previously, `chat-strategies.ts` contained the registry, the `sdk(responseStrategy)` factory, and the direct HTTP request. SDK responses lived in a second registry in `chat-response-strategies.ts`. Reading `sdk-text` meant following `sdk("text")` through the factory and then into the response registry. There weren't many lines, but a complete flow was scattered across abstractions.

## 1. Reading the new layout

Paths below are relative to `apps/server/src/lib/`.

```text
chat-strategies.ts                assembly / registry only
chat-strategies/
  sdk-ui-strategy.ts              AI SDK -> UIMessage SSE
  sdk-text-strategy.ts            AI SDK -> plain text
  direct-text-strategy.ts         HTTP fetch -> upstream SSE parser -> plain text
  direct-text-strategy.util.ts    upstream SSE parser owned by direct-text
  direct-text-strategy.util.test.ts  parser tests
  sdk-support.ts                 SDK input conversion + model response log
  types.ts                       handler contract + dependency types
chat-input.ts                    HTTP body -> validated ChatInput
provider-config.ts               provider selection + SDK chat model creation
```

Start with a `*-strategy.ts` file. Each one shows its own model invocation and response creation, rather than selecting behavior indirectly through `sdk("ui" / "text")`. The old `chat-response-strategies.ts` is removed; its response code now lives in the corresponding strategies.

`chat-strategies.ts` keeps the `createChatStrategies` interface and returns handlers created by three explicit factories. `app.ts`, typed RPC, and CLI strategy configuration continue using the same entry point.

## 2. Compare the complete flows

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

### sdk-ui: preserve the structured UI protocol

`createSdkUiStrategy` takes `model` and `config`. A prompt goes directly to the SDK; history is converted through `convertToModelMessages`. `streamText` receives the request signal, and `onEnd` logs model metadata from `finalStep.response`.

Output goes through `toUIMessageStream` and `createUIMessageStreamResponse`. The CLI receives UIMessage SSE, including `text-start`, `text-delta`, `text-end`, and lifecycle/error events, rather than concatenated answer text. This works with `DefaultChatTransport` and the `data` protocol of `useCompletion`.

### sdk-text: invoke through the SDK, return only text

`createSdkTextStrategy` has the same input conversion, `streamText` invocation, signal, and model log as `sdk-ui`. The difference comes afterward: check SDK `error` parts, extract text with `toTextStream`, and return UTF-8 plain text with `createTextStreamResponse`.

Why check errors before extracting text? An SDK in-band error could otherwise be filtered out, leaving the client with a truncated answer that looks successful. The `TransformStream` throws on error so the reader fails. Once the response has started, this isn't a new HTTP error status and doesn't provide an SSE error envelope.

### direct-text: own the upstream protocol too

`createDirectTextStrategy` takes `config` and an injectable `fetchUpstream`; it doesn't depend on a `LanguageModel`. A prompt becomes a user message. History preserves roles and joins text parts into content; empty parts or non-text parts produce HTTP 400.

It explicitly builds the `/chat/completions` request: Bearer header, model, `stream: true`, and messages, plus `reasoning: { enabled: false }` for OpenRouter. The request signal is combined with a 60-second timeout. Upstream HTTP errors preserve status/body; successful response bodies go through `OpenaiTextStream` and return plain text.

`OpenaiTextStream` still handles chunk buffering, UTF-8 decoding, `data:` payloads, `[DONE]`, and errors. Since only direct-text uses it, it moves from `lib/openai-text-stream.ts` to the adjacent `direct-text-strategy.util.ts`, together with its tests. It's the existing OpenAI-compatible single-line data-event parser, not a general parser supporting every multiline SSE form. This change doesn't rewrite it.

## 3. Why keep some duplication?

Both SDK strategies explicitly show their `streamText` options. That's deliberate: opening either file reveals its model, signal, callback, and response protocol without first understanding a general-purpose mode-switching factory.

Only small helpers that don't decide strategy behavior are shared: `prepareSdkInput` converts input and `logModelResponse` logs metadata. `types.ts` distinguishes `SdkStrategyDependencies` from `DirectStrategyDependencies`, making the direct strategy's lack of an SDK model dependency visible in its signature.

Future tool handling or provider-specific options can be changed in the relevant strategy file. Share more only when the code is genuinely common and extracting it still leaves each complete flow readable.

## 4. Simplify frontend pages by purpose too

The CLI removes `llm-test-screen.tsx`, `llm-hybrid-screen.tsx`, and their route wrappers, router entries, route constants, and navigation items. Single-turn prompts use `/llm`; multi-turn history still uses `/chat`. Strategy selection is a configuration dimension, so each backend implementation doesn't need a separate page.

CLI `CHAT_STRATEGY` selects `sdk-ui`, `sdk-text`, or `direct-text`, defaulting to `sdk-ui`. Restart `bun run dev:cli` after changing the CLI environment. The same `/llm` page sends the selection as `strategy` in its `POST /chat` request: `sdk-ui` uses the `data` protocol of `useCompletion`, while the other two use `text`. `/chat` reads the same environment configuration and selects `DefaultChatTransport` or `TextStreamChatTransport` accordingly.

The page displays the selected strategy for confirmation. The removed `/llm-test` and `/llm-hybrid` paths are no longer valid routes; choose the backend implementation through the environment instead.

## 5. Verification and historical records

The configuration entry point also moves from `ai-config.ts` to `provider-config.ts`. It validates `AI_PROVIDER`, `AI_MODEL`, and API keys with zod, selects the provider's baseURL/default model, and creates an SDK chat model with `createOpenAI`. This responsibility is broader than model parameters alone, so the provider name fits better. `providerConfig` exports the selected configuration; `chatModel` exports the SDK model instance. `app.ts` injects both into the registry, and `index.ts` uses the configuration for startup logging. Environment variable names and defaults remain the same.

All workspace checks through `bun run typecheck` passed, along with existing strategy, parser, and CLI transport tests: 11 pass, 0 fail. These tests verify prompts/history, default strategy, validation, response protocols, and error paths. No implementation-mirroring tests were added just to verify file relocation.

Starting the backend and requesting `http://localhost:3000/health` also returned `{"status":"ok"}`. This run didn't call a real provider or perform interactive terminal verification.

The previous [strategy refactor notes](./chat-strategy-refactor.en.md) retain the original structure as a historical record. This document records the new layout. Request schemas, strategy names, CLI environment configuration, and response contracts retain their existing behavior.

| Comparison | sdk-ui | sdk-text | direct-text |
| --- | --- | --- | --- |
| Complete implementation | `sdk-ui-strategy.ts` | `sdk-text-strategy.ts` | `direct-text-strategy.ts` |
| Upstream invocation | AI SDK `streamText` | AI SDK `streamText` | `fetchUpstream` |
| Upstream parsing | AI SDK provider | AI SDK provider | `OpenaiTextStream` |
| Response protocol | UIMessage SSE | Plain text | Plain text |
| Stream error | UI protocol error event | Throw to fail the reader | Parser fails the reader |
| Key distinction | Structured events beyond sdk-text | Fewer events than sdk-ui; SDK abstraction beyond direct-text | Explicit upstream request/parser; text-only history |
