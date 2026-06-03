// ADR-0019: 2-mode shell IA. VSCode/Cursor 식 좌측 활동바로 전환하는 최상위 모드.
//
//   workspace : Agent(채팅) + Edit 통합 — 마크다운 리뷰/편집의 일상 표면.
//   parser    : 파서 개발 워크벤치 — 코드 + 라이브 프리뷰 + AI 가 한 화면.
//
// 파서 모드는 P-self(자작 파서) 전용 성격이지만, "파서 개발이 *될 수밖에 없는*
// 표면"을 제공하는 게 본 모드의 존재 이유 (모달 분리 구조의 폐기).
//
// N5 (모달 탈피) / N10 (양방향 동선): 리뷰 ↔ 파서 사이를 모달 없이 *모드 전환*
// 으로만 잇기 위해 운반 상태를 여기 둔다.
//   - parserPrefillSource : 리뷰 채팅의 js 코드블록 '파서로 만들기' → 파서 모드
//     진입 시 워크벤치 소스 에디터에 prefill 할 소스 (풀 세션이 아니라 소스만).
//   - enteredParserFrom    : 파서 모드를 어느 리뷰 표면에서 열었는지 — '돌아가기'
//     breadcrumb 가 원래 모드로 복귀시키기 위함. null 이면 활동바에서 직접 진입.
//   - parserRenderNonce    : 파서 워크벤치에서 '이 파서로 지금 활성 문서 렌더' 를
//     누르면 증가. 리뷰 프리뷰(SpreadPane)가 이 값을 의존성으로 받아 동일 파일·
//     동일 내용이라도 새로 매칭된 파서로 강제 재렌더한다 (역방향 즉시 반영).

import { create } from "zustand";

export type ActivityMode = "workspace" | "parser";

interface EnterParserOptions {
  /** 워크벤치 소스 에디터에 prefill 할 파서 JS 소스. */
  prefillSource?: string;
}

interface ActivityModeState {
  mode: ActivityMode;
  /** 리뷰 채팅 코드블록 → 파서 모드 진입 시 운반되는 소스 prefill. */
  parserPrefillSource: string;
  /** 파서 모드 진입 직전의 리뷰 모드 (breadcrumb '돌아가기' 대상). null = 직접 진입. */
  enteredParserFrom: ActivityMode | null;
  /** 역방향 '이 파서로 지금 렌더' 클릭마다 증가 — 리뷰 프리뷰 강제 재렌더 트리거. */
  parserRenderNonce: number;
  /**
   * ADR-0019 §Decision.5 (T5): Parser Studio rail 조건부 노출의 *반응성* 신호.
   * 파서 registry 가 바뀔 때마다(자작 파서 등록/삭제) 증가시켜, ActivityBar 가
   * registry 를 다시 세어 rail 노출 여부를 재평가하게 한다. registry 자체는
   * 비반응형 싱글톤이므로 이 revision 이 구독 가능한 트리거 역할을 한다.
   */
  parserRegistryRev: number;
  /** 활동바 직접 전환 (운반 상태 없음). */
  setMode: (mode: ActivityMode) => void;
  /**
   * 리뷰 → 파서 진입 (소스 prefill + breadcrumb). 모달을 대체하는 진입점.
   * 이미 파서 모드면 enteredParserFrom 을 덮어쓰지 않는다 (원래 진입점 보존).
   */
  enterParser: (opts?: EnterParserOptions) => void;
  /** 파서 prefill 운반 소스 소비 후 비우기 (워크벤치가 1회 읽고 호출). */
  clearParserPrefill: () => void;
  /** breadcrumb '돌아가기' — 진입했던 리뷰 모드로 복귀. */
  exitParser: () => void;
  /** 역방향 '이 파서로 지금 렌더' — 리뷰로 복귀 + 프리뷰 재렌더 nonce 증가. */
  renderWithParser: () => void;
  /**
   * ADR-0019 T5: 자작 파서 registry 가 바뀐 뒤 호출 — rail 재평가 트리거.
   * 파서를 등록/삭제하는 UI(CreateParserDialog, Parser Studio 적용 버튼)가
   * 변경 직후 호출한다. P-self 의 "첫 자작 파서 등록 즉시 자동 등장" 보장.
   */
  notifyParserRegistryChanged: () => void;
}

export const useActivityMode = create<ActivityModeState>((set) => ({
  mode: "workspace",
  parserPrefillSource: "",
  enteredParserFrom: null,
  parserRenderNonce: 0,
  parserRegistryRev: 0,
  setMode: (mode) => set({ mode }),
  enterParser: (opts) =>
    set((s) => ({
      mode: "parser",
      parserPrefillSource: opts?.prefillSource ?? "",
      enteredParserFrom: s.mode === "parser" ? s.enteredParserFrom : s.mode,
    })),
  clearParserPrefill: () => set({ parserPrefillSource: "" }),
  exitParser: () =>
    set((s) => ({
      mode: s.enteredParserFrom ?? "workspace",
      enteredParserFrom: null,
      parserPrefillSource: "",
    })),
  renderWithParser: () =>
    set((s) => ({
      mode: s.enteredParserFrom ?? "workspace",
      enteredParserFrom: null,
      parserPrefillSource: "",
      parserRenderNonce: s.parserRenderNonce + 1,
    })),
  notifyParserRegistryChanged: () => set((s) => ({ parserRegistryRev: s.parserRegistryRev + 1 })),
}));

// ADR-0019 §Decision.5 (T5) — Parser Studio rail 노출 게이트 (순수 함수, 테스트 가능).
//
//   노출 조건 = `개발자 모드` ON  OR  자작(local-trust) 파서 ≥ 1.
//
// "local-trust 파서" = registry 에 등록됐지만 *시스템 파서가 아닌* 것. 즉
// builtin markdown(시스템 lock)이나 Parser Studio 의 임시 프리뷰 파서는 세지
// 않는다 — 둘 다 사용자가 의도적으로 만든 자작 파서가 아니기 때문. 카운트는
// `countUserParsers()`(lib/parsers/registry) 가 책임지고, 이 함수는 그 결과를
// 받아 게이트 *판정* 만 한다 (순수·테스트 가능).
export function shouldShowParserStudio(args: {
  developerMode: boolean;
  userParserCount: number;
}): boolean {
  return args.developerMode || args.userParserCount > 0;
}
