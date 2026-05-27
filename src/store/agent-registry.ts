// MAR-1010: per-workspace registered-agent store.
//
// Holds:
//   - the built-in agents (constant from `lib/agents/types.ts`)
//   - user-defined `acp-external` agents (persisted on disk through the
//     Tauri command `agents_save_custom`)
//   - per-workspace default agent id (which the chat-shell falls back to
//     when no per-session override is set)
//
// Persistence: we re-hydrate on first read by calling
// `agents_list_custom` lazily; failures fall back to empty + a warn log,
// keeping the UI usable even if the host command is unwired.

import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { BUILTIN_AGENTS, type RegisteredAgent } from "../lib/agents/types";

interface AgentRegistryState {
  /** All known agents (builtin + custom). Keyed by id. */
  byId: Record<string, RegisteredAgent>;
  /** Order in which agents appear in pickers. */
  order: string[];
  /** Per-workspace default agent id. */
  defaults: Record<string, string>;
  /** Per-chat-session override (overrides workspace default). */
  overrides: Record<string, string>;
  loaded: boolean;
  /** Reset to initial state — tests only. */
  _reset: () => void;
  load: () => Promise<void>;
  registerCustom: (agent: RegisteredAgent) => Promise<void>;
  removeCustom: (id: string) => Promise<void>;
  setWorkspaceDefault: (workspaceId: string, agentId: string) => void;
  setSessionOverride: (sessionId: string, agentId: string) => void;
  clearSessionOverride: (sessionId: string) => void;
  /** Resolve which agent applies for a (workspace, session) pair. */
  resolve: (workspaceId: string, sessionId: string | null) => RegisteredAgent | undefined;
}

function initialFromBuiltins(): { byId: Record<string, RegisteredAgent>; order: string[] } {
  const byId: Record<string, RegisteredAgent> = {};
  const order: string[] = [];
  for (const a of BUILTIN_AGENTS) {
    byId[a.id] = a;
    order.push(a.id);
  }
  return { byId, order };
}

export const useAgentRegistry = create<AgentRegistryState>((set, get) => ({
  ...initialFromBuiltins(),
  defaults: {},
  overrides: {},
  loaded: false,
  _reset: () =>
    set({
      ...initialFromBuiltins(),
      defaults: {},
      overrides: {},
      loaded: false,
    }),
  load: async () => {
    if (get().loaded) return;
    try {
      const customs = await invoke<RegisteredAgent[]>("agents_list_custom");
      if (Array.isArray(customs)) {
        set((s) => {
          const byId = { ...s.byId };
          const order = s.order.slice();
          for (const a of customs) {
            if (!byId[a.id]) order.push(a.id);
            byId[a.id] = a;
          }
          return { byId, order, loaded: true };
        });
        return;
      }
    } catch (e) {
      console.warn("[agent-registry] load failed", e);
    }
    set({ loaded: true });
  },
  registerCustom: async (agent) => {
    set((s) => {
      const order = s.order.includes(agent.id) ? s.order : [...s.order, agent.id];
      return { byId: { ...s.byId, [agent.id]: agent }, order };
    });
    try {
      await invoke("agents_save_custom", { agent });
    } catch (e) {
      console.warn("[agent-registry] save failed", e);
    }
  },
  removeCustom: async (id) => {
    // Builtins are never removed.
    if (BUILTIN_AGENTS.some((b) => b.id === id)) return;
    set((s) => {
      const byId = { ...s.byId };
      delete byId[id];
      const order = s.order.filter((x) => x !== id);
      const defaults = { ...s.defaults };
      for (const k of Object.keys(defaults)) {
        if (defaults[k] === id) delete defaults[k];
      }
      const overrides = { ...s.overrides };
      for (const k of Object.keys(overrides)) {
        if (overrides[k] === id) delete overrides[k];
      }
      return { byId, order, defaults, overrides };
    });
    try {
      await invoke("agents_remove_custom", { id });
    } catch (e) {
      console.warn("[agent-registry] remove failed", e);
    }
  },
  setWorkspaceDefault: (workspaceId, agentId) => {
    set((s) => ({ defaults: { ...s.defaults, [workspaceId]: agentId } }));
    void invoke("acp_set_workspace_default", { workspaceId, agentId }).catch(() => {});
  },
  setSessionOverride: (sessionId, agentId) =>
    set((s) => ({ overrides: { ...s.overrides, [sessionId]: agentId } })),
  clearSessionOverride: (sessionId) =>
    set((s) => {
      const overrides = { ...s.overrides };
      delete overrides[sessionId];
      return { overrides };
    }),
  resolve: (workspaceId, sessionId) => {
    const s = get();
    const override = sessionId ? s.overrides[sessionId] : undefined;
    const def = s.defaults[workspaceId];
    const id = override ?? def ?? s.order[0];
    return id ? s.byId[id] : undefined;
  },
}));
