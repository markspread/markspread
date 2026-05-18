// S-AI-029 / S-AI-030: action history backed by SQLite.
//
// Every completed AI run is persisted (input prompt, model, response,
// usage, timing) so the user can re-run a prior action against the current
// document — useful for "do that again with the new draft" workflows. We
// store via Tauri IPC so the data lives in the user's app-data dir, never
// over the network.

import { invoke } from "@tauri-apps/api/core";

export interface AiHistoryRecord {
  id: string;
  createdAt: number;
  actionId: string;
  /** Truncated label for the history list (full prompt lives in `prompt`). */
  label: string;
  prompt: string;
  /** Model identifier as reported by the provider (e.g. `claude-sonnet-4-6`). */
  model: string;
  response: string;
  inputTokens: number;
  outputTokens: number;
  usdCost: number;
  durationMs: number;
}

export async function recordHistory(record: AiHistoryRecord): Promise<void> {
  // The matching Rust command is registered in `ai_history.rs` (Phase 5
  // bootstrap). The frontend simply hands over the record; the Rust side
  // serialises into a row and respects the user's retention setting.
  await invoke("ai_history_record", { record });
}

export async function listHistory(limit = 100): Promise<AiHistoryRecord[]> {
  return invoke<AiHistoryRecord[]>("ai_history_list", { limit });
}

// S-AI-030: replay packages a previous prompt with the *current* document
// so the user sees fresh output instead of the cached response. The caller
// supplies the live document/selection, and we substitute the live values
// into the saved prompt scaffold.
export interface ReplayInputs {
  doc: string;
  selection: string | null;
}

export function replayPrompt(record: AiHistoryRecord, inputs: ReplayInputs): string {
  // The history record stores the user portion verbatim. For doc-scoped
  // actions we replace the body but keep the leading instruction so the
  // replay reproduces the intent.
  if (!inputs.selection) return record.prompt.replace(/---[\s\S]*---/, `---\n${inputs.doc}\n---`);
  return record.prompt.replace(/---[\s\S]*---/, `---\n${inputs.selection}\n---`);
}
