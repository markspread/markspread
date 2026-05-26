// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));

import { _cancelChatFlush, useChatSessions } from "../../store/chat-sessions";
import { subscribeTelemetry, useTelemetry } from "../../store/telemetry";
import { useWorkspace } from "../../store/workspace";
import { ChatShell } from "../ChatShell";

function resetStores() {
  useChatSessions.getState()._reset();
  _cancelChatFlush();
  useWorkspace.setState({ current: "/ws-1", preferredShell: "chat" });
  useTelemetry.setState({ consent: "enabled" });
}

afterEach(() => {
  cleanup();
  useChatSessions.getState()._reset();
  _cancelChatFlush();
  useWorkspace.setState({ current: null, preferredShell: "chat" });
  useTelemetry.setState({ consent: "unset" });
});

describe("ChatShell", () => {
  beforeEach(resetStores);

  it("mounts the three columns and auto-creates a session", () => {
    const { getByTestId } = render(<ChatShell />);
    expect(getByTestId("chat-workspace-nav")).toBeTruthy();
    expect(getByTestId("chat-stream-region")).toBeTruthy();
    expect(getByTestId("chat-context-panel")).toBeTruthy();
    // Auto-created session is active.
    expect(useChatSessions.getState().activeSessionId).not.toBeNull();
  });

  it("emits shell.mounted on first paint", () => {
    const events: { type: string }[] = [];
    const off = subscribeTelemetry((e) => events.push(e));
    render(<ChatShell />);
    expect(events.some((e) => e.type === "shell.mounted")).toBe(true);
    off();
  });

  it("collapse buttons hide and re-show the side panels", () => {
    const { getByTestId, queryByTestId } = render(<ChatShell />);
    fireEvent.click(getByTestId("chat-toggle-nav"));
    expect(queryByTestId("chat-workspace-nav")).toBeNull();
    fireEvent.click(getByTestId("chat-toggle-context"));
    expect(queryByTestId("chat-context-panel")).toBeNull();
    // Toggle back on.
    fireEvent.click(getByTestId("chat-toggle-nav"));
    fireEvent.click(getByTestId("chat-toggle-context"));
    expect(queryByTestId("chat-workspace-nav")).toBeTruthy();
    expect(queryByTestId("chat-context-panel")).toBeTruthy();
  });

  it("switch-to-editor sets preferredShell + emits the events", () => {
    const events: { type: string }[] = [];
    const off = subscribeTelemetry((e) => events.push(e));
    const { getByTestId } = render(<ChatShell />);
    fireEvent.click(getByTestId("chat-switch-editor"));
    expect(useWorkspace.getState().preferredShell).toBe("editor");
    expect(events.some((e) => e.type === "shell.switched")).toBe(true);
    expect(events.some((e) => e.type === "editor.opened_via_escape_hatch")).toBe(true);
    off();
  });

  it("sending a message appends user + placeholder assistant cards", () => {
    const { getByTestId } = render(<ChatShell />);
    const input = getByTestId("chat-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.click(getByTestId("chat-send"));
    expect(getByTestId("chat-msg-user").textContent).toContain("hello");
    expect(getByTestId("chat-msg-assistant").textContent).toContain("not yet connected");
  });

  it("re-selects an existing session when one is already created", () => {
    // Pre-create a session and then mount.
    const existing = useChatSessions.getState().createSession("/ws-1", "existing");
    useChatSessions.setState({ activeSessionId: null });
    render(<ChatShell />);
    expect(useChatSessions.getState().activeSessionId).toBe(existing.id);
  });

  it("uses workspaceIdOverride when supplied", () => {
    const { getByTestId } = render(<ChatShell workspaceIdOverride="/other" />);
    // Toolbar shows the override.
    expect(getByTestId("chat-toolbar").textContent).toContain("/other");
  });

  it("renders placeholder when workspaceId is empty", () => {
    useWorkspace.setState({ current: null, preferredShell: "chat" });
    const { getByTestId } = render(<ChatShell />);
    expect(getByTestId("chat-toolbar").textContent).toContain("(no workspace)");
    // No auto-session created when there's no workspace id.
    expect(useChatSessions.getState().activeSessionId).toBeNull();
  });

  it("creating a new session from the nav adds another entry", () => {
    const { getByTestId } = render(<ChatShell />);
    const initial = useChatSessions.getState().byWorkspace["/ws-1"]?.length ?? 0;
    fireEvent.click(getByTestId("chat-new-session"));
    const after = useChatSessions.getState().byWorkspace["/ws-1"]?.length ?? 0;
    expect(after).toBe(initial + 1);
  });

  it("selecting a session through the nav makes it active", () => {
    const { getByTestId } = render(<ChatShell />);
    const wsList = useChatSessions.getState().byWorkspace["/ws-1"] ?? [];
    expect(wsList.length).toBeGreaterThan(0);
    // Create one more.
    act(() => {
      useChatSessions.getState().createSession("/ws-1", "Second");
    });
    const all = useChatSessions.getState().byWorkspace["/ws-1"] ?? [];
    const other = all.find((id) => id !== useChatSessions.getState().activeSessionId);
    if (!other) throw new Error("expected a second session");
    fireEvent.click(getByTestId(`chat-session-${other}`));
    expect(useChatSessions.getState().activeSessionId).toBe(other);
  });
});
