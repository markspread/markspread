// S-AI-AUTH-001..004 host surface: provider key management +
// subscription sign-in entry. Lives inside SettingsSheet. Key storage
// goes through `ai_key_*` Rust handlers so plaintext never touches IPC
// payloads beyond the single `ai_key_save` call; this panel otherwise
// only exchanges aliases + provider ids + masked status strings.

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProviderId } from "../lib/ai/providers";
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

const DEFAULT_MODEL: Record<string, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o",
  ollama: "llama3",
};

export function SettingsAi() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<AiKeyEntry[]>([]);
  const [defaultAlias, setDefaultAlias] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProviderId>("anthropic");
  const [alias, setAlias] = useState("default");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [subscribeOpen, setSubscribeOpen] = useState(false);

  const refresh = async () => {
    try {
      const list = await invoke<AiKeyList>("ai_key_list");
      setRows(list.entries);
      setDefaultAlias(list.defaultAlias);
    } catch (e) {
      setError(String((e as { message?: string })?.message ?? e));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const save = async () => {
    if (!secret) return;
    setBusy(true);
    setError(null);
    try {
      await invoke("ai_key_save", {
        alias,
        provider,
        model: DEFAULT_MODEL[provider] ?? "",
        baseUrl: null,
        key: secret,
      });
      setSecret("");
      await refresh();
    } catch (e) {
      setError(String((e as { message?: string })?.message ?? e));
    } finally {
      setBusy(false);
    }
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
            onChange={(e) => setProvider(e.target.value as ProviderId)}
          >
            <option value="anthropic">{t("ai.provider.anthropic", "Anthropic")}</option>
            <option value="openai">{t("ai.provider.openai", "OpenAI")}</option>
            <option value="ollama">{t("ai.provider.ollama", "Ollama (local)")}</option>
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
        <div className="flex justify-end">
          <button
            type="button"
            disabled={!secret || busy}
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
