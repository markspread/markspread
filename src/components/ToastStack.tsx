import { useTranslation } from "react-i18next";
import { type ToastKind, useToasts } from "../store/toasts";

const TONE: Record<ToastKind, string> = {
  info: "border-[var(--color-border)] bg-[var(--color-surface)]",
  success: "border-emerald-300 bg-emerald-50 text-emerald-900",
  warning: "border-amber-300 bg-amber-50 text-amber-900",
  error: "border-red-300 bg-red-50 text-red-900",
};

export function ToastStack() {
  const { t: tr } = useTranslation();
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    // S-A11-010: the stack itself is a region; each individual toast carries
    // its own live attributes. `assertive` interrupts the SR mid-utterance —
    // we only want that for errors. Info / success / warning use `polite` so
    // a passing notice doesn't stomp the user's editor narration.
    <div
      className="pointer-events-none fixed top-4 right-4 flex flex-col gap-2"
      style={{ zIndex: "var(--z-toast)" }}
      role="region"
      aria-label={tr("toasts.aria", "Notifications")}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex max-w-sm items-start gap-3 rounded-md border px-3 py-2 text-sm shadow-md ${TONE[t.kind]}`}
          role={t.kind === "error" ? "alert" : "status"}
          aria-live={t.kind === "error" ? "assertive" : "polite"}
          aria-atomic="true"
        >
          <div className="flex flex-col">
            <span className="font-medium">{t.message}</span>
            {t.details && (
              <span className="text-[var(--color-muted)] text-xs">{t.details}</span>
            )}
          </div>
          {t.action && (
            <button
              type="button"
              className="ml-auto font-medium text-[var(--color-accent)] text-xs hover:underline"
              onClick={() => {
                t.action?.onClick();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            className={`text-[var(--color-muted)] text-xs hover:underline ${t.action ? "ml-2" : "ml-auto"}`}
            onClick={() => dismiss(t.id)}
            aria-label={tr("toasts.dismiss.aria", "Dismiss notification")}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
