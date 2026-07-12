// S-AI-AUTH-001..004 host surface: provider key management +
// subscription sign-in entry. Lives inside SettingsSheet. Key storage
// goes through `ai_key_*` Rust handlers so plaintext never touches IPC
// payloads beyond the single `ai_key_save` call; this panel otherwise
// only exchanges aliases + provider ids + masked status strings.
//
// SC-LLM-03: the Add Key form is driven by the PROVIDERS registry
// (lib/ai/providers.ts) — all 8 providers are selectable, the model
// defaults per provider, and base-URL-requiring providers (Ollama,
// OpenAI-compatible) expose a base URL field that is persisted.
// SC-LLM-06: the Test button runs `testConnection` (ai_key_test on the
// Rust side) and surfaces ok / auth / network / other outcomes.

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type TestOutcome, describeTestOutcome, testConnection } from "../lib/ai/key-test";
import { PROVIDERS, type ProviderId, defaultModel, getProvider } from "../lib/ai/providers";
import { SubscriptionAuthModal } from "./SubscriptionAuthModal";

interface AiKeyEntry {
  alias: string;
  provider: ProviderId;
  model: string;
  baseUrl: string | null;
  maskedKey: string;
  createdAt: number;
}

interface AiKeyList {
  entries: AiKeyEntry[];
  defaultAlias: string | null;
}

const TEST_OUTCOME_FALLBACK: Record<TestOutcome["kind"], string> = {
  ok: "Connection OK",
  auth: "Authentication failed",
  network: "Network error",
  other: "Error",
};

function firstProvider(): ProviderId {
  return PROVIDERS[0]?.id ?? "anthropic";
}

export function SettingsAi() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<AiKeyEntry[]>([]);
  const [defaultAlias, setDefaultAlias] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProviderId>(firstProvider());
  const [alias, setAlias] = useState("default");
  const [secret, setSecret] = useState("");
  const [model, setModel] = useState(() => {
    const def = getProvider(firstProvider());
    return def ? (defaultModel(def)?.id ?? "") : "";
  });
  const [baseUrl, setBaseUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestOutcome | null>(null);
  const [subscribeOpen, setSubscribeOpen] = useState(false);

  const def = getProvider(provider) ?? PROVIDERS[0];
  /* v8 ignore next -- PROVIDERS is a non-empty compile-time catalog, so a missing definition is unreachable */
  if (!def) throw new Error("provider catalog is empty");
  // Ollama is local and key-less (see providers.ts apiKeyHelp); the
  // runner sends a placeholder Bearer token that local servers ignore.
  const keyRequired = def.id !== "ollama";
  const requiresBaseUrl = def.defaultBaseUrl === null;
  const showBaseUrl = def.baseUrlEditable || requiresBaseUrl;

  const refresh = async () => {
    try {
      const list = await invoke<AiKeyList>("ai_key_list");
      setRows(list.entries);
      setDefaultAlias(list.defaultAlias);
    } catch (e) {
      setError(String((e as { message?: string })?.message ?? e));
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot mount-time fetch; refresh is a stable closure over store setters and we don't want it to re-run on every render.
  useEffect(() => {
    void refresh();
  }, []);

  const onProviderChange = (next: ProviderId) => {
    setProvider(next);
    const d = getProvider(next);
    setModel(d ? (defaultModel(d)?.id ?? "") : "");
    setBaseUrl("");
    setTestResult(null);
    setError(null);
  };

  /** Shared pre-flight for Save and Test. Returns null when a field is missing. */
  const validateForm = (): { model: string; baseUrl: string | null } | null => {
    const trimmedBaseUrl = baseUrl.trim();
    if (requiresBaseUrl && !trimmedBaseUrl) {
      setError(t("settings.ai.base_url_required", "Base URL is required for this provider."));
      return null;
    }
    const trimmedModel = model.trim();
    if (!trimmedModel) {
      setError(t("settings.ai.model_required", "Model is required."));
      return null;
    }
    return { model: trimmedModel, baseUrl: trimmedBaseUrl || null };
  };

  const save = async () => {
    /* v8 ignore next -- the Save button is disabled while the key is missing, so save() can't be invoked without a required secret through the UI */
    if (keyRequired && !secret) return;
    setError(null);
    const form = validateForm();
    if (!form) return;
    setBusy(true);
    try {
      await invoke("ai_key_save", {
        alias,
        provider,
        model: form.model,
        baseUrl: form.baseUrl,
        key: secret || "ollama",
      });
      setSecret("");
      setTestResult(null);
      await refresh();
    } catch (e) {
      setError(String((e as { message?: string })?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    setError(null);
    setTestResult(null);
    const form = validateForm();
    if (!form) return;
    setTesting(true);
    const outcome = await testConnection({
      provider,
      model: form.model,
      baseUrl: form.baseUrl,
      key: secret || "ollama",
    });
    setTestResult(outcome);
    setTesting(false);
  };

  const remove = async (row: AiKeyEntry) => {
    setBusy(true);
    setError(null);
    try {
      await invoke("ai_key_remove", { alias: row.alias });
      await refresh();
    } catch (e) {
      setError(String((e as { message?: string })?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const setDefault = async (row: AiKeyEntry) => {
    setBusy(true);
    setError(null);
    try {
      await invoke("ai_key_set_default", { alias: row.alias });
      await refresh();
    } catch (e) {
      setError(String((e as { message?: string })?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const described = testResult ? describeTestOutcome(testResult) : null;

  return (
    <section
      aria-label={t("settings.ai.title", "AI")}
      className="flex flex-col gap-3 border-[var(--color-border)] border-b p-4 text-sm"
    >
      <h2 className="font-semibold text-base">{t("settings.ai.title", "AI")}</h2>
      <div className="flex flex-col gap-2 rounded border border-[var(--color-border)] p-3">
        <p className="text-xs">
          {t(
            "settings.ai.subscription_help",
            "Use your Claude Pro / Max subscription instead of an API key.",
          )}
        </p>
        <button
          type="button"
          onClick={() => setSubscribeOpen(true)}
          className="self-start rounded bg-[var(--color-accent)] px-3 py-1 text-white text-xs"
        >
          {t("settings.ai.subscribe", "Subscribe with Claude")}
        </button>
      </div>
      <SubscriptionAuthModal
        open={subscribeOpen}
        onClose={() => setSubscribeOpen(false)}
        onSuccess={() => {
          setSubscribeOpen(false);
          void refresh();
        }}
      />
      {error && (
        <p role="alert" className="text-red-500 text-xs">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-2 rounded border border-[var(--color-border)] p-3">
        <label className="flex items-center gap-2 text-xs">
          <span className="w-20 text-[var(--color-muted)]">
            {t("settings.ai.provider", "Provider")}
          </span>
          <select
            className="flex-1 rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs"
            value={provider}
            onChange={(e) => onProviderChange(e.target.value as ProviderId)}
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {t(`ai.provider.${p.id}`, p.label)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs">
          <span className="w-20 text-[var(--color-muted)]">{t("settings.ai.alias", "Alias")}</span>
          <input
            type="text"
            className="flex-1 rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-xs" htmlFor="settings-ai-model">
          <span className="w-20 text-[var(--color-muted)]">{t("settings.ai.model", "Model")}</span>
          {def.allowCustomModels ? (
            <input
              id="settings-ai-model"
              type="text"
              data-testid="ai-model-input"
              placeholder={t("settings.ai.model_placeholder", "model id")}
              className="flex-1 rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          ) : (
            <select
              id="settings-ai-model"
              data-testid="ai-model-select"
              className="flex-1 rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              {def.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          )}
        </label>
        {showBaseUrl && (
          <label className="flex items-center gap-2 text-xs">
            <span className="w-20 text-[var(--color-muted)]">
              {t("settings.ai.base_url", "Base URL")}
            </span>
            <input
              type="text"
              data-testid="ai-baseurl-input"
              placeholder={def.defaultBaseUrl ?? "https://…"}
              className="flex-1 rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </label>
        )}
        <label className="flex items-center gap-2 text-xs">
          <span className="w-20 text-[var(--color-muted)]">{t("settings.ai.key", "API Key")}</span>
          <input
            type="password"
            className="flex-1 rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoComplete="off"
          />
        </label>
        <div className="flex items-center justify-end gap-2">
          {described && testResult && (
            <output
              data-testid="ai-key-test-result"
              className={`text-xs ${testResult.kind === "ok" ? "text-green-600" : "text-red-500"}`}
            >
              {t(described.i18nKey, TEST_OUTCOME_FALLBACK[testResult.kind])} · {described.detail}
            </output>
          )}
          <button
            type="button"
            data-testid="ai-key-test-button"
            disabled={(keyRequired && !secret) || busy || testing}
            onClick={() => void runTest()}
            className="rounded border border-[var(--color-border)] px-3 py-1 text-xs disabled:opacity-50"
          >
            {testing ? t("settings.ai.testing", "Testing…") : t("settings.ai.test", "Test")}
          </button>
          <button
            type="button"
            disabled={(keyRequired && !secret) || busy}
            onClick={() => void save()}
            className="rounded bg-[var(--color-accent)] px-3 py-1 text-white text-xs disabled:opacity-50"
          >
            {t("settings.ai.save", "Save key")}
          </button>
        </div>
      </div>
      <ul className="flex flex-col gap-1">
        {rows.length === 0 && (
          <li className="text-[var(--color-muted)] text-xs">
            {t("settings.ai.empty", "No keys saved yet.")}
          </li>
        )}
        {rows.map((row) => {
          const isDefault = row.alias === defaultAlias;
          return (
            <li
              key={row.alias}
              className="flex items-center justify-between rounded border border-[var(--color-border)] px-3 py-1.5 text-xs"
            >
              <span>
                <strong>{row.provider}</strong> · {row.alias} · {row.maskedKey}
                {isDefault ? " · default" : ""}
              </span>
              <span className="flex gap-2">
                {!isDefault && (
                  <button
                    type="button"
                    className="text-[var(--color-muted)] hover:text-[var(--color-fg)]"
                    onClick={() => void setDefault(row)}
                  >
                    {t("settings.ai.make_default", "Make default")}
                  </button>
                )}
                <button
                  type="button"
                  className="text-red-500 hover:underline"
                  onClick={() => void remove(row)}
                >
                  {t("settings.ai.remove", "Remove")}
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
