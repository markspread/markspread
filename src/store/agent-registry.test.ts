// MAR-1010: agent-registry store tests — covers builtin hydration,
// custom CRUD, per-workspace defaults, per-session overrides, and the
// resolve precedence.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useAgentRegistry } from "./agent-registry";

function reset() {
  useAgentRegistry.getState()._reset();
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
}

describe("agent-registry store", () => {
  beforeEach(reset);
  afterEach(reset);

  it("hydrates the three builtins on init", () => {
    const { byId, order } = useAgentRegistry.getState();
    expect(order).toContain("claude-subscription");
    expect(order).toContain("claude-haiku");
    expect(order).toContain("claude-api-key");
    expect(byId["claude-api-key"]?.kind).toBe("api-key");
  });

  it("load() returns early when already loaded", async () => {
    useAgentRegistry.setState({ loaded: true });
    await useAgentRegistry.getState().load();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("load() merges custom entries returned from Rust", async () => {
    invokeMock.mockResolvedValueOnce([
      {
        id: "codex-cli",
        label: "Codex CLI",
        kind: "acp-external",
        transport: { command: "codex", args: ["--acp"] },
      },
    ]);
    await useAgentRegistry.getState().load();
    const s = useAgentRegistry.getState();
    expect(s.byId["codex-cli"]?.label).toBe("Codex CLI");
    expect(s.order).toContain("codex-cli");
    expect(s.loaded).toBe(true);
  });

  it("load() updates an existing entry without re-ordering", async () => {
    invokeMock.mockResolvedValueOnce([
      {
        id: "claude-subscription",
        label: "Claude (Sonnet) — overridden",
        kind: "acp-builtin",
        transport: { command: "claude", args: ["--acp"], auth: "subscription" },
      },
    ]);
    const orderBefore = useAgentRegistry.getState().order.slice();
    await useAgentRegistry.getState().load();
    const s = useAgentRegistry.getState();
    expect(s.order).toEqual(orderBefore);
    expect(s.byId["claude-subscription"]?.label).toContain("overridden");
  });

  it("load() tolerates a non-array response", async () => {
    invokeMock.mockResolvedValueOnce({ not: "array" });
    await useAgentRegistry.getState().load();
    expect(useAgentRegistry.getState().loaded).toBe(true);
  });

  it("load() swallows IPC errors and still marks loaded", async () => {
    invokeMock.mockRejectedValueOnce(new Error("ipc down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await useAgentRegistry.getState().load();
    expect(useAgentRegistry.getState().loaded).toBe(true);
    warn.mockRestore();
  });

  it("registerCustom adds the agent and forwards to Rust", async () => {
    await useAgentRegistry.getState().registerCustom({
      id: "my-agent",
      label: "My Agent",
      kind: "acp-external",
      transport: { command: "my-cli", args: [] },
    });
    expect(useAgentRegistry.getState().byId["my-agent"]).toBeDefined();
    expect(invokeMock).toHaveBeenCalledWith("agents_save_custom", expect.any(Object));
  });

  it("registerCustom updates an existing id without duplicating order", async () => {
    await useAgentRegistry.getState().registerCustom({
      id: "alpha",
      label: "Alpha v1",
      kind: "acp-external",
      transport: { command: "a", args: [] },
    });
    const lenBefore = useAgentRegistry.getState().order.length;
    await useAgentRegistry.getState().registerCustom({
      id: "alpha",
      label: "Alpha v2",
      kind: "acp-external",
      transport: { command: "a", args: [] },
    });
    expect(useAgentRegistry.getState().order.length).toBe(lenBefore);
    expect(useAgentRegistry.getState().byId.alpha?.label).toBe("Alpha v2");
  });

  it("registerCustom tolerates a save failure", async () => {
    invokeMock.mockRejectedValueOnce(new Error("disk full"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await useAgentRegistry.getState().registerCustom({
      id: "x",
      label: "X",
      kind: "acp-external",
      transport: { command: "x", args: [] },
    });
    expect(useAgentRegistry.getState().byId.x).toBeDefined();
    warn.mockRestore();
  });

  it("removeCustom drops the agent and cleans up references", async () => {
    await useAgentRegistry.getState().registerCustom({
      id: "to-delete",
      label: "Doomed",
      kind: "acp-external",
      transport: { command: "x", args: [] },
    });
    useAgentRegistry.getState().setWorkspaceDefault("/ws", "to-delete");
    useAgentRegistry.getState().setSessionOverride("sess", "to-delete");
    await useAgentRegistry.getState().removeCustom("to-delete");
    const s = useAgentRegistry.getState();
    expect(s.byId["to-delete"]).toBeUndefined();
    expect(s.defaults["/ws"]).toBeUndefined();
    expect(s.overrides.sess).toBeUndefined();
  });

  it("removeCustom refuses to remove builtins", async () => {
    await useAgentRegistry.getState().removeCustom("claude-subscription");
    expect(useAgentRegistry.getState().byId["claude-subscription"]).toBeDefined();
  });

  it("removeCustom tolerates a Rust failure", async () => {
    await useAgentRegistry.getState().registerCustom({
      id: "ephemeral",
      label: "E",
      kind: "acp-external",
      transport: { command: "x", args: [] },
    });
    invokeMock.mockRejectedValueOnce(new Error("nope"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await useAgentRegistry.getState().removeCustom("ephemeral");
    expect(useAgentRegistry.getState().byId.ephemeral).toBeUndefined();
    warn.mockRestore();
  });

  it("setWorkspaceDefault persists to disk and updates state", () => {
    useAgentRegistry.getState().setWorkspaceDefault("/ws", "claude-haiku");
    expect(useAgentRegistry.getState().defaults["/ws"]).toBe("claude-haiku");
    expect(invokeMock).toHaveBeenCalledWith("acp_set_workspace_default", expect.any(Object));
  });

  it("setSessionOverride + clearSessionOverride round-trip", () => {
    useAgentRegistry.getState().setSessionOverride("s1", "claude-api-key");
    expect(useAgentRegistry.getState().overrides.s1).toBe("claude-api-key");
    useAgentRegistry.getState().clearSessionOverride("s1");
    expect(useAgentRegistry.getState().overrides.s1).toBeUndefined();
  });

  it("resolve() prefers session override over workspace default", () => {
    useAgentRegistry.getState().setWorkspaceDefault("/w", "claude-subscription");
    useAgentRegistry.getState().setSessionOverride("s", "claude-haiku");
    const got = useAgentRegistry.getState().resolve("/w", "s");
    expect(got?.id).toBe("claude-haiku");
  });

  it("resolve() falls back to workspace default", () => {
    useAgentRegistry.getState().setWorkspaceDefault("/w", "claude-api-key");
    const got = useAgentRegistry.getState().resolve("/w", null);
    expect(got?.id).toBe("claude-api-key");
  });

  it("resolve() falls back to the first registered agent", () => {
    const got = useAgentRegistry.getState().resolve("/missing", null);
    expect(got?.id).toBe("claude-subscription");
  });

  it("resolve() returns undefined when registry is empty", () => {
    useAgentRegistry.setState({ byId: {}, order: [] });
    expect(useAgentRegistry.getState().resolve("/x", null)).toBeUndefined();
  });
});
