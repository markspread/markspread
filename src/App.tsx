import { type ReactNode, useEffect } from "react";
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
import { registerCliForwardedListener } from "./lib/cli-forwarded";
import { registerDragDrop } from "./lib/dnd";
import { useFontFamilyEffect } from "./lib/font-effect";
import { registerKeybindings } from "./lib/keybindings";
import { openSingleMdFromDialog } from "./lib/open-md-file";
import { newWorkspaceFromDialog, openWorkspaceFromDialog } from "./lib/open-workspace";
import { registerPollingNoticeListener } from "./lib/polling-notice";
import { maybeStartUnmountWatch, registerUnmountListener, stopUnmountWatch } from "./lib/unmount";
import { Main } from "./screens/Main";
import { SingleFile } from "./screens/SingleFile";
import { Welcome } from "./screens/Welcome";
import { useAiPalette } from "./store/ai-palette";
import { useDialogs } from "./store/dialogs";
import { useRecentWorkspaces } from "./store/recent-workspaces";
import { useSingleFile } from "./store/single-file";
import { useTabs } from "./store/tabs";
import { useWorkspace } from "./store/workspace";

function App() {
  const current = useWorkspace((s) => s.current);
  const singleFilePath = useSingleFile((s) => s.path);
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
  useEffect(() => {
    if (!current) return;
    void maybeStartUnmountWatch(current);
    return () => {
      void stopUnmountWatch(current);
    };
  }, [current]);

  let body: ReactNode;
  if (current) {
    body = <Main />;
  } else if (singleFilePath) {
    body = <SingleFile />;
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
          documentTitle={activeTabPath ? (activeTabPath.split(/[/\\]/).pop() ?? "") : "Untitled"}
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
