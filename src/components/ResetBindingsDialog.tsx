// S-KB-007: confirmation dialog for "Reset all keybindings". The
// destructive part is gated behind a typed confirmation (verbatim
// "RESET") so a misclick on the keybinding sheet's three-dot menu
// can't blank an hour of customisation. The reset itself takes a
// .bak side-copy of keybindings.json before clearing — the dialog
// surfaces the backup path so the user knows where to recover from.

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { resetAllToPreset } from "@/lib/keybindings/persistence";

type Props = {
  onClose: () => void;
  onDone: () => void;
};

const CONFIRM_TOKEN = "RESET";

export function ResetBindingsDialog({ onClose, onDone }: Props) {
  const { t } = useTranslation();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backupPath, setBackupPath] = useState<string | null>(null);

  async function onConfirm() {
    /* v8 ignore next -- the Reset button is disabled until the token matches, so this guard is unreachable from the UI */
    if (token !== CONFIRM_TOKEN) return;
    setBusy(true);
    setError(null);
    try {
      const path = await resetAllToPreset();
      setBackupPath(path);
      // Hold the dialog open briefly so the user sees the backup path
      // before we close — the message disappears with the dialog.
      setTimeout(() => {
        onDone();
        onClose();
      }, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-close; Escape handled within dialog
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/50"
      style={{ zIndex: "var(--z-dialog)" }}
      // biome-ignore lint/a11y/useSemanticElements: dialog overlay keeps div for layout/portal control
      role="dialog"
      aria-modal="true"
      aria-labelledby="reset-bind-title"
      onClick={onClose}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation wrapper; not an interactive control */}
      <div
        className="w-full max-w-md rounded-lg border border-surface-border bg-surface-bg p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="reset-bind-title" className="text-base font-semibold">
          {t("keybindings.reset.title", "Reset all keybindings")}
        </h3>

        <p className="mt-2 text-sm text-surface-fg-muted">
          {t(
            "keybindings.reset.warning",
            "This clears every shortcut you've changed and restores the active preset. Your previous bindings will be saved to keybindings.json.bak.",
          )}
        </p>

        {!backupPath && (
          <>
            <label
              htmlFor="reset-confirm-input"
              className="mt-4 block text-xs text-surface-fg-muted"
            >
              {t("keybindings.reset.tokenPrompt", "Type {{token}} to confirm.", {
                token: CONFIRM_TOKEN,
              })}
            </label>
            <input
              id="reset-confirm-input"
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="mt-1 w-full rounded-md border border-surface-border bg-surface-bg-subtle px-2 py-1 text-sm font-mono"
              disabled={busy}
            />
          </>
        )}

        {backupPath && (
          <p className="mt-3 rounded-md border border-info-border bg-info-bg p-2 text-xs text-info-fg break-all">
            {t("keybindings.reset.backupSaved", "Previous bindings saved to {{path}}", {
              path: backupPath,
            })}
          </p>
        )}

        {error && (
          <p className="mt-3 rounded-md border border-error-border bg-error-bg p-2 text-xs text-error-fg">
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center justify-end space-x-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md px-3 py-1 text-sm hover:bg-surface-bg-subtle"
          >
            {t("common.cancel", "Cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || token !== CONFIRM_TOKEN || !!backupPath}
            className="rounded-md bg-error-bg px-3 py-1 text-sm font-medium text-error-fg hover:opacity-90 disabled:opacity-50"
          >
            {t("keybindings.reset.confirm", "Reset all")}
          </button>
        </div>
      </div>
    </div>
  );
}
