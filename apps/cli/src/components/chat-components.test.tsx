import { expect, test } from "bun:test";
import { act, type ReactNode } from "react";
import type { UIMessage } from "ai";
import type { TestRendererOptions, TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/react/test-utils";
import { ChatError } from "./chat-error";
import { ChatMessage } from "./chat-message";
import { ChatShell } from "./chat-shell";
import { ChatTextarea } from "./chat-textarea";

async function render(node: ReactNode, options: TestRendererOptions) {
  let view: TestRendererSetup | undefined;
  await act(async () => { view = await testRender(node, options); });
  if (!view) throw new Error("Renderer not initialized");
  return view;
}

test("renders reasoning, static/dynamic tool lifecycle states, and distinct errors", async () => {
  const message: UIMessage = {
    id: "assistant",
    role: "assistant",
    parts: [
      { type: "reasoning", text: "Checking the forecast", state: "streaming" },
      { type: "tool-weather", toolCallId: "1", state: "input-streaming", rawInput: '{"city":' },
      { type: "tool-weather", toolCallId: "2", state: "input-available", input: { city: "Paris" } },
      { type: "tool-weather", toolCallId: "3", state: "approval-requested", input: {}, approval: { id: "a" } },
      { type: "tool-weather", toolCallId: "4", state: "approval-responded", input: {}, approval: { id: "b", approved: true } },
      { type: "dynamic-tool", toolName: "weather", toolCallId: "5", state: "output-available", input: {}, output: { forecast: "Sunny" } },
      { type: "tool-weather", toolCallId: "6", state: "output-error", input: {}, errorText: "Tool timed out" },
      { type: "tool-weather", toolCallId: "7", state: "output-denied", input: {}, approval: { id: "c", approved: false } },
      { type: "text", text: "Final answer" },
    ],
  };
  const view = await render(
    <box flexDirection="column"><ChatMessage message={message} /><ChatError message="API unavailable" /></box>,
    { width: 80, height: 50 },
  );
  try {
    await view.flush();
    const frame = view.captureCharFrame();
    for (const text of ["Assistant", "Reasoning (streaming)", "Checking the forecast", "receiving input", "input ready", "awaiting approval", "approved", "completed", "Sunny", "failed", "Error: Tool timed out", "denied", "Final answer", "Error: API unavailable"]) {
      expect(frame).toContain(text);
    }
  } finally {
    await act(async () => { await view.dispose(); });
  }
});

test("long history cannot shrink the textarea; Enter sends and modified Enter adds newlines", async () => {
  const sent: string[] = [];
  const view = await render(
    <ChatShell header={<text>Chat</text>} composer={<ChatTextarea onSubmit={(text) => sent.push(text)} />} footer={<text>Footer</text>}>
      {Array.from({ length: 30 }, (_, i) => <ChatMessage key={i} message={{ id: String(i), role: "user", parts: [{ type: "text", text: `Message ${i}` }] }} />)}
    </ChatShell>,
    { width: 50, height: 16, kittyKeyboard: true },
  );
  try {
    await view.flush();
    const textarea = view.renderer.root.findDescendantById("chat-textarea");
    expect(textarea?.height).toBe(3);
    expect(view.captureCharFrame()).toContain("Footer");
    expect(view.captureCharFrame()).toContain("Message 29");
    await view.mockInput.typeText("question");
    view.mockInput.pressEnter({ shift: true });
    await view.mockInput.typeText("second line");
    view.mockInput.pressEnter({ ctrl: true });
    await view.mockInput.typeText("third line");
    view.mockInput.pressEnter();
    await view.flush();
    expect(sent).toEqual(["question\nsecond line\nthird line"]);
    expect(view.captureCharFrame()).toContain("Type a message...");
    view.resize(35, 12);
    await view.flush();
    expect(textarea?.height).toBe(3);
    expect(view.captureCharFrame()).toContain("Footer");
  } finally {
    await act(async () => { await view.dispose(); });
  }
});

test("busy textarea retains a draft without submitting it", async () => {
  const sent: string[] = [];
  const view = await render(<ChatTextarea busy onSubmit={(text) => sent.push(text)} />, { width: 40, height: 8 });
  try {
    await view.flush();
    await view.mockInput.typeText("next question");
    view.mockInput.pressEnter();
    await view.flush();
    expect(sent).toEqual([]);
    expect(view.captureCharFrame()).toContain("next question");
  } finally {
    await act(async () => { await view.dispose(); });
  }
});
