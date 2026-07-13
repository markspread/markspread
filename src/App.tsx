import { type ReactNode, useEffect } from "react";
import { ActivityBar } from "./components/ActivityBar";
import { AiActionPalette } from "./components/AiActionPalette";
import { AutoUpdateConsent } from "./components/AutoUpdateConsent";
import { ChordIndicator } from "./components/ChordIndicator";
import { CommandPalette } from "./components/CommandPalette";
import { CrashRecoveryDialog } from "./components/CrashRecoveryDialog";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ExportDialog } from "./components/ExportDialog";
import { ImageDialog } from "./components/ImageDialog";
import { IndexProgressBar } from "./components/IndexProgressBar";
import { InsertTableDialog } from "./components/InsertTableDialog";
import { LinkDialog } from "./components/LinkDialog";
import { TelemetryConsent } from "./components/TelemetryConsent";
import { ToastStack } from "./components/ToastStack";
import { useWorkspaceShellShortcuts } from "./hooks/useWorkspaceShellShortcuts";
import { registerCliForwardedListener } from "./lib/cli-forwarded";
import { registerDragDrop } from "./lib/dnd";
import { useFontFamilyEffect } from "./lib/font-effect";
import { currentHarnessMode } from "./lib/harness";
import { registerKeybindings } from "./lib/keybindings";
import { openSingleMdFromDialog } from "./lib/open-md-file";
import { newWorkspaceFromDialog, openWorkspaceFromDialog } from "./lib/open-workspace";
import { startParserHotReload } from "./lib/parsers/hot-reload-tauri";
import { registerPollingNoticeListener } from "./lib/polling-notice";
import { maybeStartUnmountWatch, registerUnmountListener, stopUnmountWatch } from "./lib/unmount";
import { HarnessRoot } from "./screens/HarnessRoot";
import { ParserWorkbench } from "./screens/ParserWorkbench";
import { SingleFile } from "./screens/SingleFile";
import { Welcome } from "./screens/Welcome";
import { WorkspaceShell } from "./screens/WorkspaceShell";
import { useActivityMode } from "./store/activity-mode";
import { useAiPalette } from "./store/ai-palette";
import { useDialogs } from "./store/dialogs";
import { useRecentWorkspaces } from "./store/recent-workspaces";
import { useSingleFile } from "./store/single-file";
import { useTabs } from "./store/tabs";
import { useWorkspace } from "./store/workspace";
import { useWorkspaceLayout } from "./store/workspace-layout";

function App() {
  const harness = currentHarnessMode();
  if (harness !== null) return <HarnessRoot mode={harness} />;
  return <RealApp />;
}

function RealApp() {
  const current = useWorkspace((s) => s.current);
  const singleFilePath = useSingleFile((s) => s.path);
  const activityMode = useActivityMode((s) => s.mode);
  const aiPaletteOpen = useAiPalette((s) => s.open);
  const aiPaletteContext = useAiPalette((s) => s.context);
  const closeAiPalette = useAiPalette((s) => s.close);
  const exportOpen = useDialogs((s) => s.exportDoc);
  const hideExport = useDialogs((s) => s.hideExport);
  const activeTabPath = useTabs((s) => s.activePath);

  useFontFamilyEffect();
  useEffect(() => registerDragDrop(), []);
  useEffect(() => registerCliForwardedListener(), []);
  useEffect(() => registerKeybindings(), []);
  useEffect(() => registerUnmountListener(), []);
  useEffect(() => registerPollingNoticeListener(), []);
  // S-MWS-004: 워크스페이스 셸 단축키 (Mod+T/W/\\/Shift+\\/1..9).
  useWorkspaceShellShortcuts();
  useEffect(() => {
    if (!current) return;
    void maybeStartUnmountWatch(current);
    return () => {
      void stopUnmountWatch(current);
    };
  }, [current]);
  // SC-WB-03 / S-PSDK-004: `.markspread/parsers/` 하위 파일 변경 감시 →
  // 파서 자동 re-register. 워크스페이스가 바뀌면 이전 감시를 정리하고 새로 연다.
  useEffect(() => {
    if (!current) return;
    return startParserHotReload(current);
  }, [current]);
  // S-MWS-005: 워크스페이스가 처음 열릴 때 셸 레이아웃을 초기화. 두 번째 호출부터는
  // ensure 가 기존 레이아웃을 그대로 반환하므로 비용 없음.
  useEffect(() => {
    if (!current) return;
    useWorkspaceLayout.getState().ensure(current);
  }, [current]);

  // ADR-0019 §Decision.1 routing matrix:
  //   singleFile → SingleFile (rail-less floating 1-doc surface, P-reviewer)
  //   workspace  → ActivityBar rail + 2-mode router:
  //                  parser    → ParserWorkbench (조건부 표면)
  //                  workspace → WorkspaceShell (단일 통합 셸 + Chat 토글)
  //   else       → Welcome
  // The chat/editor `preferredShell` branch is gone — there is one shell.
  let body: ReactNode;
  if (singleFilePath) {
    body = <SingleFile />;
  } else if (current) {
    body = (
      <div className="flex h-full w-full min-h-0">
        <ActivityBar />
        <div className="flex min-w-0 flex-1 flex-col">
          {activityMode === "parser" ? <ParserWorkbench workspace={current} /> : <WorkspaceShell />}
        </div>
      </div>
    );
  } else {
    body = (
      <Welcome
        onOpenWorkspace={() => {
          void openWorkspaceFromDialog();
        }}
        onNewWorkspace={() => {
          void newWorkspaceFromDialog();
        }}
        onSkipToSingleFile={() => {
          void openSingleMdFromDialog();
        }}
        onOpenRecent={(path) => {
          useWorkspace.getState().open(path);
          useRecentWorkspaces.getState().add(path);
        }}
      />
    );
  }

  return (
    <ErrorBoundary boundaryId="app">
      <div className="flex h-full w-full flex-col">
        {body}
        <AutoUpdateConsent />
        <CrashRecoveryDialog />
        <TelemetryConsent />
        <CommandPalette />
        <AiActionPalette
          open={aiPaletteOpen}
          context={aiPaletteContext}
          onClose={closeAiPalette}
          onInvoke={(actionId) => {
            console.warn("[ai-palette] invoke pending LLM wiring", actionId);
            closeAiPalette();
          }}
        />
        <ToastStack />
        <IndexProgressBar />
        <InsertTableDialog />
        <ImageDialog />
        <LinkDialog />
        <ExportDialog
          open={exportOpen}
          onClose={hideExport}
          documentPath={activeTabPath}
          documentTitle={
            activeTabPath
              ? /* v8 ignore next -- split() on a non-empty string always yields at least one element, so the `?? ""` fallback is unreachable */
                (activeTabPath.split(/[/\\]/).pop() ?? "")
              : "Untitled"
          }
          bodyHtml=""
        />
        <div className="pointer-events-none fixed bottom-2 right-2 z-50">
          <ChordIndicator />
        </div>
      </div>
    </ErrorBoundary>
  );
}

export default App;
