import { useEffect, useState } from "react";
import type { HarnessMode } from "../lib/harness";
import { HarnessFirstLaunch } from "./HarnessFirstLaunch";
import { HarnessPluginHost } from "./HarnessPluginHost";
import { HarnessWorkspace } from "./HarnessWorkspace";

export function HarnessRoot({ mode }: { mode: HarnessMode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setReady(true), 0);
    return () => clearTimeout(id);
  }, []);
  return (
    <div data-harness-ready={ready ? "true" : "false"} data-harness-mode={mode}>
      <HarnessContent mode={mode} />
    </div>
  );
}

function HarnessContent({ mode }: { mode: HarnessMode }) {
  if (mode === "fresh-install") return <HarnessFirstLaunch />;
  if (mode === "returning-user") return <div data-testid="workspace-shell">Workspace.</div>;
  if (mode === "empty-home" || mode === "workspace-with-links" || mode === "workspace-with-content")
    return <HarnessWorkspace mode={mode} />;
  if (mode === "plugin-host") return <HarnessPluginHost />;
  return <div data-testid="workspace-shell">Harness {mode}.</div>;
}
