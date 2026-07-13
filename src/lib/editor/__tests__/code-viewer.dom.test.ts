import "../extensions/jsdomLayoutShim";
// ADR-0014 (T2.c): 비-md 파일 마운트 → 실제 언어 extension 적용 회귀 테스트.
//
// SC-EDIT-02 고정: 앱 마운트 경로 (Editor.tsx → mountEditor(..., "plain",
// readOnly) + createCodeViewerSetup(path).applyLanguage(view)) 와 동일한
// 시퀀스로 *실제* @codemirror/lang-* 모듈을 lazy 로드해 (1) language facet
// 활성 + syntax tree 토큰 생성, (2) read-only 유지, (3) 로드 전/취소 시
// plain 폴백을 검증한다.

import { ensureSyntaxTree, language } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { createCodeViewerSetup } from "../code-viewer";
import { DEFAULT_EDITOR_PREFS } from "../settings";
import { mountEditor } from "../state";

const mounted: { view: EditorView; parent: HTMLElement }[] = [];

function mountCodeFile(doc: string, path: string) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const setup = createCodeViewerSetup(path);
  // Editor.tsx 와 동일: plain language + readOnly + code-viewer slot.
  const view = mountEditor(parent, doc, setup.extensions, DEFAULT_EDITOR_PREFS, "plain", true);
  mounted.push({ view, parent });
  return { view, setup };
}

function treeNodeNames(view: EditorView): Set<string> {
  const tree = ensureSyntaxTree(view.state, view.state.doc.length, 5_000);
  const names = new Set<string>();
  if (!tree) return names;
  const cursor = tree.cursor();
  do {
    names.add(cursor.type.name);
  } while (cursor.next());
  return names;
}

afterEach(() => {
  for (const { view, parent } of mounted.splice(0)) {
    view.destroy();
    parent.remove();
  }
});

describe("code viewer — real language module wiring (SC-EDIT-02)", () => {
  it("mounts a .json file plain, then applies the JSON language after the lazy load", async () => {
    const { view, setup } = mountCodeFile('{"answer": 42}', "/ws/config.json");
    // Before the lazy load lands the view is plain text (no language facet).
    expect(view.state.facet(language)).toBeNull();

    await expect(setup.applyLanguage(view)).resolves.toBe(true);

    // Highlight is on: the language facet is active and the syntax tree
    // yields real JSON tokens instead of a bare plain-text document.
    expect(view.state.facet(language)).not.toBeNull();
    const names = treeNodeNames(view);
    expect(names.has("JsonText")).toBe(true);
    expect(names.has("Number")).toBe(true);
    // The document itself is untouched by the reconfigure.
    expect(view.state.doc.toString()).toBe('{"answer": 42}');
  });

  it("applies the TypeScript language for a .ts file and keeps the view read-only", async () => {
    const { view, setup } = mountCodeFile("const a: number = 1;", "/ws/src/main.ts");
    await expect(setup.applyLanguage(view)).resolves.toBe(true);

    const names = treeNodeNames(view);
    expect(names.has("VariableDeclaration")).toBe(true);
    // ADR-0014 T2 B+D: read-only survives the language reconfigure — the
    // facet editing commands consult still reports true after the dispatch.
    expect(view.state.readOnly).toBe(true);
  });

  it("skips the reconfigure when the mount was cancelled first (unmount race)", async () => {
    const { view, setup } = mountCodeFile("body { color: red }", "/ws/app.css");
    await expect(setup.applyLanguage(view, () => true)).resolves.toBe(false);
    // Plain fallback stays: no language facet was installed.
    expect(view.state.facet(language)).toBeNull();
  });
});
