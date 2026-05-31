// ADR-0014 (T2.g): File tree filter 테스트.

import { describe, expect, it } from "vitest";
import { fromWorkspaceFiles } from "../multi-layer-ignore";
import {
  type TreeNode,
  createTransientVisibility,
  filterFlatList,
  filterTree,
  isDocumentFile,
  shouldShow,
} from "../tree-filter";

const ROOT = "/ws";

function dir(name: string, children: TreeNode[] = []): TreeNode {
  return { path: `${ROOT}/${name}`, name, isDirectory: true, children };
}

function file(name: string, parent = ROOT): TreeNode {
  return { path: `${parent}/${name}`, name, isDirectory: false };
}

describe("isDocumentFile", () => {
  it("recognises builtin md extensions", () => {
    expect(isDocumentFile("README.md", [])).toBe(true);
    expect(isDocumentFile("note.mdx", [])).toBe(true);
    expect(isDocumentFile("file.markdown", [])).toBe(true);
  });

  it("rejects non-doc extensions", () => {
    expect(isDocumentFile("script.ts", [])).toBe(false);
    expect(isDocumentFile("data.json", [])).toBe(false);
    expect(isDocumentFile("image.png", [])).toBe(false);
  });

  it("promotes active parser extensions", () => {
    expect(isDocumentFile("doc.rst", [".rst"])).toBe(true);
    expect(isDocumentFile("notes.org", [".org", ".adoc"])).toBe(true);
    expect(isDocumentFile("script.ts", [".rst"])).toBe(false);
  });

  it("case-insensitive", () => {
    expect(isDocumentFile("README.MD", [])).toBe(true);
    expect(isDocumentFile("DOC.RST", [".rst"])).toBe(true);
  });
});

describe("shouldShow — md-only mode", () => {
  it("md file visible", () => {
    expect(shouldShow(file("README.md"), { mode: "md-only" })).toBe(true);
  });

  it("non-md file hidden", () => {
    expect(shouldShow(file("script.ts"), { mode: "md-only" })).toBe(false);
  });

  it("folder always visible (md-only mode)", () => {
    expect(shouldShow(dir("src"), { mode: "md-only" })).toBe(true);
  });

  it("empty folder visible (T2.g — 새 폴더 만들기 UX)", () => {
    expect(shouldShow(dir("new-folder", []), { mode: "md-only" })).toBe(true);
  });

  it("active parser extension promoted to visible", () => {
    expect(shouldShow(file("doc.rst"), { mode: "md-only", activeParserExtensions: [".rst"] })).toBe(
      true,
    );
  });

  it("transient visibility lifts md-only block", () => {
    const transient = new Set([`${ROOT}/created.ts`]);
    expect(shouldShow(file("created.ts"), { mode: "md-only", transientlyVisible: transient })).toBe(
      true,
    );
  });
});

describe("shouldShow — all mode", () => {
  it("all files visible", () => {
    expect(shouldShow(file("README.md"), { mode: "all" })).toBe(true);
    expect(shouldShow(file("script.ts"), { mode: "all" })).toBe(true);
    expect(shouldShow(file("data.json"), { mode: "all" })).toBe(true);
  });
});

describe("shouldShow — ignore takes precedence", () => {
  it("ignored file hidden regardless of mode", () => {
    const ignore = fromWorkspaceFiles(ROOT, { gitignore: "*.log\n" });
    expect(shouldShow(file("debug.log"), { mode: "all", ignore })).toBe(false);
    expect(shouldShow(file("debug.log"), { mode: "md-only", ignore })).toBe(false);
  });

  it("ignored folder hidden", () => {
    const ignore = fromWorkspaceFiles(ROOT, { gitignore: "node_modules\n" });
    expect(shouldShow(dir("node_modules"), { mode: "all", ignore })).toBe(false);
  });
});

describe("filterTree — recursive", () => {
  it("filters out hidden files but keeps the folder", () => {
    const tree = dir("src", [file("README.md", `${ROOT}/src`), file("a.ts", `${ROOT}/src`)]);
    const filtered = filterTree(tree, { mode: "md-only" });
    expect(filtered).not.toBeNull();
    if (!filtered) return;
    expect(filtered.children?.map((c) => c.name)).toEqual(["README.md"]);
  });

  it("returns null when ignore hides the node", () => {
    const ignore = fromWorkspaceFiles(ROOT, { gitignore: "node_modules\n" });
    const node = dir("node_modules", [file("pkg.json", `${ROOT}/node_modules`)]);
    expect(filterTree(node, { mode: "all", ignore })).toBeNull();
  });

  it("directory without children property yields empty children array", () => {
    const node: TreeNode = { path: `${ROOT}/lazy`, name: "lazy", isDirectory: true };
    const filtered = filterTree(node, { mode: "md-only" });
    expect(filtered).not.toBeNull();
    expect(filtered?.children).toEqual([]);
  });

  it("deep nesting filtered", () => {
    const tree = dir("a", [
      dir("b", [file("README.md", `${ROOT}/a/b`), file("c.ts", `${ROOT}/a/b`)]),
    ]);
    const filtered = filterTree(tree, { mode: "md-only" });
    expect(filtered?.children?.[0]?.children?.map((c) => c.name)).toEqual(["README.md"]);
  });
});

describe("filterFlatList", () => {
  it("filters flat list with same rules", () => {
    const list = [file("a.md"), file("b.ts"), file("c.markdown")];
    const filtered = filterFlatList(list, { mode: "md-only" });
    expect(filtered.map((n) => n.name)).toEqual(["a.md", "c.markdown"]);
  });
});

describe("createTransientVisibility", () => {
  it("add/remove/set lifecycle", () => {
    const t = createTransientVisibility();
    expect(t.set().size).toBe(0);
    t.add("/ws/a.ts");
    t.add("/ws/b.ts");
    expect(t.set().size).toBe(2);
    t.remove("/ws/a.ts");
    expect(t.set().has("/ws/a.ts")).toBe(false);
    expect(t.set().has("/ws/b.ts")).toBe(true);
  });

  it("set() returns defensive copy", () => {
    const t = createTransientVisibility();
    t.add("/ws/x");
    const snap = t.set();
    snap.add("/ws/y");
    expect(t.set().has("/ws/y")).toBe(false);
  });
});
