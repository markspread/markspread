import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { ask } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRecentWorkspaces } from "../store/recent-workspaces";

type RecentStatus = "pending" | "ok" | "missing" | "unmounted";

interface DriveInfo {
  kind: "internal" | "external" | "network" | "unknown";
}

interface WelcomeProps {
  onOpenWorkspace?: () => void;
  onNewWorkspace?: () => void;
  onSkipToSingleFile?: () => void;
  onOpenRecent?: (path: string) => void;
}

export function Welcome({
  onOpenWorkspace,
  onNewWorkspace,
  onSkipToSingleFile,
  onOpenRecent,
}: WelcomeProps = {}) {
  const { t } = useTranslation();
  const [version, setVersion] = useState<string>("");
  const recent = useRecentWorkspaces((s) => s.recent);
  const removeRecent = useRecentWorkspaces((s) => s.remove);
  const recentRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [focusedIdx, setFocusedIdx] = useState<number>(-1);
  const [statuses, setStatuses] = useState<Record<string, RecentStatus>>({});

  useEffect(() => {
    let cancelled = false;
    getVersion()
      .then((v) => {
        if (!cancelled) setVersion(v);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // S-WS-019: validate Recent paths off the render path. Each path is
    // marked pending then resolved to ok / missing / unmounted independently
    // so a slow network drive doesn't gate the rest.
    let cancelled = false;
    setStatuses(
      Object.fromEntries(recent.map((w) => [w.path, "pending" as RecentStatus])),
    );
    for (const w of recent) {
      void (async () => {
        try {
          // fs_stat requires a workspace + a path within it. The recent
          // entry IS the workspace, so we ask it to stat itself via ".".
          await invoke("fs_stat", { workspace: w.path, path: "." });
          if (!cancelled) {
            setStatuses((s) => ({ ...s, [w.path]: "ok" }));
          }
        } catch {
          let unmounted = false;
          try {
            const drive = await invoke<DriveInfo>("drive_classify", {
              path: w.path,
            });
            unmounted = drive.kind === "external" || drive.kind === "network";
          } catch {}
          if (!cancelled) {
            setStatuses((s) => ({
              ...s,
              [w.path]: unmounted ? "unmounted" : "missing",
            }));
          }
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [recent]);

  async function handleRecentClick(path: string): Promise<void> {
    const status = statuses[path];
    if (status === "missing") {
      const proceed = await ask(
        t(
          "welcome.recent.missing_prompt",
          "This path can no longer be found. Remove it from Recent?",
        ),
        { title: "Markspread", kind: "warning" },
      );
      if (proceed) removeRecent(path);
      return;
    }
    if (status === "unmounted") {
      await ask(
        t(
          "welcome.recent.unmounted_prompt",
          "The drive for this workspace is not connected. Mount it and try again.",
        ),
        { title: "Markspread", kind: "info" },
      );
      return;
    }
    onOpenRecent?.(path);
  }

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key.toLowerCase() === "o" && !e.shiftKey) {
        e.preventDefault();
        onOpenWorkspace?.();
      } else if (cmd && e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        onNewWorkspace?.();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onSkipToSingleFile?.();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onOpenWorkspace, onNewWorkspace, onSkipToSingleFile]);

  return (
    <main
      className="grid h-full w-full grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
      role="main"
      aria-label={t("welcome.aria.main", "Welcome screen")}
    >
      {/* Left panel: logo + version */}
      <aside
        className="flex flex-col items-center justify-center border-[var(--color-border)] border-r bg-[var(--color-surface-subtle)] px-8 py-12"
        aria-label={t("welcome.aria.brand", "Brand")}
      >
        <h1 className="font-bold text-5xl tracking-tight">Markspread</h1>
        <p className="mt-3 text-[var(--color-muted)] text-sm">
          {t("app.tagline", "A lightweight markdown reviewer for the AI era")}
        </p>
        {version && (
          <p className="mt-12 text-[var(--color-muted)] text-xs">v{version}</p>
        )}
      </aside>

      {/* Right panel: actions + recent */}
      <section
        className="flex flex-col gap-8 px-12 py-12"
        aria-label={t("welcome.aria.actions", "Get started")}
      >
        <div className="flex flex-col gap-3">
          <button
            type="button"
            className="rounded-md bg-[var(--color-accent)] px-6 py-3 text-left font-medium text-white hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2"
            onClick={onOpenWorkspace}
          >
            <span className="block">
              {t("welcome.action.open_workspace", "Open workspace")}
            </span>
            <span className="mt-1 block text-white/70 text-xs">
              <kbd>⌘O</kbd>
            </span>
          </button>
          <button
            type="button"
            className="rounded-md border border-[var(--color-border)] px-6 py-3 text-left font-medium hover:bg-[var(--color-border)]/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2"
            onClick={onNewWorkspace}
          >
            <span className="block">
              {t("welcome.action.new_workspace", "Create new workspace")}
            </span>
            <span className="mt-1 block text-[var(--color-muted)] text-xs">
              <kbd>⌘⇧N</kbd>
            </span>
          </button>
          <button
            type="button"
            className="text-left text-[var(--color-accent)] text-sm hover:underline focus:outline-none"
            onClick={onSkipToSingleFile}
          >
            {t("welcome.action.single_file", "Open single markdown file")}{" "}
            <kbd className="ml-1 text-xs">Esc</kbd>
          </button>
        </div>

        <div>
          <h2 className="mb-3 font-semibold text-[var(--color-muted)] text-xs uppercase tracking-wider">
            {t("welcome.recent.heading", "Recent workspaces")}
          </h2>
          {recent.length === 0 ? (
            <div
              className="flex items-center gap-3 text-[var(--color-muted)] text-sm"
              aria-label={t("welcome.recent.empty.aria", "Empty")}
            >
              <svg
                width="40"
                height="40"
                viewBox="0 0 40 40"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="opacity-50"
              >
                <path d="M5 10 h12 l3 3 h15 v18 a2 2 0 0 1 -2 2 H7 a2 2 0 0 1 -2 -2 z" />
                <path d="M14 22 h12 M14 26 h8" />
              </svg>
              <span>
                {t(
                  "welcome.recent.empty.label",
                  "No recently opened workspaces",
                )}
              </span>
            </div>
          ) : (
            <ul
              className="flex flex-col gap-1"
              role="listbox"
              aria-label={t("welcome.recent.list.aria", "Recent workspaces")}
              onKeyDown={(e) => {
                if (recent.length === 0) return;
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  const next =
                    focusedIdx < 0
                      ? 0
                      : Math.min(focusedIdx + 1, recent.length - 1);
                  setFocusedIdx(next);
                  recentRefs.current[next]?.focus();
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  const next = Math.max(focusedIdx - 1, 0);
                  setFocusedIdx(next);
                  recentRefs.current[next]?.focus();
                } else if (e.key === "Enter" && focusedIdx >= 0) {
                  e.preventDefault();
                  const f = recent[focusedIdx];
                  if (f) void handleRecentClick(f.path);
                }
              }}
            >
              {recent.map((w, i) => {
                const segments = w.path.split(/[/\\]/);
                const label = segments[segments.length - 1] || w.path;
                const status = statuses[w.path] ?? "pending";
                const dim = status === "missing" || status === "unmounted";
                const icon =
                  status === "missing"
                    ? "⚠"
                    : status === "unmounted"
                      ? "⏏"
                      : null;
                return (
                  <li
                    key={w.path}
                    role="option"
                    aria-selected={focusedIdx === i}
                    className="group relative"
                  >
                    <button
                      ref={(el) => {
                        recentRefs.current[i] = el;
                      }}
                      type="button"
                      className={`flex w-full items-baseline gap-2 truncate rounded px-2 py-1 pr-8 text-left text-sm hover:bg-[var(--color-border)]/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] ${
                        dim ? "text-[var(--color-muted)]" : ""
                      }`}
                      title={
                        status === "missing"
                          ? t("welcome.recent.title_missing", "{{path}} (not found)", {
                              path: w.path,
                            })
                          : status === "unmounted"
                            ? t(
                                "welcome.recent.title_unmounted",
                                "{{path}} (drive not mounted)",
                                { path: w.path },
                              )
                            : w.path
                      }
                      onClick={() => void handleRecentClick(w.path)}
                      onFocus={() => setFocusedIdx(i)}
                    >
                      {icon && (
                        <span aria-hidden="true" className="text-xs">
                          {icon}
                        </span>
                      )}
                      <span className="truncate font-medium">{label}</span>
                      <span className="truncate text-[var(--color-muted)] text-xs">
                        {w.path}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={t(
                        "welcome.recent.remove.aria",
                        "Remove from recent",
                      )}
                      title={t(
                        "welcome.recent.remove",
                        "Remove from recent",
                      )}
                      className="-translate-y-1/2 absolute top-1/2 right-1 hidden h-6 w-6 items-center justify-center rounded text-[var(--color-muted)] hover:bg-[var(--color-border)]/50 hover:text-[var(--color-fg)] focus:flex focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] group-hover:flex"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeRecent(w.path);
                      }}
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
