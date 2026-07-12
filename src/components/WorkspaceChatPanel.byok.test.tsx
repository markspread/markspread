// @vitest-environment jsdom
//
// SC-LLM-05 (F12) / SC-LLM-06 chat half (F13b): the BYOK (api-key) agent
// lane. The GWTs fixed by this suite:
//
//   SC-LLM-05 — Given an `api-key` agent and a stored credential, When the
//   user sends a chat message, Then the provider is really called through
//   `ai/runner` (key via the `ai_key_resolve` seam, model/baseUrl from the
//   stored credential meta) and the streamed chunks accumulate in the same
//   shared ChatStream the ACP lanes render into — no ACP session involved.
//
//   SC-LLM-06 — Given an invalid key, When the provider answers 401/403,
//   Then the chat shows a clearly-worded authentication error pointing at
//   Settings › AI; network and other failures get their own wording.
//
// The provider adapters are mocked at the wire seam so the *real* runner
// (alias lookup → ai_key_resolve → adapter routing → usage row) executes.

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
// AgentPicker is heavy (keychain probing) and irrelevant to this suite.
vi.mock("./AgentPicker", () => ({ AgentPicker: () => null }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true) }));

const anthropicCall = vi.fn();
vi.mock("../lib/ai/providers/anthropic", () => ({
  anthropicAdapter: { call: (opts: unknown) => anthropicCall(opts) },
}));
const openaiCall = vi.fn();
vi.mock("../lib/ai/providers/openai", () => ({
  openaiAdapter: { call: (opts: unknown) => openaiCall(opts) },
}));

import { invoke } from "@tauri-apps/api/core";
import { type AcpAdapter, resetAcpAdapter, setAcpAdapter } from "../lib/agents/acp-adapter";
import { type AiKeyEntry, useKeyStore } from "../lib/ai/key-store";
import type { ChatChunk, ChatMessage } from "../lib/ai/providers/types";
import { useAgentRegistry } from "../store/agent-registry";
import { _cancelChatFlush, useChatSessions } from "../store/chat-sessions";
import { useDragChatSelection } from "../store/drag-chat-selection";
import { useTabs } from "../store/tabs";
import { useTelemetry } from "../store/telemetry";
import { WorkspaceChatPanel, classifyByokError, describeByokFailure } from "./WorkspaceChatPanel";

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
const WS = "/ws-byok";

const KEY_ENTRY: AiKeyEntry = {
  alias: "personal-claude",
  provider: "anthropic",
  model: "claude-sonnet-4.5",
  baseUrl: null,
  maskedKey: "sk-…••••XYZ",
  createdAt: 0,
};

interface CapturedCallOpts {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
}

function fakeAcpAdapter(): AcpAdapter {
  return {
    startSession: vi.fn(async () => "acp-sess"),
    sendMessage: vi.fn(async () => {}),
    approveTool: vi.fn(async () => {}),
  };
}

/** Async-iterable provider reply, same shape the real adapters yield. */
function chunkStream(...cs: ChatChunk[]): AsyncGenerator<ChatChunk, void, void> {
  return (async function* () {
    for (const c of cs) yield c;
  })();
}

function doneChunk(): ChatChunk {
  return { kind: "done", usage: { inputTokens: 3, outputTokens: 5 }, finishReason: "stop" };
}

/** Adapter stream whose first pull rejects — what a dead socket looks like. */
function failingStream(err: Error): AsyncIterable<ChatChunk> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<ChatChunk>> {
          return Promise.reject(err);
        },
      };
    },
  };
}

function resetStores() {
  useChatSessions.getState()._reset();
  _cancelChatFlush();
  useTelemetry.setState({ consent: "enabled" });
  useAgentRegistry.getState()._reset();
  useAgentRegistry.getState().setWorkspaceDefault(WS, "claude-api-key");
  useKeyStore.setState({ entries: [KEY_ENTRY], defaultAlias: KEY_ENTRY.alias });
  useTabs.setState({ tabs: [], activePath: null });
  useDragChatSelection.getState().clear();
  resetAcpAdapter();
  anthropicCall.mockReset();
  openaiCall.mockReset();
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === "ai_key_resolve") return "sk-live-key";
    return undefined;
  });
}

beforeEach(resetStores);

afterEach(() => {
  cleanup();
  useChatSessions.getState()._reset();
  _cancelChatFlush();
  useTelemetry.setState({ consent: "unset" });
  useAgentRegistry.getState()._reset();
  useKeyStore.setState({ entries: [], defaultAlias: null });
  useDragChatSelection.getState().clear();
  resetAcpAdapter();
});

async function send(getByTestId: (id: string) => HTMLElement, text: string) {
  fireEvent.change(getByTestId("chat-input"), { target: { value: text } });
  fireEvent.click(getByTestId("chat-send"));
}

describe("WorkspaceChatPanel — BYOK chat lane (SC-LLM-05)", () => {
  it("sends through the runner to the provider and streams chunks into the shared ChatStream", async () => {
    const acp = fakeAcpAdapter();
    setAcpAdapter(acp);
    anthropicCall.mockImplementation(() =>
      chunkStream(
        { kind: "text", delta: "Hello" },
        { kind: "text", delta: " from BYOK" },
        doneChunk(),
      ),
    );
    const { getByTestId } = render(<WorkspaceChatPanel workspaceId={WS} />);

    await send(getByTestId, "hi there");

    // Streamed chunks accumulate into one assistant message in the same
    // ChatStream every lane renders into.
    await waitFor(() =>
      expect(getByTestId("chat-msg-assistant").textContent).toContain("Hello from BYOK"),
    );
    expect(getByTestId("chat-msg-user").textContent).toContain("hi there");
    // The key came through the ai_key_resolve seam (S-AIK-020)…
    expect(invokeMock).toHaveBeenCalledWith("ai_key_resolve", { alias: "personal-claude" });
    // …and no ACP session was ever started for this lane.
    expect(acp.startSession).not.toHaveBeenCalled();
    expect(acp.sendMessage).not.toHaveBeenCalled();

    const opts = anthropicCall.mock.calls[0]?.[0] as CapturedCallOpts;
    expect(opts.apiKey).toBe("sk-live-key");
    // model comes from the stored credential meta, not the agent entry.
    expect(opts.model).toBe(KEY_ENTRY.model);
    expect(opts.messages[0]?.role).toBe("system");
    expect(opts.messages[0]?.content).toContain("[Markspread environment]");
    const last = opts.messages[opts.messages.length - 1];
    expect(last?.role).toBe("user");
    expect(last?.content).toContain(`[Workspace] ${WS}`);
    expect(last?.content).toContain("hi there");
  });

  it("resends prior user/assistant turns on the next call (stateless provider shape)", async () => {
    setAcpAdapter(fakeAcpAdapter());
    anthropicCall.mockImplementationOnce(() =>
      chunkStream({ kind: "text", delta: "ack-1" }, doneChunk()),
    );
    anthropicCall.mockImplementationOnce(() =>
      chunkStream({ kind: "text", delta: "ack-2" }, doneChunk()),
    );
    const { getByTestId } = render(<WorkspaceChatPanel workspaceId={WS} />);

    await send(getByTestId, "one");
    await waitFor(() => expect(getByTestId("chat-msg-assistant").textContent).toContain("ack-1"));
    await send(getByTestId, "two");
    await waitFor(() => expect(anthropicCall).toHaveBeenCalledTimes(2));

    const second = anthropicCall.mock.calls[1]?.[0] as CapturedCallOpts;
    const roles = second.messages.map((m) => m.role);
    expect(roles).toEqual(["system", "user", "assistant", "user"]);
    expect(second.messages[1]?.content).toBe("one");
    expect(second.messages[2]?.content).toBe("ack-1");
    expect(second.messages[3]?.content).toContain("two");
  });

  it("falls back to the first stored entry when no default alias is set", async () => {
    setAcpAdapter(fakeAcpAdapter());
    useKeyStore.setState({ entries: [KEY_ENTRY], defaultAlias: null });
    anthropicCall.mockImplementation(() => chunkStream({ kind: "text", delta: "ok" }, doneChunk()));
    const { getByTestId } = render(<WorkspaceChatPanel workspaceId={WS} />);

    await send(getByTestId, "go");

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("ai_key_resolve", { alias: KEY_ENTRY.alias }),
    );
  });
});

describe("WorkspaceChatPanel — BYOK failure display (SC-LLM-06 chat half)", () => {
  it("a 401 from the provider surfaces a clear authentication error pointing at Settings", async () => {
    setAcpAdapter(fakeAcpAdapter());
    anthropicCall.mockImplementation(() =>
      chunkStream({ kind: "error", message: "anthropic 401: invalid x-api-key" }),
    );
    const { getByTestId } = render(<WorkspaceChatPanel workspaceId={WS} />);

    await send(getByTestId, "hello?");

    await waitFor(() => {
      const sys = getByTestId("chat-msg-system").textContent ?? "";
      expect(sys).toContain("Authentication failed");
      expect(sys).toContain("Settings › AI");
      expect(sys).toContain("401");
    });
  });

  it("a 403 is classified as an authentication error too", async () => {
    setAcpAdapter(fakeAcpAdapter());
    anthropicCall.mockImplementation(() =>
      chunkStream({ kind: "error", message: "anthropic 403: forbidden" }),
    );
    const { getByTestId } = render(<WorkspaceChatPanel workspaceId={WS} />);

    await send(getByTestId, "hello?");

    await waitFor(() =>
      expect(getByTestId("chat-msg-system").textContent).toContain("Authentication failed"),
    );
  });

  it("an unreachable endpoint surfaces as a network error, not an auth error", async () => {
    setAcpAdapter(fakeAcpAdapter());
    anthropicCall.mockImplementation(() => failingStream(new TypeError("fetch failed")));
    const { getByTestId } = render(<WorkspaceChatPanel workspaceId={WS} />);

    await send(getByTestId, "hello?");

    await waitFor(() => {
      const sys = getByTestId("chat-msg-system").textContent ?? "";
      expect(sys).toContain("Network error");
      expect(sys).not.toContain("Authentication failed");
    });
  });

  it("a non-auth HTTP failure surfaces as a provider error with the raw detail", async () => {
    setAcpAdapter(fakeAcpAdapter());
    anthropicCall.mockImplementation(() =>
      chunkStream({ kind: "error", message: "anthropic 529: overloaded" }),
    );
    const { getByTestId } = render(<WorkspaceChatPanel workspaceId={WS} />);

    await send(getByTestId, "hello?");

    await waitFor(() => {
      const sys = getByTestId("chat-msg-system").textContent ?? "";
      expect(sys).toContain("Provider error");
      expect(sys).toContain("529");
    });
  });

  it("a key-resolve failure (thrown before the provider call) still lands in chat", async () => {
    setAcpAdapter(fakeAcpAdapter());
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "ai_key_resolve") throw new Error("keychain locked");
      return undefined;
    });
    const { getByTestId } = render(<WorkspaceChatPanel workspaceId={WS} />);

    await send(getByTestId, "hello?");

    await waitFor(() => {
      const sys = getByTestId("chat-msg-system").textContent ?? "";
      expect(sys).toContain("Provider error");
      expect(sys).toContain("keychain locked");
    });
    expect(anthropicCall).not.toHaveBeenCalled();
  });
});

// ─── drag-edit on the BYOK lane (flow is lane-independent) ──────────────

const DOC = "# Title\nold line\nrest";

function captureSelection() {
  act(() => {
    useDragChatSelection.getState().capture({
      filePath: "notes.md",
      fullText: DOC,
      fromOffset: 8,
      toOffset: 16, // "old line"
    });
  });
}

describe("WorkspaceChatPanel — BYOK drag-edit lane (SC-LLM-05 × SC-DRAG-01)", () => {
  it("a selection-scoped request runs through the runner and opens the inline diff", async () => {
    const acp = fakeAcpAdapter();
    setAcpAdapter(acp);
    anthropicCall.mockImplementation(() =>
      chunkStream({ kind: "text", delta: "new line" }, doneChunk()),
    );
    const { getByTestId } = render(<WorkspaceChatPanel workspaceId={WS} />);
    captureSelection();

    await send(getByTestId, "make it better");

    await waitFor(() => expect(getByTestId("inline-diff-overlay")).toBeTruthy());
    const overlay = getByTestId("inline-diff-overlay");
    expect(overlay.textContent).toContain("new line");
    expect(overlay.textContent).toContain("old line");
    expect(acp.startSession).not.toHaveBeenCalled();
    const opts = anthropicCall.mock.calls[0]?.[0] as CapturedCallOpts;
    const prompt = opts.messages[opts.messages.length - 1]?.content ?? "";
    expect(prompt).toContain("[Markspread drag-edit request]");
    expect(prompt).toContain("old line");
    expect(prompt).toContain("make it better");
  });

  it("a 401 during a drag-edit shows the auth notice and opens no overlay", async () => {
    setAcpAdapter(fakeAcpAdapter());
    anthropicCall.mockImplementation(() =>
      chunkStream({ kind: "error", message: "anthropic 401: invalid x-api-key" }),
    );
    const { getByTestId, queryByTestId } = render(<WorkspaceChatPanel workspaceId={WS} />);
    captureSelection();

    await send(getByTestId, "improve");

    await waitFor(() =>
      expect(getByTestId("chat-msg-system").textContent).toContain("Authentication failed"),
    );
    expect(queryByTestId("inline-diff-overlay")).toBeNull();
  });

  it("an empty provider reply aborts the drag flow with the no-replacement notice", async () => {
    setAcpAdapter(fakeAcpAdapter());
    anthropicCall.mockImplementation(() => chunkStream(doneChunk()));
    const { getByTestId, queryByTestId, container } = render(
      <WorkspaceChatPanel workspaceId={WS} />,
    );
    captureSelection();

    await send(getByTestId, "improve");

    await waitFor(() => expect(container.textContent ?? "").toContain("no replacement text"));
    expect(queryByTestId("inline-diff-overlay")).toBeNull();
  });

  it("drag-edit without a stored key prints the Settings guidance", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setAcpAdapter(fakeAcpAdapter());
    useKeyStore.setState({ entries: [], defaultAlias: null });
    const { getByTestId, container } = render(<WorkspaceChatPanel workspaceId={WS} />);
    captureSelection();

    await send(getByTestId, "improve");

    await waitFor(() => expect(container.textContent ?? "").toContain("No API key registered"));
    expect(anthropicCall).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ─── classification unit coverage (F13b) ────────────────────────────────

describe("classifyByokError / describeByokFailure", () => {
  it("maps provider-status prefixes: 401/403 → auth, other statuses → other", () => {
    expect(classifyByokError("openai 401: nope")).toBe("auth");
    expect(classifyByokError("anthropic 403: forbidden")).toBe("auth");
    expect(classifyByokError("openai 429: slow down")).toBe("other");
    expect(classifyByokError("anthropic 500: oops")).toBe("other");
  });

  it("maps connection-shaped failures to network", () => {
    expect(classifyByokError("fetch failed")).toBe("network");
    expect(classifyByokError("Failed to fetch")).toBe("network");
    expect(classifyByokError("connect ECONNREFUSED 127.0.0.1:443")).toBe("network");
    expect(classifyByokError("getaddrinfo ENOTFOUND api.example.com")).toBe("network");
    expect(classifyByokError("request timed out")).toBe("network");
  });

  it("everything else is other", () => {
    expect(classifyByokError("unknown alias: main")).toBe("other");
    expect(classifyByokError("schema mismatch")).toBe("other");
  });

  it("keeps the raw detail in every notice", () => {
    expect(describeByokFailure("openai 401: bad key")).toContain("openai 401: bad key");
    expect(describeByokFailure("openai 401: bad key")).toContain("Settings › AI");
    expect(describeByokFailure("fetch failed")).toContain("fetch failed");
    expect(describeByokFailure("weird")).toBe("Provider error: weird");
  });
});
