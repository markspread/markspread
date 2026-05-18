import { listen } from "@tauri-apps/api/event";
import { useToasts } from "../store/toasts";

interface PollingNotice {
  workspace: string;
  reason: string;
}

const seen = new Set<string>();

/**
 * S-WS-025: surface the network-drive polling fallback exactly once per
 * workspace per session so users understand why save→external→reload may
 * lag a few seconds.
 */
export function registerPollingNoticeListener(): () => void {
  let unlisten: (() => void) | null = null;
  listen<PollingNotice>("fs:polling_fallback", (evt) => {
    const ws = evt.payload.workspace;
    if (seen.has(ws)) return;
    seen.add(ws);
    useToasts.getState().push({
      kind: "info",
      message: "watcher.polling_fallback",
      details: evt.payload.reason,
      ttlMs: 10000,
    });
  })
    .then((u) => {
      unlisten = u;
    })
    .catch(() => {});
  return () => unlisten?.();
}
