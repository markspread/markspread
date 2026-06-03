// ADR-0019: 좌측 활동바 (VSCode/Cursor 식). 최상위 2모드 전환.
//
//   ▦ 리뷰   : 마크다운 리뷰 (AI 채팅 기본) — workspace 모드
//   ▣ 파서   : 파서 개발 워크벤치 — parser 모드
//   ⚙ 설정   : 설정 시트 토글
//
// 모드 전환은 *뷰 전체* 를 바꾼다 (모달 아님). 파서 개발이 한 모드의 전체
// 화면을 받으므로 "코드+프리뷰+AI 가 한 화면" 이 구조적으로 보장된다.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { countUserParsers } from "../lib/parsers/registry";
import { type ActivityMode, shouldShowParserStudio, useActivityMode } from "../store/activity-mode";
import { useSettings } from "../store/settings";

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
  // ADR-0019 §Decision.5 (T5): ▣ Parser Studio rail 은 조건부.
  //   `개발자 모드` ON  OR  자작 파서 ≥ 1  일 때만 노출.
  // parserRegistryRev 는 registry 변경 시마다 증가하므로 이 selector 가
  // 재구독되어 countUserParsers() 를 다시 평가한다 (비반응형 registry 의 트리거).
  const developerMode = useSettings((s) => s.developerMode);
  const parserRegistryRev = useActivityMode((s) => s.parserRegistryRev);
  // biome-ignore lint/correctness/useExhaustiveDependencies: parserRegistryRev is listed so a registry mutation (parser register/unregister) re-evaluates the non-reactive registry count; Biome flags it because the body doesn't reference it directly.
  const parserStudioVisible = useMemo(
    () =>
      shouldShowParserStudio({
        developerMode,
        userParserCount: countUserParsers(),
      }),
    [developerMode, parserRegistryRev],
  );

  // 활성 모드의 버튼은 게이트와 무관하게 항상 노출 — 게이트가 꺼져도 파서
  // 모드에 들어가 있으면 ▦ 로 돌아갈 동선이 끊기면 안 되기 때문.
  const items = useMemo(
    () =>
      ITEMS.filter((item) => item.mode !== "parser" || parserStudioVisible || mode === "parser"),
    [parserStudioVisible, mode],
  );

  return (
    <nav
      aria-label={t("activity.aria", "Mode switcher")}
      data-testid="activity-bar"
      className="flex w-12 flex-col items-center gap-1 border-[var(--color-border)] border-r bg-[var(--color-surface-subtle)] py-2"
    >
      {items.map((item) => {
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
