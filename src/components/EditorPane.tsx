import { invoke } from "@tauri-apps/api/core";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fromPosixError } from "../lib/access-policy/mapping";
import type { AccessDecision } from "../lib/access-policy/types";
import { classifyFile, isMarkdownPath } from "../lib/file-kind";
import { saveTab } from "../lib/save-tab";
import { useTabs } from "../store/tabs";
import { useWorkspace } from "../store/workspace";
import { Editor } from "./Editor";
import { FileAccessErrorCard } from "./FileAccessErrorCard";
import { NonTextViewer } from "./NonTextViewer";

interface EditorPaneProps {
  workspace: string;
}

interface FsReadResult {
  content: string;
  encoding: string;
  mtime?: number | null;
  sha256?: string | null;
}

interface LoadedDoc {
  content: string;
  encoding: string;
}

const SAVE_DEBOUNCE_MS = 600;

export const EditorPane = memo(function EditorPane({ workspace }: EditorPaneProps) {
  const { t } = useTranslation();
  const activePath = useTabs((s) => s.activePath);
  const setDirty = useTabs((s) => s.setDirty);
  const readOnly = useWorkspace((s) => s.readOnly);

  const [docs, setDocs] = useState<Record<string, LoadedDoc>>({});
  const [, setLoading] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, AccessDecision>>({});
  const [reloadKey, setReloadKey] = useState(0);
  const liveContentRef = useRef<Record<string, string>>({});
  const saveTimerRef = useRef<number | null>(null);
  // S-EP-005: in-flight fetch ledger lives in a ref so the load effect can
  // depend only on (activePath, workspace) without re-running every time the
  // docs / loading / errors state mutates. Without this, setLoading triggers
  // a deps-driven cleanup (cancelled = true) that throws away the result and
  // re-arms the fetch — a livelock that pinned the UI on `editor.loading`.
  const inFlightRef = useRef<Set<string>>(new Set());

  // S-EP-010: classify the active file by extension. Binary kinds (image, pdf,
  // anything in the binary blocklist) skip the fs_read_file → CodeMirror path
  // entirely so we never paint raw bytes as "text". Memoized off the path so
  // a re-render with the same active tab is a no-op.
  const activeKind = useMemo(() => (activePath ? classifyFile(activePath) : "text"), [activePath]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: docs[activePath]/errors[activePath] are read once for early-return; adding them would re-trigger the read on every keystroke or error update. reloadKey is listed so a retry can re-run the fetch by clearing errors[activePath] and bumping the key.
  useEffect(() => {
    if (!activePath) return;
    if (activeKind !== "text") return;
    if (
      docs[activePath] !== undefined ||
      inFlightRef.current.has(activePath) ||
      errors[activePath]
    ) {
      return;
    }
    let cancelled = false;
    inFlightRef.current.add(activePath);
    setLoading((s) => {
      /* v8 ignore next -- inFlightRef early-returns the effect if the path is already loading, so the setLoading updater never sees a duplicate */
      if (s.has(activePath)) return s;
      const next = new Set(s);
      next.add(activePath);
      return next;
    });
    void (async () => {
      try {
        const result = await invoke<FsReadResult>("fs_read_file", {
          workspace,
          path: activePath,
        });
        if (cancelled) return;
        setDocs((d) => ({
          ...d,
          [activePath]: { content: result.content, encoding: result.encoding },
        }));
        liveContentRef.current[activePath] = result.content;
      } catch (err) {
        if (cancelled) return;
        // S-FAP-008: surface read failures through the access-policy card so
        // the user sees category + rule_id + actionable next step instead of
        // the legacy bare red placeholder. Once FAP-007 lands, the engine
        // will return a structured AccessDecision over IPC; until then we
        // promote the raw POSIX code into a best-effort rule_id.
        const decision = fromPosixError(err);
        setErrors((e) => ({ ...e, [activePath]: decision }));
      } finally {
        inFlightRef.current.delete(activePath);
        if (!cancelled) {
          setLoading((s) => {
            /* v8 ignore next -- the setLoading on entry always adds the path; the finally only runs after that, so the path is always present here */
            if (!s.has(activePath)) return s;
            const next = new Set(s);
            next.delete(activePath);
            return next;
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // reloadKey is included so the retry action can re-run the fetch by
    // clearing errors[activePath] and bumping the key.
  }, [activePath, workspace, activeKind, reloadKey]);

  const flushSave = useCallback(
    async (path: string) => {
      if (readOnly) return;
      const content = liveContentRef.current[path];
      /* v8 ignore next -- handleChange only schedules flushSave after writing into liveContentRef, so this guard only fires if the ref is cleared between schedule and flush — which we never do */
      if (content === undefined) return;
      await saveTab({ workspace, path, content });
    },
    [workspace, readOnly],
  );

  const handleChange = useCallback(
    (path: string) => (next: string) => {
      const prev = liveContentRef.current[path];
      liveContentRef.current[path] = next;
      const baseline = docs[path]?.content;
      const isDirty = baseline !== undefined && next !== baseline;
      setDirty(path, isDirty);
      if (prev === next) return;
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        if (isDirty) void flushSave(path);
      }, SAVE_DEBOUNCE_MS);
    },
    [docs, flushSave, setDirty],
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  if (!activePath) {
    return (
      <section
        className="flex flex-1 items-center justify-center p-6 text-[var(--color-muted)] text-sm"
        aria-label={t("editor.aria.empty", "Editor (no file open)")}
      >
        {t("editor.empty.hint", "Open a file from the sidebar to start reviewing.")}
      </section>
    );
  }

  if (activeKind !== "text") {
    return <NonTextViewer path={activePath} kind={activeKind} />;
  }

  const decision = errors[activePath];
  if (decision) {
    const retry = () => {
      setErrors((e) => {
        /* v8 ignore next -- retry is only rendered when errors[activePath] is set; the updater always sees the path present */
        if (!(activePath in e)) return e;
        const next = { ...e };
        delete next[activePath];
        return next;
      });
      setReloadKey((k) => k + 1);
    };
    const copyDiagnostics = () => {
      const payload = JSON.stringify(
        {
          ruleId: decision.ruleId,
          category: decision.category,
          path: activePath,
          vars: decision.vars ?? {},
        },
        null,
        2,
      );
      void navigator.clipboard?.writeText(payload);
    };
    return (
      <section
        className="flex flex-1 items-center justify-center p-6"
        aria-label={t("editor.aria.error", "Editor error")}
      >
        <FileAccessErrorCard
          decision={decision}
          className="max-w-lg"
          handlers={{ retry, copy_diagnostics: copyDiagnostics }}
        />
      </section>
    );
  }

  const doc = docs[activePath];
  if (!doc) {
    return (
      <section
        className="flex flex-1 items-center justify-center p-6 text-[var(--color-muted)] text-sm"
        aria-label={t("editor.aria.loading", "Loading file")}
      >
        {t("editor.loading", "Loading…")}
      </section>
    );
  }

  return (
    <section
      className="flex flex-1 min-h-0 min-w-0 flex-col"
      aria-label={t("editor.aria.host", "Editor")}
    >
      <Editor
        tabId={activePath}
        initialDoc={doc.content}
        language={isMarkdownPath(activePath) ? "markdown" : "plain"}
        onChange={handleChange(activePath)}
      />
    </section>
  );
});
