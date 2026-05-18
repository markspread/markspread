// S-BK-* host surface: snapshot list + restore + export/import. The
// snapshot writer runs on the Rust side (timer-driven), so this panel
// only reads the rolling list and offers manual recovery actions.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  listSnapshots,
  restoreSnapshot,
  type SnapshotRecord,
} from "../lib/backup/backup";
import { useWorkspace } from "../store/workspace";

function fmtDate(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function SettingsBackup() {
  const { t } = useTranslation();
  const current = useWorkspace((s) => s.current);
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!current) return;
    void (async () => {
      try {
        const list = await listSnapshots(current);
        setSnapshots(list);
      } catch (e) {
        setError(String((e as { message?: string })?.message ?? e));
      }
    })();
  }, [current]);

  const restore = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await restoreSnapshot(id);
    } catch (e) {
      setError(String((e as { message?: string })?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label={t("settings.backup.title", "Backup & Restore")}
      className="flex flex-col gap-3 border-[var(--color-border)] border-b p-4 text-sm"
    >
      <h2 className="font-semibold text-base">
        {t("settings.backup.title", "Backup & Restore")}
      </h2>
      {error && (
        <p role="alert" className="text-red-500 text-xs">
          {error}
        </p>
      )}
      {!current ? (
        <p className="text-[var(--color-muted)] text-xs">
          {t("settings.backup.no_workspace", "Open a workspace to view snapshots.")}
        </p>
      ) : snapshots.length === 0 ? (
        <p className="text-[var(--color-muted)] text-xs">
          {t("settings.backup.empty", "No snapshots yet for this workspace.")}
        </p>
      ) : (
        <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
          {snapshots.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between rounded border border-[var(--color-border)] px-3 py-1.5 text-xs"
            >
              <span>
                {fmtDate(s.ts)} · {s.newBlobs} files · {fmtBytes(s.bytesAdded)}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void restore(s.id)}
                className="text-[var(--color-accent)] hover:underline disabled:opacity-50"
              >
                {t("settings.backup.restore", "Restore")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
