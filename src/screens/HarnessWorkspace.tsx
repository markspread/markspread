// S-TST-009: fixture renderer for the workspace-authoring specs.
// Handles `empty-home`, `workspace-with-content`, and `workspace-with-links`.
// Pure React state — no Tauri IPC required.

import { type KeyboardEvent, useEffect, useState } from "react";
import type { HarnessMode } from "../lib/harness";

type Stage =
  | "empty"
  | "name-prompt"
  | "palette"
  | "folder-name-prompt"
  | "file-name-prompt"
  | "editor"
  | "rename-prompt"
  | "delete-confirm";

interface FsNode {
  name: string;
  kind: "folder" | "file";
  content?: string;
  children?: FsNode[];
}

interface ContextMenuState {
  target: string;
  kind: "folder" | "file";
}

interface TrashEntry {
  parent: string;
  node: FsNode;
}

function findNode(tree: FsNode[], name: string): FsNode | null {
  for (const n of tree) {
    if (n.name === name) return n;
    if (n.children) {
      const r = findNode(n.children, name);
      if (r) return r;
    }
  }
  return null;
}

function setFileContent(tree: FsNode[], name: string, content: string): FsNode[] {
  return tree.map((n) => {
    if (n.name === name && n.kind === "file") return { ...n, content };
    if (n.children) return { ...n, children: setFileContent(n.children, name, content) };
    return n;
  });
}

function removeNode(tree: FsNode[], target: string): { next: FsNode[]; removed: FsNode | null } {
  let removed: FsNode | null = null;
  const walk = (nodes: FsNode[]): FsNode[] =>
    nodes
      .filter((n) => {
        if (n.name === target) {
          removed = n;
          return false;
        }
        return true;
      })
      .map((n) => (n.children ? { ...n, children: walk(n.children) } : n));
  return { next: walk(tree), removed };
}

function rewriteLinks(tree: FsNode[], from: string, to: string): FsNode[] {
  return tree.map((n) => {
    if (n.kind === "file" && n.content) {
      return {
        ...n,
        content: n.content.replaceAll(`[[${from}]]`, `[[${to}]]`),
      };
    }
    if (n.children) return { ...n, children: rewriteLinks(n.children, from, to) };
    return n;
  });
}

function renameNode(tree: FsNode[], from: string, to: string): FsNode[] {
  return tree.map((n) => {
    if (n.name === from) return { ...n, name: to };
    if (n.children) return { ...n, children: renameNode(n.children, from, to) };
    return n;
  });
}

function initialTree(mode: HarnessMode): FsNode[] {
  if (mode === "workspace-with-links") {
    return [
      {
        name: "old-title.md",
        kind: "file",
        content: "# old\n\nSee [[old-title]] for context.\n",
      },
      { name: "scratch.md", kind: "file", content: "# scratch\n" },
      { name: "index.md", kind: "file", content: "Pointer: [[old-title]]\n" },
    ];
  }
  if (mode === "workspace-with-content") {
    return [{ name: "welcome.md", kind: "file", content: "# Welcome\n" }];
  }
  return [];
}

export function HarnessWorkspace({ mode }: { mode: HarnessMode }) {
  const showsHomeFirst = mode === "empty-home";
  const [stage, setStage] = useState<Stage>(showsHomeFirst ? "empty" : "editor");
  const [tree, setTree] = useState<FsNode[]>(() => initialTree(mode));
  const [wsName, setWsName] = useState("");
  const [folderName, setFolderName] = useState("");
  const [fileName, setFileName] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [updateRefs, setUpdateRefs] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [activeFile, setActiveFile] = useState<string>(() => {
    if (mode === "workspace-with-links") return "old-title.md";
    if (mode === "workspace-with-content") return "welcome.md";
    return "";
  });
  const [trash, setTrash] = useState<TrashEntry | null>(null);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setStage("palette");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onCreateWorkspace = () => {
    if (!wsName.trim()) return;
    setStage("editor");
  };

  const onPaletteSelect = () => {
    setPaletteQuery("");
    setStage("folder-name-prompt");
  };

  const onFolderConfirm = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    if (!folderName.trim()) return;
    setTree((t) => [...t, { name: folderName.trim(), kind: "folder", children: [] }]);
    setFolderName("");
    setStage("editor");
  };

  const onFileConfirm = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    if (!fileName.trim() || !menu) return;
    const filename = fileName.trim();
    setTree((t) =>
      t.map((n) =>
        n.name === menu.target
          ? {
              ...n,
              children: [...(n.children ?? []), { name: filename, kind: "file", content: "" }],
            }
          : n,
      ),
    );
    setActiveFile(filename);
    setFileName("");
    setMenu(null);
    setStage("editor");
  };

  const onRenameConfirm = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    if (!renameValue.trim() || !menu) return;
    const from = menu.target;
    const to = renameValue.trim();
    setTree((t) => {
      let next = renameNode(t, from, to);
      if (updateRefs) {
        const fromStem = from.replace(/\.md$/i, "");
        const toStem = to.replace(/\.md$/i, "");
        next = rewriteLinks(next, fromStem, toStem);
      }
      return next;
    });
    if (activeFile === from) setActiveFile(to);
    setRenameValue("");
    setUpdateRefs(false);
    setMenu(null);
    setStage("editor");
  };

  const onConfirmDelete = () => {
    if (!menu) return;
    const target = menu.target;
    const { next, removed } = removeNode(tree, target);
    if (removed) setTrash({ parent: "", node: removed });
    setTree(next);
    if (activeFile === target) setActiveFile("");
    setMenu(null);
    setStage("editor");
  };

  const onUndoDelete = () => {
    if (!trash) return;
    setTree((t) => [...t, trash.node]);
    setTrash(null);
  };

  const onEditorChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!activeFile) return;
    const text = e.target.value;
    setTree((t) => setFileContent(t, activeFile, text));
  };

  const onContextMenu = (e: React.MouseEvent, node: FsNode) => {
    e.preventDefault();
    setMenu({ target: node.name, kind: node.kind });
  };

  const editorContent = activeFile ? (findNode(tree, activeFile)?.content ?? "") : "";

  const spreadHtml = editorContent
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l, i) => {
      const key = `${i}-${l}`;
      if (l.startsWith("# ")) {
        return <h1 key={key}>{l.slice(2)}</h1>;
      }
      return <p key={key}>{l}</p>;
    });

  return (
    <div data-testid="workspace-shell">
      {stage === "empty" && (
        <div>
          <button type="button" onClick={() => setStage("name-prompt")}>
            Create new workspace
          </button>
        </div>
      )}

      {stage === "name-prompt" && (
        <div role="dialog">
          <label>
            Workspace name
            <input value={wsName} onChange={(e) => setWsName(e.target.value)} />
          </label>
          <button type="button" onClick={onCreateWorkspace}>
            Create
          </button>
        </div>
      )}

      {stage !== "empty" && stage !== "name-prompt" && (
        <div style={{ display: "flex", gap: "1rem" }}>
          <ul role="tree" aria-label="files">
            {tree.map((n) => (
              <li
                key={n.name}
                role="treeitem"
                aria-label={n.name}
                aria-selected={activeFile === n.name}
                onContextMenu={(e) => onContextMenu(e, n)}
                onClick={() => {
                  if (n.kind === "file") setActiveFile(n.name);
                }}
              >
                {n.name}
                {n.children && (
                  <ul role="group">
                    {n.children.map((c) => (
                      <li
                        key={c.name}
                        role="treeitem"
                        aria-label={c.name}
                        onContextMenu={(e) => onContextMenu(e, c)}
                      >
                        {c.name}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          <div style={{ flex: 1 }}>
            <textarea
              data-testid="editor-surface"
              value={editorContent}
              onChange={onEditorChange}
              style={{ width: "100%", minHeight: 200 }}
            />
            <div data-testid="spread-pane">{spreadHtml}</div>
          </div>
        </div>
      )}

      {menu && stage !== "rename-prompt" && stage !== "delete-confirm" && (
        <div role="menu" aria-label="context">
          {menu.kind === "folder" && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setStage("file-name-prompt");
              }}
            >
              New file
            </button>
          )}
          {menu.kind === "file" && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setRenameValue(menu.target);
                  setStage("rename-prompt");
                }}
              >
                Rename
              </button>
              <button type="button" role="menuitem" onClick={() => setStage("delete-confirm")}>
                Delete
              </button>
            </>
          )}
        </div>
      )}

      {stage === "palette" && (
        <div role="dialog" aria-label="palette">
          <input
            type="text"
            aria-label="command"
            value={paletteQuery}
            onChange={(e) => setPaletteQuery(e.target.value)}
          />
          <ul role="listbox">
            <li role="option" aria-label="New folder" onClick={onPaletteSelect}>
              New folder
            </li>
          </ul>
        </div>
      )}

      {stage === "folder-name-prompt" && (
        <div role="dialog">
          <label>
            Folder name
            <input
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              onKeyDown={onFolderConfirm}
              autoFocus
            />
          </label>
        </div>
      )}

      {stage === "file-name-prompt" && (
        <div role="dialog">
          <label>
            File name
            <input
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              onKeyDown={onFileConfirm}
              autoFocus
            />
          </label>
        </div>
      )}

      {stage === "rename-prompt" && (
        <div
          role="dialog"
          onKeyDown={(e) => {
            if (e.key === "Enter") onRenameConfirm(e as unknown as KeyboardEvent<HTMLInputElement>);
          }}
        >
          <label>
            New name
            <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
          </label>
          <label>
            <input
              type="checkbox"
              checked={updateRefs}
              onChange={(e) => setUpdateRefs(e.target.checked)}
              aria-label="update references"
            />
            Update references
          </label>
        </div>
      )}

      {stage === "delete-confirm" && (
        <div role="dialog">
          <p>Delete this file?</p>
          <button type="button" onClick={onConfirmDelete}>
            Move to trash
          </button>
        </div>
      )}

      {trash && (
        <div role="status">
          <span>Moved to trash.</span>
          <button type="button" onClick={onUndoDelete}>
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
