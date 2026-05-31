// ADR-0019: 좌측 활동바 (VSCode/Cursor 식). 최상위 2모드 전환.
//
//   ▦ 리뷰   : 마크다운 리뷰 (AI 채팅 기본) — workspace 모드
//   ▣ 파서   : 파서 개발 워크벤치 — parser 모드
//   ⚙ 설정   : 설정 시트 토글
//
// 모드 전환은 *뷰 전체* 를 바꾼다 (모달 아님). 파서 개발이 한 모드의 전체
// 화면을 받으므로 "코드+프리뷰+AI 가 한 화면" 이 구조적으로 보장된다.

import { useTranslation } from "react-i18next";
import { type ActivityMode, useActivityMode } from "../store/activity-mode";

interface RailItem {
  mode: ActivityMode;
  glyph: string;
  labelKey: string;
  labelFallback: string;
}

const ITEMS: RailItem[] = [
  { mode: "workspace", glyph: "▦", labelKey: "activity.review", labelFallback: "리뷰" },
  { mode: "parser", glyph: "▣", labelKey: "activity.parser", labelFallback: "파서 개발" },
];

export function ActivityBar(): React.ReactElement {
  const { t } = useTranslation();
  const mode = useActivityMode((s) => s.mode);
  const setMode = useActivityMode((s) => s.setMode);

  return (
    <nav
      aria-label={t("activity.aria", "Mode switcher")}
      data-testid="activity-bar"
      className="flex w-12 flex-col items-center gap-1 border-[var(--color-border)] border-r bg-[var(--color-surface-subtle)] py-2"
    >
      {ITEMS.map((item) => {
        const active = mode === item.mode;
        return (
          <button
            key={item.mode}
            type="button"
            data-testid={`activity-${item.mode}`}
            aria-label={t(item.labelKey, item.labelFallback)}
            aria-pressed={active}
            title={t(item.labelKey, item.labelFallback)}
            onClick={() => setMode(item.mode)}
            className={`flex h-10 w-10 items-center justify-center rounded text-lg ${
              active
                ? "bg-[var(--color-border)] text-[var(--color-fg)]"
                : "text-[var(--color-muted)] hover:bg-[var(--color-border)]/40 hover:text-[var(--color-fg)]"
            }`}
          >
            <span aria-hidden="true">{item.glyph}</span>
          </button>
        );
      })}
    </nav>
  );
}
