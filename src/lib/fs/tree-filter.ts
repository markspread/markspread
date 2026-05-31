// ADR-0014 (T2.g): File tree filter — md-only ↔ 전체 토글 + 폴더 항상 표시.
//
// 순수 logic — React 컴포넌트와 분리. 호출자 (FileTree.tsx 등) 는 본 함수만 사용.
// 토글 상태 persist (workspace 별) 는 caller (Zustand store) 책임.

import type { MultiLayerIgnore } from "./multi-layer-ignore";

export type TreeFilterMode = "md-only" | "all";

export interface TreeNode {
  /** absolute path */
  path: string;
  /** OS-specific basename */
  name: string;
  isDirectory: boolean;
  /** 자식 (디렉토리만). 없으면 undefined (lazy load). */
  children?: TreeNode[];
}

export interface FilterOptions {
  mode: TreeFilterMode;
  /** 활성 파서 플러그인이 자동 *문서로 승격* 시킨 확장자 (e.g. ['.rst', '.org']). default empty. */
  activeParserExtensions?: readonly string[];
  /** ignore matcher (없으면 모두 통과). */
  ignore?: MultiLayerIgnore;
  /** 임시 표시 — 방금 생성된 비-md 파일을 *일시적으로* 보이게 (T2.g 새 파일 생성 UX). */
  transientlyVisible?: ReadonlySet<string>;
}

const BUILTIN_DOC_EXTENSIONS: readonly string[] = [".md", ".mdx", ".markdown"];

/**
 * 한 노드를 보여야 하는지 판단. 호출자가 트리 traverse 하면서 사용.
 */
export function shouldShow(node: TreeNode, opts: FilterOptions): boolean {
  // ignore matcher 우선 (모드 무관)
  if (opts.ignore?.isIgnored(node.path, node.isDirectory)) return false;

  // 폴더는 모드 무관 항상 표시 (.gitignore 통과한 한)
  if (node.isDirectory) return true;

  // 일시 표시 파일은 모드 무관
  if (opts.transientlyVisible?.has(node.path)) return true;

  if (opts.mode === "all") return true;

  // md-only 모드 — 문서 확장자만
  return isDocumentFile(node.name, opts.activeParserExtensions ?? []);
}

/** 파일 이름이 문서 카테고리인가 (확장 가능 정의 — ADR-0013/0014). */
export function isDocumentFile(
  filename: string,
  activeParserExtensions: readonly string[],
): boolean {
  const lower = filename.toLowerCase();
  for (const ext of BUILTIN_DOC_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  for (const ext of activeParserExtensions) {
    if (lower.endsWith(ext.toLowerCase())) return true;
  }
  return false;
}

/**
 * 트리 전체에 필터 적용. 새 트리 반환 (불변).
 * children 재귀 — 자식 모두 숨김이면 폴더는 빈 채로 노출 (사용자가 빈 폴더 만들 수 있어야).
 */
export function filterTree(node: TreeNode, opts: FilterOptions): TreeNode | null {
  if (!shouldShow(node, opts)) return null;

  if (!node.isDirectory) {
    // file — children 없음
    return { ...node };
  }

  const filteredChildren = (node.children ?? [])
    .map((c) => filterTree(c, opts))
    .filter((c): c is TreeNode => c !== null);

  return {
    ...node,
    children: filteredChildren,
  };
}

/**
 * 평탄화된 트리에 대해 필터 적용 (성능 빠름 — virtual list 용).
 */
export function filterFlatList(nodes: readonly TreeNode[], opts: FilterOptions): TreeNode[] {
  return nodes.filter((n) => shouldShow(n, opts));
}

/**
 * 새 파일 생성 UX 의 일시 표시 helper.
 * 호출자가 setTimeout(removeTransient, msec) 으로 자동 해제.
 */
export function createTransientVisibility(): {
  add(path: string): void;
  remove(path: string): void;
  set(): Set<string>;
} {
  const s = new Set<string>();
  return {
    add(path: string): void {
      s.add(path);
    },
    remove(path: string): void {
      s.delete(path);
    },
    set(): Set<string> {
      return new Set(s);
    },
  };
}
