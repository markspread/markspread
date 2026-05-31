// ADR-0010 D2 (right column) + D4: ContextPanel — file tree,
// active preview, pinned snippets, token gauge.
//
// FIX: 이전 버전은 file tree 가 stub 문자열이라 ChatShell 에서 파일 선택 불가.
// 실제 <FileTree workspace> 컴포넌트 wire 함.

import { useMemo } from "react";
import { FileTree } from "../../components/FileTree";
import { buildContextPack } from "../../lib/ai/context-pack";
import { useTabs } from "../../store/tabs";

export interface ContextPanelProps {
  workspaceId: string;
  activeFilePath: string | null;
  onPickFile: (path: string | null) => void;
}

const DEFAULT_TOKEN_BUDGET = 16_000;

export function ContextPanel({ workspaceId, activeFilePath, onPickFile }: ContextPanelProps) {
  // FIX: FileTree 클릭 시 useTabs.activePath 가 업데이트되는데 ContextPanel 의 activeFilePath
  //      prop 은 부모(ChatShell)의 setActiveFilePath 가 호출돼야만 갱신됨.
  //      useTabs 를 직접 구독해서 "ACTIVE PREVIEW" 표시·context-pack 계산에 사용.
  const tabsActivePath = useTabs((s) => s.activePath);
  const effectiveActivePath = activeFilePath ?? tabsActivePath;
  const pack = useMemo(
    () =>
      buildContextPack({
        workspaceId,
        activeFilePath: effectiveActivePath,
        activeFileContent: null,
        selection: null,
        recentlyEdited: [],
        pinnedSnippets: [],
        tokenBudget: DEFAULT_TOKEN_BUDGET,
      }),
    [workspaceId, effectiveActivePath],
  );

  const pct = Math.min(100, Math.round((pack.tokensUsed / pack.tokensBudget) * 100));

  return (
    <div className="flex h-full flex-col">
      <section
        className="flex max-h-[40%] flex-col border-[var(--color-border)] border-b"
        data-testid="chat-file-tree"
      >
        <div className="border-[var(--color-border)] border-b px-2 py-1 text-[var(--color-muted)] text-xs uppercase tracking-wide">
          Files
        </div>
        {workspaceId ? (
          <div className="flex-1 overflow-hidden">
            <FileTree workspace={workspaceId} />
          </div>
        ) : (
          <div className="p-2 text-[var(--color-muted)] text-xs italic">(no workspace)</div>
        )}
        {effectiveActivePath && (
          <button
            type="button"
            data-testid="chat-clear-active-file"
            onClick={() => onPickFile(null)}
            className="border-[var(--color-border)] border-t p-1 text-[var(--color-accent)] text-xs underline"
          >
            Clear active file
          </button>
        )}
      </section>
      <section className="flex-1 overflow-auto border-[var(--color-border)] border-b p-2">
        <div className="mb-1 text-[var(--color-muted)] text-xs uppercase tracking-wide">
          Active preview
        </div>
        <div data-testid="chat-active-preview" className="text-sm">
          {effectiveActivePath ? (
            <span className="truncate font-medium" title={effectiveActivePath}>
              {effectiveActivePath.split(/[/\\]/).pop() ?? effectiveActivePath}
            </span>
          ) : (
            <span className="text-[var(--color-muted)] italic">No file selected</span>
          )}
        </div>
      </section>
      <section className="border-[var(--color-border)] border-b p-2">
        <div className="mb-1 text-[var(--color-muted)] text-xs uppercase tracking-wide">
          Pinned snippets
        </div>
        <div data-testid="chat-pinned" className="text-[var(--color-muted)] text-xs italic">
          No pins yet
        </div>
      </section>
      <section className="p-2" data-testid="chat-token-gauge">
        <div className="mb-1 text-[var(--color-muted)] text-xs uppercase tracking-wide">
          Context tokens
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded bg-[var(--color-border)]"
          role="progressbar"
          tabIndex={0}
          aria-valuemin={0}
          aria-valuemax={pack.tokensBudget}
          aria-valuenow={pack.tokensUsed}
          aria-label="Context token usage"
        >
          <div
            className="h-full bg-[var(--color-accent)]"
            style={{ width: `${pct}%` }}
            data-testid="chat-token-gauge-fill"
          />
        </div>
        <div className="mt-1 text-[var(--color-muted)] text-xs">
          {pack.tokensUsed} / {pack.tokensBudget} ({pct}%)
        </div>
      </section>
    </div>
  );
}
