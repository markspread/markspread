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

  it("surfaces an error when listSnapshots rejects", async () => {
    useWorkspace.setState({ current: "/tmp/ws" } as never);
    listSnapshots.mockRejectedValueOnce(new Error("list failed"));
    render(<SettingsBackup />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("list failed"));
  });

  it("stringifies a non-Error rejection from listSnapshots", async () => {
    useWorkspace.setState({ current: "/tmp/ws" } as never);
    listSnapshots.mockRejectedValueOnce("plain-list-error");
    render(<SettingsBackup />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("plain-list-error"));
  });

  it("surfaces an error when restoreSnapshot rejects", async () => {
    useWorkspace.setState({ current: "/tmp/ws" } as never);
    listSnapshots.mockResolvedValue([
      { id: "snap-2", ts: Date.now(), newBlobs: 1, bytesAdded: 256 } as SnapshotRecord,
    ]);
    restoreSnapshot.mockRejectedValueOnce(new Error("restore boom"));
    render(<SettingsBackup />);
    await waitFor(() => expect(screen.getByText("Restore")).toBeTruthy());
    await act(async () => {
      screen.getByText("Restore").click();
    });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("restore boom"));
  });

  it("stringifies a non-Error rejection from restoreSnapshot", async () => {
    useWorkspace.setState({ current: "/tmp/ws" } as never);
    listSnapshots.mockResolvedValue([
      { id: "snap-3", ts: Date.now(), newBlobs: 1, bytesAdded: 256 } as SnapshotRecord,
    ]);
    restoreSnapshot.mockRejectedValueOnce("plain-restore-error");
    render(<SettingsBackup />);
    await waitFor(() => expect(screen.getByText("Restore")).toBeTruthy());
    await act(async () => {
      screen.getByText("Restore").click();
    });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("plain-restore-error"));
  });

  it("formats varied snapshot sizes", async () => {
    useWorkspace.setState({ current: "/tmp/ws" } as never);
    listSnapshots.mockResolvedValue([
      { id: "small", ts: 1000, newBlobs: 1, bytesAdded: 16 } as SnapshotRecord,
      { id: "medium", ts: 2000, newBlobs: 2, bytesAdded: 5000 } as SnapshotRecord,
      { id: "large", ts: 3000, newBlobs: 3, bytesAdded: 5 * 1024 * 1024 } as SnapshotRecord,
    ]);
    render(<SettingsBackup />);
    await waitFor(() => expect(screen.getAllByText("Restore").length).toBe(3));
    expect(screen.getByText(/16 B/)).toBeTruthy();
    expect(screen.getByText(/4\.9 KB/)).toBeTruthy();
    expect(screen.getByText(/5\.0 MB/)).toBeTruthy();
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
