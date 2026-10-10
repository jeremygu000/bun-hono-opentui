# Reusable CLI chat components

[中文版](./chat-components.zh-CN.md)

## Why this split?

The old `ChatScreen` mixed transport setup, initial route state, keyboard shortcuts,
message rendering, and a fixed-width single-line input. The new structure keeps
the stateful screen small and makes the actual chat pieces reusable. Styling is
deliberately plain: default text, gray secondary labels, red errors, and a
transparent textarea without borders or a send button.

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

All reusable pieces live in `apps/cli/src/components/`, one component per file.
The page composition lives in `apps/cli/src/screens/chat-screen.tsx`; its route
wrapper imports it directly. Other existing screens have not been relocated as
part of this change.

## Message roles are not part types

In installed `ai@7.0.137`, `UIMessage.role` is `user | assistant | system`.
Reasoning and tool calls belong to `UIMessage.parts`, usually inside an assistant
message. Creating fake `tool` or `reasoning` roles would introduce another data
model and force us to convert it back when sending conversation history.

`ChatMessage` accepts the SDK's `UIMessage` directly. Human and assistant messages
share the same small wrapper, differing only in their role label. A dedicated
component for each would currently duplicate markup without giving us useful
behavior. Text uses native `<text>`; reasoning and tools get components because
their display logic is different. Parts retain their original order.

`step-start` is a protocol boundary and has no visible output. Other parts, such
as files, sources, custom content, or `data-*`, receive a `[type content]`
placeholder. This makes unsupported content visible without prematurely building
attachment viewers or inventing a schema for arbitrary application data.

## Reasoning and tool lifecycle

`ChatReasoning` displays its text inline, with a streaming label when
`part.state === "streaming"`. It cannot recover reasoning that the provider or
transport did not send.

`ChatTool` handles both static `tool-${name}` and `dynamic-tool` parts using the
SDK's `isToolUIPart` and `getToolName` helpers. Strings display as strings;
structured input/output displays as indented JSON.

| SDK state | Display |
| --- | --- |
| `input-streaming` | receiving input, partial input or raw input text |
| `input-available` | input ready |
| `approval-requested` | awaiting approval |
| `approval-responded` | approved / approval denied |
| `output-available` | completed, or preliminary output when `preliminary` is true |
| `output-error` | failed, with `errorText` |
| `output-denied` | denied |

There is no separate universally reliable “executing” state here. Ready arguments
do not prove execution has started. Approval states are displayed, not acted on:
adding approval controls later would require wiring `useChat` approval methods
into the screen. The backend currently defines no application tools, so rendering
support does not itself enable tool execution.

## Errors belong in two places

`useChat.error` covers failed HTTP requests, transport failures, and SDK stream
errors. It renders alongside history, outside individual messages. Tool failures
are `output-error` parts and render inside the assistant message. Both reuse
`ChatError`, which takes a string; there is no fabricated error message role.
Only the available error message is displayed. If the backend masks a stream
error, the frontend cannot recreate the internal details.

## Layout: give the remaining space to history

```text
ChatShell: column, 100% height/width, padding 1
  header:   flexShrink 0
  history:  flexGrow 1, flexBasis 0, minHeight 0
  composer: flexShrink 0
    textarea: height 3, flexShrink 0, width 100%
  footer:   flexShrink 0
```

The scrollbox is the flexible region. Its content can be tall without pushing the
composer offscreen; each message also has `flexShrink={0}`. The textarea reserves
three rows and scrolls internally for longer drafts. Giving it vertical
`flexGrow` would compete with history rather than solve the shrinking problem.
There is no fixed 70-column chat width anymore. Extremely short terminals still
need enough rows for the reserved header, composer, footer, and padding.

`stickyScroll` with `stickyStart="bottom"` delegates follow-new-output behavior
to OpenTUI, including its manual-scroll handling. Mouse-wheel history scrolling
does not require moving focus away from the textarea.

## Textarea and request path

OpenTUI's textarea is an imperative edit buffer, not a controlled `<input>`.
`ChatTextarea` reads `plainText` from a `TextareaRenderable` ref, trims it, and
validates `{ prompt: text }` with shared `promptSchema` before invoking its typed
callback. Blank drafts are ignored; overlong drafts show a validation error and
are preserved. A submitted draft is cleared with `setText("")`.

Enter submits; Shift+Enter inserts a newline. Ctrl+Enter also inserts a newline
as a fallback for terminals that cannot distinguish Shift+Enter. Actual modifier
reporting depends on the terminal. While busy, submission is ignored and the
draft remains editable. Esc stops generation; Ctrl+C calls `renderer.destroy()`.
Bare `q` no longer exits this screen because it must be usable as message text.

The screen still owns `useChat`, initial history parsed from route state, and the
one-time initial request. Its send callback uses `sendMessage({ text })`; the
existing transport and typed Hono RPC bridge send history to `POST /chat`.
`CHAT_STRATEGY=sdk-ui` supports structured reasoning/tool parts when emitted.
`sdk-text` and `direct-text` only deliver text, so the same components render
text-only histories for those strategies.

## Verification

`chat-components.test.tsx` uses the real OpenTUI test renderer. It verifies
reasoning, static/dynamic tools and all seven lifecycle states, distinct tool and
API errors, three-row textarea layout under long history and resizing, Enter and
modified Enter behavior, draft clearing, and busy draft retention. These checks
do not invoke a live provider or configure tool execution.

```bash
bun run typecheck
bun test apps/cli/src/components/chat-components.test.tsx apps/cli/src/lib/chat-transport.test.ts
```
