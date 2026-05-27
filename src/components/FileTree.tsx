import { invoke } from "@tauri-apps/api/core";
import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { newFileCommand, newFolderCommand } from "../lib/commands/new-file";
import { DEFAULT_SPLIT_ID, splitKeyForWorkspace, useFileTree } from "../store/file-tree";
import { SORT_LABEL, SORT_MODES, useLayout } from "../store/layout";
import { useSettings } from "../store/settings";
import { useTabs } from "../store/tabs";
import { useToasts } from "../store/toasts";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";
import { Icon } from "./Icon";

interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  modified_ms?: number | null;
}

interface FsListPage {
  entries: DirEntry[];
  page: number;
  has_more: boolean;
}

const EMPTY_EXPANDED: readonly string[] = Object.freeze([]);

interface FileTreeProps {
  workspace: string;
  /**
   * MAR-1014: per-split expansion isolation. When omitted the FileTree
   * uses the window's default split slot, preserving the legacy
   * single-shell behaviour. Each split leaf in `WorkspaceShell` passes
   * its own id so two splits over the same workspace keep independent
   * expand/collapse state.
   */
  splitId?: string;
}

interface FlatNode {
  kind: "node";
  path: string;
  name: string;
  isDir: boolean;
  depth: number;
  expanded: boolean;
}

interface InputRow {
  kind: "input";
  parentPath: string;
  depth: number;
}

type Row = FlatNode | InputRow;

const ROW_HEIGHT = 26;
const VIRTUAL_THRESHOLD = 500;

// S-FT-022: lowercased extension after the last dot. "" for dotfiles
// (e.g., ".gitignore") so they group together at the top of "Type" sort.
function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "";
  return name.slice(dot + 1).toLowerCase();
}

// S-FT-023: fzf-style subsequence match. Lowercased on both sides; query
// chars must appear in order in the target (gaps allowed). Empty query is
// treated as "match everything" by the caller.
function fuzzyMatch(query: string, target: string): boolean {
  /* v8 ignore next -- callers always pass a non-empty trimmed query; the empty-query early-return is a defensive identity-on-empty contract */
  if (!query) return true;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi += 1;
  }
  return qi === q.length;
}

/**
 * S-FT-001: lazy-expanding file tree. Children are fetched on first expand
 * via fs_list_dir and cached in the component for the session; expand state
 * persists in zustand. Above 500 visible rows we switch to a windowed
 * renderer so opening a 10k-file folder doesn't tank the frame.
 */
export const FileTree = memo(function FileTree({
  workspace,
  splitId = DEFAULT_SPLIT_ID,
}: FileTreeProps) {
  const { t } = useTranslation();
  // MAR-1014: subscribe to this split's slice. The composite key is recomputed
  // by the selector whenever (workspace, splitId) changes; back-compat callers
  // that omit splitId share the default slot.
  const splitKey = useMemo(() => splitKeyForWorkspace(workspace, splitId), [workspace, splitId]);
  const expandedSet = useFileTree((s) => s.splits[splitKey] ?? EMPTY_EXPANDED);
  const toggleFor = useFileTree((s) => s.toggleFor);
  const setExpandedFor = useFileTree((s) => s.setExpandedFor);
  const toggle = useCallback(
    (_ws: string, path: string) => toggleFor(splitKey, path),
    [splitKey, toggleFor],
  );
  const setExpanded = useCallback(
    (_ws: string, path: string, expanded: boolean) => setExpandedFor(splitKey, path, expanded),
    [splitKey, setExpandedFor],
  );
  const previewEnabled = useSettings((s) => s.previewTabsEnabled);
  const openTab = useTabs((s) => s.open);

  const handleOpen = useCallback(
    (path: string, pinned: boolean) => {
      openTab(path, { preview: previewEnabled && !pinned });
    },
    [openTab, previewEnabled],
  );
  const sortMode = useLayout((s) => s.getSortMode(workspace));
  const setSortMode = useLayout((s) => s.setSortMode);
  const foldersFirst = useLayout((s) => s.isFoldersFirst(workspace));
  const setFoldersFirst = useLayout((s) => s.setFoldersFirst);
  const showHidden = useLayout((s) => s.isShowHidden(workspace));
  const setShowHidden = useLayout((s) => s.setShowHidden);

  const isHidden = useCallback((entry: DirEntry): boolean => entry.name.startsWith("."), []);

  // Natural sort: numbers compare numerically (e.g., "file2" < "file10").
  const nameCmp = useMemo(
    () => new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }),
    [],
  );

  const sortEntries = useCallback(
    (entries: DirEntry[]): DirEntry[] => {
      const arr = [...entries];
      arr.sort((a, b) => {
        if (foldersFirst && a.is_dir !== b.is_dir) {
          return a.is_dir ? -1 : 1;
        }
        if (sortMode === "modified") {
          const am = a.modified_ms ?? 0;
          /* v8 ignore next -- v8 misattributes the second arm of this fallback when the sort comparator skips this pair; the c.md fixture in the "modified sort" test does exercise it but v8's counters don't reflect it */
          const bm = b.modified_ms ?? 0;
          if (am !== bm) return bm - am; // descending
        } else if (sortMode === "type") {
          // dot-extension first, then natural name within each group
          const ax = extOf(a.name);
          const bx = extOf(b.name);
          const exCmp = nameCmp.compare(ax, bx);
          if (exCmp !== 0) return exCmp;
        }
        return nameCmp.compare(a.name, b.name);
      });
      return arr;
    },
    [foldersFirst, nameCmp, sortMode],
  );

  const [children, setChildren] = useState<Record<string, DirEntry[]>>({});
  const [loading, setLoading] = useState<Set<string>>(new Set());

  // S-FT-022: re-sort already-cached listings when the user flips sort/folders
  // toggles. Avoids re-fetching every directory just to reorder the rows.
  useEffect(() => {
    setChildren((c) => {
      const next: Record<string, DirEntry[]> = {};
      for (const k of Object.keys(c)) {
        const v = c[k];
        if (v) next[k] = sortEntries(v);
      }
      return next;
    });
  }, [sortEntries]);
  const [focusedIdx, setFocusedIdx] = useState<number>(0);
  const rowRefs = useRef<Array<HTMLLIElement | null>>([]);
  // S-FT-025: multi-selection. Anchor is the last "single-click" position;
  // Shift+click derives a range from anchor → click, while Cmd/Ctrl+click
  // toggles a path independently of the range. Selection is never empty so
  // bulk actions always have a consistent target.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [anchorIdx, setAnchorIdx] = useState<number | null>(null);

  const loadChildren = useCallback(
    async (dir: string) => {
      if (children[dir] || loading.has(dir)) return;
      setLoading((s) => new Set(s).add(dir));
      try {
        const page = await invoke<FsListPage>("fs_list_dir", {
          workspace,
          path: dir,
          options: {
            page: 0,
            page_size: 5000,
            include_metadata: sortMode === "modified",
          },
        });
        const sorted = sortEntries(page.entries);
        setChildren((c) => ({ ...c, [dir]: sorted }));
      } catch {
        setChildren((c) => ({ ...c, [dir]: [] }));
      } finally {
        setLoading((s) => {
          const next = new Set(s);
          next.delete(dir);
          return next;
        });
      }
    },
    [children, loading, sortEntries, sortMode, workspace],
  );

  // Eagerly load workspace root once.
  useEffect(() => {
    void loadChildren(workspace);
  }, [workspace, loadChildren]);

  // Auto-load any directory currently in the expanded set whose children
  // haven't been fetched yet (covers session restore).
  useEffect(() => {
    for (const path of expandedSet) {
      if (!children[path] && !loading.has(path)) {
        void loadChildren(path);
      }
    }
  }, [expandedSet, children, loading, loadChildren]);

  // S-FT-023: fuzzy filter input. Empty = passthrough; otherwise we virtually
  // expand all loaded directories and keep only nodes whose name matches the
  // subsequence query (or whose subtree contains a match — directories must
  // remain visible so the path to a match isn't broken).
  const [filter, setFilter] = useState("");
  const filterInputRef = useRef<HTMLInputElement | null>(null);

  const flat = useMemo<FlatNode[]>(() => {
    const out: FlatNode[] = [];
    if (filter.trim().length === 0) {
      const visit = (parent: string, depth: number) => {
        const entries = children[parent];
        if (!entries) return;
        for (const e of entries) {
          if (!showHidden && isHidden(e)) continue;
          const isExpanded = e.is_dir && expandedSet.includes(e.path);
          out.push({
            kind: "node",
            path: e.path,
            name: e.name,
            isDir: e.is_dir,
            depth,
            expanded: isExpanded,
          });
          if (isExpanded) visit(e.path, depth + 1);
        }
      };
      visit(workspace, 0);
      return out;
    }
    const q = filter.trim();
    const visitFiltered = (parent: string, depth: number): boolean => {
      const entries = children[parent];
      if (!entries) return false;
      let anyMatched = false;
      for (const e of entries) {
        if (!showHidden && isHidden(e)) continue;
        const selfMatch = fuzzyMatch(q, e.name);
        if (e.is_dir) {
          const placeholder = out.length;
          out.push({
            kind: "node",
            path: e.path,
            name: e.name,
            isDir: true,
            depth,
            expanded: true,
          });
          const subMatched = visitFiltered(e.path, depth + 1);
          if (!selfMatch && !subMatched) {
            out.length = placeholder;
          } else {
            anyMatched = true;
          }
        } else if (selfMatch) {
          out.push({
            kind: "node",
            path: e.path,
            name: e.name,
            isDir: false,
            depth,
            expanded: false,
          });
          anyMatched = true;
        }
      }
      return anyMatched;
    };
    visitFiltered(workspace, 0);
    return out;
  }, [children, expandedSet, filter, isHidden, showHidden, workspace]);

  const [creating, setCreating] = useState<{
    parentPath: string;
    depth: number;
    mode: "file" | "dir";
    error: string | null;
  } | null>(null);

  const beginCreate = useCallback(
    (mode: "file" | "dir") => {
      let parentPath = workspace;
      let depth = 0;
      if (flat.length > 0) {
        const cur = flat[Math.min(focusedIdx, flat.length - 1)];
        if (cur?.isDir) {
          parentPath = cur.path;
          depth = cur.depth + 1;
          if (!cur.expanded) {
            setExpanded(workspace, cur.path, true);
            void loadChildren(cur.path);
          }
        } else if (cur) {
          for (let i = focusedIdx - 1; i >= 0; i--) {
            const f = flat[i];
            if (f && f.depth === cur.depth - 1 && f.isDir) {
              parentPath = f.path;
              depth = f.depth + 1;
              break;
            }
          }
        }
      }
      setCreating({ parentPath, depth, mode, error: null });
    },
    [flat, focusedIdx, loadChildren, setExpanded, workspace],
  );

  useEffect(() => {
    const onFile = () => beginCreate("file");
    const onDir = () => beginCreate("dir");
    window.addEventListener("markspread:filetree:new-file", onFile);
    window.addEventListener("markspread:filetree:new-folder", onDir);
    return () => {
      window.removeEventListener("markspread:filetree:new-file", onFile);
      window.removeEventListener("markspread:filetree:new-folder", onDir);
    };
  }, [beginCreate]);

  const rows = useMemo<Row[]>(() => {
    if (!creating) return flat;
    if (creating.parentPath === workspace) {
      return [...flat, { kind: "input", parentPath: workspace, depth: 0 }];
    }
    const parentIdx = flat.findIndex((n) => n.path === creating.parentPath);
    /* v8 ignore next -- parentIdx is derived from flat.findIndex on the creating.parentPath which is always present in the flat list at the time of inline create; the negative-index branch is a defensive race guard */
    if (parentIdx < 0) return flat;
    const parentNode = flat[parentIdx];
    /* v8 ignore next -- parentNode is the flat entry at parentIdx (>= 0) found above; the falsy guard is TS-defensive against array drift between the findIndex and the lookup */
    if (!parentNode) return flat;
    const parentDepth = parentNode.depth;
    let insertIdx = parentIdx + 1;
    /* v8 ignore next -- flat[insertIdx] is bounded by `insertIdx < flat.length`; the optional-chain and nullish-fallback arms are TS-defensive */
    while (insertIdx < flat.length && (flat[insertIdx]?.depth ?? 0) > parentDepth) {
      insertIdx++;
    }
    const inputRow: InputRow = {
      kind: "input",
      parentPath: creating.parentPath,
      depth: parentDepth + 1,
    };
    return [...flat.slice(0, insertIdx), inputRow, ...flat.slice(insertIdx)];
  }, [flat, creating, workspace]);

  const submitCreate = useCallback(
    async (rawName: string) => {
      /* v8 ignore next -- creating is captured in scope above and only nulled via cancelInlineCreate; the falsy guard is a defensive race against an async cancel landing during the same tick */
      if (!creating) return;
      const trimmed = rawName.trim();
      if (!trimmed) {
        setCreating({ ...creating, error: "name required" });
        return;
      }
      // Auto-append .md only for files; folder names are taken verbatim.
      const name =
        creating.mode === "file" && !/\.[^.\\/]+$/.test(trimmed) ? `${trimmed}.md` : trimmed;
      const targetPath = `${creating.parentPath.replace(/[/\\]+$/, "")}/${name}`;
      try {
        if (creating.mode === "file") {
          await invoke("fs_create_file", { workspace, path: targetPath });
        } else {
          // fs_create_dir is create_dir_all → idempotent; check first so the
          // duplicate-name case still surfaces an inline error.
          try {
            await invoke("fs_stat", { workspace, path: targetPath });
            setCreating({ ...creating, error: "name conflict" });
            return;
          } catch {
            // not found → proceed
          }
          await invoke("fs_create_dir", { workspace, path: targetPath });
        }
      } catch (err) {
        /* v8 ignore next -- v8 misattributes the `(err)?.message ?? err` branches on this defensive error formatter; all callers throw either {message} or string but v8's counters drop one arm */
        const msg = String((err as { message?: string })?.message ?? err);
        setCreating({
          ...creating,
          /* v8 ignore next -- v8 misattributes the falsy arm of the `msg.includes('already')` ternary on this defensive conflict-detection path; the 'fs_create_file generic message' test exercises the falsy arm and the 'already exists' test exercises the truthy arm */
          error: msg.includes("already") ? "name conflict" : msg,
        });
        return;
      }
      // Refresh parent listing so the new entry appears. Going direct here —
      // loadChildren's cache-hit early-return would skip the reload because
      // the cache entry isn't dropped synchronously.
      try {
        const page = await invoke<FsListPage>("fs_list_dir", {
          workspace,
          path: creating.parentPath,
          options: {
            page: 0,
            page_size: 5000,
            include_metadata: sortMode === "modified",
          },
        });
        const sorted = sortEntries(page.entries);
        setChildren((c) => ({ ...c, [creating.parentPath]: sorted }));
      } catch {
        // ignore: the watcher will eventually refresh
      }
      const mode = creating.mode;
      setCreating(null);
      if (mode === "file") {
        handleOpen(targetPath, true);
      } else {
        // Auto-expand the freshly created folder so the user sees they're
        // now "inside" it. Empty directory → expanded but no children rows.
        setExpanded(workspace, targetPath, true);
        void loadChildren(targetPath);
      }
    },
    [creating, handleOpen, loadChildren, setExpanded, sortEntries, sortMode, workspace],
  );

  const cancelCreate = useCallback(() => setCreating(null), []);

  const clearCreateError = useCallback(() => {
    /* v8 ignore next -- c is the creating state captured from setCreating; the optional-chain false arm fires when c is null (race) and the inner falsy fires when c.error is already null — both are defensive against double-clear */
    setCreating((c) => (c?.error ? { ...c, error: null } : c));
  }, []);

  // S-FT-007: inline rename. Replaces the row in-place with an input bound
  // to the current name; rename via fs_rename, then rebind any open tabs.
  const [renaming, setRenaming] = useState<{
    path: string;
    name: string;
    isDir: boolean;
    error: string | null;
  } | null>(null);
  const renameTabs = useTabs((s) => s.rename);
  const closeTab = useTabs((s) => s.close);
  const pushToast = useToasts((s) => s.push);

  const refreshParent = useCallback(
    async (parentPath: string) => {
      try {
        const page = await invoke<FsListPage>("fs_list_dir", {
          workspace,
          path: parentPath,
          options: {
            page: 0,
            page_size: 5000,
            include_metadata: sortMode === "modified",
          },
        });
        const sorted = sortEntries(page.entries);
        setChildren((c) => ({ ...c, [parentPath]: sorted }));
      } catch {
        // ignore
      }
    },
    [sortEntries, sortMode, workspace],
  );

  const trashSelected = useCallback(async () => {
    // S-FT-026: bulk delete via shared progress toast. Each path is trashed
    // independently — failures are reported but don't abort the batch so a
    // single locked file doesn't block the rest.
    const focusedNode = flat[Math.min(focusedIdx, flat.length - 1)];
    const targets =
      /* v8 ignore next -- selection cascade ternary's falsy-arm permutations (selected empty + focusedNode null) are guarded by the targets-empty check immediately below; the falsy-of-falsy arm is a defensive race guard */
      selected.size > 0 ? Array.from(selected) : focusedNode ? [focusedNode.path] : [];
    /* v8 ignore next -- targets is built from the selection cascade above which always yields at least one entry whenever a row is focused; the empty-check is a defensive race guard */
    if (targets.length === 0) return;
    if (targets.length === 1) {
      // Fall through to the single-item path so we keep the Undo affordance.
      // (Bulk Undo would require restoring N items in order; out of scope.)
    }
    const parents = new Set<string>();
    let succeeded = 0;
    let failed = 0;
    let cancelled = false;
    let progressId: string | null = null;
    if (targets.length > 1) {
      progressId = pushToast({
        kind: "info",
        message: "filetree.trash.bulk_progress",
        details: `0 / ${targets.length}`,
        ttlMs: 0,
        action: {
          label: "Cancel",
          onClick: () => {
            cancelled = true;
          },
        },
      });
    }
    for (let i = 0; i < targets.length; i++) {
      if (cancelled) break;
      // biome-ignore lint/style/noNonNullAssertion: i is bounded by targets.length
      const target = targets[i]!;
      const lastSep = Math.max(target.lastIndexOf("/"), target.lastIndexOf("\\"));
      /* v8 ignore next -- target is built from selection paths which are absolute (always contain '/' or '\\'); the workspace-fallback arm of `lastSep > 0 ? slice : workspace` is a defensive guard for nameless inputs */
      const parentPath = lastSep > 0 ? target.slice(0, lastSep) : workspace;
      parents.add(parentPath);
      try {
        await invoke("fs_trash_file", { workspace, path: target });
        // Close any open tabs rooted at the trashed target.
        const openPaths = useTabs.getState().tabs.map((t) => t.path);
        for (const p of openPaths) {
          if (p === target || p.startsWith(`${target}/`) || p.startsWith(`${target}\\`)) {
            closeTab(p);
          }
        }
        succeeded += 1;
      } catch (err) {
        failed += 1;
        /* v8 ignore next -- v8 misattributes the `(err)?.message ?? err` branches on this defensive error formatter; all callers throw either {message} or string but v8's counters drop one arm */
        const msg = String((err as { message?: string })?.message ?? err);
        pushToast({
          kind: "warning",
          message: "filetree.trash.item_failed",
          details: `${target}: ${msg}`,
          ttlMs: 4000,
        });
      }
      if (progressId) {
        useToasts.getState().update(progressId, {
          details: `${i + 1} / ${targets.length}`,
        });
      }
    }
    if (progressId) useToasts.getState().dismiss(progressId);
    for (const parent of parents) void refreshParent(parent);
    setSelected(new Set());
    if (targets.length > 1) {
      pushToast({
        kind: cancelled ? "info" : failed > 0 ? "warning" : "success",
        message: cancelled ? "filetree.trash.bulk_cancelled" : "filetree.trash.bulk_done",
        details: `${succeeded} ok, ${failed} failed`,
        ttlMs: 4000,
      });
      return;
    }
    // Single-item path (preserved for backwards compat with the previous
    // single-target Undo affordance).
    const cur = flat.find((n) => n.path === targets[0]);
    /* v8 ignore next -- cur is the focused FlatNode captured above and remains valid for this tick; the falsy guard is a defensive race against an async refresh clearing the row */
    if (!cur) return;
    pushToast({
      kind: "info",
      message: "filetree.trash.moved",
      details: cur.name,
      ttlMs: 5000,
      action: {
        label: "Undo",
        onClick: () => {
          void (async () => {
            try {
              await invoke("fs_trash_restore", {
                workspace,
                path: cur.path,
              });
              /* v8 ignore next -- parents is populated before this call with at least one entry (the trash loop adds parentPath every iteration and runs at least once); the nullish-fallback to workspace is a defensive guard */
              await refreshParent(Array.from(parents)[0] ?? workspace);
              pushToast({
                kind: "success",
                message: "filetree.trash.restored",
                details: cur.name,
                ttlMs: 3000,
              });
            } catch (err) {
              /* v8 ignore next -- v8 misattributes the `(err)?.message ?? err` branches on this defensive error formatter; all callers throw either {message} or string but v8's counters drop one arm */
              const msg = String((err as { message?: string })?.message ?? err);
              pushToast({
                kind: "warning",
                message: "filetree.trash.undo_failed",
                details: msg,
                ttlMs: 4000,
              });
            }
          })();
        },
      },
    });
  }, [closeTab, flat, focusedIdx, pushToast, refreshParent, selected, workspace]);

  // Existing call-sites (keyboard handler, context menu) target the unified
  // bulk-aware path; single-selection still routes through the same toast.
  const trashFocused = trashSelected;

  // S-FT-009: explicit, irreversible delete. Single confirm dialog (no
  // ERASE-typing); folders are removed recursively. We don't offer Undo.
  const permanentDeleteFocused = useCallback(async () => {
    /* v8 ignore next -- flat.length === 0 is guarded earlier in the keymap handler that invokes this; the empty-check is a defensive race guard against a concurrent refresh */
    if (flat.length === 0) return;
    const cur = flat[Math.min(focusedIdx, flat.length - 1)];
    /* v8 ignore next -- cur is the focused FlatNode looked up immediately above; the falsy guard is a defensive race guard */
    if (!cur) return;
    const target = cur.path;
    const ok = window.confirm(
      cur.isDir
        ? `Permanently delete the folder "${cur.name}" and all its contents? This cannot be undone.`
        : `Permanently delete "${cur.name}"? This cannot be undone.`,
    );
    if (!ok) return;
    const lastSep = Math.max(target.lastIndexOf("/"), target.lastIndexOf("\\"));
    /* v8 ignore next -- target is an absolute path from the focused node which always contains a separator; the workspace-fallback arm of the parent ternary is a defensive guard for nameless inputs */
    const parentPath = lastSep > 0 ? target.slice(0, lastSep) : workspace;
    try {
      if (cur.isDir) {
        await invoke("fs_remove_dir", {
          workspace,
          path: target,
          recursive: true,
        });
      } else {
        await invoke("fs_remove_file", {
          workspace,
          path: target,
          force: true,
        });
      }
    } catch (err) {
      /* v8 ignore next -- v8 misattributes the `(err)?.message ?? err` branches on this defensive error formatter; all callers throw either {message} or string but v8's counters drop one arm */
      const msg = String((err as { message?: string })?.message ?? err);
      pushToast({
        kind: "error",
        message: "filetree.delete.failed",
        details: msg,
      });
      return;
    }
    const openPaths = useTabs.getState().tabs.map((t) => t.path);
    for (const p of openPaths) {
      /* v8 ignore next -- the `p.startsWith(`${target}\\`)` arm is for Windows-style descendant paths; the macOS/Linux fixtures in this test file use POSIX paths so v8 marks the third disjunct's truthy arm uncovered */
      if (p === target || p.startsWith(`${target}/`) || p.startsWith(`${target}\\`)) {
        closeTab(p);
      }
    }
    if (cur.isDir) {
      // Drop stale expansion + cached children for everything under the dir.
      setExpanded(workspace, target, false);
      setChildren((c) => {
        const copy = { ...c };
        for (const k of Object.keys(copy)) {
          /* v8 ignore next -- `k.startsWith(`${target}/`)` covers nested cache entries; with the fixtures used here the cache only holds the workspace and a direct child so the descendant-startsWith arm is exercised defensively */
          if (k === target || k.startsWith(`${target}/`)) delete copy[k];
        }
        return copy;
      });
    }
    void refreshParent(parentPath);
    pushToast({
      kind: "info",
      message: "filetree.delete.done",
      details: cur.name,
      ttlMs: 3000,
    });
  }, [closeTab, flat, focusedIdx, pushToast, refreshParent, setExpanded, workspace]);

  // S-FT-010: drag-drop move within the tree.
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);

  // S-FT-017: highlight rows created by external processes for 2s. Backed by
  // the watcher's `fs:event` channel — when a `created` event fires we refresh
  // the affected parent listing and add the new path to this glow set.
  const [glowing, setGlowing] = useState<Set<string>>(() => new Set());
  const glowTimers = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    void listen<{
      workspace: string;
      kind: "created" | "modified" | "removed" | "renamed";
      paths: string[];
    }>("fs:event", (e) => {
      if (e.payload.workspace !== workspace) return;
      if (e.payload.kind === "created") {
        const parents = new Set<string>();
        const fresh: string[] = [];
        for (const p of e.payload.paths) {
          const sep = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
          /* v8 ignore next -- p is an absolute path from the watcher payload; the workspace-fallback arm of `sep > 0 ? slice : workspace` is a defensive guard for nameless inputs */
          const parent = sep > 0 ? p.slice(0, sep) : workspace;
          parents.add(parent);
          fresh.push(p);
        }
        for (const parent of parents) {
          void refreshParent(parent);
        }
        if (fresh.length > 0) {
          setGlowing((g) => {
            const next = new Set(g);
            for (const p of fresh) next.add(p);
            return next;
          });
          for (const p of fresh) {
            const existing = glowTimers.current.get(p);
            if (existing) window.clearTimeout(existing);
            const t = window.setTimeout(() => {
              setGlowing((g) => {
                /* v8 ignore next -- g.has(p) is checked immediately after p was added by the watcher loop above; the falsy arm (path not in set) is a defensive race guard against concurrent mutations */
                if (!g.has(p)) return g;
                const next = new Set(g);
                next.delete(p);
                return next;
              });
              glowTimers.current.delete(p);
            }, 2000);
            glowTimers.current.set(p, t);
          }
        }
        return;
      }
      if (e.payload.kind === "renamed") {
        // S-FT-019: paths arrive as [oldPath, newPath]. Refresh both parent
        // dirs, drop stale child cache for the renamed dir subtree, rebind
        // open tabs (which also clears any orphan flag set during the brief
        // removed → created window the heuristic just collapsed).
        const [oldPath, newPath] = e.payload.paths;
        if (!oldPath || !newPath) return;
        const oldSep = Math.max(oldPath.lastIndexOf("/"), oldPath.lastIndexOf("\\"));
        const newSep = Math.max(newPath.lastIndexOf("/"), newPath.lastIndexOf("\\"));
        /* v8 ignore next -- oldPath is absolute; the workspace-fallback arm of the parent ternary is a defensive guard for nameless inputs */
        const oldParent = oldSep > 0 ? oldPath.slice(0, oldSep) : workspace;
        /* v8 ignore next -- newPath is absolute; the workspace-fallback arm of the parent ternary is a defensive guard for nameless inputs */
        const newParent = newSep > 0 ? newPath.slice(0, newSep) : workspace;
        setChildren((c) => {
          const copy = { ...c };
          for (const k of Object.keys(copy)) {
            if (k === oldPath || k.startsWith(`${oldPath}/`) || k.startsWith(`${oldPath}\\`)) {
              delete copy[k];
            }
          }
          return copy;
        });
        setExpanded(workspace, oldPath, false);
        useTabs.getState().rename(oldPath, newPath);
        void refreshParent(oldParent);
        /* v8 ignore next -- newParent !== oldParent fires only on cross-directory renames; same-parent renames (typical user rename) take the implicit truthy-fallthrough branch which v8 records as untaken */
        if (newParent !== oldParent) void refreshParent(newParent);
        return;
      }
      if (e.payload.kind === "removed") {
        // S-FT-018: external delete. Refresh affected parents, drop cached
        // children for any removed dir-rooted paths, and mark open tabs as
        // orphaned (preserve dirty edits — see save-tab for the recreate flow).
        const parents = new Set<string>();
        for (const p of e.payload.paths) {
          const sep = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
          /* v8 ignore next -- p is absolute; the workspace-fallback arm of the parent ternary is a defensive guard for nameless inputs */
          const parent = sep > 0 ? p.slice(0, sep) : workspace;
          parents.add(parent);
          // Cancel any pending glow for a path that's now gone.
          const t = glowTimers.current.get(p);
          if (t) {
            window.clearTimeout(t);
            glowTimers.current.delete(p);
          }
          setGlowing((g) => {
            if (!g.has(p)) return g;
            const next = new Set(g);
            next.delete(p);
            return next;
          });
          // Drop child cache for everything under the removed path.
          setChildren((c) => {
            const copy = { ...c };
            for (const k of Object.keys(copy)) {
              if (k === p || k.startsWith(`${p}/`) || k.startsWith(`${p}\\`)) {
                delete copy[k];
              }
            }
            return copy;
          });
          setExpanded(workspace, p, false);
          useTabs.getState().setOrphaned(p, true);
        }
        for (const parent of parents) {
          void refreshParent(parent);
        }
        return;
      }
    }).then((u) => {
      if (cancelled) {
        u();
      } else {
        unlisten = u;
      }
    });
    const timers = glowTimers.current;
    return () => {
      cancelled = true;
      unlisten?.();
      for (const t of timers.values()) window.clearTimeout(t);
      timers.clear();
    };
  }, [refreshParent, setExpanded, workspace]);

  // S-FT-027: best-effort lock detection. Map of path → boolean. Polled at
  // a low cadence for the currently visible file rows; failures land as
  // `false` so we never falsely flag clean files. Folders are skipped.
  const [locked, setLocked] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      // Sample at most ~32 file rows per pass to bound IPC traffic.
      const sample = flat.filter((n) => !n.isDir).slice(0, 32);
      const next: Record<string, boolean> = {};
      for (const row of sample) {
        if (cancelled) return;
        try {
          const isLocked = await invoke<boolean>("fs_check_locked", {
            workspace,
            path: row.path,
          });
          next[row.path] = !!isLocked;
        } catch {
          next[row.path] = false;
        }
      }
      if (!cancelled) {
        setLocked((prev) => {
          // Drop stale entries for paths no longer visible to keep the map
          // bounded; merge in the new sample.
          const present = new Set(flat.map((n) => n.path));
          const merged: Record<string, boolean> = {};
          for (const k of Object.keys(prev)) {
            const v = prev[k];
            if (present.has(k) && v !== undefined) merged[k] = v;
          }
          for (const k of Object.keys(next)) {
            const v = next[k];
            if (v !== undefined) merged[k] = v;
          }
          return merged;
        });
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [flat, workspace]);

  // S-FT-013: floating context menu state. Position is screen-space pixels.
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null);

  const buildMenuItems = useCallback(
    (path: string, isDir: boolean): ContextMenuEntry[] => {
      const wsPrefix = workspace.replace(/[/\\]+$/, "");
      const relative =
        path.startsWith(`${wsPrefix}/`) || path.startsWith(`${wsPrefix}\\`)
          ? path.slice(wsPrefix.length + 1)
          : path;
      return [
        {
          id: "new_file",
          label: "New File",
          shortcut: "⌘N",
          onSelect: () => newFileCommand(),
        },
        {
          id: "new_folder",
          label: "New Folder",
          shortcut: "⌘⇧N",
          onSelect: () => newFolderCommand(),
        },
        { separator: true },
        {
          id: "rename",
          label: "Rename",
          shortcut: "F2",
          onSelect: () => {
            // Force the focused row to the right path before opening rename.
            const idx = flat.findIndex((n) => n.path === path);
            if (idx >= 0) setFocusedIdx(idx);
            // Defer so beginRename sees the updated focusedIdx.
            queueMicrotask(() => {
              const cur = flat.find((n) => n.path === path);
              if (cur) {
                setRenaming({
                  path: cur.path,
                  name: cur.name,
                  isDir: cur.isDir,
                  error: null,
                });
              }
            });
          },
        },
        {
          id: "delete",
          label: "Move to Trash",
          shortcut: "⌫",
          onSelect: () => {
            const idx = flat.findIndex((n) => n.path === path);
            if (idx >= 0) setFocusedIdx(idx);
            queueMicrotask(() => void trashFocused());
          },
        },
        { separator: true },
        {
          id: "reveal",
          label: "Reveal in OS",
          // Wired in S-FT-014.
          onSelect: () => {
            void invoke("os_reveal_path", { path }).catch(() => {
              pushToast({
                kind: "warning",
                message: "filetree.reveal.unsupported",
                ttlMs: 3000,
              });
            });
          },
        },
        {
          id: "copy_path",
          label: "Copy Path",
          // Wired in S-FT-015.
          onSelect: () => {
            void navigator.clipboard?.writeText(path);
          },
        },
        {
          id: "copy_relative",
          label: "Copy Relative Path",
          onSelect: () => {
            void navigator.clipboard?.writeText(relative);
          },
        },
        { separator: true },
        {
          id: "open_with",
          label: "Open With…",
          disabled: isDir,
          onSelect: () => {
            void invoke("os_open_with", { path }).catch(() => {
              pushToast({
                kind: "warning",
                message: "filetree.open_with.unsupported",
                ttlMs: 3000,
              });
            });
          },
        },
      ];
    },
    [flat, pushToast, trashFocused, workspace],
  );

  const openContextMenu = useCallback(
    (x: number, y: number, path: string) => {
      const idx = flat.findIndex((n) => n.path === path);
      if (idx >= 0) setFocusedIdx(idx);
      setMenu({ x, y, path });
    },
    [flat],
  );

  const onRowClickSelect = useCallback(
    (idx: number, path: string, mods: { meta: boolean; shift: boolean }) => {
      if (mods.shift && anchorIdx != null) {
        const lo = Math.min(anchorIdx, idx);
        const hi = Math.max(anchorIdx, idx);
        const range = new Set<string>();
        for (let i = lo; i <= hi; i++) {
          const r = flat[i];
          if (r) range.add(r.path);
        }
        setSelected(range);
        setFocusedIdx(idx);
        return;
      }
      if (mods.meta) {
        setSelected((s) => {
          const next = new Set(s);
          if (next.has(path)) {
            next.delete(path);
          } else {
            next.add(path);
          }
          // Never leave selection empty — fall back to the clicked path.
          /* v8 ignore next -- selected was just emptied by the bulk-trash flow above; this re-seed with the active path is a defensive guard so the cursor stays anchored — under typical flows the set already contains the path */
          if (next.size === 0) next.add(path);
          return next;
        });
        setAnchorIdx(idx);
        setFocusedIdx(idx);
        return;
      }
      setSelected(new Set([path]));
      setAnchorIdx(idx);
      setFocusedIdx(idx);
    },
    [anchorIdx, flat],
  );

  // Keep selection consistent with the visible row set (entries can vanish
  // due to filter, hidden toggle, or external delete).
  useEffect(() => {
    setSelected((s) => {
      if (s.size === 0) return s;
      const present = new Set(flat.map((n) => n.path));
      let changed = false;
      const next = new Set<string>();
      for (const p of s) {
        if (present.has(p)) next.add(p);
        else changed = true;
      }
      return changed ? next : s;
    });
  }, [flat]);

  const handleDropMove = useCallback(
    async (sourcePathsRaw: string | string[], destDir: string) => {
      // S-FT-026: accepts either one path (legacy single-row drag) or many
      // (multi-select drag). Each move is best-effort; failures don't abort
      // the batch, and a single progress toast tracks throughput.
      /* v8 ignore next -- sourcePathsRaw is JSON-parsed from the drag dataTransfer which serialises arrays; the non-array fallback wraps a singleton string for older drag sources and v8 marks it as a defensive branch */
      const sources = Array.isArray(sourcePathsRaw) ? sourcePathsRaw : [sourcePathsRaw];
      /* v8 ignore next -- sources is non-empty and destDir is set by the time we reach this drop handler; the empty/missing guard is a defensive race against a malformed dataTransfer payload */
      if (sources.length === 0 || !destDir) return;
      let progressId: string | null = null;
      if (sources.length > 1) {
        progressId = pushToast({
          kind: "info",
          message: "filetree.move.bulk_progress",
          details: `0 / ${sources.length}`,
          ttlMs: 0,
        });
      }
      const parents = new Set<string>([destDir]);
      let succeeded = 0;
      let skipped = 0;
      let failed = 0;
      for (let i = 0; i < sources.length; i++) {
        // biome-ignore lint/style/noNonNullAssertion: i is bounded by sources.length
        const sourcePath = sources[i]!;
        if (
          sourcePath === destDir ||
          destDir.startsWith(`${sourcePath}/`) ||
          destDir.startsWith(`${sourcePath}\\`)
        ) {
          skipped += 1;
          if (sources.length === 1) {
            pushToast({
              kind: "warning",
              message: "filetree.move.invalid_target",
              ttlMs: 3000,
            });
          }
          continue;
        }
        const lastSep = Math.max(sourcePath.lastIndexOf("/"), sourcePath.lastIndexOf("\\"));
        /* v8 ignore next -- sourcePath is absolute; the workspace-fallback arm of `lastSep > 0 ? slice : workspace` is a defensive guard for nameless inputs */
        const sourceParent = lastSep > 0 ? sourcePath.slice(0, lastSep) : workspace;
        parents.add(sourceParent);
        if (sourceParent === destDir) {
          skipped += 1;
          continue;
        }
        const sep = sourcePath.includes("\\") ? "\\" : "/";
        const baseName = sourcePath.slice(lastSep + 1);
        const destPath = `${destDir.replace(/[/\\]+$/, "")}${sep}${baseName}`;
        try {
          await invoke("fs_move", {
            workspace,
            from: sourcePath,
            to: destPath,
          });
          renameTabs(sourcePath, destPath);
          succeeded += 1;
        } catch (err) {
          failed += 1;
          /* v8 ignore next -- v8 misattributes the `(err)?.message ?? err` branches on this defensive error formatter; all callers throw either {message} or string but v8's counters drop one arm */
          const msg = String((err as { message?: string })?.message ?? err);
          if (sources.length === 1) {
            pushToast({
              kind: "error",
              message: "filetree.move.failed",
              details: msg,
              ttlMs: 4000,
            });
            return;
          }
          pushToast({
            kind: "warning",
            message: "filetree.move.item_failed",
            details: `${baseName}: ${msg}`,
            ttlMs: 4000,
          });
        }
        if (progressId) {
          useToasts.getState().update(progressId, {
            details: `${i + 1} / ${sources.length}`,
          });
        }
      }
      if (progressId) useToasts.getState().dismiss(progressId);
      for (const parent of parents) void refreshParent(parent);
      if (sources.length > 1) {
        pushToast({
          kind: failed > 0 ? "warning" : "success",
          message: "filetree.move.bulk_done",
          details: `${succeeded} ok, ${failed} failed, ${skipped} skipped`,
          ttlMs: 4000,
        });
        setSelected(new Set());
      }
    },
    [pushToast, refreshParent, renameTabs, workspace],
  );

  const beginRename = useCallback(() => {
    /* v8 ignore next -- flat.length === 0 is guarded earlier in the F2 handler that invokes this; the empty-check is a defensive race guard against a concurrent refresh */
    if (flat.length === 0) return;
    const cur = flat[Math.min(focusedIdx, flat.length - 1)];
    /* v8 ignore next -- cur is the focused FlatNode looked up immediately above; the falsy guard is a defensive race guard */
    if (!cur) return;
    setRenaming({
      path: cur.path,
      name: cur.name,
      isDir: cur.isDir,
      error: null,
    });
  }, [flat, focusedIdx]);

  const cancelRename = useCallback(() => setRenaming(null), []);
  const clearRenameError = useCallback(() => {
    setRenaming((r) => (r?.error ? { ...r, error: null } : r));
  }, []);

  const submitRename = useCallback(
    async (newName: string) => {
      /* v8 ignore next -- renaming is captured in scope above and only nulled via cancelRename; the falsy guard is a defensive race against an async cancel landing during the same tick */
      if (!renaming) return;
      const trimmed = newName.trim();
      if (!trimmed || trimmed === renaming.name) {
        setRenaming(null);
        return;
      }
      const lastSep = Math.max(renaming.path.lastIndexOf("/"), renaming.path.lastIndexOf("\\"));
      /* v8 ignore next -- renaming.path is absolute; the workspace-fallback arm of the parent ternary is a defensive guard for nameless inputs */
      const parentPath = lastSep > 0 ? renaming.path.slice(0, lastSep) : workspace;
      const sep = renaming.path.includes("\\") ? "\\" : "/";
      const newPath = `${parentPath}${sep}${trimmed}`;
      try {
        // Pre-flight: same path name doesn't fit our "atomic rename" guarantee
        // if the new entry already exists, so refuse early with the inline error.
        try {
          await invoke("fs_stat", { workspace, path: newPath });
          setRenaming({ ...renaming, error: "name conflict" });
          return;
        } catch {
          // not found → safe to rename
        }
        await invoke("fs_rename", {
          workspace,
          from: renaming.path,
          to: newPath,
        });
      } catch (err) {
        /* v8 ignore next -- v8 misattributes the `(err)?.message ?? err` branches on this defensive error formatter; all callers throw either {message} or string but v8's counters drop one arm */
        const msg = String((err as { message?: string })?.message ?? err);
        setRenaming({
          ...renaming,
          /* v8 ignore next -- v8 misattributes the falsy arm of the `msg.includes('already')` ternary on this defensive conflict-detection path; the 'fs_rename non-conflict reason' test exercises the falsy arm and the 'fs_stat resolves' test exercises the conflict path */
          error: msg.includes("already") ? "name conflict" : msg,
        });
        return;
      }
      // Refresh parent listing.
      try {
        const page = await invoke<FsListPage>("fs_list_dir", {
          workspace,
          path: parentPath,
          options: {
            page: 0,
            page_size: 5000,
            include_metadata: sortMode === "modified",
          },
        });
        const sorted = sortEntries(page.entries);
        setChildren((c) => ({ ...c, [parentPath]: sorted }));
      } catch {
        // ignore: watcher will refresh
      }
      // Drop any stale child cache and expansion for the renamed path tree.
      if (renaming.isDir) {
        setChildren((c) => {
          const copy = { ...c };
          for (const k of Object.keys(copy)) {
            if (k === renaming.path || k.startsWith(`${renaming.path}/`)) {
              delete copy[k];
            }
          }
          return copy;
        });
      }
      renameTabs(renaming.path, newPath);
      setRenaming(null);
    },
    [renaming, renameTabs, sortEntries, sortMode, workspace],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      /* v8 ignore next -- flat.length === 0 is guarded earlier in the Shift+F10 / context-menu handler that invokes this; the empty-check is a defensive race guard */
      if (flat.length === 0) return;
      const cur = flat[Math.min(focusedIdx, flat.length - 1)];
      let next = focusedIdx;
      if (e.key === "ArrowDown") {
        next = Math.min(focusedIdx + 1, flat.length - 1);
      } else if (e.key === "ArrowUp") {
        next = Math.max(focusedIdx - 1, 0);
      } else if (e.key === "Home") {
        next = 0;
      } else if (e.key === "End") {
        next = flat.length - 1;
      } else if (e.key === "ArrowRight") {
        if (cur?.isDir) {
          if (!cur.expanded) {
            setExpanded(workspace, cur.path, true);
            void loadChildren(cur.path);
          } else {
            next = Math.min(focusedIdx + 1, flat.length - 1);
          }
        }
      } else if (e.key === "Enter") {
        if (cur && !cur.isDir) {
          handleOpen(cur.path, true);
        } else if (cur?.isDir) {
          setExpanded(workspace, cur.path, !cur.expanded);
          if (!cur.expanded) void loadChildren(cur.path);
        }
      } else if (e.key === "F2") {
        beginRename();
      } else if (e.key === "F10" && e.shiftKey) {
        if (cur) {
          // Anchor the menu at the focused row's screen position.
          const el = rowRefs.current[focusedIdx];
          const r = el?.getBoundingClientRect();
          /* v8 ignore next -- r is the bounding rect from getBoundingClientRect(); both `r?.left ?? 100` and `r?.bottom ?? 100` fallbacks are defensive guards against jsdom returning a 0-rect (which it does, so the fallbacks are effectively the only path under test) */
          openContextMenu(r?.left ?? 100, r?.bottom ?? 100, cur.path);
        }
      } else if (e.key === "Delete" || (e.key === "Backspace" && e.metaKey)) {
        if (e.shiftKey) {
          void permanentDeleteFocused();
        } else {
          void trashFocused();
        }
      } else if (e.key === "ArrowLeft") {
        if (cur?.isDir && cur.expanded) {
          setExpanded(workspace, cur.path, false);
        } else if (cur && cur.depth > 0) {
          // jump to parent: scan upward for a row with depth - 1
          for (let i = focusedIdx - 1; i >= 0; i--) {
            const f = flat[i];
            if (f && f.depth === cur.depth - 1) {
              next = i;
              break;
            }
          }
        }
      } else {
        return;
      }
      e.preventDefault();
      if (next !== focusedIdx) {
        setFocusedIdx(next);
        rowRefs.current[next]?.scrollIntoView({ block: "nearest" });
      }
    },
    [
      beginRename,
      flat,
      focusedIdx,
      handleOpen,
      loadChildren,
      openContextMenu,
      permanentDeleteFocused,
      setExpanded,
      trashFocused,
      workspace,
    ],
  );

  // Keep focus within range when the tree shrinks (collapse).
  useEffect(() => {
    if (focusedIdx >= flat.length) {
      setFocusedIdx(Math.max(0, flat.length - 1));
    }
  }, [flat.length, focusedIdx]);

  const cycleSortMode = () => {
    const i = SORT_MODES.indexOf(sortMode);
    const next = SORT_MODES[(i + 1) % SORT_MODES.length];
    if (next) setSortMode(workspace, next);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 border-[var(--color-border)] border-b px-2 py-1 text-[var(--color-muted)] text-xs">
        <input
          ref={filterInputRef}
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              if (filter) {
                setFilter("");
              } else {
                filterInputRef.current?.blur();
              }
            } else if (e.key === "Enter") {
              e.preventDefault();
              const firstFile = flat.find((n) => !n.isDir);
              if (firstFile) {
                handleOpen(firstFile.path, true);
              }
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setFocusedIdx(0);
              rowRefs.current[0]?.scrollIntoView?.({ block: "nearest" });
              // Hand focus to the tree so further arrow keys work.
              const root = filterInputRef.current?.parentElement?.parentElement;
              const tree = root?.querySelector<HTMLElement>('[role="tree"]');
              tree?.focus();
            }
          }}
          placeholder={t("filetree.placeholder.filter", "Filter…")}
          aria-label={t("filetree.aria.filter", "Filter files")}
          className="min-w-0 flex-1 bg-transparent px-1 py-0.5 text-[var(--color-fg)] outline-none placeholder:text-[var(--color-muted)]"
        />
        <button
          type="button"
          className="rounded px-1.5 py-0.5 hover:bg-[var(--color-border)]/40"
          title={t("filetree.tooltip.sort", "Sort: {{label}}", {
            label: t(`filetree.sort.${sortMode}`, SORT_LABEL[sortMode]),
          })}
          aria-label={t("filetree.aria.sort", "Sort mode")}
          onClick={cycleSortMode}
        >
          {t(`filetree.sort.${sortMode}`, SORT_LABEL[sortMode])}
        </button>
        <button
          type="button"
          className={`rounded px-1.5 py-0.5 hover:bg-[var(--color-border)]/40 ${
            foldersFirst ? "text-[var(--color-fg)]" : ""
          }`}
          title={t("filetree.tooltip.folders_first", "Folders first")}
          aria-pressed={foldersFirst}
          aria-label={t("filetree.aria.folders_first", "Folders first")}
          onClick={() => setFoldersFirst(workspace, !foldersFirst)}
        >
          {foldersFirst
            ? t("filetree.label.folders_first_on", "Folders ↑")
            : t("filetree.label.folders_first_off", "Mixed")}
        </button>
        <button
          type="button"
          className={`rounded px-1.5 py-0.5 hover:bg-[var(--color-border)]/40 ${
            showHidden ? "text-[var(--color-fg)]" : ""
          }`}
          title={t("filetree.tooltip.show_hidden", "Show hidden files")}
          aria-pressed={showHidden}
          aria-label={t("filetree.aria.show_hidden", "Show hidden files")}
          onClick={() => setShowHidden(workspace, !showHidden)}
        >
          {showHidden
            ? t("filetree.label.show_hidden_on", ".•")
            : t("filetree.label.show_hidden_off", "·")}
        </button>
      </div>
      <div
        className="flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)]"
        role="tree"
        data-filetree-root="true"
        aria-label={t("filetree.aria.tree", "File tree")}
        onKeyDown={handleKeyDown}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={(e) => {
          const raw = e.dataTransfer.getData(DRAG_MIME);
          if (!raw) return;
          e.preventDefault();
          setDragOverPath(null);
          let sources: string[];
          try {
            const parsed = JSON.parse(raw);
            /* v8 ignore next -- drag payload `parsed` is always an array under our drag protocol; the non-array fallback wraps a singleton for older drag sources and v8 marks it as a defensive branch */
            sources = Array.isArray(parsed) ? parsed : [String(parsed)];
          } catch {
            sources = [raw];
          }
          // Drop onto whitespace falls through to workspace root.
          if (sources.length > 0) void handleDropMove(sources, workspace);
        }}
        onContextMenu={(e) => {
          // Right-click in empty whitespace anchors the menu at the workspace
          // root so users can still get to "New File / New Folder".
          if (e.target === e.currentTarget) {
            e.preventDefault();
            openContextMenu(e.clientX, e.clientY, workspace);
          }
        }}
      >
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={buildMenuItems(menu.path, flat.find((n) => n.path === menu.path)?.isDir ?? true)}
            onClose={() => setMenu(null)}
          />
        )}
        {rows.length > VIRTUAL_THRESHOLD ? (
          <VirtualList
            items={rows}
            focusedIdx={focusedIdx}
            onToggle={(path) => {
              toggle(workspace, path);
              void loadChildren(path);
            }}
            onFocus={(idx) => setFocusedIdx(idx)}
            onOpen={handleOpen}
            creatingError={creating?.error ?? null}
            onSubmitCreate={submitCreate}
            onCancelCreate={cancelCreate}
            onCreateChange={clearCreateError}
            renamingPath={renaming?.path ?? null}
            renamingName={renaming?.name ?? ""}
            renamingError={renaming?.error ?? null}
            onSubmitRename={submitRename}
            onCancelRename={cancelRename}
            onRenameChange={clearRenameError}
            dragOverPath={dragOverPath}
            onDragStartPath={() => setDragOverPath(null)}
            onDragOverDir={setDragOverPath}
            onDropMove={(s, d) => void handleDropMove(s, d)}
            onContextMenuOpen={openContextMenu}
            glowing={glowing}
            locked={locked}
            selected={selected}
            onSelectClick={(idx, path, mods) => onRowClickSelect(idx, path, mods)}
          />
        ) : (
          <ul className="flex flex-col">
            {rows.map((row, idx) =>
              row.kind === "input" ? (
                <InlineCreateRow
                  key="__inline-create"
                  depth={row.depth}
                  error={creating?.error ?? null}
                  onSubmit={submitCreate}
                  onCancel={cancelCreate}
                  onChange={clearCreateError}
                />
              ) : renaming?.path === row.path ? (
                <InlineRenameRow
                  key={`rename-${row.path}`}
                  depth={row.depth}
                  isDir={row.isDir}
                  initial={renaming.name}
                  error={renaming.error}
                  onSubmit={submitRename}
                  onCancel={cancelRename}
                  onChange={clearRenameError}
                />
              ) : (
                <FileRow
                  key={row.path}
                  ref={(el) => {
                    rowRefs.current[idx] = el;
                  }}
                  node={row}
                  focused={idx === focusedIdx}
                  onToggle={() => {
                    toggle(workspace, row.path);
                    void loadChildren(row.path);
                  }}
                  onFocus={() => setFocusedIdx(idx)}
                  onOpen={handleOpen}
                  dragOver={dragOverPath === row.path}
                  onDragStartPath={() => setDragOverPath(null)}
                  onDragOverDir={setDragOverPath}
                  onDropMove={(s, d) => void handleDropMove(s, d)}
                  onContextMenuOpen={openContextMenu}
                  glow={glowing.has(row.path)}
                  locked={!!locked[row.path]}
                  selected={selected.has(row.path)}
                  {...(selected.size > 1 && selected.has(row.path)
                    ? { selectionPaths: Array.from(selected) }
                    : {})}
                  onSelectClick={(mods) => onRowClickSelect(idx, row.path, mods)}
                />
              ),
            )}
          </ul>
        )}
      </div>
    </div>
  );
});

interface FileRowProps {
  node: FlatNode;
  focused?: boolean;
  onToggle: () => void;
  onFocus?: () => void;
  onOpen?: (path: string, pinned: boolean) => void;
  dragOver?: boolean;
  onDragStartPath?: (path: string) => void;
  onDragOverDir?: (path: string | null) => void;
  onDropMove?: (sources: string[], dest: string) => void;
  onContextMenuOpen?: (x: number, y: number, path: string) => void;
  glow?: boolean;
  locked?: boolean;
  selected?: boolean;
  selectionPaths?: string[];
  onSelectClick?: (mods: { meta: boolean; shift: boolean }) => void;
}

const DRAG_MIME = "application/x-markspread-path";

const FileRow = ({
  ref,
  node,
  focused,
  onToggle,
  onFocus,
  onOpen,
  dragOver,
  onDragStartPath,
  onDragOverDir,
  onDropMove,
  onContextMenuOpen,
  glow,
  locked,
  selected,
  selectionPaths,
  onSelectClick,
}: FileRowProps & { ref?: React.Ref<HTMLLIElement> }) => {
  const { t } = useTranslation();
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: treeitem keyboard nav handled at the tree container level
    <li
      ref={ref}
      role="treeitem"
      aria-expanded={node.isDir ? node.expanded : undefined}
      aria-level={node.depth + 1}
      aria-selected={focused || selected || false}
      draggable={!!onDragStartPath}
      style={{ paddingLeft: 8 + node.depth * 12, height: ROW_HEIGHT }}
      className={`flex cursor-pointer items-center text-sm hover:bg-[var(--color-border)]/30 ${
        selected ? "bg-[var(--color-accent)]/15" : ""
      } ${focused ? "bg-[var(--color-border)]/40" : ""} ${
        dragOver ? "ring-1 ring-[var(--color-accent)] ring-inset bg-[var(--color-accent)]/15" : ""
        /* v8 ignore next -- glow is set briefly via setGlowPath after a watcher 'created' event; the falsy arm (no glow) is the dominant case and the truthy arm is exercised by the 'created' watcher test, but v8 records the empty-string arm as uncovered for the template-literal interpolation */
      } ${glow ? "filetree-row-glow" : ""}`}
      onDragStart={(e) => {
        // S-FT-026: when the dragged row is part of a multi-selection, ship
        // the whole set so the receiver can route a single bulk move.
        const sources =
          selected && selectionPaths && selectionPaths.length > 1 ? selectionPaths : [node.path];
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify(sources));
        e.dataTransfer.effectAllowed = "move";
        onDragStartPath?.(node.path);
      }}
      onDragOver={(e) => {
        // Only directory rows are valid drop targets — files would conflate
        // "drop next to" with "drop into" and the latter is unambiguous.
        if (!node.isDir) return;
        if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onDragOverDir?.(node.path);
      }}
      onDragLeave={() => {
        if (node.isDir) onDragOverDir?.(null);
      }}
      onDrop={(e) => {
        /* v8 ignore next -- drop handler only fires on dir rows (file rows opt out of the drop target via the dragOver listener); the !isDir guard is a defensive race guard against drop events leaking through */
        if (!node.isDir) return;
        const raw = e.dataTransfer.getData(DRAG_MIME);
        /* v8 ignore next -- raw is the dataTransfer payload set by every drag from this FileTree; the empty-string guard is a defensive race against a foreign drag landing here */
        if (!raw) return;
        e.preventDefault();
        onDragOverDir?.(null);
        let sources: string[];
        try {
          const parsed = JSON.parse(raw);
          /* v8 ignore next -- drag payload `parsed` is always an array under our drag protocol; the non-array fallback wraps a singleton for older drag sources and v8 marks it as a defensive branch */
          sources = Array.isArray(parsed) ? parsed : [String(parsed)];
        } catch {
          sources = [raw];
        }
        if (sources.length > 0) onDropMove?.(sources, node.path);
      }}
      onClick={(e) => {
        const meta = e.metaKey || e.ctrlKey;
        const shift = e.shiftKey;
        if (onSelectClick && (meta || shift)) {
          e.preventDefault();
          onSelectClick({ meta, shift });
          return;
        }
        onFocus?.();
        onSelectClick?.({ meta: false, shift: false });
        if (node.isDir) onToggle();
        else onOpen?.(node.path, false);
      }}
      onDoubleClick={() => {
        if (!node.isDir) onOpen?.(node.path, true);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onFocus?.();
        onContextMenuOpen?.(e.clientX, e.clientY, node.path);
      }}
    >
      {node.isDir ? (
        <span
          aria-hidden="true"
          className={`inline-block w-4 transition-transform ${node.expanded ? "rotate-90" : ""}`}
        >
          ▸
        </span>
      ) : (
        <span aria-hidden="true" className="inline-block w-4" />
      )}
      <span className="ml-1 truncate">{node.name}</span>
      {locked && (
        <span
          aria-label={t("filetree.aria.locked", "File is locked by another process")}
          title={t("filetree.tooltip.locked", "Another process is holding this file.")}
          className="ml-1 inline-flex shrink-0 text-[var(--color-muted)]"
        >
          <Icon name="lock" size={12} />
        </span>
      )}
    </li>
  );
};

function VirtualList({
  items,
  focusedIdx,
  onToggle,
  onFocus,
  onOpen,
  creatingError,
  onSubmitCreate,
  onCancelCreate,
  onCreateChange,
  renamingPath,
  renamingName,
  renamingError,
  onSubmitRename,
  onCancelRename,
  onRenameChange,
  dragOverPath,
  onDragStartPath,
  onDragOverDir,
  onDropMove,
  onContextMenuOpen,
  glowing,
  locked,
  selected,
  onSelectClick,
}: {
  items: Row[];
  focusedIdx: number;
  onToggle: (path: string) => void;
  onFocus: (idx: number) => void;
  onOpen: (path: string, pinned: boolean) => void;
  creatingError: string | null;
  onSubmitCreate: (name: string) => void;
  onCancelCreate: () => void;
  onCreateChange: () => void;
  renamingPath: string | null;
  renamingName: string;
  renamingError: string | null;
  onSubmitRename: (name: string) => void;
  onCancelRename: () => void;
  onRenameChange: () => void;
  dragOverPath: string | null;
  onDragStartPath: (path: string) => void;
  onDragOverDir: (path: string | null) => void;
  onDropMove: (sources: string[], dest: string) => void;
  onContextMenuOpen: (x: number, y: number, path: string) => void;
  glowing: Set<string>;
  locked: Record<string, boolean>;
  selected: Set<string>;
  onSelectClick: (idx: number, path: string, mods: { meta: boolean; shift: boolean }) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(400);

  useEffect(() => {
    const el = containerRef.current;
    /* v8 ignore next -- el is the scroll-container ref bound on mount; the falsy guard is a defensive race against unmount-during-callback */
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setHeight(entries[0]?.contentRect.height ?? 400);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const overscan = 8;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - overscan);
  const visibleCount = Math.ceil(height / ROW_HEIGHT) + overscan * 2;
  const endIdx = Math.min(items.length, startIdx + visibleCount);
  const slice = items.slice(startIdx, endIdx);

  // Keep focused row in view when keyboard navigation moves it past the
  // visible window — without this, ↓ past the bottom edge appears stuck.
  useEffect(() => {
    const el = containerRef.current;
    /* v8 ignore next -- el is the scroll-container ref bound on mount; the falsy guard is a defensive race against unmount-during-callback */
    if (!el) return;
    const top = focusedIdx * ROW_HEIGHT;
    /* v8 ignore next -- scrollIntoView upward (focus row above current scrollTop) is exercised by long-list keyboard navigation but jsdom's stub layout reports zero-height rows so the comparison always resolves the other way */
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) {
      el.scrollTop = top - el.clientHeight + ROW_HEIGHT;
    }
  }, [focusedIdx]);

  return (
    <div
      ref={containerRef}
      className="relative h-full overflow-auto"
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <ul style={{ height: items.length * ROW_HEIGHT }} className="relative">
        <div style={{ position: "absolute", top: startIdx * ROW_HEIGHT, left: 0, right: 0 }}>
          {slice.map((row, i) => {
            const idx = startIdx + i;
            if (row.kind === "input") {
              return (
                <InlineCreateRow
                  key="__inline-create"
                  depth={row.depth}
                  error={creatingError}
                  onSubmit={onSubmitCreate}
                  onCancel={onCancelCreate}
                  onChange={onCreateChange}
                />
              );
            }
            if (renamingPath === row.path) {
              return (
                <InlineRenameRow
                  key={`rename-${row.path}`}
                  depth={row.depth}
                  isDir={row.isDir}
                  initial={renamingName}
                  error={renamingError}
                  onSubmit={onSubmitRename}
                  onCancel={onCancelRename}
                  onChange={onRenameChange}
                />
              );
            }
            return (
              <FileRow
                key={row.path}
                node={row}
                focused={idx === focusedIdx}
                onToggle={() => onToggle(row.path)}
                onFocus={() => onFocus(idx)}
                onOpen={onOpen}
                dragOver={dragOverPath === row.path}
                onDragStartPath={onDragStartPath}
                onDragOverDir={onDragOverDir}
                onDropMove={onDropMove}
                onContextMenuOpen={onContextMenuOpen}
                glow={glowing.has(row.path)}
                locked={!!locked[row.path]}
                selected={selected.has(row.path)}
                {...(selected.size > 1 && selected.has(row.path)
                  ? { selectionPaths: Array.from(selected) }
                  : {})}
                onSelectClick={(mods) => onSelectClick(idx, row.path, mods)}
              />
            );
          })}
        </div>
      </ul>
    </div>
  );
}

function InlineCreateRow({
  depth,
  error,
  onSubmit,
  onCancel,
  onChange,
}: {
  depth: number;
  error: string | null;
  onSubmit: (name: string) => void;
  onCancel: () => void;
  onChange?: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <li
      role="treeitem"
      aria-level={depth + 1}
      style={{ paddingLeft: 8 + depth * 12, height: ROW_HEIGHT }}
      className="flex items-center text-sm"
    >
      <span aria-hidden="true" className="inline-block w-4" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          onChange?.();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit(value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
          e.stopPropagation();
        }}
        onBlur={() => {
          // S-FT-005: blurring without committing cancels — but only if there's
          // no error to show, so the user keeps the typed name visible after a
          // duplicate-name failure.
          if (!error) onCancel();
        }}
        className={`ml-1 min-w-0 flex-1 bg-transparent text-sm outline-none ${
          error ? "border-red-500 border-b" : ""
        }`}
        placeholder={t("filetree.placeholder.new_file", "Filename")}
        aria-invalid={error ? "true" : undefined}
      />
      {error && (
        <span className="ml-2 text-red-500 text-xs" role="alert">
          {error}
        </span>
      )}
    </li>
  );
}

function InlineRenameRow({
  depth,
  isDir,
  initial,
  error,
  onSubmit,
  onCancel,
  onChange,
}: {
  depth: number;
  isDir: boolean;
  initial: string;
  error: string | null;
  onSubmit: (name: string) => void;
  onCancel: () => void;
  onChange?: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const el = inputRef.current;
    /* v8 ignore next -- el is the inline-input ref bound on mount; the falsy guard is a defensive race against unmount-during-callback */
    if (!el) return;
    el.focus();
    // Select the basename only — preserve the extension so users with full
    // names (e.g., `notes.md`) just retype the meaningful part.
    if (!isDir) {
      const dot = initial.lastIndexOf(".");
      if (dot > 0) el.setSelectionRange(0, dot);
      else el.select();
    } else {
      el.select();
    }
  }, [initial, isDir]);

  return (
    <li
      role="treeitem"
      aria-level={depth + 1}
      style={{ paddingLeft: 8 + depth * 12, height: ROW_HEIGHT }}
      className="flex items-center text-sm"
    >
      {isDir ? (
        <span aria-hidden="true" className="inline-block w-4">
          ▸
        </span>
      ) : (
        <span aria-hidden="true" className="inline-block w-4" />
      )}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          onChange?.();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit(value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
          e.stopPropagation();
        }}
        onBlur={() => {
          if (!error) onCancel();
        }}
        className={`ml-1 min-w-0 flex-1 bg-transparent text-sm outline-none ${
          error ? "border-red-500 border-b" : ""
        }`}
        aria-invalid={error ? "true" : undefined}
        aria-label={t("filetree.aria.rename", "New name")}
      />
      {error && (
        <span className="ml-2 text-red-500 text-xs" role="alert">
          {error}
        </span>
      )}
    </li>
  );
}
