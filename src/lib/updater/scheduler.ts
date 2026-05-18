// S-UP-001 boot wiring: schedule update checks. Runs the first check 5s
// after boot (giving first paint priority) and re-checks every 6 hours.
// When the user has already granted "allow" via AutoUpdateConsent, the
// scheduler also fires the download immediately; otherwise it just
// surfaces the available state for the UI to pick up.

import { useUpdater } from "../../store/updater";
import { checkForUpdate, startDownload } from "./updater";

const FIRST_CHECK_DELAY_MS = 5_000;
const POLL_INTERVAL_MS = 6 * 60 * 60 * 1_000;

let started = false;

export function startUpdaterScheduler(): void {
  if (started) return;
  started = true;

  const tick = async () => {
    try {
      // Channel selection lives in the (future) UpdaterSettings store;
      // for now the boot scheduler uses the stable channel and Settings
      // → Update lets the user manually re-check on other channels.
      const manifest = await checkForUpdate("stable");
      if (!manifest) return;
      const consent = useUpdater.getState().consent;
      if (consent === "allow") {
        await startDownload(manifest);
      }
    } catch (e) {
      console.warn("[updater/scheduler] check failed", e);
    }
  };

  setTimeout(() => {
    void tick();
    setInterval(() => void tick(), POLL_INTERVAL_MS);
  }, FIRST_CHECK_DELAY_MS);
}
