// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unregisterParser } from "../lib/parsers/register-from-source";
import * as previewRender from "../lib/preview/render";
import { useActivityMode } from "../store/activity-mode";
import { useChatSessions } from "../store/chat-sessions";
import { useTabs } from "../store/tabs";
import { ParserWorkbench, clampSampleRatio, nextSampleRatio } from "./ParserWorkbench";

const h = vi.hoisted(() => ({
  handler: null as null | ((e: { payload: unknown }) => void),
  listenRejects: false,
  startSession: vi.fn<(...a: unknown[]) => Promise<string>>(),
  sendMessage: vi.fn<(...a: unknown[]) => Promise<void>>(),
  resolve: vi.fn<(...a: unknown[]) => unknown>(),
  // Routes Tauri IPC by command. fs_read_file is the N11 live-data path the
  // workbench uses for the active file; FileTree's fs_list_dir / fs_check_locked
  // calls fall through to the default so the shared tree mounts cleanly.
  invoke: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => h.invoke(cmd, args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  // The shared FileTree mounted in the workbench also subscribes to `fs:event`;
  // only the workbench's own `acp:notification` listener is under test here, so
  // the inject-failure flag must not reject FileTree's unrelated subscription
  // (its .then chain has no .catch, so a spurious reject would leak as an
  // unhandled rejection and falsely fail the run).
  listen: (event: string, cb: (e: { payload: unknown }) => void) => {
    if (event === "acp:notification") {
      if (h.listenRejects) return Promise.reject(new Error("listen boom"));
      h.handler = cb;
    }
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

// Default IPC: FileTree's directory/lock probes resolve empty; fs_read_file is
// overridden per-test where the active-file path matters.
function defaultInvoke(cmd: string): Promise<unknown> {
  if (cmd === "fs_list_dir") return Promise.resolve({ entries: [], page: 0, has_more: false });
  if (cmd === "fs_check_locked") return Promise.resolve(false);
  return Promise.resolve(undefined);
}

beforeEach(() => {
  h.invoke.mockImplementation(defaultInvoke);
});

afterEach(() => {
  cleanup();
  h.handler = null;
  h.listenRejects = false;
  h.startSession.mockReset();
  h.sendMessage.mockReset();
  h.resolve.mockReset();
  h.invoke.mockReset();
  vi.restoreAllMocks();
  useChatSessions.getState()._reset();
  useTabs.getState().replaceAll([], null);
  useActivityMode.setState({
    mode: "workspace",
    parserPrefillSource: "",
    enteredParserFrom: null,
    parserRenderNonce: 0,
  });
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

  it("renders the shared FileTree wired to the parser split", async () => {
    render(<ParserWorkbench workspace={WS} />);
    await waitFor(() => expect(screen.getByTestId("parser-file-tree")).toBeTruthy());
    // FileTree mounted → it eagerly lists the workspace root via fs_list_dir.
    await waitFor(() => expect(h.invoke.mock.calls.some((c) => c[0] === "fs_list_dir")).toBe(true));
  });

  it("no active file → DEFAULT_SAMPLE mock is the live preview source", async () => {
    render(<ParserWorkbench workspace={WS} />);
    await waitFor(() => expect(screen.getByTestId("parser-preview").innerHTML).toContain("📌"));
    expect((screen.getByTestId("parser-sample") as HTMLTextAreaElement).value).toContain(
      "샘플 문서",
    );
    expect(screen.getByTestId("parser-sample-source").textContent).toContain("미선택");
  });

  it("N11: selecting a workspace file reads its real content into the sample", async () => {
    h.invoke.mockImplementation((cmd, args) => {
      if (cmd === "fs_read_file") {
        expect(args).toMatchObject({ workspace: WS, path: "/ws/doc.md" });
        return Promise.resolve({ content: "::note REALFILE 내용", encoding: "utf-8" });
      }
      return defaultInvoke(cmd);
    });
    render(<ParserWorkbench workspace={WS} />);
    act(() => {
      useTabs.getState().setActive("/ws/doc.md");
    });
    await waitFor(() =>
      expect((screen.getByTestId("parser-sample") as HTMLTextAreaElement).value).toContain(
        "REALFILE",
      ),
    );
    // header reflects the active file basename, not the mock label
    expect(screen.getByTestId("parser-sample-source").textContent).toContain("doc.md");
    // live preview renders the real file through the default parser
    await waitFor(() =>
      expect(screen.getByTestId("parser-preview").innerHTML).toContain("REALFILE"),
    );
  });

  it("truncates an oversized active file before sampling it", async () => {
    const big = `::note ${"x".repeat(60_000)}`;
    h.invoke.mockImplementation((cmd) => {
      if (cmd === "fs_read_file") return Promise.resolve({ content: big, encoding: "utf-8" });
      return defaultInvoke(cmd);
    });
    render(<ParserWorkbench workspace={WS} />);
    act(() => {
      useTabs.getState().setActive("/ws/big.md");
    });
    await waitFor(() => {
      const v = (screen.getByTestId("parser-sample") as HTMLTextAreaElement).value;
      expect(v).toContain("truncated; total 60007 chars");
      expect(v.length).toBeLessThan(big.length);
    });
  });

  it("falls back to the mock when fs_read_file returns a non-string body", async () => {
    h.invoke.mockImplementation((cmd) => {
      if (cmd === "fs_read_file") return Promise.resolve({ content: null, encoding: "binary" });
      return defaultInvoke(cmd);
    });
    render(<ParserWorkbench workspace={WS} />);
    act(() => {
      useTabs.getState().setActive("/ws/image.png");
    });
    await waitFor(() =>
      expect((screen.getByTestId("parser-sample") as HTMLTextAreaElement).value).toContain(
        "샘플 문서",
      ),
    );
  });

  it("falls back to the mock when reading the active file throws", async () => {
    h.invoke.mockImplementation((cmd) => {
      if (cmd === "fs_read_file") return Promise.reject(new Error("read boom"));
      return defaultInvoke(cmd);
    });
    render(<ParserWorkbench workspace={WS} />);
    act(() => {
      useTabs.getState().setActive("/ws/locked.md");
    });
    await waitFor(() =>
      expect((screen.getByTestId("parser-sample") as HTMLTextAreaElement).value).toContain(
        "샘플 문서",
      ),
    );
  });

  it("reverts to the mock sample when the active file is cleared", async () => {
    h.invoke.mockImplementation((cmd) => {
      if (cmd === "fs_read_file")
        return Promise.resolve({ content: "::note PICKED", encoding: "utf-8" });
      return defaultInvoke(cmd);
    });
    render(<ParserWorkbench workspace={WS} />);
    act(() => {
      useTabs.getState().setActive("/ws/doc.md");
    });
    await waitFor(() =>
      expect((screen.getByTestId("parser-sample") as HTMLTextAreaElement).value).toContain(
        "PICKED",
      ),
    );
    act(() => {
      useTabs.getState().replaceAll([], null);
    });
    await waitFor(() =>
      expect((screen.getByTestId("parser-sample") as HTMLTextAreaElement).value).toContain(
        "샘플 문서",
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

  it("N5: consumes the carried prefill source into the editor on entry, then clears it", async () => {
    act(() => {
      useActivityMode.getState().enterParser({
        prefillSource: '(input) => ({ ast: { kind: "html", html: "<b>PREFILLED</b>" } })',
      });
    });
    render(<ParserWorkbench workspace={WS} />);
    await waitFor(() =>
      expect((screen.getByTestId("parser-source") as HTMLTextAreaElement).value).toContain(
        "PREFILLED",
      ),
    );
    // Prefill is consumed once — store slot is cleared so re-renders don't clobber edits.
    expect(useActivityMode.getState().parserPrefillSource).toBe("");
    // and the prefilled parser renders in the live preview.
    await waitFor(() =>
      expect(screen.getByTestId("parser-preview").innerHTML).toContain("PREFILLED"),
    );
  });

  it("N5: breadcrump '돌아가기' returns to the entered review mode", () => {
    act(() => {
      useActivityMode.setState({ mode: "workspace" });
      useActivityMode.getState().enterParser();
    });
    render(<ParserWorkbench workspace={WS} />);
    expect(useActivityMode.getState().mode).toBe("parser");
    fireEvent.click(screen.getByTestId("parser-back"));
    expect(useActivityMode.getState().mode).toBe("workspace");
    expect(useActivityMode.getState().enteredParserFrom).toBeNull();
  });

  it("N5: no breadcrumb when parser mode is opened directly from the activity bar", () => {
    act(() => {
      // setMode = direct activity-bar switch → no enteredParserFrom recorded.
      useActivityMode.getState().setMode("parser");
    });
    render(<ParserWorkbench workspace={WS} />);
    expect(screen.queryByTestId("parser-back")).toBeNull();
  });

  it("N10: '이 파서로 지금 렌더' registers, returns to review, and bumps the render nonce", () => {
    act(() => {
      useActivityMode.getState().enterParser();
    });
    render(<ParserWorkbench workspace={WS} />);
    fireEvent.change(screen.getByTestId("parser-id"), { target: { value: "my-parser" } });
    fireEvent.change(screen.getByTestId("parser-extensions"), { target: { value: ".md" } });
    const before = useActivityMode.getState().parserRenderNonce;
    fireEvent.click(screen.getByTestId("parser-apply-render"));
    // registration succeeded → message + back to review + nonce bumped.
    expect(screen.getByTestId("parser-apply-msg").textContent).toContain("등록됨");
    expect(useActivityMode.getState().mode).toBe("workspace");
    expect(useActivityMode.getState().parserRenderNonce).toBe(before + 1);
  });

  it("AC2: center panel defaults to preview-first (sample < preview basis)", () => {
    render(<ParserWorkbench workspace={WS} />);
    const sample = screen.getByTestId("parser-sample");
    // flex-basis is the sample ratio (28%) → preview gets the remaining ~72%.
    expect(sample.style.flexBasis).toBe("28%");
  });

  it("AC2: keyboard ArrowDown on the resizer grows the sample share", () => {
    render(<ParserWorkbench workspace={WS} />);
    const resizer = screen.getByTestId("parser-sample-resizer");
    const sample = screen.getByTestId("parser-sample");
    expect(sample.style.flexBasis).toBe("28%");
    fireEvent.keyDown(resizer, { key: "ArrowDown" });
    // 0.28 + 0.03 = 0.31
    expect(sample.style.flexBasis).toBe("31%");
    // Shift = larger step: 0.31 + 0.10 = 0.41
    fireEvent.keyDown(resizer, { key: "ArrowDown", shiftKey: true });
    expect(sample.style.flexBasis).toBe("41%");
  });

  it("AC2: ArrowUp shrinks and clamps the sample share to the minimum", () => {
    render(<ParserWorkbench workspace={WS} />);
    const resizer = screen.getByTestId("parser-sample-resizer");
    const sample = screen.getByTestId("parser-sample");
    fireEvent.keyDown(resizer, { key: "Home" });
    expect(sample.style.flexBasis).toBe("12%");
    // already at min → ArrowUp stays clamped, preview keeps priority.
    fireEvent.keyDown(resizer, { key: "ArrowUp" });
    expect(sample.style.flexBasis).toBe("12%");
  });

  it("AC2: End maximizes and a non-arrow key is a no-op on the resizer", () => {
    render(<ParserWorkbench workspace={WS} />);
    const resizer = screen.getByTestId("parser-sample-resizer");
    const sample = screen.getByTestId("parser-sample");
    fireEvent.keyDown(resizer, { key: "End" });
    expect(sample.style.flexBasis).toBe("80%");
    fireEvent.keyDown(resizer, { key: "x" });
    expect(sample.style.flexBasis).toBe("80%");
  });

  it("AC2: pointer drag exercises the capture → move → release path", () => {
    // NOTE: jsdom PointerEvent does not carry clientY through fireEvent, so the
    // exact ratio arithmetic is covered by the nextSampleRatio unit test below.
    // Here we only assert the drag wiring runs end-to-end without throwing.
    render(<ParserWorkbench workspace={WS} />);
    const resizer = screen.getByTestId("parser-sample-resizer");
    resizer.setPointerCapture = () => {};
    resizer.hasPointerCapture = () => true;
    resizer.releasePointerCapture = () => {};
    fireEvent.pointerDown(resizer, { pointerId: 1, clientY: 100 });
    fireEvent.pointerMove(resizer, { pointerId: 1, clientY: 140 });
    fireEvent.pointerUp(resizer, { pointerId: 1 });
    expect(resizer).toBeTruthy();
  });

  it("AC2: pointer move without capture is ignored", () => {
    render(<ParserWorkbench workspace={WS} />);
    const resizer = screen.getByTestId("parser-sample-resizer");
    const sample = screen.getByTestId("parser-sample");
    resizer.hasPointerCapture = () => false;
    fireEvent.pointerMove(resizer, { pointerId: 1, clientY: 999 });
    expect(sample.style.flexBasis).toBe("28%");
  });

  it("AC2: nextSampleRatio converts pixel delta to ratio, clamps, and guards h≤0", () => {
    // +40px over a 400px container → +0.10 → 0.28 + 0.10 = 0.38
    expect(nextSampleRatio(0.28, 40, 400)).toBeCloseTo(0.38, 5);
    // overshoot clamps to max (0.8); undershoot clamps to min (0.12)
    expect(nextSampleRatio(0.5, 1000, 400)).toBe(0.8);
    expect(nextSampleRatio(0.5, -1000, 400)).toBe(0.12);
    // zero / negative container height → no change (pre-layout guard)
    expect(nextSampleRatio(0.28, 40, 0)).toBe(0.28);
    // NaN ratio falls back to the default
    expect(clampSampleRatio(Number.NaN)).toBeCloseTo(0.28, 5);
  });

  it("N10: '이 파서로 지금 렌더' stays in parser mode when registration fails", () => {
    act(() => {
      useActivityMode.getState().enterParser();
    });
    render(<ParserWorkbench workspace={WS} />);
    fireEvent.change(screen.getByTestId("parser-source"), {
      target: { value: "definitely not a function" },
    });
    fireEvent.change(screen.getByTestId("parser-id"), { target: { value: "bad-parser" } });
    fireEvent.change(screen.getByTestId("parser-extensions"), { target: { value: ".x" } });
    const before = useActivityMode.getState().parserRenderNonce;
    fireEvent.click(screen.getByTestId("parser-apply-render"));
    expect(screen.getByTestId("parser-apply-msg").textContent).toContain("등록 실패");
    // stayed put, no nonce bump → review preview untouched.
    expect(useActivityMode.getState().mode).toBe("parser");
    expect(useActivityMode.getState().parserRenderNonce).toBe(before);
  });
});
