// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatStream } from "../ChatStream";

afterEach(cleanup);

const msg = (id: string, role: "user" | "assistant", content = "x") => ({
  id,
  role,
  content,
  createdAt: 0,
});

describe("ChatStream", () => {
  it("shows the empty placeholder when no messages", () => {
    const { container } = render(<ChatStream messages={[]} onSend={() => {}} />);
    expect(container.textContent).toContain("Ask anything");
  });

  it("renders messages with role-tagged data attributes", () => {
    const { getByTestId } = render(
      <ChatStream
        messages={[msg("1", "user", "hi"), msg("2", "assistant", "hello")]}
        onSend={() => {}}
      />,
    );
    expect(getByTestId("chat-msg-user").textContent).toContain("hi");
    expect(getByTestId("chat-msg-assistant").textContent).toContain("hello");
  });

  it("send button is disabled when draft is empty", () => {
    const { getByTestId } = render(<ChatStream messages={[]} onSend={() => {}} />);
    expect((getByTestId("chat-send") as HTMLButtonElement).disabled).toBe(true);
  });

  it("clicking send calls onSend with the trimmed draft and clears the input", () => {
    const onSend = vi.fn();
    const { getByTestId } = render(<ChatStream messages={[]} onSend={onSend} />);
    const input = getByTestId("chat-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "  hello  " } });
    fireEvent.click(getByTestId("chat-send"));
    expect(onSend).toHaveBeenCalledWith("hello");
    expect(input.value).toBe("");
  });

  it("Enter sends; Shift+Enter inserts a newline (no send)", () => {
    const onSend = vi.fn();
    const { getByTestId } = render(<ChatStream messages={[]} onSend={onSend} />);
    const input = getByTestId("chat-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("hi");
  });

  it("send is a no-op when the draft is only whitespace", () => {
    const onSend = vi.fn();
    const { getByTestId } = render(<ChatStream messages={[]} onSend={onSend} />);
    const input = getByTestId("chat-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("renders a JS code block with a '+ Parser' button for assistant messages", () => {
    const onRegisterParser = vi.fn();
    const content = "before text\n```js\nconst x = 1;\n```\nafter text";
    const { getByTestId } = render(
      <ChatStream
        messages={[msg("1", "assistant", content)]}
        onSend={() => {}}
        onRegisterParser={onRegisterParser}
      />,
    );
    // Multi-segment path renders the code-block register button.
    const btn = getByTestId("chat-codeblock-register-parser");
    fireEvent.click(btn);
    expect(onRegisterParser).toHaveBeenCalledWith("const x = 1;\n");
    // Surrounding text segments are rendered too.
    expect(getByTestId("chat-msg-assistant").textContent).toContain("before text");
    expect(getByTestId("chat-msg-assistant").textContent).toContain("after text");
  });

  it("renders a non-JS code block without the register button", () => {
    const onRegisterParser = vi.fn();
    const content = "```python\nprint(1)\n```";
    const { queryByTestId, getByTestId } = render(
      <ChatStream
        messages={[msg("1", "assistant", content)]}
        onSend={() => {}}
        onRegisterParser={onRegisterParser}
      />,
    );
    // isJs false → no register button; lang label falls back to the fence lang.
    expect(queryByTestId("chat-codeblock-register-parser")).toBeNull();
    expect(getByTestId("chat-msg-assistant").textContent).toContain("python");
    expect(getByTestId("chat-msg-assistant").textContent).toContain("print(1)");
  });

  it("renders a code block with no language label as 'code'", () => {
    const content = "```\nplain\n```";
    const { getByTestId, queryByTestId } = render(
      <ChatStream
        messages={[msg("1", "assistant", content)]}
        onSend={() => {}}
        onRegisterParser={() => {}}
      />,
    );
    expect(queryByTestId("chat-codeblock-register-parser")).toBeNull();
    expect(getByTestId("chat-msg-assistant").textContent).toContain("code");
  });

  it("does not show the register button for a JS block in a user message", () => {
    const content = "```js\nconst y = 2;\n```";
    const { queryByTestId } = render(
      <ChatStream
        messages={[msg("1", "user", content)]}
        onSend={() => {}}
        onRegisterParser={() => {}}
      />,
    );
    // role !== "assistant" → no register button.
    expect(queryByTestId("chat-codeblock-register-parser")).toBeNull();
  });

  it("hides the register button when onRegisterParser is not provided", () => {
    const content = "```js\nconst z = 3;\n```";
    const { queryByTestId } = render(
      <ChatStream messages={[msg("1", "assistant", content)]} onSend={() => {}} />,
    );
    // onRegisterParser undefined → showRegister falsy.
    expect(queryByTestId("chat-codeblock-register-parser")).toBeNull();
  });

  it("renders an empty-content assistant message as a single text segment", () => {
    const { getByTestId } = render(
      <ChatStream
        messages={[msg("1", "assistant", "")]}
        onSend={() => {}}
        onRegisterParser={() => {}}
      />,
    );
    // parseMessageSegments("") → [{kind:text,text:""}] → single-text fast path.
    expect(getByTestId("chat-msg-assistant")).toBeTruthy();
  });

  it("renders a typescript code block and registers its source", () => {
    const onRegisterParser = vi.fn();
    const content = "```typescript\ntype T = number;\n```";
    const { getByTestId } = render(
      <ChatStream
        messages={[msg("1", "assistant", content)]}
        onSend={() => {}}
        onRegisterParser={onRegisterParser}
      />,
    );
    fireEvent.click(getByTestId("chat-codeblock-register-parser"));
    expect(onRegisterParser).toHaveBeenCalledWith("type T = number;\n");
  });
});
