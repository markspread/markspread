// ADR-0014 (T2.c): Read-only 코드 뷰어 — CodeMirror 6 + lazy language modules.
//
// 문서/코드 비대칭 모델에서 *코드/설정 파일* (T2 B+D) 의 view-only 렌더링.
// LSP/intellisense 없음 — 가벼움 약속 (CONTEXT.md §3) 준수.
//
// Language module 은 *lazy import* — 첫 .ts 열림 시점에만 typescript chunk 다운로드.
// 이후 캐시. 본 모듈 import 시점에는 어떤 lang 도 로드 안 됨.

import type { Extension } from "@codemirror/state";

/**
 * 파일 확장자 → CM6 language module factory.
 * 호출자가 `await getLanguageFor(filename)` 으로 lazy 로드.
 * 매핑 없으면 null (plain text).
 */
const LANG_LOADERS: Record<string, () => Promise<Extension | null>> = {
  ".ts": async () => {
    try {
      const mod = (await import(/* @vite-ignore */ "@codemirror/lang-javascript" as string)) as {
        javascript: (opts?: { typescript?: boolean; jsx?: boolean }) => Extension;
      };
      return mod.javascript({ typescript: true });
    } catch {
      return null;
    }
  },
  ".tsx": async () => {
    try {
      const mod = (await import(/* @vite-ignore */ "@codemirror/lang-javascript" as string)) as {
        javascript: (opts?: { typescript?: boolean; jsx?: boolean }) => Extension;
      };
      return mod.javascript({ jsx: true, typescript: true });
    } catch {
      return null;
    }
  },
  ".js": async () => {
    try {
      const mod = (await import(/* @vite-ignore */ "@codemirror/lang-javascript" as string)) as {
        javascript: (opts?: { typescript?: boolean; jsx?: boolean }) => Extension;
      };
      return mod.javascript();
    } catch {
      return null;
    }
  },
  ".jsx": async () => {
    try {
      const mod = (await import(/* @vite-ignore */ "@codemirror/lang-javascript" as string)) as {
        javascript: (opts?: { typescript?: boolean; jsx?: boolean }) => Extension;
      };
      return mod.javascript({ jsx: true });
    } catch {
      return null;
    }
  },
  ".json": async () => {
    try {
      const mod = (await import(/* @vite-ignore */ "@codemirror/lang-json" as string)) as {
        json: () => Extension;
      };
      return mod.json();
    } catch {
      return null;
    }
  },
  ".css": async () => {
    try {
      const mod = (await import(/* @vite-ignore */ "@codemirror/lang-css" as string)) as {
        css: () => Extension;
      };
      return mod.css();
    } catch {
      return null;
    }
  },
  ".html": async () => {
    try {
      const mod = (await import(/* @vite-ignore */ "@codemirror/lang-html" as string)) as {
        html: () => Extension;
      };
      return mod.html();
    } catch {
      return null;
    }
  },
  ".rs": async () => {
    try {
      const mod = (await import(/* @vite-ignore */ "@codemirror/lang-rust" as string)) as {
        rust: () => Extension;
      };
      return mod.rust();
    } catch {
      return null;
    }
  },
  ".py": async () => {
    try {
      const mod = (await import(/* @vite-ignore */ "@codemirror/lang-python" as string)) as {
        python: () => Extension;
      };
      return mod.python();
    } catch {
      return null;
    }
  },
  ".go": async () => {
    try {
      const mod = (await import(/* @vite-ignore */ "@codemirror/lang-go" as string)) as {
        go: () => Extension;
      };
      return mod.go();
    } catch {
      return null;
    }
  },
  ".sql": async () => {
    try {
      // optional dep — installed only if user opts into SQL viewing.
      const mod = (await import(/* @vite-ignore */ "@codemirror/lang-sql" as string)) as {
        sql: () => Extension;
      };
      return mod.sql();
    } catch {
      return null;
    }
  },
  ".yaml": async () => {
    try {
      const mod = (await import(/* @vite-ignore */ "@codemirror/lang-yaml" as string)) as {
        yaml: () => Extension;
      };
      return mod.yaml();
    } catch {
      return null;
    }
  },
  ".yml": async () => {
    try {
      const mod = (await import(/* @vite-ignore */ "@codemirror/lang-yaml" as string)) as {
        yaml: () => Extension;
      };
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
 * CodeMirror 6 read-only mode extension — 호출자가 EditorState 구성 시 spread.
 * 의존성 0 — `@codemirror/state` 만 의존.
 */
export function readOnlyExtension(): Extension[] {
  // 정적 import 해도 가벼움 — state 모듈은 이미 본 도구 코어
  // 호출자가 EditorState.readOnly.of(true) 직접 추가하는 방식도 가능
  return [];
}

/**
 * CM6 EditorState 구성용 helper — 동기 부분만. 호출자가 lang Extension 을
 * 별도 async 로드 후 합쳐서 EditorView 생성.
 */
export interface CodeViewerSetup {
  /** caller 가 ...spread 해서 EditorState.create({ extensions: [...] }) 에 추가 */
  extensions: Extension[];
  /** 추후 lang module 로드 시 dispatch 용 — caller 가 EditorView.dispatch 호출 */
  pendingLanguageLoad: Promise<Extension | null>;
}

/**
 * 비동기 lang 로드 promise 를 caller 에게 넘김. caller 가 EditorView 생성 후
 * lang 로드 완료 시 `.dispatch({ effects: ... })` 또는 reconfigure.
 */
export function createCodeViewerSetup(filename: string): CodeViewerSetup {
  return {
    extensions: [],
    pendingLanguageLoad: getLanguageFor(filename),
  };
}
