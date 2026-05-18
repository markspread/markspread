// S-AIK-003 / S-AIK-004 / S-AIK-018 / S-AIK-019: provider + model catalog.
//
// Markspread supports 8 first-class providers plus an "OpenAI-compatible"
// escape hatch for self-hosted endpoints (vLLM, LM Studio, OpenRouter,
// Together, etc.). Models are listed per provider with a recommended
// default; users can also add ad-hoc model identifiers when running
// against an OpenAI-compatible base URL (S-AIK-019).
//
// We keep this catalog frontend-resident so the Add Provider form can
// render synchronously — pulling it from the network would mean a
// blocking spinner on first open, and providers don't churn fast enough
// for that to be worthwhile. When new models ship, a release updates
// this list.

export type ProviderId =
  | "anthropic"
  | "openai"
  | "google"
  | "xai"
  | "deepseek"
  | "mistral"
  | "ollama"
  | "openai-compatible";

// S-AI-AUTH-002 (ADR-0004): a provider may accept zero or more auth modes.
// Default for every existing provider is API key. `anthropic` additionally
// accepts the Agent SDK subscription flow so users can authenticate with
// their Claude Pro/Max plan instead of issuing a console API key.
export type AuthMode = "api-key" | "subscription";

export interface ModelOption {
  id: string;
  label: string;
  /** Approximate context window in tokens — used by S-AI-035 truncation. */
  contextWindow: number;
  /** Recommended default for this provider — pre-selected in the dropdown. */
  recommended?: boolean;
}

export interface ProviderDefinition {
  id: ProviderId;
  label: string;
  /** Where to send requests by default. `null` for providers that require user input (Azure, OpenAI-compatible). */
  defaultBaseUrl: string | null;
  /** True if the base URL is user-editable (S-AIK-018). */
  baseUrlEditable: boolean;
  /** True if users can type custom model identifiers (S-AIK-019). */
  allowCustomModels: boolean;
  models: ModelOption[];
  /** Help link rendered next to the key field. */
  apiKeyHelp: string;
  /** S-AI-AUTH-002: auth modes this provider accepts (ADR-0004). */
  supportedAuthModes: readonly AuthMode[];
}

export const PROVIDERS: ProviderDefinition[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    defaultBaseUrl: "https://api.anthropic.com",
    baseUrlEditable: false,
    allowCustomModels: false,
    apiKeyHelp: "https://console.anthropic.com/settings/keys",
    // S-AI-AUTH-002: anthropic adds the Agent SDK subscription auth so users
    // can sign in with their Claude Pro/Max plan instead of an API key.
    supportedAuthModes: ["api-key", "subscription"],
    models: [
      {
        id: "claude-opus-4-7",
        label: "Claude Opus 4.7",
        contextWindow: 200_000,
        recommended: true,
      },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", contextWindow: 200_000 },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", contextWindow: 200_000 },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    baseUrlEditable: false,
    allowCustomModels: false,
    apiKeyHelp: "https://platform.openai.com/api-keys",
    supportedAuthModes: ["api-key"],
    models: [
      { id: "gpt-5", label: "GPT-5", contextWindow: 256_000, recommended: true },
      { id: "gpt-5-mini", label: "GPT-5 mini", contextWindow: 256_000 },
      { id: "gpt-4.1", label: "GPT-4.1", contextWindow: 128_000 },
    ],
  },
  {
    id: "google",
    label: "Google",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    baseUrlEditable: false,
    allowCustomModels: false,
    apiKeyHelp: "https://aistudio.google.com/apikey",
    supportedAuthModes: ["api-key"],
    models: [
      {
        id: "gemini-2.5-pro",
        label: "Gemini 2.5 Pro",
        contextWindow: 2_000_000,
        recommended: true,
      },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", contextWindow: 1_000_000 },
    ],
  },
  {
    id: "xai",
    label: "xAI",
    defaultBaseUrl: "https://api.x.ai/v1",
    baseUrlEditable: false,
    allowCustomModels: false,
    apiKeyHelp: "https://console.x.ai",
    supportedAuthModes: ["api-key"],
    models: [
      { id: "grok-4", label: "Grok 4", contextWindow: 256_000, recommended: true },
      { id: "grok-3-mini", label: "Grok 3 mini", contextWindow: 128_000 },
    ],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    baseUrlEditable: false,
    allowCustomModels: false,
    apiKeyHelp: "https://platform.deepseek.com/api_keys",
    supportedAuthModes: ["api-key"],
    models: [
      { id: "deepseek-chat", label: "DeepSeek Chat", contextWindow: 64_000, recommended: true },
      { id: "deepseek-reasoner", label: "DeepSeek Reasoner", contextWindow: 64_000 },
    ],
  },
  {
    id: "mistral",
    label: "Mistral",
    defaultBaseUrl: "https://api.mistral.ai/v1",
    baseUrlEditable: false,
    allowCustomModels: false,
    apiKeyHelp: "https://console.mistral.ai/api-keys",
    supportedAuthModes: ["api-key"],
    models: [
      {
        id: "mistral-large-latest",
        label: "Mistral Large",
        contextWindow: 128_000,
        recommended: true,
      },
      { id: "mistral-small-latest", label: "Mistral Small", contextWindow: 32_000 },
    ],
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    defaultBaseUrl: "http://127.0.0.1:11434",
    baseUrlEditable: true,
    allowCustomModels: true,
    apiKeyHelp: "https://ollama.com — local models, no API key required.",
    supportedAuthModes: ["api-key"],
    models: [
      { id: "llama3.3", label: "Llama 3.3", contextWindow: 128_000, recommended: true },
      { id: "qwen2.5-coder", label: "Qwen 2.5 Coder", contextWindow: 32_000 },
      { id: "mistral", label: "Mistral 7B", contextWindow: 32_000 },
    ],
  },
  {
    id: "openai-compatible",
    label: "OpenAI-compatible",
    defaultBaseUrl: null,
    baseUrlEditable: true,
    allowCustomModels: true,
    apiKeyHelp: "Used for vLLM, LM Studio, OpenRouter, Together AI, Azure OpenAI, etc.",
    supportedAuthModes: ["api-key"],
    models: [],
  },
];

export function getProvider(id: ProviderId): ProviderDefinition | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function defaultModel(p: ProviderDefinition): ModelOption | undefined {
  return p.models.find((m) => m.recommended) ?? p.models[0];
}

// S-AIK-002: alias validator. Allowed: lowercase letters, digits, hyphen.
// Length 2..40. The keychain item id is derived directly from the alias,
// so we keep the character set narrow to avoid escaping headaches across
// macOS Keychain / Linux Secret Service / Windows Credential Manager.
const ALIAS_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function validateAlias(alias: string): { ok: true } | { ok: false; reason: string } {
  if (alias.length < 2) return { ok: false, reason: "alias must be at least 2 characters" };
  if (alias.length > 40) return { ok: false, reason: "alias must be at most 40 characters" };
  if (!ALIAS_RE.test(alias)) {
    return {
      ok: false,
      reason: "alias may only contain a-z, 0-9, and hyphen (no leading/trailing hyphen)",
    };
  }
  return { ok: true };
}

// S-AIK-020: render a key for display, masking everything but the last 3
// characters. We never display the full key — the Keychain holds the
// canonical copy, and the user has the original at the source.
export function maskKeyForDisplay(key: string): string {
  if (key.length <= 6) return "••••••";
  const tail = key.slice(-3);
  return `${key.slice(0, Math.min(3, key.length - 3))}…••••${tail}`;
}
