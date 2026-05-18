// S-OP-001: confirmation modal for "Erase all data". The destructive
// path requires the user to type the literal phrase
// `MARKSPREAD ERASE` — copy-paste works, but the inertia of typing
// 16 characters is the design point. After success the editor is
// effectively unconfigured: it will return to the first-launch
// onboarding on next start.

import { useId, useState } from "react";

import {
  ERASE_CONFIRMATION_TOKEN,
  type EraseReport,
  eraseAllData,
} from "@/lib/ops/erase";

type Props = {
  onClose: () => void;
  onComplete: (report: EraseReport) => void;
};

export function EraseAllDialog({ onClose, onComplete }: Props) {
  const inputId = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const armed = text === ERASE_CONFIRMATION_TOKEN && !busy;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!armed) return;
    setBusy(true);
    setError(null);
    try {
      const report = await eraseAllData(text);
      onComplete(report);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="erase-title"
      className="fixed inset-0 z-50 grid place-items-center bg-black/50"
    >
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-lg bg-[var(--ms-bg-elevated)] p-6 shadow-lg"
      >
        <h2 id="erase-title" className="text-lg font-semibold text-[var(--ms-text-danger)]">
          Erase all Markspread data
        </h2>
        <p className="mt-2 text-sm text-[var(--ms-text-muted)]">
          This removes the app data directory, all keychain entries (AI
          provider keys, marketplace signing key, telemetry id), and
          every cached index. Your workspace files on disk are
          untouched.
        </p>
        <p className="mt-3 text-sm">
          Type{" "}
          <code className="rounded bg-[var(--ms-bg-sunken)] px-1 py-0.5 font-mono">
            {ERASE_CONFIRMATION_TOKEN}
          </code>{" "}
          to confirm.
        </p>
        <label htmlFor={inputId} className="sr-only">
          Confirmation phrase
        </label>
        <input
          id={inputId}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="mt-2 w-full rounded border border-[var(--ms-border)] bg-[var(--ms-bg)] px-3 py-2 font-mono text-sm"
          placeholder={ERASE_CONFIRMATION_TOKEN}
        />
        {error && (
          <p role="alert" className="mt-2 text-sm text-[var(--ms-text-danger)]">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-[var(--ms-border)] px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!armed}
            aria-disabled={!armed}
            className="rounded-md bg-[var(--ms-bg-danger)] px-3 py-1.5 text-sm font-medium text-[var(--ms-text-on-danger)] disabled:opacity-50"
          >
            {busy ? "Erasing…" : "Erase everything"}
          </button>
        </div>
      </form>
    </div>
  );
}
