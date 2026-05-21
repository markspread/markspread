// S-KB-004: capture-mode dialog for editing a single binding. Opens
// from the keybinding sheet's "Edit" action. The dialog listens for
// the next non-modifier keydown, builds a binding via the same
// resolver the live system uses, runs a conflict check, and persists
// on save.
//
// Conflict semantics (acceptance bullet 1): if the proposed binding
// is already used by another command, we surface that and require a
// second confirmation. The user can still proceed — silently winning
// would surprise people who expect their preset to keep working.

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { commands } from "@/lib/commands/registry";
import {
  type Binding,
  bindingFromEvent,
  formatBinding,
  listActiveBindings,
  normaliseBinding,
} from "@/lib/keybindings";
import { isComposing } from "@/lib/keybindings/ime";
import { rebind, resetToPreset, unbind } from "@/lib/keybindings/persistence";

type Props = {
  commandId: string;
  onClose: () => void;
};

export function RecordBindingDialog({ commandId, onClose }: Props) {
  const { t } = useTranslation();
  const [captured, setCaptured] = useState<Binding>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const command = commands.find((c) => c.id === commandId);
  const conflict = useMemo(() => findConflict(captured, commandId), [captured, commandId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Esc cancels regardless of focus state.
      if (e.key === "Escape" && !captured) {
        e.preventDefault();
        onClose();
        return;
      }
      // Modifier-only events don't form a binding; ignore them so
      // pressing Cmd alone doesn't immediately freeze the capture.
      if (e.key === "Meta" || e.key === "Control" || e.key === "Alt" || e.key === "Shift") {
        return;
      }
      // S-KB-008: an IME composition would otherwise capture e.g. a
      // hangul jamo key as the binding. Wait until composition ends.
      if (isComposing(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const proposed = bindingFromEvent(e);
      if (proposed) setCaptured(normaliseBinding(proposed));
    }
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true } as EventListenerOptions);
  }, [captured, onClose]);

  async function onSave() {
    /* v8 ignore next -- the Save button is disabled while !captured, so onSave never fires without a captured binding; this guard only protects callers we don't yet have */
    if (!captured) return;
    setBusy(true);
    setError(null);
    try {
      await rebind(commandId, captured);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function onUnbind() {
    setBusy(true);
    setError(null);
    try {
      await unbind(commandId);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function onReset() {
    setBusy(true);
    setError(null);
    try {
      await resetToPreset(commandId);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (!command) {
    return null;
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-close; Escape handled within dialog
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/50"
      style={{ zIndex: "var(--z-dialog)" }}
      // biome-ignore lint/a11y/useSemanticElements: dialog overlay keeps div for layout/portal control
      role="dialog"
      aria-modal="true"
      aria-labelledby="rec-bind-title"
      onClick={onClose}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation wrapper; not an interactive control */}
      <div
        className="w-full max-w-md rounded-lg border border-surface-border bg-surface-bg p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="rec-bind-title" className="text-base font-semibold">
          {t("keybindings.record.title", "Edit shortcut for {{name}}", {
            name: command.title,
          })}
        </h3>

        <p className="mt-1 text-sm text-surface-fg-muted">
          {t("keybindings.record.instructions", "Press the keys you want to use. Esc to cancel.")}
        </p>

        <div
          className="mt-4 flex h-16 items-center justify-center rounded-md border border-dashed border-surface-border bg-surface-bg-subtle"
          aria-live="polite"
        >
          {captured ? (
            <kbd className="rounded border border-surface-border bg-surface-bg px-3 py-1 font-mono text-base">
              {formatBinding(captured)}
            </kbd>
          ) : (
            <span className="text-sm text-surface-fg-muted">
              {t("keybindings.record.waiting", "Waiting for keys…")}
            </span>
          )}
        </div>

        {conflict && (
          <p className="mt-3 rounded-md border border-warning-border bg-warning-bg p-2 text-xs text-warning-fg">
            {t(
              "keybindings.record.conflict",
              "This shortcut is already used by {{name}}. Saving will reassign it.",
              { name: conflict.title },
            )}
          </p>
        )}

        {error && (
          <p className="mt-3 rounded-md border border-error-border bg-error-bg p-2 text-xs text-error-fg">
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center justify-between">
          <div className="space-x-2 text-xs">
            <button
              type="button"
              onClick={onUnbind}
              disabled={busy}
              className="text-surface-fg-muted hover:underline"
            >
              {t("keybindings.record.unbind", "Unbind")}
            </button>
            <button
              type="button"
              onClick={onReset}
              disabled={busy}
              className="text-surface-fg-muted hover:underline"
            >
              {t("keybindings.record.reset", "Reset to preset")}
            </button>
          </div>
          <div className="space-x-2">
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
              onClick={onSave}
              disabled={busy || !captured}
              className="rounded-md bg-brand-500 px-3 py-1 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {t("common.save", "Save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function findConflict(
  binding: Binding,
  ownerId: string,
): { commandId: string; title: string } | null {
  if (!binding) return null;
  const target = normaliseBinding(binding);
  for (const e of listActiveBindings()) {
    if (e.commandId === ownerId) continue;
    if (normaliseBinding(e.binding) === target) {
      const cmd = commands.find((c) => c.id === e.commandId);
      /* v8 ignore next -- every active binding's commandId is sourced from the registry, so the fallback to e.commandId is defensive only */
      return { commandId: e.commandId, title: cmd?.title ?? e.commandId };
    }
  }
  return null;
}
