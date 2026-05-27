// MAR-1009 / MAR-1010: Agent-registry domain types.
//
// Three flavours of agent share a common shape so the picker UI groups
// them and so the chat-shell can ask one of them to handle a turn:
//   - `acp-builtin`     : speaks ACP, baked into the Tauri binary
//   - `acp-external`    : speaks ACP, user-provided command line
//   - `api-key`         : legacy provider path through `ai/credentials`
//                         (NOT ACP — tool calls auto-approved per ADR-0004)

export type AgentKind = "acp-builtin" | "acp-external" | "api-key";

export interface AgentTransport {
  /** Argv[0]; further argv lives in `args`. */
  command: string;
  args: string[];
  /** Optional working directory override (defaults to workspace root). */
  cwd?: string;
  /** Static env injected at spawn time (secrets resolved separately). */
  env?: Record<string, string>;
  /** Subscription-vs-api-key auth seam. Only `acp-*` consult this. */
  auth?: "subscription" | "api-key" | "none";
}

export interface RegisteredAgent {
  id: string;
  label: string;
  kind: AgentKind;
  /** Present for `acp-*` kinds. `api-key` kind sets this to `undefined`. */
  transport?: AgentTransport;
  /** Optional model id passed through to the agent (e.g. `claude-sonnet-4.5`). */
  model?: string;
}

/**
 * Static catalogue of agents shipped with Markspread. These are visible
 * in every workspace and cannot be deleted (the UI hides the X button).
 */
export const BUILTIN_AGENTS: readonly RegisteredAgent[] = Object.freeze([
  {
    id: "claude-subscription",
    label: "Claude (Sonnet) — Subscription",
    kind: "acp-builtin",
    transport: {
      command: "claude",
      args: ["--acp"],
      auth: "subscription",
    },
    model: "claude-sonnet-4.5",
  },
  {
    id: "claude-haiku",
    label: "Claude (Haiku) — Subscription",
    kind: "acp-builtin",
    transport: {
      command: "claude",
      args: ["--acp", "--model", "claude-haiku-4.5"],
      auth: "subscription",
    },
    model: "claude-haiku-4.5",
  },
  {
    id: "claude-api-key",
    label: "Claude (API key)",
    kind: "api-key",
    model: "claude-sonnet-4.5",
  },
]);
