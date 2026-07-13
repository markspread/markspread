// ADR-0014 H13: 드래그-채팅 편집 — 현재 활성 선택 영역 store.
//
// Editor 에서 선택 발생 시 본 store 에 push. ChatPanel 이 subscribe 해서
// "이 선택 영역에 대해 수정 요청" 모드 활성. AI 응답 → InlineDiffOverlay 가
// 이 store 의 선택 위치에 렌더.

import { create } from "zustand";
import type { SelectionContext } from "../lib/editor/drag-chat-edit";
import { buildSelectionContext } from "../lib/editor/drag-chat-edit";

/** Raw capture data — accept 시 문서 write-back 에 필요한 offset 기반 원본. */
export interface RawSelectionRange {
  fullText: string;
  fromOffset: number;
  toOffset: number;
}

export interface DragChatSelectionState {
  /** 현재 활성 selection — null = 활성 선택 없음. */
  current: SelectionContext | null;
  /** capture 시점의 raw range — accept 시 offset 기반 치환에 사용. */
  raw: RawSelectionRange | null;
  /** 선택 영역의 화면 좌표 (px) — InlineDiffOverlay 위치. 계산 불가 시 null. */
  screenPosition: { top: number; left: number } | null;
  /** Editor 에서 emit 한 raw range → SelectionContext 변환·저장. */
  capture(input: {
    filePath: string;
    fullText: string;
    fromOffset: number;
    toOffset: number;
    screenPosition?: { top: number; left: number } | null;
  }): void;
  /** 선택 해제 (다른 곳 클릭, ESC, accept/reject 후). */
  clear(): void;
}

export const useDragChatSelection = create<DragChatSelectionState>()((set) => ({
  current: null,
  raw: null,
  screenPosition: null,
  capture(input) {
    // empty selection 은 무시 — emit 측에서 이미 필터링하지만 안전망.
    if (input.fromOffset === input.toOffset) return;
    const ctx = buildSelectionContext(input);
    set({
      current: ctx,
      raw: {
        fullText: input.fullText,
        fromOffset: input.fromOffset,
        toOffset: input.toOffset,
      },
      screenPosition: input.screenPosition ?? null,
    });
  },
  clear() {
    set({ current: null, raw: null, screenPosition: null });
  },
}));
