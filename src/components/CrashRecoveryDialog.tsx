// S-ER-008 / S-BK-003: on boot, check whether the previous session
// crashed (a stale beacon with dirty buffers). When it did, call
// backup_propose_recovery for the current workspace and offer the user
// the listed snapshots. Selecting a snapshot fires backup_snapshot_restore.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusTrap } from "../lib/focus-trap";
import { readBeacon, clearBeacon } from "../lib/errors/crash-recovery";
import { proposeRecovery, restoreSnapshot, type RecoveryProposal } from "../lib/backup/backup";
import { useWorkspace } from "../store/workspace";

export function CrashRecoveryDialog() {
  const { t } = useTranslation();
  const workspace = useWorkspace((s) => s.current);
  const [proposal, setProposal] = useState<RecoveryProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const trapRef = useFocusTrap<HTMLDivElement>({
    active: !!proposal,
    onEscape: () => setProposal(null),
  });

  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    (async () => {
      try {
        const beacon = await readBeacon();
        if (cancelled || !beacon) return;
        const hadDirty = beacon.buffers.some((b) => b.dirty);
        if (!hadDirty) {
          await clearBeacon();
          return;
        }
        const result = await proposeRecovery(workspace);
        if (cancelled) return;
        if (result.snapshots.length > 0) setProposal(result);
        else await clearBeacon();
      } catch (e) {
        console.warn("[crash-recovery] proposal failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspace]);

  if (!proposal) return null;

  const onRestore = async (snapshotId: string) => {
    setBusy(true);
    try {
      await restoreSnapshot(snapshotId);
      await clearBeacon();
      setProposal(null);
    } catch (e) {
      console.warn("[crash-recovery] restore failed", e);
    } finally {
      setBusy(false);
    }
  };

  const onDismiss = async () => {
    await clearBeacon().catch(() => {});
    setProposal(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label={t("recovery.aria", "Recover unsaved changes")}
    >
      <div
        ref={trapRef}
        className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl"
      >
        <h2 className="font-semibold text-base">
          {t("recovery.title", "Recover unsaved changes?")}
        </h2>
        <p className="mt-1 text-[var(--color-muted)] text-xs">
          {t(
            "recovery.body",
            "The previous session ended unexpectedly. Pick a snapshot to restore.",
          )}
        </p>
        <ul className="mt-3 flex max-h-60 flex-col gap-1 overflow-y-auto">
          {proposal.snapshots.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-2 rounded border border-[var(--color-border)] px-3 py-1.5 text-xs"
            >
              <span className="flex flex-col">
                <span className="font-medium">
                  {new Date(s.ts).toLocaleString()}
                </span>
                <span className="text-[var(--color-muted)]">
                  +{s.newBlobs} blobs · {(s.bytesAdded / 1024).toFixed(1)} KiB
                </span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onRestore(s.id)}
                className="rounded bg-[var(--color-accent)] px-3 py-1 text-white disabled:opacity-50"
              >
                {t("recovery.restore", "Restore")}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onDismiss()}
            className="rounded border border-[var(--color-border)] px-4 py-1.5 text-sm hover:bg-[var(--color-border)]/30 disabled:opacity-50"
          >
            {t("recovery.dismiss", "Dismiss")}
          </button>
        </div>
      </div>
    </div>
  );
}
