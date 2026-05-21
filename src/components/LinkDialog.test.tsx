import type { LinkDialogRequest, LinkDialogResult } from "@/lib/editor/commands/link";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LinkDialog } from "./LinkDialog";

afterEach(cleanup);

// The component registers an opener via `setLinkDialogOpener` on mount.
let opener: ((r: LinkDialogRequest) => void) | null = null;
let providerImpl: { search: (q: string, limit: number) => Promise<string[]> } | null = null;
vi.mock("@/lib/editor/commands/link", async () => {
  const actual = await vi.importActual<typeof import("@/lib/editor/commands/link")>(
    "@/lib/editor/commands/link",
  );
  return {
    ...actual,
    setLinkDialogOpener: (fn: (r: LinkDialogRequest) => void) => {
      opener = fn;
    },
    getWorkspaceLinkProvider: () => providerImpl,
  };
});

afterEach(() => {
  opener = null;
  providerImpl = null;
});

function show(partial?: Partial<LinkDialogRequest>): {
  resolved: () => LinkDialogResult | null | undefined;
} {
  let result: LinkDialogResult | null | undefined;
  act(() => {
    opener?.({
      initialText: "",
      initialUrl: "",
      initialTitle: "",
      resolve: (r) => {
        result = r;
      },
      ...partial,
    });
  });
  return { resolved: () => result };
}

describe("LinkDialog", () => {
  it("renders nothing until a request opens it", () => {
    const { container } = render(<LinkDialog />);
    expect(container.firstChild).toBeNull();
  });

  it("opens with pre-filled values and submits a result", () => {
    render(<LinkDialog />);
    const handle = show({
      initialText: "label",
      initialUrl: "https://example.com",
      initialTitle: "tip",
    });
    expect(screen.getByDisplayValue("label")).toBeTruthy();
    fireEvent.click(screen.getByText("Insert"));
    expect(handle.resolved()).toEqual({
      text: "label",
      url: "https://example.com",
      title: "tip",
    });
  });

  it("cancels with a null result", () => {
    render(<LinkDialog />);
    const handle = show({ initialUrl: "x" });
    fireEvent.click(screen.getByText("Cancel"));
    expect(handle.resolved()).toBeNull();
  });

  it("disables insert when the URL is empty", () => {
    render(<LinkDialog />);
    show();
    const insert = screen.getByText("Insert") as HTMLButtonElement;
    expect(insert.disabled).toBe(true);
  });

  it("edits the URL field and submits", () => {
    render(<LinkDialog />);
    const handle = show({ initialText: "t" });
    fireEvent.change(screen.getByPlaceholderText("https://… or ./relative/path.md"), {
      target: { value: "https://new.example" },
    });
    fireEvent.click(screen.getByText("Insert"));
    expect(handle.resolved()).toEqual({ text: "t", url: "https://new.example" });
  });

  it("edits the text and title fields", () => {
    render(<LinkDialog />);
    const handle = show({ initialUrl: "https://x" });
    fireEvent.change(screen.getByPlaceholderText("Link text"), {
      target: { value: "label" },
    });
    fireEvent.change(screen.getByPlaceholderText("Hover tooltip"), {
      target: { value: "tip" },
    });
    fireEvent.click(screen.getByText("Insert"));
    expect(handle.resolved()).toEqual({ text: "label", url: "https://x", title: "tip" });
  });

  it("closes via Escape", () => {
    render(<LinkDialog />);
    const handle = show({ initialUrl: "https://x" });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(handle.resolved()).toBeNull();
  });

  it("submits via Cmd+Enter", () => {
    render(<LinkDialog />);
    const handle = show({ initialUrl: "https://x", initialText: "t" });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter", metaKey: true });
    expect(handle.resolved()).toEqual({ text: "t", url: "https://x" });
  });

  it("submits via Ctrl+Enter", () => {
    render(<LinkDialog />);
    const handle = show({ initialUrl: "https://x", initialText: "t" });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter", ctrlKey: true });
    expect(handle.resolved()).toEqual({ text: "t", url: "https://x" });
  });

  it("ignores plain Enter without a modifier", () => {
    render(<LinkDialog />);
    const handle = show({ initialUrl: "https://x" });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
    expect(handle.resolved()).toBeUndefined();
  });

  it("ignores submit when the URL is only whitespace", () => {
    render(<LinkDialog />);
    const handle = show({ initialUrl: "   " });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter", metaKey: true });
    expect(handle.resolved()).toBeUndefined();
  });

  it("shows workspace path completions and replaces the URL on click", async () => {
    vi.useFakeTimers();
    providerImpl = { search: vi.fn().mockResolvedValue(["docs/a.md", "docs/b.md"]) };
    try {
      render(<LinkDialog />);
      show({ initialUrl: "" });
      fireEvent.change(screen.getByPlaceholderText("https://… or ./relative/path.md"), {
        target: { value: "docs/" },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120);
      });
      const item = screen.getByText("docs/a.md");
      fireEvent.mouseDown(item);
      expect(
        (screen.getByPlaceholderText("https://… or ./relative/path.md") as HTMLInputElement).value,
      ).toBe("docs/a.md");
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears completions when the provider rejects", async () => {
    vi.useFakeTimers();
    providerImpl = { search: vi.fn().mockRejectedValue(new Error("boom")) };
    try {
      render(<LinkDialog />);
      show({ initialUrl: "" });
      fireEvent.change(screen.getByPlaceholderText("https://… or ./relative/path.md"), {
        target: { value: "docs/" },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120);
      });
      expect(screen.queryByText("docs/a.md")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats dotted relative paths as path-like", async () => {
    vi.useFakeTimers();
    const search = vi.fn().mockResolvedValue(["./a.md"]);
    providerImpl = { search };
    try {
      render(<LinkDialog />);
      show({ initialUrl: "" });
      fireEvent.change(screen.getByPlaceholderText("https://… or ./relative/path.md"), {
        target: { value: "./a.md" },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120);
      });
      expect(search).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats bare-extension filenames as path-like", async () => {
    vi.useFakeTimers();
    const search = vi.fn().mockResolvedValue(["readme.md"]);
    providerImpl = { search };
    try {
      render(<LinkDialog />);
      show({ initialUrl: "" });
      fireEvent.change(screen.getByPlaceholderText("https://… or ./relative/path.md"), {
        target: { value: "readme.md" },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120);
      });
      expect(search).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not query the provider for non-path-like URLs", async () => {
    vi.useFakeTimers();
    const search = vi.fn().mockResolvedValue([]);
    providerImpl = { search };
    try {
      render(<LinkDialog />);
      show({ initialUrl: "" });
      fireEvent.change(screen.getByPlaceholderText("https://… or ./relative/path.md"), {
        target: { value: "https://example.com" },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120);
      });
      expect(search).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the opener on unmount", () => {
    const before = opener;
    const { unmount } = render(<LinkDialog />);
    const afterMount = opener;
    expect(afterMount).not.toBe(before);
    unmount();
    expect(opener).not.toBe(afterMount);
  });
});
