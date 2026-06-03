// ADR-0019 §Decision.1: the chat/editor dual shell is gone, so the
// workspace store no longer carries `preferredShell`. It now only tracks
// the open workspace path + read-only flag. Verify open/close/setReadOnly.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useWorkspace } from "./workspace";

describe("useWorkspace", () => {
  beforeEach(() => useWorkspace.setState({ current: null, readOnly: false }));
  afterEach(() => useWorkspace.setState({ current: null, readOnly: false }));

  it("defaults current to null and readOnly to false", () => {
    expect(useWorkspace.getState().current).toBeNull();
    expect(useWorkspace.getState().readOnly).toBe(false);
  });

  it("open(path) sets current and defaults readOnly to false", () => {
    useWorkspace.getState().open("/ws");
    expect(useWorkspace.getState().current).toBe("/ws");
    expect(useWorkspace.getState().readOnly).toBe(false);
  });

  it("open(path, { readOnly }) honours the read-only override", () => {
    useWorkspace.getState().open("/ws", { readOnly: true });
    expect(useWorkspace.getState().current).toBe("/ws");
    expect(useWorkspace.getState().readOnly).toBe(true);
  });

  it("setReadOnly flips the flag", () => {
    useWorkspace.getState().setReadOnly(true);
    expect(useWorkspace.getState().readOnly).toBe(true);
    useWorkspace.getState().setReadOnly(false);
    expect(useWorkspace.getState().readOnly).toBe(false);
  });

  it("close() clears current and resets readOnly", () => {
    useWorkspace.getState().open("/ws-a", { readOnly: true });
    expect(useWorkspace.getState().current).toBe("/ws-a");
    useWorkspace.getState().close();
    expect(useWorkspace.getState().current).toBeNull();
    expect(useWorkspace.getState().readOnly).toBe(false);
  });
});
