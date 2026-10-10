# 可复用的 CLI chat components

[English](./chat-components.en.md)

## 为什么这样拆？

旧的 `ChatScreen` 把 transport 初始化、route state、keyboard shortcuts、
message rendering 和固定宽度的单行 input 放在一起。现在让 screen 负责状态与
调用链，让 chat components 负责展示。样式刻意保持朴素：正文使用默认颜色，
次要信息用 gray，error 用 red，textarea 使用透明背景，没有 border 和 send button。

```text
routes/chat.tsx
  -> screens/chat-screen.tsx        useChat, route state, transport, shortcuts
       -> ChatShell                 header / scrollbox / composer / footer
            -> ChatMessage          role label + ordered UIMessage.parts
                 -> text            native OpenTUI text
                 -> ChatReasoning   reasoning label + streamed text
                 -> ChatTool        tool name, state, input/output/error
                      -> ChatError
            -> ChatError            request/transport/stream error
            -> ChatTextarea         editor, validation, submission
```

可复用组件都在 `apps/cli/src/components/`，每个 component 一个文件。
页面组合放到 `apps/cli/src/screens/chat-screen.tsx`，route wrapper 直接引用它。
这次只调整 chat 的结构，没有把其他 screen 一起搬迁。

## Message role 和 part type 不是一回事

当前安装的 `ai@7.0.137` 中，`UIMessage.role` 只有 `user | assistant | system`。
reasoning 和 tool calling 是 `UIMessage.parts`，通常属于 assistant message。
如果自己造 `tool` 或 `reasoning` role，就会多出一套 data model，发送 history
时还得转换回 SDK 格式。

所以 `ChatMessage` 直接接收 SDK 的 `UIMessage`。human 和 assistant 共用一个
简单 wrapper，只改变 role label。此时再拆两个 component，基本只会复制 markup。
text 直接用原生 `<text>`；reasoning 和 tool 的展示逻辑不同，才单独拆 component。
所有 parts 都按原始顺序显示。

`step-start` 是 protocol boundary，不显示内容。其他暂未实现的 parts，比如
file、source、custom content、`data-*`，显示 `[type content]` placeholder。
这样至少能看见收到的内容类型，也不用提前实现 attachment viewer 或给任意
application data 编造 schema。

## Reasoning 和 tool lifecycle

`ChatReasoning` inline 显示 text；`part.state === "streaming"` 时加 streaming
label。如果 provider 或 transport 没有发送 reasoning，component 无法把它还原。

`ChatTool` 同时处理静态 `tool-${name}` 和 `dynamic-tool`，使用 SDK 的
`isToolUIPart`、`getToolName` helpers。string 直接显示，结构化 input/output
使用缩进的 JSON，不添加 expandable panel。

| SDK state | 显示 |
| --- | --- |
| `input-streaming` | receiving input，显示 partial input 或 raw input text |
| `input-available` | input ready |
| `approval-requested` | awaiting approval |
| `approval-responded` | approved / approval denied |
| `output-available` | completed；`preliminary` 为 true 时显示 preliminary output |
| `output-error` | failed，并显示 `errorText` |
| `output-denied` | denied |

这里没有一个通用、可靠的“executing” state。arguments 准备好了，不代表 execution
一定开始了。approval states 目前只展示；以后要添加交互，需要由 screen 接入
`useChat` 的 approval methods。当前 backend 没有定义 application tools，
因此支持显示 tool parts，并不等于已经启用了 tool execution。

## Error 有两个落点

`useChat.error` 包含 HTTP request failure、transport failure 和 SDK stream error。
它在 history 旁显示，不属于某条 message。tool failure 是 `output-error` part，
显示在 assistant message 内部。两者复用接收 string 的 `ChatError`，不用造一个
error role。界面只能显示收到的 error message；如果 backend 屏蔽了 stream error
的内部细节，frontend 不可能还原出来。

## Layout：把剩余空间交给 history

```text
ChatShell: column, 100% height/width, padding 1
  header:   flexShrink 0
  history:  flexGrow 1, flexBasis 0, minHeight 0
  composer: flexShrink 0
    textarea: height 3, flexShrink 0, width 100%
  footer:   flexShrink 0
```

scrollbox 才是 flexible region。它的 content 可以很高，但不会把 composer 挤出
屏幕；每个 message 也设置了 `flexShrink={0}`。textarea 固定保留三行，较长 draft
在内部 scroll。给 textarea 纵向 `flexGrow`，反而会与 history 竞争空间，不能解决
被压缩的问题。chat 不再固定为 70 columns。当然，特别矮的 terminal 仍需要容得下
header、composer、footer 和 padding 这些保留区域。

`stickyScroll` 配合 `stickyStart="bottom"`，把跟随新输出以及 manual scroll 的
行为交给 OpenTUI。使用 mouse wheel 滚动 history 时，不需要让 textarea 失去 focus。

## Textarea 和 request path

OpenTUI textarea 使用 imperative edit buffer，不是 controlled `<input>`。
`ChatTextarea` 通过 `TextareaRenderable` ref 读取 `plainText`，trim 后用共享
`promptSchema` 校验 `{ prompt: text }`，成功才调用 typed callback。空 draft 忽略，
超长 draft 保留并显示 validation error。提交后用 `setText("")` 清空。

Enter 提交，Shift+Enter 换行。Ctrl+Enter 也换行，作为 terminal 无法区分
Shift+Enter 时的 fallback；实际 modifier reporting 仍取决于 terminal。
busy 时忽略提交，但 draft 可以继续编辑。Esc 停止 generation；Ctrl+C 调用
`renderer.destroy()`。chat screen 不再用裸 `q` 退出，因为 message 需要正常输入 q。

screen 仍负责 `useChat`、从 route state 校验得到的 initial history，以及一次性的
initial request。send callback 调用 `sendMessage({ text })`，原有 transport 和
typed Hono RPC bridge 把 history 发送到 `POST /chat`。
`CHAT_STRATEGY=sdk-ui` 能保留实际发送的 reasoning/tool parts；`sdk-text` 和
`direct-text` 只传 text，同一组 components 在这些 strategies 下显示 text-only history。

## Verification

`chat-components.test.tsx` 使用真实 OpenTUI test renderer，检查 reasoning、
static/dynamic tools 和全部七种 lifecycle states、独立的 tool/API errors，
以及长 history 和 resize 下 textarea 仍保留三行。还检查 Enter、modified Enter、
提交后清空和 busy 时保留 draft。这些测试不调用 live provider，也不配置 tool execution。

```bash
bun run typecheck
bun test apps/cli/src/components/chat-components.test.tsx apps/cli/src/lib/chat-transport.test.ts
```
