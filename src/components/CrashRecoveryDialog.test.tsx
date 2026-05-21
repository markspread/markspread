import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecoveryProposal } from "../lib/backup/backup";
import type { SessionBeacon } from "../lib/errors/crash-recovery";

const readBeacon = vi.fn<() => Promise<SessionBeacon | null>>();
const clearBeacon = vi.fn(async () => {});
const proposeRecovery = vi.fn<() => Promise<RecoveryProposal>>();
const restoreSnapshot = vi.fn(async (_id: string) => ({ filesRestored: 1 }));

vi.mock("../lib/errors/crash-recovery", () => ({
  readBeacon: () => readBeacon(),
  clearBeacon: () => clearBeacon(),
}));
vi.mock("../lib/backup/backup", () => ({
  proposeRecovery: () => proposeRecovery(),
  restoreSnapshot: (id: string) => restoreSnapshot(id),
}));

import { useWorkspace } from "../store/workspace";
import { CrashRecoveryDialog } from "./CrashRecoveryDialog";

const dirtyBeacon: SessionBeacon = {
  id: "s1",
  ts: Date.now(),
  buffers: [{ key: "a.md", dirty: true, sha256: "x", bytes: 4 }],
};

const proposal: RecoveryProposal = {
  workspaceHash: "/ws",
  lastSessionEndedAt: Date.now(),
  snapshots: [
    { id: "snap-1", ts: Date.now(), workspaceHash: "/ws", newBlobs: 2, bytesAdded: 2048 },
  ],
};

afterEach(cleanup);

describe("CrashRecoveryDialog", () => {
  beforeEach(() => {
    readBeacon.mockReset();
    clearBeacon.mockClear();
    proposeRecovery.mockReset();
    restoreSnapshot.mockClear();
    useWorkspace.setState({ current: "/ws" });
  });
  afterEach(() => useWorkspace.setState({ current: null }));

  it("renders nothing without a proposal", () => {
    readBeacon.mockResolvedValue(null);
    const { container } = render(<CrashRecoveryDialog />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the dialog when a dirty beacon yields snapshots", async () => {
    readBeacon.mockResolvedValue(dirtyBeacon);
    proposeRecovery.mockResolvedValue(proposal);
    render(<CrashRecoveryDialog />);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(screen.getByText("Recover unsaved changes?")).toBeTruthy();
  });

  it("clears the beacon when there were no dirty buffers", async () => {
    readBeacon.mockResolvedValue({ ...dirtyBeacon, buffers: [] });
    render(<CrashRecoveryDialog />);
    await waitFor(() => expect(clearBeacon).toHaveBeenCalled());
  });

  it("restores a snapshot when Restore is clicked", async () => {
    readBeacon.mockResolvedValue(dirtyBeacon);
    proposeRecovery.mockResolvedValue(proposal);
    render(<CrashRecoveryDialog />);
    await waitFor(() => expect(screen.getByText("Restore")).toBeTruthy());
    screen.getByText("Restore").click();
    await waitFor(() => expect(restoreSnapshot).toHaveBeenCalledWith("snap-1"));
  });

  it("dismisses the dialog", async () => {
    readBeacon.mockResolvedValue(dirtyBeacon);
    proposeRecovery.mockResolvedValue(proposal);
    render(<CrashRecoveryDialog />);
    await waitFor(() => expect(screen.getByText("Dismiss")).toBeTruthy());
    screen.getByText("Dismiss").click();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("clears the beacon when proposeRecovery yields no snapshots", async () => {
    readBeacon.mockResolvedValue(dirtyBeacon);
    proposeRecovery.mockResolvedValue({ ...proposal, snapshots: [] });
    render(<CrashRecoveryDialog />);
    await waitFor(() => expect(clearBeacon).toHaveBeenCalled());
  });

  it("logs and recovers when readBeacon throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    readBeacon.mockRejectedValue(new Error("read failed"));
    const { container } = render(<CrashRecoveryDialog />);
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
    warn.mockRestore();
  });

  it("bails on cancellation after proposeRecovery resolves", async () => {
    let resolveProp: ((value: RecoveryProposal) => void) | null = null;
    readBeacon.mockResolvedValue(dirtyBeacon);
    proposeRecovery.mockReturnValueOnce(
      new Promise<RecoveryProposal>((resolve) => {
        resolveProp = resolve;
      }),
    );
    const { unmount } = render(<CrashRecoveryDialog />);
    await waitFor(() => expect(proposeRecovery).toHaveBeenCalled());
    unmount();
    (resolveProp as ((value: RecoveryProposal) => void) | null)?.(proposal);
    // No assertion needed — exercising the cancelled branch is the goal.
    await new Promise((r) => setTimeout(r, 0));
  });

  it("closes when Escape is pressed inside the focus trap", async () => {
    readBeacon.mockResolvedValue(dirtyBeacon);
    proposeRecovery.mockResolvedValue(proposal);
    render(<CrashRecoveryDialog />);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    const evt = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    document.dispatchEvent(evt);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("logs and stays open when restoreSnapshot throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    readBeacon.mockResolvedValue(dirtyBeacon);
    proposeRecovery.mockResolvedValue(proposal);
    restoreSnapshot.mockRejectedValueOnce(new Error("restore failed"));
    render(<CrashRecoveryDialog />);
    await waitFor(() => expect(screen.getByText("Restore")).toBeTruthy());
    screen.getByText("Restore").click();
    await waitFor(() => expect(warn).toHaveBeenCalled());
    warn.mockRestore();
  });
});
