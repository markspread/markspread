// S-AIK-006 / S-AIK-007 / S-AIK-008: "Test connection" before save.
//
// The Add Provider form ends with a Test button. We send the smallest
// possible request the provider accepts (a 1-token completion or a
// `/v1/models` GET, whichever the provider supports cheaper) so the user
// pays effectively nothing and gets a fast yes/no. The result is folded
// into one of three classifications:
//
//   - ok                        — provider accepted the key, returned 2xx
//   - auth                      — 401/403 (S-AIK-007)
//   - network                   — DNS/timeout/connection refused (S-AIK-008)
//   - other                     — surprise non-2xx (5xx, 429, schema)
//
// We never store the result of the test in the entry — provider keys can
// be revoked at any time and the cache would lie. The test is a one-shot
// pre-save check.

import { invoke } from "@tauri-apps/api/core";
import type { ProviderId } from "./providers";

export type TestOutcome =
  | { kind: "ok"; latencyMs: number; modelId?: string }
  | { kind: "auth"; status: number; message: string }
  | { kind: "network"; message: string }
  | { kind: "other"; status: number; message: string };

export interface TestRequest {
  provider: ProviderId;
  model: string;
  baseUrl: string | null;
  /** Plaintext key for the test. Lives only on the call stack. */
  key: string;
}

export async function testConnection(req: TestRequest, signal?: AbortSignal): Promise<TestOutcome> {
  const startedAt = performance.now();
  try {
    // The Rust side performs the actual request — keeps the key off the
    // renderer's network stack and lets us reuse provider-specific
    // request shaping. Cancelled by ESC via the abort signal hook.
    const raw = await invoke<{
      status: number;
      ok: boolean;
      modelId?: string;
      message: string;
    }>("ai_key_test", {
      provider: req.provider,
      model: req.model,
      baseUrl: req.baseUrl,
      key: req.key,
      // S-AI-027 abort signal isn't transferable across IPC; we register
      // an Abort cookie the Rust side polls.
      abortCookie: signal ? Math.random().toString(36).slice(2) : null,
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    if (raw.ok) return { kind: "ok", latencyMs, ...(raw.modelId !== undefined && { modelId: raw.modelId }) };
    if (raw.status === 401 || raw.status === 403) {
      return { kind: "auth", status: raw.status, message: raw.message || "Unauthorized" };
    }
    return { kind: "other", status: raw.status, message: raw.message || `HTTP ${raw.status}` };
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    // The Rust runner classifies network failures with a `network:` prefix
    // so we don't confuse "endpoint unreachable" (S-AIK-008) with "auth
    // failed" (S-AIK-007).
    if (message.startsWith("network:")) {
      return { kind: "network", message: message.slice("network:".length).trim() };
    }
    return { kind: "other", status: 0, message };
  }
}

// Human-readable summary for the test result chip. Localisation happens at
// the call site via the i18n key returned alongside.
export function describeTestOutcome(outcome: TestOutcome): { i18nKey: string; detail: string } {
  switch (outcome.kind) {
    case "ok":
      return { i18nKey: "ai.test.ok", detail: `${outcome.latencyMs} ms` };
    case "auth":
      return { i18nKey: "ai.test.auth", detail: `HTTP ${outcome.status}` };
    case "network":
      return { i18nKey: "ai.test.network", detail: outcome.message };
    case "other":
      return { i18nKey: "ai.test.other", detail: outcome.message };
  }
}
