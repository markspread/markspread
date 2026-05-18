import { useTranslation } from "react-i18next";
import { type CostEstimate, formatTokens } from "../lib/ai/cost-estimate";
import { formatUsdCost } from "../lib/i18n-format";

// S-AI-003: pre-run chip rendered just above the editor before an AI action
// fires. The user can confirm or abort — abort closes the chip without
// touching the document, confirm hands off to the action runner.

interface AiCostChipProps {
  estimate: CostEstimate;
  actionLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function AiCostChip({ estimate, actionLabel, onConfirm, onCancel }: AiCostChipProps) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-auto flex items-center gap-3 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs shadow-md"
    >
      <span className="font-medium">{actionLabel}</span>
      <span className="text-[var(--color-muted)]">
        ~{formatTokens(estimate.tokens)} tokens · {formatUsdCost(estimate.usd)}
      </span>
      <button
        type="button"
        className="rounded-full bg-[var(--color-accent)] px-3 py-0.5 font-medium text-white"
        onClick={onConfirm}
        autoFocus
      >
        {t("ai.chip.run", "Run")}
      </button>
      <button
        type="button"
        className="text-[var(--color-muted)] hover:underline"
        onClick={onCancel}
        aria-label={t("ai.chip.cancel.aria", "Cancel AI action")}
      >
        {t("ai.chip.cancel", "Cancel")}
      </button>
    </div>
  );
}
