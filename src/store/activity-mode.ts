// ADR-0019: 2-mode shell IA. VSCode/Cursor 식 좌측 활동바로 전환하는 최상위 모드.
//
//   workspace : Agent(채팅) + Edit 통합 — 마크다운 리뷰/편집의 일상 표면.
//   parser    : 파서 개발 워크벤치 — 코드 + 라이브 프리뷰 + AI 가 한 화면.
//
// 파서 모드는 P-self(자작 파서) 전용 성격이지만, "파서 개발이 *될 수밖에 없는*
// 표면"을 제공하는 게 본 모드의 존재 이유 (모달 분리 구조의 폐기).

import { create } from "zustand";

export type ActivityMode = "workspace" | "parser";

interface ActivityModeState {
  mode: ActivityMode;
  setMode: (mode: ActivityMode) => void;
}

export const useActivityMode = create<ActivityModeState>((set) => ({
  mode: "workspace",
  setMode: (mode) => set({ mode }),
}));
