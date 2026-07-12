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

import { PROVIDERS } from "../lib/ai/providers";
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

  // ── SC-LLM-03: registry-driven provider form ─────────────────────────

  it("renders every provider from the registry", async () => {
    const { container } = render(<SettingsAi />);
    await waitFor(() => expect(screen.getByText(/sk-…abcd/)).toBeTruthy());
    const select = container.querySelector("select");
    if (!select) throw new Error("provider select not found");
    const values = Array.from((select as HTMLSelectElement).options).map((o) => o.value);
    expect(values).toEqual(PROVIDERS.map((p) => p.id));
    expect(values).toHaveLength(8);
  });

  it("saves with the registry default model for a newly wired provider", async () => {
    const { container } = render(<SettingsAi />);
    await waitFor(() => expect(screen.getByText(/sk-…abcd/)).toBeTruthy());
    const select = container.querySelector("select");
    if (!select) throw new Error("provider select not found");
    fireEvent.change(select, { target: { value: "deepseek" } });
    const keyInput = container.querySelector('input[type="password"]');
    if (!keyInput) throw new Error("key input not found");
    fireEvent.change(keyInput, { target: { value: "sk-ds" } });
    await act(async () => {
      screen.getByText("Save key").click();
    });
    expect(invoke).toHaveBeenCalledWith(
      "ai_key_save",
      expect.objectContaining({
        provider: "deepseek",
        model: "deepseek-chat",
        baseUrl: null,
        key: "sk-ds",
      }),
    );
  });

  it("requires a base URL for openai-compatible and blocks save until provided", async () => {
    const { container } = render(<SettingsAi />);
    await waitFor(() => expect(screen.getByText(/sk-…abcd/)).toBeTruthy());
    const select = container.querySelector("select");
    if (!select) throw new Error("provider select not found");
    fireEvent.change(select, { target: { value: "openai-compatible" } });
    const keyInput = container.querySelector('input[type="password"]');
    if (!keyInput) throw new Error("key input not found");
    fireEvent.change(keyInput, { target: { value: "sk-compat" } });
    await act(async () => {
      screen.getByText("Save key").click();
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Base URL is required"),
    );
    expect(invoke).not.toHaveBeenCalledWith("ai_key_save", expect.anything());
  });

  it("requires a model for openai-compatible once the base URL is set", async () => {
    const { container } = render(<SettingsAi />);
    await waitFor(() => expect(screen.getByText(/sk-…abcd/)).toBeTruthy());
    const select = container.querySelector("select");
    if (!select) throw new Error("provider select not found");
    fireEvent.change(select, { target: { value: "openai-compatible" } });
    fireEvent.change(screen.getByTestId("ai-baseurl-input"), {
      target: { value: "http://localhost:8000/v1" },
    });
    const keyInput = container.querySelector('input[type="password"]');
    if (!keyInput) throw new Error("key input not found");
    fireEvent.change(keyInput, { target: { value: "sk-compat" } });
    await act(async () => {
      screen.getByText("Save key").click();
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Model is required"),
    );
    expect(invoke).not.toHaveBeenCalledWith("ai_key_save", expect.anything());
  });

  it("persists the base URL and custom model for openai-compatible", async () => {
    const { container } = render(<SettingsAi />);
    await waitFor(() => expect(screen.getByText(/sk-…abcd/)).toBeTruthy());
    const select = container.querySelector("select");
    if (!select) throw new Error("provider select not found");
    fireEvent.change(select, { target: { value: "openai-compatible" } });
    fireEvent.change(screen.getByTestId("ai-baseurl-input"), {
      target: { value: "http://localhost:8000/v1" },
    });
    fireEvent.change(screen.getByTestId("ai-model-input"), {
      target: { value: "qwen3-32b" },
    });
    const keyInput = container.querySelector('input[type="password"]');
    if (!keyInput) throw new Error("key input not found");
    fireEvent.change(keyInput, { target: { value: "sk-compat" } });
    await act(async () => {
      screen.getByText("Save key").click();
    });
    expect(invoke).toHaveBeenCalledWith(
      "ai_key_save",
      expect.objectContaining({
        provider: "openai-compatible",
        model: "qwen3-32b",
        baseUrl: "http://localhost:8000/v1",
        key: "sk-compat",
      }),
    );
  });

  it("allows saving ollama without a key and defaults the base URL to null", async () => {
    const { container } = render(<SettingsAi />);
    await waitFor(() => expect(screen.getByText(/sk-…abcd/)).toBeTruthy());
    const select = container.querySelector("select");
    if (!select) throw new Error("provider select not found");
    fireEvent.change(select, { target: { value: "ollama" } });
    await act(async () => {
      screen.getByText("Save key").click();
    });
    expect(invoke).toHaveBeenCalledWith(
      "ai_key_save",
      expect.objectContaining({
        provider: "ollama",
        model: "llama3.3",
        baseUrl: null,
        key: "ollama",
      }),
    );
  });

  // ── SC-LLM-06: Test-connection button ────────────────────────────────

  it("shows a success chip when ai_key_test accepts the key", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "ai_key_list") return Promise.resolve({ entries: [], defaultAlias: null });
      if (cmd === "ai_key_test")
        return Promise.resolve({ status: 200, ok: true, modelId: "claude-opus-4-7", message: "" });
      return Promise.resolve(undefined);
    });
    const { container } = render(<SettingsAi />);
    await waitFor(() => expect(screen.getByText("No keys saved yet.")).toBeTruthy());
    const keyInput = container.querySelector('input[type="password"]');
    if (!keyInput) throw new Error("key input not found");
    fireEvent.change(keyInput, { target: { value: "sk-ant-good" } });
    await act(async () => {
      screen.getByTestId("ai-key-test-button").click();
    });
    await waitFor(() =>
      expect(screen.getByTestId("ai-key-test-result").textContent).toContain("Connection OK"),
    );
    expect(invoke).toHaveBeenCalledWith(
      "ai_key_test",
      expect.objectContaining({ provider: "anthropic", key: "sk-ant-good" }),
    );
  });

  it("shows the auth classification when ai_key_test returns 401", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "ai_key_list") return Promise.resolve({ entries: [], defaultAlias: null });
      if (cmd === "ai_key_test")
        return Promise.resolve({ status: 401, ok: false, message: "invalid api key" });
      return Promise.resolve(undefined);
    });
    const { container } = render(<SettingsAi />);
    await waitFor(() => expect(screen.getByText("No keys saved yet.")).toBeTruthy());
    const keyInput = container.querySelector('input[type="password"]');
    if (!keyInput) throw new Error("key input not found");
    fireEvent.change(keyInput, { target: { value: "sk-ant-bad" } });
    await act(async () => {
      screen.getByTestId("ai-key-test-button").click();
    });
    const chip = await waitFor(() => screen.getByTestId("ai-key-test-result"));
    expect(chip.textContent).toContain("Authentication failed");
    expect(chip.textContent).toContain("HTTP 401");
  });

  it("shows the network classification when ai_key_test rejects with a network error", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "ai_key_list") return Promise.resolve({ entries: [], defaultAlias: null });
      if (cmd === "ai_key_test") return Promise.reject(new Error("network: connection refused"));
      return Promise.resolve(undefined);
    });
    const { container } = render(<SettingsAi />);
    await waitFor(() => expect(screen.getByText("No keys saved yet.")).toBeTruthy());
    const keyInput = container.querySelector('input[type="password"]');
    if (!keyInput) throw new Error("key input not found");
    fireEvent.change(keyInput, { target: { value: "sk-any" } });
    await act(async () => {
      screen.getByTestId("ai-key-test-button").click();
    });
    const chip = await waitFor(() => screen.getByTestId("ai-key-test-result"));
    expect(chip.textContent).toContain("Network error");
  });
});
