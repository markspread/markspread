import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SnapshotRecord } from "../lib/backup/backup";

const listSnapshots = vi.fn<(ws: string) => Promise<SnapshotRecord[]>>(() => Promise.resolve([]));
const restoreSnapshot = vi.fn((_id: string) => Promise.resolve());
vi.mock("../lib/backup/backup", () => ({
  listSnapshots: (ws: string) => listSnapshots(ws),
  restoreSnapshot: (id: string) => restoreSnapshot(id),
}));

import { useWorkspace } from "../store/workspace";
import { SettingsBackup } from "./SettingsBackup";

afterEach(cleanup);

describe("SettingsBackup", () => {
  beforeEach(() => {
    useWorkspace.setState({ current: null } as never);
    listSnapshots.mockResolvedValue([]);
  });

  it("prompts to open a workspace when none is open", () => {
    render(<SettingsBackup />);
    expect(screen.getByText("Open a workspace to view snapshots.")).toBeTruthy();
  });

  it("shows the empty state when there are no snapshots", async () => {
    useWorkspace.setState({ current: "/tmp/ws" } as never);
    render(<SettingsBackup />);
    await waitFor(() =>
      expect(screen.getByText("No snapshots yet for this workspace.")).toBeTruthy(),
    );
  });

  it("lists snapshots and restores one", async () => {
    useWorkspace.setState({ current: "/tmp/ws" } as never);
    listSnapshots.mockResolvedValue([
      { id: "snap-1", ts: Date.now(), newBlobs: 4, bytesAdded: 2048 } as SnapshotRecord,
    ]);
    render(<SettingsBackup />);
    await waitFor(() => expect(screen.getByText("Restore")).toBeTruthy());
    await act(async () => {
      screen.getByText("Restore").click();
    });
    expect(restoreSnapshot).toHaveBeenCalledWith("snap-1");
  });
});
