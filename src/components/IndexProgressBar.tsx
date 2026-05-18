import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

interface IndexProgress {
  workspace: string;
  files_seen: number;
  bytes_seen: number;
  state: "empty" | "rebuilding" | "ready" | "stale";
}

/**
 * S-WS-022: surfaces background re-index progress at the bottom of the
 * window. Hidden when no rebuild is in flight.
 */
export function IndexProgressBar() {
  const [active, setActive] = useState<IndexProgress | null>(null);

  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    listen<IndexProgress>("fs:index:progress", (evt) => {
      if (evt.payload.state === "rebuilding") setActive(evt.payload);
    })
      .then((u) => unlisteners.push(u))
      .catch(() => {});
    listen<IndexProgress>("fs:index:done", () => setActive(null))
      .then((u) => unlisteners.push(u))
      .catch(() => {});
    return () => {
      for (const u of unlisteners) u();
    };
  }, []);

  if (!active) return null;
  return (
    <output
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 flex items-center justify-center bg-[var(--color-surface-subtle)] px-4 py-1 text-[var(--color-muted)] text-xs"
    >
      <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--color-accent)]" />
      <span>
        인덱스 재구축 중 — {active.files_seen}개 파일, {Math.round(active.bytes_seen / 1024)} KB
      </span>
    </output>
  );
}
