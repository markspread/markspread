// S-AIO-001..013: Ollama integration.
//
// Ollama is a local-only provider — the binary listens on
// http://127.0.0.1:11434 by default and exposes an OpenAI-compatible
// completion endpoint plus its own native API. We treat it as a
// first-class provider with a few special behaviours:
//
//   - no API key: the Add Provider form skips the key field entirely
//   - auto-discovery: probe the default port on app start to pre-fill
//     baseURL and offer one-click setup when the user opens Settings
//   - model catalog from /api/tags rather than a hand-curated list
//   - OOM error parsing → recommend a smaller variant (Q4_K_M, etc.)
//   - offline indicator + guard so non-Ollama aliases don't fire when
//     the user is offline (S-AIO-009)
//
// All HTTP happens via the Rust side (consistent abort handling,
// no CORS surprises) so this module is mostly types + UI helpers.

import { invoke } from "@tauri-apps/api/core";

export const OLLAMA_DEFAULT_BASE_URL = "http://127.0.0.1:11434";

export interface OllamaProbe {
  /** True when /api/tags returned 2xx within the timeout. */
  reachable: boolean;
  baseUrl: string;
  /** Process version (`0.5.7`, etc.) — null when not exposed by older builds. */
  version: string | null;
  /** Latency to first byte for the probe request, useful for the diag panel. */
  latencyMs: number;
}

export async function probeOllama(baseUrl = OLLAMA_DEFAULT_BASE_URL): Promise<OllamaProbe> {
  return invoke<OllamaProbe>("ai_ollama_probe", { baseUrl });
}

export interface OllamaInstalledModel {
  name: string;        // "llama3.3:latest"
  size: number;        // bytes
  modifiedAt: number;  // epoch ms
  parameterCount: string | null; // "70B" — derived from manifest if available
  quantisation: string | null;   // "Q4_K_M"
}

export async function listInstalledModels(baseUrl = OLLAMA_DEFAULT_BASE_URL): Promise<OllamaInstalledModel[]> {
  return invoke<OllamaInstalledModel[]>("ai_ollama_models", { baseUrl });
}

// S-AIO-003: alias suggestion. Drop the tag, replace `:` with `-`, prefix
// with `local-` if the bare name would collide with a remote provider's
// alias namespace. Existing aliases are passed in to avoid collision.
export function suggestAlias(modelName: string, existing: Set<string>): string {
  const base = modelName.replace(/[:/]/g, "-").toLowerCase();
  let candidate = `local-${base}`;
  if (!existing.has(candidate)) return candidate;
  for (let i = 2; i < 100; i += 1) {
    const next = `${candidate}-${i}`;
    if (!existing.has(next)) return next;
  }
  return `${candidate}-${Date.now()}`;
}

// S-AIO-006: structured "Ollama not running" hint with a deep link to the
// install page. The shell open is delegated to Tauri's opener plugin at
// the call site.
export interface OllamaNotRunningHint {
  i18nKey: string;
  installUrl: string;
}

export const OLLAMA_NOT_RUNNING: OllamaNotRunningHint = {
  i18nKey: "ai.ollama.not-running",
  installUrl: "https://ollama.com/download",
};

// S-AIO-007: parse "model not found" and prompt a `ollama pull` command.
// The Rust runner returns a structured error code we can switch on.
export interface OllamaPullHint {
  modelName: string;
  command: string;
}

export function pullHint(modelName: string): OllamaPullHint {
  // Display the literal command so the user can copy and run it. We
  // deliberately don't auto-shell-out from the app — model downloads can
  // be tens of GB and need user awareness.
  return { modelName, command: `ollama pull ${modelName}` };
}

// S-AIO-008: offline indicator. We compute "offline" as "the OS reports
// no connectivity AND no Ollama instance is reachable." If Ollama is up
// we keep the badge subtle (just a pill on the status bar) since local
// AI is fully usable.
export interface ConnectivityState {
  online: boolean;
  ollamaReachable: boolean;
}

export function describeConnectivity(state: ConnectivityState): "online" | "local-only" | "offline" {
  if (state.online) return "online";
  if (state.ollamaReachable) return "local-only";
  return "offline";
}

// S-AIO-009: when offline (or local-only), block calls to non-Ollama
// aliases at the dispatcher layer. The dispatcher imports this and raises
// a typed error that the UI translates into "switch to a local model"
// inline action.
export class NotAvailableOfflineError extends Error {
  readonly alias: string;
  constructor(alias: string) {
    super(`alias "${alias}" requires network access`);
    this.alias = alias;
    this.name = "NotAvailableOfflineError";
  }
}

export function shouldBlockOffline(connectivity: ConnectivityState, providerForAlias: string | null): boolean {
  if (connectivity.online) return false;
  return providerForAlias !== "ollama";
}

// S-AIO-010: parse OOM responses from /api/generate. Ollama returns a
// 500 with body containing "out of memory" or "ggml_cuda_compute_forward".
// We map that to a recommendation: smaller quant or smaller variant.
export interface OomRecommendation {
  recommendedQuant: "Q4_K_M" | "Q3_K_M" | "Q2_K";
  fallbackVariant: string | null;
}

const VARIANT_LADDER: Record<string, string> = {
  "70b": "13b",
  "13b": "8b",
  "8b": "3b",
  "3b": "1b",
};

export function recommendOnOom(currentModel: string): OomRecommendation {
  const sizeMatch = /(\d+)b/i.exec(currentModel);
  const fallback = sizeMatch ? VARIANT_LADDER[(sizeMatch[1] ?? "").toLowerCase() + "b"] ?? null : null;
  const fallbackVariant = fallback ? currentModel.replace(/\d+b/i, fallback) : null;
  // Q4 is the default; if the user's already on Q4, drop to Q3 then Q2.
  const quantMatch = /Q[2-8]_[KS][_M]?/i.exec(currentModel);
  let recommendedQuant: OomRecommendation["recommendedQuant"] = "Q4_K_M";
  if (/Q4/i.test(quantMatch?.[0] ?? "")) recommendedQuant = "Q3_K_M";
  else if (/Q3/i.test(quantMatch?.[0] ?? "")) recommendedQuant = "Q2_K";
  return { recommendedQuant, fallbackVariant };
}

// S-AIO-011: trim oversized contexts before they reach Ollama. Local
// models routinely OOM on 200K-token prompts even when the model claims
// to support them. We cap to a conservative budget driven by total
// system RAM (queried once at startup) and let S-AI-035's truncation
// kick in.
export function effectiveContextWindow(declared: number, ramGB: number): number {
  // Roughly 4 GB of RAM headroom needed per 32K of llama.cpp KV cache at
  // F16. The Ollama server can swap, but cache thrashing kills latency.
  const headroomTokens = Math.max(8_000, Math.floor((ramGB - 4) * 8_000));
  return Math.min(declared, headroomTokens);
}

// S-AIO-012: validate user-supplied baseURL for the corporate gateway
// scenario. We accept http(s) URLs only, normalise the trailing slash,
// and strip auth fragments (rare but it's a foot-gun).
export function normaliseOllamaBaseUrl(input: string): { ok: true; url: string } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "must be http(s)" };
  }
  parsed.username = "";
  parsed.password = "";
  parsed.hash = "";
  parsed.search = "";
  let url = parsed.toString();
  if (url.endsWith("/")) url = url.slice(0, -1);
  return { ok: true, url };
}

// S-AIO-013: bundling Ollama as a sidecar is a Phase-2 ambition. The
// stub here records the user's preference (auto-start vs detect-only) so
// the flag is honoured the moment the bundling lands. Today it returns
// `false` for any platform — manual install is the only supported path.
export interface SidecarPreference {
  autoStart: boolean;
}

export function sidecarSupported(): boolean {
  return false;
}
