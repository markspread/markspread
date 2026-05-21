import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(
  (cmd: string, _args?: unknown) => {
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
  },
);
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

vi.mock("./SubscriptionAuthModal", () => ({
  SubscriptionAuthModal: ({
    open,
    onClose,
    onSuccess,
  }: {
    open: boolean;
    onClose: () => void;
    onSuccess: () => void;
  }) => {
    if (!open) return null;
    return (
      <div data-testid="sub-modal">
        <span>Sign in with Claude</span>
        <button type="button" onClick={onSuccess}>
          mock-success
        </button>
        <button type="button" onClick={onClose}>
          mock-close
        </button>
      </div>
    );
  },
}));

import { SettingsAi } from "./SettingsAi";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  invoke.mockClear();
});

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

  it("closes the subscription modal via the modal's onClose", async () => {
    render(<SettingsAi />);
    await waitFor(() => expect(screen.getByText(/sk-…abcd/)).toBeTruthy());
    fireEvent.click(screen.getByText("Subscribe with Claude"));
    expect(screen.getByTestId("sub-modal")).toBeTruthy();
    await act(async () => {
      screen.getByText("mock-close").click();
    });
    expect(screen.queryByTestId("sub-modal")).toBeNull();
  });

  it("refreshes when the subscription flow succeeds", async () => {
    render(<SettingsAi />);
    await waitFor(() => expect(screen.getByText(/sk-…abcd/)).toBeTruthy());
    fireEvent.click(screen.getByText("Subscribe with Claude"));
    const before = invoke.mock.calls.filter((c) => c[0] === "ai_key_list").length;
    await act(async () => {
      screen.getByText("mock-success").click();
    });
    const after = invoke.mock.calls.filter((c) => c[0] === "ai_key_list").length;
    expect(after).toBeGreaterThan(before);
    expect(screen.queryByTestId("sub-modal")).toBeNull();
  });

  it("promotes a non-default key via Make default", async () => {
    invoke.mockImplementationOnce(() =>
      Promise.resolve({
        entries: [
          {
            alias: "default",
            provider: "anthropic",
            model: "claude-sonnet-4-6",
            baseUrl: null,
            maskedKey: "sk-…aaaa",
            createdAt: 0,
          },
          {
            alias: "secondary",
            provider: "openai",
            model: "gpt-4o",
            baseUrl: null,
            maskedKey: "sk-…bbbb",
            createdAt: 1,
          },
        ],
        defaultAlias: "default",
      }),
    );
    render(<SettingsAi />);
    await waitFor(() => expect(screen.getByText(/sk-…bbbb/)).toBeTruthy());
    await act(async () => {
      screen.getByText("Make default").click();
    });
    expect(invoke).toHaveBeenCalledWith("ai_key_set_default", { alias: "secondary" });
  });

  it("surfaces an error when ai_key_list rejects with an Error", async () => {
    invoke.mockImplementationOnce(() => Promise.reject(new Error("list boom")));
    render(<SettingsAi />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("list boom"));
  });

  it("stringifies a non-Error rejection from ai_key_list", async () => {
    invoke.mockImplementationOnce(() => Promise.reject("plain-list-error"));
    render(<SettingsAi />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("plain-list-error"));
  });

  it("stringifies a non-Error rejection from ai_key_save", async () => {
    const { container } = render(<SettingsAi />);
    await waitFor(() => expect(screen.getByText(/sk-…abcd/)).toBeTruthy());
    const keyInput = container.querySelector('input[type="password"]');
    if (!keyInput) throw new Error("key input not found");
    fireEvent.change(keyInput, { target: { value: "sk-new" } });
    invoke.mockImplementationOnce(() => Promise.reject("plain-save-error"));
    await act(async () => {
      screen.getByText("Save key").click();
    });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("plain-save-error"));
  });

  it("stringifies a non-Error rejection from ai_key_remove", async () => {
    render(<SettingsAi />);
    await waitFor(() => expect(screen.getByText(/sk-…abcd/)).toBeTruthy());
    invoke.mockImplementationOnce(() => Promise.reject("plain-remove-error"));
    await act(async () => {
      screen.getByText("Remove").click();
    });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("plain-remove-error"));
  });

  it("stringifies a non-Error rejection from ai_key_set_default", async () => {
    invoke.mockImplementationOnce(() =>
      Promise.resolve({
        entries: [
          {
            alias: "default",
            provider: "anthropic",
            model: "claude-sonnet-4-6",
            baseUrl: null,
            maskedKey: "sk-…aaaa",
            createdAt: 0,
          },
          {
            alias: "secondary",
            provider: "openai",
            model: "gpt-4o",
            baseUrl: null,
            maskedKey: "sk-…bbbb",
            createdAt: 1,
          },
        ],
        defaultAlias: "default",
      }),
    );
    render(<SettingsAi />);
    await waitFor(() => expect(screen.getByText(/sk-…bbbb/)).toBeTruthy());
    invoke.mockImplementationOnce(() => Promise.reject("plain-default-error"));
    await act(async () => {
      screen.getByText("Make default").click();
    });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("plain-default-error"));
  });

  it("updates the provider and alias inputs", async () => {
    const { container } = render(<SettingsAi />);
    await waitFor(() => expect(screen.getByText(/sk-…abcd/)).toBeTruthy());
    const select = container.querySelector("select");
    if (!select) throw new Error("provider select not found");
    fireEvent.change(select, { target: { value: "openai" } });
    expect((select as HTMLSelectElement).value).toBe("openai");
    const aliasInput = container.querySelector('input[type="text"]');
    if (!aliasInput) throw new Error("alias input not found");
    fireEvent.change(aliasInput, { target: { value: "work" } });
    expect((aliasInput as HTMLInputElement).value).toBe("work");
  });

  it("shows the empty state when no keys exist", async () => {
    invoke.mockImplementationOnce(() => Promise.resolve({ entries: [], defaultAlias: null }));
    render(<SettingsAi />);
    await waitFor(() => expect(screen.getByText("No keys saved yet.")).toBeTruthy());
  });
});
