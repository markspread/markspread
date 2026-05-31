// ADR-0014 H13: 드래그-채팅 편집 결과의 인라인 diff overlay.
//
// AI 응답 (proposed text) 을 사용자에게 보여주고 accept/reject/retry 결정 받음.
// src/lib/editor/drag-chat-edit.ts 의 computeInlineDiff + applyDecision 를 wrap.

import { useTranslation } from "react-i18next";
import type { Decision, InlineDiff } from "../lib/editor/drag-chat-edit";

interface Props {
  /** computeInlineDiff() 결과. null = overlay 닫힘. */
  diff: InlineDiff | null;
  /** 사용자 결정 콜백. caller 가 applyDecision() 후 store/editor 반영. */
  onDecision: (decision: Decision) => void;
  /** 시각 위치 (px) — caller 가 selection screen coords 로 계산. */
  position?: { top: number; left: number };
}

export function InlineDiffOverlay({
  diff,
  onDecision,
  position,
}: Props): React.ReactElement | null {
  const { t } = useTranslation();
  if (!diff) return null;

  const style = position
    ? { top: position.top, left: position.left }
    : { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };

  return (
    // biome-ignore lint/a11y/useSemanticElements: overlay rendered inline (no portal), matches the rest of the app's modal pattern
    <div
      role="dialog"
      aria-label={t("inline_diff.aria", "Inline edit suggestion")}
      data-testid="inline-diff-overlay"
      style={{ position: "fixed", zIndex: 60, ...style }}
      className="flex max-w-[min(640px,92vw)] flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-fg)] shadow-2xl"
    >
      <div
        className="flex max-h-72 flex-col overflow-y-auto p-3 font-mono text-xs leading-5"
        data-testid="inline-diff-chunks"
      >
        {diff.chunks.map((c, i) => {
          if (c.kind === "equal") {
            return (
              <span key={`equal-${i}-${c.text.slice(0, 16)}`} className="whitespace-pre-wrap">
                {c.text}
              </span>
            );
          }
          if (c.kind === "add") {
            return (
              <span
                key={`add-${i}-${c.text.slice(0, 16)}`}
                data-chunk-kind="add"
                className="whitespace-pre-wrap bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200"
              >
                {c.text}
              </span>
            );
          }
          return (
            <span
              key={`del-${i}-${c.text.slice(0, 16)}`}
              data-chunk-kind="remove"
              className="whitespace-pre-wrap bg-red-100 text-red-900 line-through dark:bg-red-950/60 dark:text-red-200"
            >
              {c.text}
            </span>
          );
        })}
      </div>
      <footer className="flex items-center justify-end gap-2 border-[var(--color-border)] border-t px-3 py-2 text-xs">
        <button
          type="button"
          data-testid="inline-diff-reject"
          className="rounded border border-[var(--color-border)] px-2 py-1 hover:bg-[var(--color-border)]/40"
          onClick={() => onDecision("reject")}
          title={t("inline_diff.reject.tooltip", "Esc 로 거절")}
        >
          {t("inline_diff.reject", "거절 (Esc)")}
        </button>
        <button
          type="button"
          data-testid="inline-diff-retry"
          className="rounded border border-[var(--color-border)] px-2 py-1 hover:bg-[var(--color-border)]/40"
          onClick={() => onDecision("retry")}
          title={t("inline_diff.retry.tooltip", "Cmd+R 로 다시")}
        >
          {t("inline_diff.retry", "다시 (⌘R)")}
        </button>
        <button
          type="button"
          data-testid="inline-diff-accept"
          className="rounded bg-[var(--color-accent)] px-2 py-1 text-white hover:opacity-90"
          onClick={() => onDecision("accept")}
          title={t("inline_diff.accept.tooltip", "Enter 로 수락")}
        >
          {t("inline_diff.accept", "수락 (↵)")}
        </button>
      </footer>
    </div>
  );
}
