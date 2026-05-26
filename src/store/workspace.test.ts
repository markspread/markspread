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
});
