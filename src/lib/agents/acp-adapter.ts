// MAR-1009: Thin renderer-side wrapper around the Rust ACP commands.
//
// This adapter does not own the session lifecycle (`acp_start_session`
// is invoked lazily) — its job is to turn the registered agent shape
// into the IPC call sequence so callers don't have to remember argument
// names. A test seam allows the chat shell to wire a fake adapter.

import { invoke } from "@tauri-apps/api/core";
import type { RegisteredAgent } from "./types";

export interface AcpAdapter {
  /** Spawn the agent + perform handshake. Returns the session id. */
  startSession(agent: RegisteredAgent, workspaceRoot: string): Promise<string>;
  /** Send a user-authored message into an existing session. */
  sendMessage(sessionId: string, text: string): Promise<void>;
  /** Reply to a `session/request_permission` request. */
  approveTool(
    sessionId: string,
    requestId: number | string,
    decision: "allow" | "allow_once" | "deny",
  ): Promise<void>;
}

function makeApproveDecisionPayload(
  requestId: number | string,
  decision: "allow" | "allow_once" | "deny",
): Record<string, unknown> {
  if (typeof requestId === "number") {
    return { requestIdNumber: requestId, decision };
  }
  return { requestIdString: requestId, decision };
}

class TauriAcpAdapter implements AcpAdapter {
  async startSession(agent: RegisteredAgent, workspaceRoot: string): Promise<string> {
    if (agent.kind === "api-key") {
      throw new Error(`acp-adapter: agent ${agent.id} is api-key (no ACP session)`);
    }
    const handle = await invoke<{ sessionId: string }>("acp_start_session", {
      agentId: agent.id,
      workspaceRoot,
    });
    return handle.sessionId;
  }

  async sendMessage(sessionId: string, text: string): Promise<void> {
    await invoke("acp_send_message", { sessionId, content: text });
  }

  async approveTool(
    sessionId: string,
    requestId: number | string,
    decision: "allow" | "allow_once" | "deny",
  ): Promise<void> {
    await invoke("acp_approve_tool", {
      sessionId,
      decision: makeApproveDecisionPayload(requestId, decision),
    });
  }
}

let currentAdapter: AcpAdapter = new TauriAcpAdapter();

/** Replace the active adapter — tests use this to inject a fake. */
export function setAcpAdapter(a: AcpAdapter): void {
  currentAdapter = a;
}

/** Restore the production Tauri-backed adapter. */
export function resetAcpAdapter(): void {
  currentAdapter = new TauriAcpAdapter();
}

export function getAcpAdapter(): AcpAdapter {
  return currentAdapter;
}
