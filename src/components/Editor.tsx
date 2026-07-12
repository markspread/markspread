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

import { createCodeViewerSetup } from "@/lib/editor/code-viewer";
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
  /**
   * ADR-0014 T2.c: file path used for lazy syntax-highlight of non-md files.
   * When `language` is "plain" and the extension maps to a CM6 language
   * module, the module is lazy-loaded and injected after mount; until it
   * arrives (or if loading fails) the view stays plain text.
   */
  path?: string;
  /** ADR-0014: 코드/설정 파일은 read-only — caller decides per-file. */
  readOnly?: boolean;
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
   * ADR-0014 H13: 드래그-채팅 편집 — non-empty selection 발생 시 호출.
   * 본 callback 은 selection range + full doc 을 함께 받아 caller (ChatPanel) 가
   * SelectionContext 를 buildSelectionContext() 로 변환 가능.
   */
  onSelectionRange?: (range: { fromOffset: number; toOffset: number; fullText: string }) => void;
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
  path,
  readOnly = false,
  className,
  initialPosition,
  onPositionChange,
  onSelectionRange,
  remoteDoc,
}: Props) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onPositionChangeRef = useRef(onPositionChange);
  onPositionChangeRef.current = onPositionChange;
  const onSelectionRangeRef = useRef(onSelectionRange);
  onSelectionRangeRef.current = onSelectionRange;
  const initialPositionRef = useRef(initialPosition);
  initialPositionRef.current = initialPosition;

  // S-ED-024: i18n'd placeholder for an empty document. Locale change
  // re-mounts via the dependency, so a Korean→English switch updates
  // the hint without the user needing to reopen the file.
  const placeholderText = useMemo(
    () => t("editor.placeholder", "Start typing… or press ⌘K for commands"),
    [t],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment near the dep array — initialDoc/placeholderText/extensions are intentionally elided (initial-only values; live edits are handled by separate effects below). tabId is listed so a tab swap re-mounts even if language stays the same.
  useEffect(() => {
    /* v8 ignore next -- hostRef is attached before effects run; this guards a future refactor where the host can be conditionally rendered */
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
      // ADR-0014 H13: emit non-empty selection range for drag-chat-edit.
      if (u.selectionSet && onSelectionRangeRef.current) {
        const sel = u.state.selection.main;
        if (sel.from !== sel.to) {
          onSelectionRangeRef.current({
            fromOffset: sel.from,
            toOffset: sel.to,
            fullText: u.state.doc.toString(),
          });
        }
      }
    });
    // ADR-0014 T2.c: non-md files get a lazy syntax-highlight slot. The
    // compartment mounts empty (plain text) and is reconfigured once the
    // language chunk arrives; a failed load leaves the plain fallback.
    const codeViewer = language === "plain" && path ? createCodeViewerSetup(path) : null;
    let disposed = false;
    const view = mountEditor(
      hostRef.current,
      initialDoc,
      [
        updateExt,
        placeholderExt(placeholderText),
        ...(codeViewer ? codeViewer.extensions : []),
        ...(extensions ?? []),
      ],
      undefined,
      language,
      readOnly,
    );
    viewRef.current = view;
    if (codeViewer) void codeViewer.applyLanguage(view, () => disposed);
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
      disposed = true;
      view.scrollDOM.removeEventListener("scroll", onScroll);
      view.destroy();
      viewRef.current = null;
    };
    // tabId in deps so a tab swap recreates the view; initialDoc is
    // intentionally not — it's the *initial* value, not a controlled
    // prop. Hot-replacing the doc on every parent re-render would
    // lose the user's cursor. `language` joins so a same-tab swap from
    // markdown to plain (rare) re-mounts; `path` so the highlight slot
    // tracks the file the pane actually shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, language, path, readOnly]);

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
