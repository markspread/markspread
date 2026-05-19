import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn((cmd: string, _args?: unknown) => {
  if (cmd === "ai_key_list")
    return Promise.resolve({
      entries: [
        {
          alias: "default",
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          baseUrl: null,
          maskedKey: "sk-…abcd",
          createdAt: 0,
        },
      ],
      defaultAlias: "default",
    });
  return Promise.resolve(undefined);
});
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invoke(cmd, args),
}));
vi.mock("../lib/ai/subscription-auth", () => ({
  createSubscriptionAuthFlow: () => ({
    start: () => Promise.resolve({ kind: "idle" }),
    cancel: () => Promise.resolve(),
    getStage: () => ({ kind: "idle" }),
  }),
}));
vi.mock("../lib/ai/subscription-auth-tauri", () => ({
  createTauriAuthTransport: () => ({}),
}));

import { SettingsAi } from "./SettingsAi";

afterEach(cleanup);

describe("SettingsAi", () => {
  it("loads and lists existing keys", async () => {
    render(<SettingsAi />);
    await waitFor(() => expect(screen.getByText(/sk-…abcd/)).toBeTruthy());
  });

  it("saves a new key", async () => {
    const { container } = render(<SettingsAi />);
    await waitFor(() => expect(screen.getByText(/sk-…abcd/)).toBeTruthy());
    const keyInput = container.querySelector('input[type="password"]');
    if (!keyInput) throw new Error("key input not found");
    fireEvent.change(keyInput, { target: { value: "sk-new" } });
    await act(async () => {
      screen.getByText("Save key").click();
    });
    expect(invoke).toHaveBeenCalledWith(
      "ai_key_save",
      expect.objectContaining({ key: "sk-new", provider: "anthropic" }),
    );
  });

  it("removes a key", async () => {
    render(<SettingsAi />);
    await waitFor(() => expect(screen.getByText(/sk-…abcd/)).toBeTruthy());
    await act(async () => {
      screen.getByText("Remove").click();
    });
    expect(invoke).toHaveBeenCalledWith("ai_key_remove", { alias: "default" });
  });

  it("opens the subscription modal", async () => {
    render(<SettingsAi />);
    await waitFor(() => expect(screen.getByText(/sk-…abcd/)).toBeTruthy());
    fireEvent.click(screen.getByText("Subscribe with Claude"));
    expect(screen.getByText("Sign in with Claude")).toBeTruthy();
  });
});
