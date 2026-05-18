// S-SBC-004: per-workspace layout disk persistence.
//
// On workspace mount, loads `.markspread/layout.json` and hydrates the
// in-memory store. While the workspace is active, subscribes to the
// relevant fields and debounces writes back to disk. The in-memory
// localStorage persistence (zustand `persist`) stays as the fast path —
// disk persistence is the source of truth for cross-device/cross-window
// continuity.

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import {
  collectPaths,
  parseEditorLayout,
  pruneEditorLayout,
  serializeEditorLayout,
} from "../lib/editor/layout-model";
import { useEditorLayout } from "../store/editor-layout";
import { useLayout, type SidebarCollapsedMode } from "../store/layout";

const DEBOUNCE_MS = 500;
const LOAD_DEBOUNCE_GUARD_MS = 100;

interface LayoutPayload {
  schemaVersion?: number;
  sidebar?: {
    hidden?: boolean;
    width?: number;
    collapsedMode?: SidebarCollapsedMode;
  };
  editor?: unknown;
}

interface FileStat {
  kind?: string;
  is_file?: boolean;
}

async function checkPathExists(workspace: string, path: string): Promise<boolean> {
  try {
    await invoke<FileStat>("fs_stat", { workspace, path });
    return true;
  } catch {
    return false;
  }
}

export function useWorkspaceLayoutSync(workspace: string | null): void {
  const hydratingRef = useRef<number>(0);

  // Load on workspace change.
  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    hydratingRef.current = Date.now();
    void (async () => {
      try {
        const payload = await invoke<LayoutPayload>("workspace_layout_load", {
          workspace,
        });
        if (cancelled || !payload?.sidebar) return;
        const state = useLayout.getState();
        const { hidden, width, collapsedMode } = payload.sidebar;
        if (typeof hidden === "boolean") {
          state.setSidebarHidden(workspace, hidden);
        }
        if (typeof width === "number" && Number.isFinite(width)) {
          state.setSidebarWidth(workspace, width);
        }
        if (collapsedMode === "rail" || collapsedMode === "hidden") {
          state.setSidebarCollapsedMode(workspace, collapsedMode);
        }
        // S-ESP-009: hydrate the editor pane/tab tree. Parse first, then
        // prune any tab whose path no longer exists on disk; an entirely
        // empty pane collapses via pruneEditorLayout's structural rules.
        const editor = parseEditorLayout(payload.editor);
        if (editor) {
          const paths = collectPaths(editor.root);
          const missing = new Set<string>();
          await Promise.all(
            paths.map(async (p) => {
              const exists = await checkPathExists(workspace, p);
              if (!exists) missing.add(p);
            }),
          );
          if (cancelled) return;
          const pruned = pruneEditorLayout(editor, (p) => missing.has(p));
          useEditorLayout.getState().setLayout(workspace, pruned);
        }
      } catch (err) {
        // Disk persistence is best-effort. The in-memory store + localStorage
        // already hold reasonable defaults, so a missing/corrupt layout.json
        // just means "use whatever you had".
        console.warn("[layout-sync] load failed", err);
      } finally {
        // Release the guard slightly after hydration so the subscription
        // doesn't immediately echo the loaded values back to disk.
        setTimeout(() => {
          hydratingRef.current = 0;
        }, LOAD_DEBOUNCE_GUARD_MS);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspace]);

  // Subscribe + debounce write.
  useEffect(() => {
    if (!workspace) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useLayout.subscribe((s) => {
      // During hydration we receive setter callbacks for the values we just
      // loaded; don't bounce them back to disk.
      if (hydratingRef.current && Date.now() - hydratingRef.current < 2000) {
        return;
      }
      const hidden = !!s.sidebarHidden[workspace];
      const width = s.sidebarWidth[workspace];
      const collapsedMode = s.sidebarCollapsedMode[workspace];
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const editor = useEditorLayout.getState().layouts[workspace];
        const payload: LayoutPayload = {
          sidebar: {
            hidden,
            ...(typeof width === "number" ? { width } : {}),
            ...(collapsedMode ? { collapsedMode } : {}),
          },
          ...(editor ? { editor: serializeEditorLayout(editor) } : {}),
        };
        void invoke("workspace_layout_save", { workspace, payload }).catch(
          (err) => console.warn("[layout-sync] save failed", err),
        );
      }, DEBOUNCE_MS);
    });
    // Also subscribe to editor-layout mutations so a pane split / tab move
    // triggers a debounced write. We re-use the same timer so paired
    // sidebar+editor changes batch into one disk hit.
    const unsubEditor = useEditorLayout.subscribe((s) => {
      if (hydratingRef.current && Date.now() - hydratingRef.current < 2000) return;
      if (!s.layouts[workspace]) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const layout = useLayout.getState();
        const hidden = !!layout.sidebarHidden[workspace];
        const width = layout.sidebarWidth[workspace];
        const collapsedMode = layout.sidebarCollapsedMode[workspace];
        const editor = useEditorLayout.getState().layouts[workspace];
        const payload: LayoutPayload = {
          sidebar: {
            hidden,
            ...(typeof width === "number" ? { width } : {}),
            ...(collapsedMode ? { collapsedMode } : {}),
          },
          ...(editor ? { editor: serializeEditorLayout(editor) } : {}),
        };
        void invoke("workspace_layout_save", { workspace, payload }).catch(
          (err) => console.warn("[layout-sync] save failed", err),
        );
      }, DEBOUNCE_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
      unsubEditor();
    };
  }, [workspace]);
}
