// S-ED-001: thin React wrapper around CodeMirror 6. The component
// owns the DOM container; CodeMirror owns everything inside. We never
// re-render the view from React state — instead, a parent prop
// change recreates the view (cheap, see lib/editor/state.ts) and a
// `value` change after mount uses dispatch() so React doesn't fight
// the editor's internal state.
//
// onChange fires on every edit but is debounced to a single rAF tick
// upstream — the spread pane (S-PR) is where heavy work lives.

import { EditorSelection, type Extension } from "@codemirror/state";
import { EditorView, placeholder as placeholderExt } from "@codemirror/view";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import { type EditorLanguage, buildEditorState, mountEditor } from "@/lib/editor/state";

export interface EditorViewPosition {
  line: number;
  column: number;
  scrollTop: number;
}

type Props = {
  /** The text shown when the view is first mounted. */
  initialDoc: string;
  /** Extension list appended to the always-on base extensions. */
  extensions?: readonly Extension[];
  onChange?: (doc: string) => void;
  /**
   * If provided, the editor is recreated whenever this id changes.
   * Use it as the tab id; switching tabs swaps the document with no
   * stale StateField leaking from the previous tab.
   */
  tabId?: string;
  /** "markdown" enables md-specific extensions; "plain" keeps it text-only. */
  language?: EditorLanguage;
  className?: string;
  /**
   * S-ESP-006: cursor + scroll snapshot to restore on mount. Same path
   * opened in two panes can carry two different positions; the host (e.g.
   * PaneEditor) hands each its own.
   */
  initialPosition?: EditorViewPosition;
  /** Throttled callback fired when selection/scroll change. */
  onPositionChange?: (position: EditorViewPosition) => void;
  /**
   * S-ESP-007: external doc snapshot for buffer share. When this changes
   * and differs from the EditorView's current doc, the view reconciles via
   * a replace-all transaction. The same value the local editor just wrote
   * back is a no-op (string equality short-circuits).
   */
  remoteDoc?: string;
};

export function Editor({
  initialDoc,
  extensions,
  onChange,
  tabId,
  language = "markdown",
  className,
  initialPosition,
  onPositionChange,
  remoteDoc,
}: Props) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onPositionChangeRef = useRef(onPositionChange);
  onPositionChangeRef.current = onPositionChange;
  const initialPositionRef = useRef(initialPosition);
  initialPositionRef.current = initialPosition;

  // S-ED-024: i18n'd placeholder for an empty document. Locale change
  // re-mounts via the dependency, so a Korean→English switch updates
  // the hint without the user needing to reopen the file.
  const placeholderText = useMemo(
    () => t("editor.placeholder", "Start typing… or press ⌘K for commands"),
    [t],
  );

  useEffect(() => {
    if (!hostRef.current) return;
    const updateExt = EditorView.updateListener.of((u) => {
      if (u.docChanged && onChangeRef.current) {
        onChangeRef.current(u.state.doc.toString());
      }
      // Position write-back: emit when selection moves or scroll fires.
      // We coalesce by reading `view.scrollDOM.scrollTop` instead of
      // tracking deltas so re-mounts and external scrolls both report
      // accurately.
      if ((u.selectionSet || u.docChanged) && onPositionChangeRef.current) {
        const head = u.state.selection.main.head;
        const line = u.state.doc.lineAt(head);
        onPositionChangeRef.current({
          line: line.number - 1,
          column: head - line.from,
          scrollTop: view.scrollDOM.scrollTop,
        });
      }
    });
    const view = mountEditor(
      hostRef.current,
      initialDoc,
      [updateExt, placeholderExt(placeholderText), ...(extensions ?? [])],
      undefined,
      language,
    );
    viewRef.current = view;
    // Restore cursor + scroll if a position was supplied. The line/column
    // values are 0-based here (matches our PaneTab.position contract); CM6
    // uses 1-based lines internally so we adjust on the way in.
    const restore = initialPositionRef.current;
    if (restore) {
      const lineCount = view.state.doc.lines;
      const lineNo = Math.min(Math.max(restore.line + 1, 1), lineCount);
      const lineInfo = view.state.doc.line(lineNo);
      const pos = lineInfo.from + Math.min(restore.column, lineInfo.length);
      view.dispatch({ selection: EditorSelection.cursor(pos) });
      view.scrollDOM.scrollTop = restore.scrollTop;
    }
    const onScroll = () => {
      const cb = onPositionChangeRef.current;
      if (!cb) return;
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head);
      cb({
        line: line.number - 1,
        column: head - line.from,
        scrollTop: view.scrollDOM.scrollTop,
      });
    };
    view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      view.scrollDOM.removeEventListener("scroll", onScroll);
      view.destroy();
      viewRef.current = null;
    };
    // tabId in deps so a tab swap recreates the view; initialDoc is
    // intentionally not — it's the *initial* value, not a controlled
    // prop. Hot-replacing the doc on every parent re-render would
    // lose the user's cursor. `language` joins so a same-tab swap from
    // markdown to plain (rare) re-mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, language]);

  // If extensions ever change without a tabId swap, reconfigure in
  // place rather than recreate. This is the common case for toggling
  // soft wrap or line numbers.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !extensions) return;
    view.setState(buildEditorState(view.state.doc.toString(), extensions, undefined, language));
  }, [extensions, language]);

  // S-ESP-007: reconcile when an external (other-pane) edit lands. We do
  // a plain replace-all instead of a diff because the same-pane local
  // write hits the early-return on string equality, so this only runs for
  // genuine remote changes. A diff would buy us nothing.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || remoteDoc === undefined) return;
    const current = view.state.doc.toString();
    if (current === remoteDoc) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: remoteDoc },
      // Don't move the cursor — the user's selection / scroll in this pane
      // stays where it was. CM6 clamps the selection automatically.
    });
  }, [remoteDoc]);

  return <div ref={hostRef} className={className ?? "h-full w-full"} />;
}
