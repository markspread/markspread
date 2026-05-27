// MAR-1010: header-mounted agent dropdown.
//
// The select groups registered agents by `kind` so users instantly see
// which agents speak ACP vs the legacy api-key path. Picking an entry
// sets the per-workspace default; the chat-shell can additionally set a
// per-session override through the store API directly.

import { useMemo, useState } from "react";
import type { AgentKind, RegisteredAgent } from "../lib/agents/types";
import { useAgentRegistry } from "../store/agent-registry";

export interface AgentPickerProps {
  workspaceId: string;
  sessionId?: string | null;
}

const KIND_LABEL: Record<AgentKind, string> = {
  "acp-builtin": "Subscription",
  "acp-external": "External ACP",
  "api-key": "API key",
};

function groupByKind(
  agents: RegisteredAgent[],
): Array<{ kind: AgentKind; entries: RegisteredAgent[] }> {
  const buckets = new Map<AgentKind, RegisteredAgent[]>();
  for (const a of agents) {
    const arr = buckets.get(a.kind) ?? [];
    arr.push(a);
    buckets.set(a.kind, arr);
  }
  return Array.from(buckets.entries()).map(([kind, entries]) => ({ kind, entries }));
}

export function AgentPicker({ workspaceId, sessionId }: AgentPickerProps) {
  const byId = useAgentRegistry((s) => s.byId);
  const order = useAgentRegistry((s) => s.order);
  const setWorkspaceDefault = useAgentRegistry((s) => s.setWorkspaceDefault);
  const setSessionOverride = useAgentRegistry((s) => s.setSessionOverride);
  const registerCustom = useAgentRegistry((s) => s.registerCustom);
  const resolved = useAgentRegistry((s) => s.resolve(workspaceId, sessionId ?? null));

  const [showCustom, setShowCustom] = useState(false);
  const [draftId, setDraftId] = useState("");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftCmd, setDraftCmd] = useState("");

  const groups = useMemo(() => {
    const agents = order.map((id) => byId[id]).filter((a): a is RegisteredAgent => Boolean(a));
    return groupByKind(agents);
  }, [byId, order]);

  const onSelect = (id: string) => {
    setWorkspaceDefault(workspaceId, id);
    if (sessionId) setSessionOverride(sessionId, id);
  };

  const submitCustom = async () => {
    if (!draftId.trim() || !draftCmd.trim()) return;
    const trimmed = draftCmd.trim();
    const argv = trimmed.split(/\s+/);
    // split on a non-empty trimmed string always returns at least one
    // element; fall through to the trimmed text if that invariant is
    // ever broken upstream.
    const command = argv[0] /* v8 ignore next */ ?? trimmed;
    await registerCustom({
      id: draftId.trim(),
      label: draftLabel.trim() || draftId.trim(),
      kind: "acp-external",
      transport: { command, args: argv.slice(1) },
    });
    setShowCustom(false);
    setDraftId("");
    setDraftLabel("");
    setDraftCmd("");
  };

  return (
    <div className="flex items-center gap-2" data-testid="agent-picker">
      <label className="text-[var(--color-muted)] text-xs" htmlFor="agent-picker-select">
        Agent
      </label>
      <select
        id="agent-picker-select"
        data-testid="agent-picker-select"
        value={resolved?.id ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs"
      >
        {groups.map((g) => (
          <optgroup key={g.kind} label={KIND_LABEL[g.kind]}>
            {g.entries.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <button
        type="button"
        data-testid="agent-picker-add"
        onClick={() => setShowCustom((v) => !v)}
        className="text-[var(--color-muted)] text-xs hover:text-[var(--color-fg)]"
      >
        {showCustom ? "Cancel" : "+ Add"}
      </button>
      {showCustom && (
        <div
          data-testid="agent-picker-custom-form"
          className="flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1"
        >
          <input
            data-testid="agent-picker-custom-id"
            placeholder="id"
            value={draftId}
            onChange={(e) => setDraftId(e.target.value)}
            className="w-20 bg-transparent text-xs focus:outline-none"
          />
          <input
            data-testid="agent-picker-custom-label"
            placeholder="label"
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            className="w-24 bg-transparent text-xs focus:outline-none"
          />
          <input
            data-testid="agent-picker-custom-cmd"
            placeholder="command --acp"
            value={draftCmd}
            onChange={(e) => setDraftCmd(e.target.value)}
            className="w-40 bg-transparent text-xs focus:outline-none"
          />
          <button
            type="button"
            data-testid="agent-picker-custom-save"
            onClick={submitCustom}
            className="rounded bg-[var(--color-accent)] px-2 py-0.5 text-white text-xs"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}
