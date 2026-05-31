// ADR-0010 D5: workspace store gains `preferredShell`. Verify the
// default + the open/setter behaviour.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useWorkspace } from "./workspace";

describe("useWorkspace preferredShell", () => {
  beforeEach(() => useWorkspace.setState({ current: null, preferredShell: "chat" }));
  afterEach(() => useWorkspace.setState({ current: null, preferredShell: "chat" }));

  it("defaults preferredShell to 'chat'", () => {
    expect(useWorkspace.getState().preferredShell).toBe("chat");
  });

  it("open(path) without opts keeps preferredShell as 'chat'", () => {
    useWorkspace.getState().open("/ws");
    expect(useWorkspace.getState().preferredShell).toBe("chat");
  });

  it("open(path, { preferredShell }) honours the override", () => {
    useWorkspace.getState().open("/ws", { preferredShell: "editor" });
    expect(useWorkspace.getState().preferredShell).toBe("editor");
  });

  it("setPreferredShell flips the value", () => {
    useWorkspace.getState().setPreferredShell("editor");
    expect(useWorkspace.getState().preferredShell).toBe("editor");
    useWorkspace.getState().setPreferredShell("chat");
    expect(useWorkspace.getState().preferredShell).toBe("chat");
  });

  // Regression: previously close() only reset `current` and `readOnly`,
  // leaving `preferredShell` from the prior workspace to leak into the
  // next open() call that didn't pass an explicit shell.
  it("close() resets preferredShell back to the default 'chat'", () => {
    useWorkspace.getState().open("/ws-a", { preferredShell: "editor" });
    expect(useWorkspace.getState().preferredShell).toBe("editor");
    useWorkspace.getState().close();
    expect(useWorkspace.getState().preferredShell).toBe("chat");
    // And a subsequent open without opts should now see the default.
    useWorkspace.getState().open("/ws-b");
    expect(useWorkspace.getState().preferredShell).toBe("chat");
  });
});
