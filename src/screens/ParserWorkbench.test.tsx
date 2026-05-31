// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { unregisterParser } from "../lib/parsers/register-from-source";
import * as previewRender from "../lib/preview/render";
import { useChatSessions } from "../store/chat-sessions";
import { ParserWorkbench } from "./ParserWorkbench";

const h = vi.hoisted(() => ({
  handler: null as null | ((e: { payload: unknown }) => void),
  listenRejects: false,
  startSession: vi.fn<(...a: unknown[]) => Promise<string>>(),
  sendMessage: vi.fn<(...a: unknown[]) => Promise<void>>(),
  resolve: vi.fn<(...a: unknown[]) => unknown>(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (_event: string, cb: (e: { payload: unknown }) => void) => {
    if (h.listenRejects) return Promise.reject(new Error("listen boom"));
    h.handler = cb;
    return Promise.resolve(() => {});
  },
}));
vi.mock("../lib/agents/acp-adapter", () => ({
  getAcpAdapter: () => ({ startSession: h.startSession, sendMessage: h.sendMessage }),
}));
vi.mock("../store/agent-registry", () => ({
  useAgentRegistry: (sel: (s: { resolve: typeof h.resolve }) => unknown) =>
    sel({ resolve: h.resolve }),
}));

const WS = "/ws";

function send(text: string) {
  fireEvent.change(screen.getByTestId("chat-input"), { target: { value: text } });
  fireEvent.click(screen.getByTestId("chat-send"));
}

afterEach(() => {
  cleanup();
  h.handler = null;
  h.listenRejects = false;
  h.startSession.mockReset();
  h.sendMessage.mockReset();
  h.resolve.mockReset();
  vi.restoreAllMocks();
  useChatSessions.getState()._reset();
  unregisterParser("__studio_preview__");
  unregisterParser("my-parser");
});

describe("ParserWorkbench", () => {
  it("renders the live preview by running the default parser over the sample", async () => {
    render(<ParserWorkbench workspace={WS} />);
    await waitFor(() => expect(screen.getByTestId("parser-preview").innerHTML).toContain("📌"));
  });

  it("shows the rendered output of an edited parser source", async () => {
    render(<ParserWorkbench workspace={WS} />);
    fireEvent.change(screen.getByTestId("parser-source"), {
      target: {
        value: `(input) => ({ ast: { kind: "html", html: "<b>EDITED</b>" + input.content.length } })`,
      },
    });
    await waitFor(() => expect(screen.getByTestId("parser-preview").innerHTML).toContain("EDITED"));
  });

  it("re-renders the preview when the sample markdown changes", async () => {
    render(<ParserWorkbench workspace={WS} />);
    await waitFor(() => expect(screen.getByTestId("parser-preview").innerHTML).toContain("📌"));
    fireEvent.change(screen.getByTestId("parser-sample"), {
      target: { value: "::note 새 샘플 내용입니다" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("parser-preview").innerHTML).toContain("새 샘플 내용입니다"),
    );
  });

  it("surfaces an evaluation error in the preview pane", async () => {
    render(<ParserWorkbench workspace={WS} />);
    fireEvent.change(screen.getByTestId("parser-source"), {
      target: { value: "this is not a function" },
    });
    await waitFor(() => expect(screen.getByTestId("parser-preview-error")).toBeTruthy());
  });

  it("apply: requires a parser id", () => {
    render(<ParserWorkbench workspace={WS} />);
    fireEvent.change(screen.getByTestId("parser-id"), { target: { value: "  " } });
    fireEvent.click(screen.getByTestId("parser-apply"));
    expect(screen.getByTestId("parser-apply-msg").textContent).toContain("id");
  });

  it("apply: requires at least one extension", () => {
    render(<ParserWorkbench workspace={WS} />);
    fireEvent.change(screen.getByTestId("parser-extensions"), { target: { value: "  " } });
    fireEvent.click(screen.getByTestId("parser-apply"));
    expect(screen.getByTestId("parser-apply-msg").textContent).toContain("확장자");
  });

  it("apply: registers the parser and normalises bare extensions", () => {
    render(<ParserWorkbench workspace={WS} />);
    fireEvent.change(screen.getByTestId("parser-id"), { target: { value: "my-parser" } });
    fireEvent.change(screen.getByTestId("parser-extensions"), { target: { value: "wiki, .md" } });
    fireEvent.click(screen.getByTestId("parser-apply"));
    const msg = screen.getByTestId("parser-apply-msg").textContent ?? "";
    expect(msg).toContain("등록됨");
    expect(msg).toContain(".wiki");
    expect(msg).toContain(".md");
  });

  it("send: no agent → system hint", async () => {
    h.resolve.mockReturnValue(undefined);
    render(<ParserWorkbench workspace={WS} />);
    await waitFor(() => expect(screen.getByTestId("chat-input")).toBeTruthy());
    send("파서 짜줘");
    await waitFor(() =>
      expect(screen.getByTestId("chat-messages").textContent).toContain("에이전트가 없습니다"),
    );
  });

  it("send: api-key agent → legacy provider note", async () => {
    h.resolve.mockReturnValue({ kind: "api-key", label: "k" });
    render(<ParserWorkbench workspace={WS} />);
    send("hi");
    await waitFor(() =>
      expect(screen.getByTestId("chat-messages").textContent).toContain("legacy provider path"),
    );
  });

  it("send: acp agent → starts session, sends preamble, streams a chunk, code → editor", async () => {
    h.resolve.mockReturnValue({ kind: "acp", label: "claude", id: "a1" });
    h.startSession.mockResolvedValue("acp1");
    h.sendMessage.mockResolvedValue(undefined);
    render(<ParserWorkbench workspace={WS} />);
    await waitFor(() => expect(screen.getByTestId("chat-input")).toBeTruthy());
    send("::note 를 callout 으로");
    await waitFor(() => expect(h.startSession).toHaveBeenCalled());
    await waitFor(() => expect(h.sendMessage).toHaveBeenCalled());
    // preamble carries the current source + the user request
    expect(String(h.sendMessage.mock.calls[0]?.[1])).toContain("파서 개발 모드");

    // stream an assistant chunk containing a js code block
    await waitFor(() => expect(h.handler).toBeTruthy());
    h.handler?.({
      payload: {
        sessionId: "acp1",
        update: {
          type: "agent_message_chunk",
          content: {
            text: '```js\n(input) => ({ ast: { kind: "html", html: "<i>FROMCHAT</i>" } })\n```',
          },
        },
      },
    });
    await waitFor(() => expect(screen.getByTestId("chat-codeblock-register-parser")).toBeTruthy());
    // code block → editor (the connection that was missing)
    fireEvent.click(screen.getByTestId("chat-codeblock-register-parser"));
    expect((screen.getByTestId("parser-source") as HTMLTextAreaElement).value).toContain(
      "FROMCHAT",
    );
    await waitFor(() =>
      expect(screen.getByTestId("parser-preview").innerHTML).toContain("FROMCHAT"),
    );
  });

  it("send: acp start failure → system error", async () => {
    h.resolve.mockReturnValue({ kind: "acp", label: "claude", id: "a1" });
    h.startSession.mockRejectedValue(new Error("spawn failed"));
    render(<ParserWorkbench workspace={WS} />);
    await waitFor(() => expect(screen.getByTestId("chat-input")).toBeTruthy());
    send("go");
    await waitFor(() =>
      expect(screen.getByTestId("chat-messages").textContent).toContain(
        "Agent error: spawn failed",
      ),
    );
  });

  it("apply: surfaces a registration failure", () => {
    render(<ParserWorkbench workspace={WS} />);
    fireEvent.change(screen.getByTestId("parser-source"), {
      target: { value: "definitely not a function" },
    });
    fireEvent.change(screen.getByTestId("parser-id"), { target: { value: "bad-parser" } });
    fireEvent.change(screen.getByTestId("parser-extensions"), { target: { value: ".x" } });
    fireEvent.click(screen.getByTestId("parser-apply"));
    expect(screen.getByTestId("parser-apply-msg").textContent).toContain("등록 실패");
  });

  it("tolerates the acp listener failing to attach", async () => {
    h.listenRejects = true;
    render(<ParserWorkbench workspace={WS} />);
    // still renders the live preview despite the listener attach failing
    await waitFor(() => expect(screen.getByTestId("parser-preview").innerHTML).toContain("📌"));
  });

  it("surfaces a render-pipeline failure in the preview pane", async () => {
    vi.spyOn(previewRender, "render").mockRejectedValueOnce(new Error("render boom"));
    render(<ParserWorkbench workspace={WS} />);
    await waitFor(() =>
      expect(screen.getByTestId("parser-preview-error").textContent).toContain("render boom"),
    );
  });

  it("send: non-Error rejection is stringified into the system message", async () => {
    h.resolve.mockReturnValue({ kind: "acp", label: "claude", id: "a1" });
    h.startSession.mockRejectedValue("raw string failure");
    render(<ParserWorkbench workspace={WS} />);
    await waitFor(() => expect(screen.getByTestId("chat-input")).toBeTruthy());
    send("go");
    await waitFor(() =>
      expect(screen.getByTestId("chat-messages").textContent).toContain(
        "Agent error: raw string failure",
      ),
    );
  });

  it("ignores acp chunks for a different acp session id", async () => {
    h.resolve.mockReturnValue({ kind: "acp", label: "claude", id: "a1" });
    h.startSession.mockResolvedValue("acp1");
    h.sendMessage.mockResolvedValue(undefined);
    render(<ParserWorkbench workspace={WS} />);
    send("go");
    await waitFor(() => expect(h.handler).toBeTruthy());
    h.handler?.({
      payload: {
        sessionId: "OTHER",
        update: { type: "agent_message_chunk", content: { text: "X" } },
      },
    });
    // no assistant message with that text
    expect(screen.getByTestId("chat-messages").textContent).not.toContain("X");
  });
});
