// ADR-0014 (T2.c): Read-only 코드 뷰어 — CodeMirror 6 + lazy language modules.
//
// 문서/코드 비대칭 모델에서 *코드/설정 파일* (T2 B+D) 의 view-only 렌더링.
// LSP/intellisense 없음 — 가벼움 약속 (CONTEXT.md §3) 준수.
//
// Language module 은 *lazy import* — 첫 .ts 열림 시점에만 typescript chunk 로드.
// 이후 캐시 (Vite 가 각 @codemirror/lang-* 를 별도 chunk 로 code-split). 본 모듈
// import 시점에는 어떤 lang 도 로드 안 됨. read-only 강제 자체는
// `buildEditorState(..., readOnly)` (state.ts) 가 담당한다.

import { Compartment, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/**
 * 파일 확장자 → CM6 language module factory.
 * 호출자가 `await getLanguageFor(filename)` 으로 lazy 로드.
 * 매핑 없으면 null (plain text).
 */
const LANG_LOADERS: Record<string, () => Promise<Extension | null>> = {
  ".ts": async () => {
    try {
      const mod = await import("@codemirror/lang-javascript");
      return mod.javascript({ typescript: true });
    } catch {
      return null;
    }
  },
  ".tsx": async () => {
    try {
      const mod = await import("@codemirror/lang-javascript");
      return mod.javascript({ jsx: true, typescript: true });
    } catch {
      return null;
    }
  },
  ".js": async () => {
    try {
      const mod = await import("@codemirror/lang-javascript");
      return mod.javascript();
    } catch {
      return null;
    }
  },
  ".jsx": async () => {
    try {
      const mod = await import("@codemirror/lang-javascript");
      return mod.javascript({ jsx: true });
    } catch {
      return null;
    }
  },
  ".json": async () => {
    try {
      const mod = await import("@codemirror/lang-json");
      return mod.json();
    } catch {
      return null;
    }
  },
  ".css": async () => {
    try {
      const mod = await import("@codemirror/lang-css");
      return mod.css();
    } catch {
      return null;
    }
  },
  ".html": async () => {
    try {
      const mod = await import("@codemirror/lang-html");
      return mod.html();
    } catch {
      return null;
    }
  },
  ".rs": async () => {
    try {
      const mod = await import("@codemirror/lang-rust");
      return mod.rust();
    } catch {
      return null;
    }
  },
  ".py": async () => {
    try {
      const mod = await import("@codemirror/lang-python");
      return mod.python();
    } catch {
      return null;
    }
  },
  ".go": async () => {
    try {
      const mod = await import("@codemirror/lang-go");
      return mod.go();
    } catch {
      return null;
    }
  },
  ".sql": async () => {
    try {
      const mod = await import("@codemirror/lang-sql");
      return mod.sql();
    } catch {
      return null;
    }
  },
  ".yaml": async () => {
    try {
      const mod = await import("@codemirror/lang-yaml");
      return mod.yaml();
    } catch {
      return null;
    }
  },
  ".yml": async () => {
    try {
      const mod = await import("@codemirror/lang-yaml");
      return mod.yaml();
    } catch {
      return null;
    }
  },
};

/**
 * filename 또는 path → 적절한 language Extension. plain text 면 null.
 * 호출자는 항상 await 사용 (lazy load).
 */
export async function getLanguageFor(filename: string): Promise<Extension | null> {
  const lower = filename.toLowerCase();
  // longest-suffix first (e.g. .tsx 가 .ts 보다 우선)
  const exts = Object.keys(LANG_LOADERS).sort((a, b) => b.length - a.length);
  for (const ext of exts) {
    if (lower.endsWith(ext)) {
      return (await LANG_LOADERS[ext]?.()) ?? null;
    }
  }
  return null;
}

export function isSupportedCodeExt(filename: string): boolean {
  const lower = filename.toLowerCase();
  for (const ext of Object.keys(LANG_LOADERS)) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

/**
 * 비-md 파일 마운트용 setup. `extensions` 를 EditorState 구성에 spread 하면
 * 빈 language Compartment 가 자리를 잡고, view 생성 후 `applyLanguage(view)` 가
 * lazy 로드 완료 시점에 compartment 를 reconfigure 해 하이라이트를 켠다.
 * 로드 실패/미지원 확장자면 compartment 는 비어 있는 채 — plain text 폴백.
 */
export interface CodeViewerSetup {
  /** EditorState.create({ extensions: [...] }) 에 spread — 빈 language slot. */
  extensions: Extension[];
  /**
   * lang module lazy 로드 후 view 에 주입. 적용되면 true, plain 폴백이면 false.
   * `isCancelled` 가 true 를 반환하면 (unmount 등) dispatch 를 생략한다.
   */
  applyLanguage(view: EditorView, isCancelled?: () => boolean): Promise<boolean>;
}

export function createCodeViewerSetup(filename: string): CodeViewerSetup {
  const languageSlot = new Compartment();
  return {
    extensions: [languageSlot.of([])],
    async applyLanguage(view, isCancelled = () => false) {
      const lang = await getLanguageFor(filename);
      if (!lang || isCancelled()) return false;
      view.dispatch({ effects: languageSlot.reconfigure(lang) });
      return true;
    },
  };
}
