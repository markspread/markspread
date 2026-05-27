// S-PL-SEC-001 (MAR-1019): standalone chat-side panel for LLM-assisted
// plugin authoring.
//
// 본 컴포넌트는 **마운트 포인트를 가정하지 않는다** — ChatShell 의
// ContextPanel 안에 fit-to-content 으로 떨어지도록 self-contained. 이
// 분리는 U2 의 ChatShell 편집과 충돌 회피를 위해 의도된 것 (mount 작업은
// 후속 wiring 티켓이 처리).
//
// 책임:
//   1. 현재 draft (manifest + index.js + README) 표시.
//   2. Install / Reload / Open in Editor 버튼.
//   3. validateManifest 의 결과를 inline 으로 표시 (에이전트 자기수정용).
//
// 본 컴포넌트는 PluginHost 와 "Open in Editor" 콜백을 prop 으로 받는다 —
// 테스트가 host 를 fake 로 대체할 수 있고, prod wiring 은 useEffect 로
// 글로벌 host 를 잡아 prop 으로 전달한다.

import { invoke } from "@tauri-apps/api/core";
import { useMemo, useState } from "react";
import type { PluginHost } from "../lib/plugins/runtime/host";
import { type ScaffoldFiles, installScaffold } from "../lib/plugins/scaffold";
import { validateManifest } from "../lib/plugins/scaffold";

export interface PluginAuthorPanelProps {
  /** Plugin host — 테스트는 fake 를 주입한다. */
  host: PluginHost;
  /** 현재 draft. 부모(ChatShell)가 LLM 출력을 받아 setState 한다. */
  draft: { name: string; files: ScaffoldFiles } | null;
  /** "Open in Editor" 클릭 시 호출. 디폴트는 noop (테스트). */
  onOpenInEditor?: (path: string) => void;
}

type Status =
  | { kind: "idle" }
  | { kind: "busy"; label: string }
  | { kind: "ok"; message: string }
  | { kind: "err"; message: string };

export function PluginAuthorPanel({ host, draft, onOpenInEditor }: PluginAuthorPanelProps) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [activeTab, setActiveTab] = useState<keyof ScaffoldFiles>("markspread-plugin.json");

  const validation = useMemo(() => {
    if (!draft) return null;
    return validateManifest(draft.files["markspread-plugin.json"]);
  }, [draft]);

  if (!draft) {
    return (
      <div className="ms-plugin-author-panel" data-testid="plugin-author-panel-empty">
        <p className="text-[var(--color-muted)] text-sm">
          No plugin draft yet. Ask the agent to "scaffold a plugin for …" to begin.
        </p>
      </div>
    );
  }

  const install = async () => {
    setStatus({ kind: "busy", label: "Installing…" });
    try {
      const result = await installScaffold(host, draft.name, draft.files);
      setStatus({
        kind: "ok",
        message: `Installed at ${result.pluginDir}`,
      });
    } catch (e) {
      setStatus({ kind: "err", message: (e as Error).message });
    }
  };

  const reload = async () => {
    setStatus({ kind: "busy", label: "Reloading…" });
    try {
      await host.reload(draft.name);
      setStatus({ kind: "ok", message: `Reloaded ${draft.name}` });
    } catch (e) {
      setStatus({ kind: "err", message: (e as Error).message });
    }
  };

  const openInEditor = async () => {
    try {
      const dir = await invoke<string>("plugin_runtime_dir");
      const path = `${dir}/${draft.name}/index.js`;
      onOpenInEditor?.(path);
    } catch (e) {
      setStatus({ kind: "err", message: (e as Error).message });
    }
  };

  return (
    <div className="ms-plugin-author-panel" data-testid="plugin-author-panel">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold text-sm">Plugin draft: {draft.name}</h3>
        <div className="flex gap-1">
          <button
            type="button"
            className="rounded border px-2 py-1 text-xs"
            data-testid="plugin-author-install"
            onClick={() => void install()}
          >
            Install
          </button>
          <button
            type="button"
            className="rounded border px-2 py-1 text-xs"
            data-testid="plugin-author-reload"
            onClick={() => void reload()}
          >
            Reload
          </button>
          <button
            type="button"
            className="rounded border px-2 py-1 text-xs"
            data-testid="plugin-author-open"
            onClick={() => void openInEditor()}
          >
            Open
          </button>
        </div>
      </div>

      <div className="mb-2 flex gap-1 border-b text-xs" role="tablist">
        {(Object.keys(draft.files) as Array<keyof ScaffoldFiles>).map((path) => (
          <button
            type="button"
            key={path}
            role="tab"
            aria-selected={activeTab === path}
            className={`px-2 py-1 ${activeTab === path ? "border-b-2 font-semibold" : ""}`}
            onClick={() => setActiveTab(path)}
            data-testid={`plugin-author-tab-${path}`}
          >
            {path}
          </button>
        ))}
      </div>

      <pre
        className="overflow-auto rounded bg-[var(--color-bg-alt,#f6f6f6)] p-2 text-xs"
        data-testid="plugin-author-preview"
      >
        {draft.files[activeTab]}
      </pre>

      {validation && !validation.ok && (
        <ul className="mt-2 text-rose-700 text-xs" data-testid="plugin-author-errors">
          {validation.errors.map((e) => (
            <li key={`${e.path}-${e.message}`}>
              <strong>{e.path}</strong>: {e.message}
              {e.hint && <em className="ml-1 text-rose-500">— {e.hint}</em>}
            </li>
          ))}
        </ul>
      )}
      {validation?.ok && validation.warnings.length > 0 && (
        <ul className="mt-2 text-amber-700 text-xs" data-testid="plugin-author-warnings">
          {validation.warnings.map((w) => (
            <li key={`${w.path}-${w.message}`}>
              <strong>{w.path}</strong>: {w.message}
            </li>
          ))}
        </ul>
      )}

      {status.kind === "busy" && (
        <p className="mt-2 text-[var(--color-muted)] text-xs" data-testid="plugin-author-busy">
          {status.label}
        </p>
      )}
      {status.kind === "ok" && (
        <p className="mt-2 text-emerald-700 text-xs" data-testid="plugin-author-ok">
          {status.message}
        </p>
      )}
      {status.kind === "err" && (
        <p className="mt-2 text-rose-700 text-xs" data-testid="plugin-author-error">
          {status.message}
        </p>
      )}
    </div>
  );
}
