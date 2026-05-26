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
});
