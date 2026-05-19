// S-ST-001 / S-ST-012: settings-dialog state coverage.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeSettingsDialog,
  getSettingsDialogState,
  openSettingsDialog,
  setSettingsCategory,
  setSettingsJsonMode,
  setSettingsQuery,
  subscribeSettingsDialog,
} from "./dialogState";

beforeEach(() => {
  // Reset to a known closed state.
  closeSettingsDialog();
  setSettingsCategory("general");
  setSettingsQuery("");
  setSettingsJsonMode(false);
});

describe("openSettingsDialog", () => {
  it("opens with the current category when none is given", () => {
    setSettingsCategory("editor");
    openSettingsDialog();
    const state = getSettingsDialogState();
    expect(state.open).toBe(true);
    expect(state.category).toBe("editor");
    expect(state.query).toBe("");
  });

  it("opens at the requested category and preserves jsonMode", () => {
    setSettingsJsonMode(true);
    openSettingsDialog("privacy");
    const state = getSettingsDialogState();
    expect(state.category).toBe("privacy");
    expect(state.jsonMode).toBe(true);
  });
});

describe("closeSettingsDialog", () => {
  it("closes an open dialog", () => {
    openSettingsDialog("ai");
    closeSettingsDialog();
    expect(getSettingsDialogState().open).toBe(false);
  });

  it("is a no-op (no emit) when already closed", () => {
    const fn = vi.fn();
    const off = subscribeSettingsDialog(fn);
    closeSettingsDialog();
    expect(fn).not.toHaveBeenCalled();
    off();
  });
});

describe("setters", () => {
  it("setSettingsCategory updates the category", () => {
    setSettingsCategory("plugins");
    expect(getSettingsDialogState().category).toBe("plugins");
  });

  it("setSettingsQuery updates the query", () => {
    setSettingsQuery("font");
    expect(getSettingsDialogState().query).toBe("font");
  });

  it("setSettingsJsonMode toggles json mode", () => {
    setSettingsJsonMode(true);
    expect(getSettingsDialogState().jsonMode).toBe(true);
    setSettingsJsonMode(false);
    expect(getSettingsDialogState().jsonMode).toBe(false);
  });
});

describe("subscribeSettingsDialog", () => {
  it("notifies listeners on change and stops after unsubscribe", () => {
    const fn = vi.fn();
    const off = subscribeSettingsDialog(fn);
    openSettingsDialog("editor");
    expect(fn).toHaveBeenCalledTimes(1);
    setSettingsQuery("x");
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    setSettingsQuery("y");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
