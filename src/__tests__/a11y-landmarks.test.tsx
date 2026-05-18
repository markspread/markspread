import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Main mounts FileTree, which registers a `fs:event` listener and issues
// `invoke` calls on boot. There is no Tauri runtime under jsdom, so we
// stub the IPC surface — the landmark contract doesn't depend on it.
vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: () => Promise.resolve(undefined),
}));

import { Main } from "../screens/Main";
import { useWorkspace } from "../store/workspace";

// S-A11-004 / S-A11-005: VoiceOver / NVDA smoke. We can't drive the actual
// screen-reader binaries from CI, but we can pin the structural contract that
// they rely on — every interactive region exposes an explicit role + label
// so the SR rotor lands on something meaningful instead of "group".

describe("a11y/landmarks", () => {
  beforeEach(() => {
    useWorkspace.setState({ current: "/tmp/ws", close: () => {} } as never);
  });

  it("Main exposes labelled landmarks", () => {
    const { container } = render(<Main />);
    // <main> carries the `main` landmark role implicitly — no explicit
    // role attribute needed (and Biome flags it as redundant).
    const main = container.querySelector("main");
    expect(main).not.toBeNull();
    expect(main?.getAttribute("aria-label")).toBeTruthy();

    const filetree = container.querySelector("aside[aria-label]");
    expect(filetree).not.toBeNull();

    const editor = container.querySelector("section[aria-label]");
    expect(editor).not.toBeNull();
  });
});
