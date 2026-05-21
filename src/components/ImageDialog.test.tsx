import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

type Opener = (req: unknown) => void;
let registeredOpener: Opener = () => {};
let providerImpl: { search: (q: string, n: number) => Promise<string[]> } | null = null;
vi.mock("@/lib/editor/commands/image", () => ({
  setImageDialogOpener: (fn: Opener) => {
    registeredOpener = fn;
  },
}));
vi.mock("@/lib/editor/commands/link", () => ({
  getWorkspaceLinkProvider: () => providerImpl,
}));

import { ImageDialog } from "./ImageDialog";

interface OpenReq {
  initialAlt: string;
  initialUrl: string;
  resolve: ReturnType<typeof vi.fn>;
  pickFile?: () => Promise<{ name: string } | null>;
}

function open(overrides?: Partial<OpenReq>): OpenReq {
  const req: OpenReq = {
    initialAlt: "",
    initialUrl: "",
    resolve: vi.fn(),
    ...overrides,
  };
  act(() => registeredOpener(req));
  return req;
}

afterEach(() => {
  cleanup();
  providerImpl = null;
});

describe("ImageDialog", () => {
  it("renders nothing until opened", () => {
    const { container } = render(<ImageDialog />);
    expect(container.firstChild).toBeNull();
  });

  it("opens with the initial alt and url", () => {
    render(<ImageDialog />);
    open({ initialAlt: "logo", initialUrl: "./a.png" });
    expect(screen.getByRole("dialog")).toBeTruthy();
    const inputs = screen.getAllByRole("textbox");
    expect((inputs[0] as HTMLInputElement).value).toBe("logo");
    expect((inputs[1] as HTMLInputElement).value).toBe("./a.png");
  });

  it("submits the alt/url result", () => {
    render(<ImageDialog />);
    const req = open({ initialUrl: "./pic.png" });
    fireEvent.click(screen.getByText("Insert"));
    expect(req.resolve).toHaveBeenCalledWith({ alt: "", url: "./pic.png" });
  });

  it("does not submit an empty url", () => {
    render(<ImageDialog />);
    const req = open();
    fireEvent.click(screen.getByText("Insert"));
    expect(req.resolve).not.toHaveBeenCalled();
  });

  it("cancels with a null result", () => {
    render(<ImageDialog />);
    const req = open();
    fireEvent.click(screen.getByText("Cancel"));
    expect(req.resolve).toHaveBeenCalledWith(null);
  });

  it("closes on Escape", () => {
    render(<ImageDialog />);
    const req = open();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(req.resolve).toHaveBeenCalledWith(null);
  });

  it("submits via Cmd+Enter", () => {
    render(<ImageDialog />);
    const req = open({ initialUrl: "./x.png" });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter", metaKey: true });
    expect(req.resolve).toHaveBeenCalledWith({ alt: "", url: "./x.png" });
  });

  it("ignores plain Enter without a modifier", () => {
    render(<ImageDialog />);
    const req = open({ initialUrl: "./x.png" });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
    expect(req.resolve).not.toHaveBeenCalled();
  });

  it("ignores submit when the URL is only whitespace", () => {
    render(<ImageDialog />);
    const req = open({ initialUrl: "   " });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter", metaKey: true });
    expect(req.resolve).not.toHaveBeenCalled();
  });

  it("edits the alt field via change", () => {
    render(<ImageDialog />);
    const req = open({ initialUrl: "./x.png" });
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0] as HTMLInputElement, { target: { value: "label" } });
    fireEvent.click(screen.getByText("Insert"));
    expect(req.resolve).toHaveBeenCalledWith({ alt: "label", url: "./x.png" });
  });

  it("hides the picker button when no pickFile is provided", () => {
    render(<ImageDialog />);
    open();
    expect(screen.queryByText("Pick file…")).toBeNull();
  });

  it("invokes pickFile and back-fills the URL and alt", async () => {
    const pickFile = vi.fn().mockResolvedValue({ name: "screenshot.png" });
    render(<ImageDialog />);
    const req = open({ pickFile });
    await act(async () => {
      screen.getByText("Pick file…").click();
    });
    expect(pickFile).toHaveBeenCalled();
    const urlInput = (screen.getAllByRole("textbox")[1] as HTMLInputElement).value;
    expect(urlInput).toBe("screenshot.png");
    expect((screen.getAllByRole("textbox")[0] as HTMLInputElement).value).toBe("screenshot");
    expect(req).toBeTruthy();
  });

  it("keeps the existing alt when the picker returns a file", async () => {
    const pickFile = vi.fn().mockResolvedValue({ name: "logo.png" });
    render(<ImageDialog />);
    open({ initialAlt: "keep me", pickFile });
    await act(async () => {
      screen.getByText("Pick file…").click();
    });
    expect((screen.getAllByRole("textbox")[0] as HTMLInputElement).value).toBe("keep me");
  });

  it("recovers when the picker returns no file", async () => {
    const pickFile = vi.fn().mockResolvedValue(null);
    render(<ImageDialog />);
    open({ pickFile });
    await act(async () => {
      screen.getByText("Pick file…").click();
    });
    expect((screen.getAllByRole("textbox")[1] as HTMLInputElement).value).toBe("");
  });

  it("filters completions to image extensions and inserts on click", async () => {
    vi.useFakeTimers();
    providerImpl = {
      search: vi.fn().mockResolvedValue(["docs/a.md", "img/pic.png", "img/photo.jpg", "notes/x"]),
    };
    try {
      render(<ImageDialog />);
      open({ initialUrl: "" });
      const inputs = screen.getAllByRole("textbox");
      fireEvent.change(inputs[1] as HTMLInputElement, { target: { value: "img/" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120);
      });
      expect(screen.getByText("img/pic.png")).toBeTruthy();
      expect(screen.getByText("img/photo.jpg")).toBeTruthy();
      expect(screen.queryByText("docs/a.md")).toBeNull();
      fireEvent.mouseDown(screen.getByText("img/pic.png"));
      expect((screen.getAllByRole("textbox")[1] as HTMLInputElement).value).toBe("img/pic.png");
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears completions when the provider rejects", async () => {
    vi.useFakeTimers();
    providerImpl = { search: vi.fn().mockRejectedValue(new Error("boom")) };
    try {
      render(<ImageDialog />);
      open({ initialUrl: "" });
      const inputs = screen.getAllByRole("textbox");
      fireEvent.change(inputs[1] as HTMLInputElement, { target: { value: "img/" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120);
      });
      expect(screen.queryByText("img/pic.png")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not query the provider for scheme-prefixed URLs", async () => {
    vi.useFakeTimers();
    const search = vi.fn().mockResolvedValue([]);
    providerImpl = { search };
    try {
      render(<ImageDialog />);
      open({ initialUrl: "" });
      const inputs = screen.getAllByRole("textbox");
      fireEvent.change(inputs[1] as HTMLInputElement, { target: { value: "https://example.com" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120);
      });
      expect(search).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats dotted relative paths as path-like", async () => {
    vi.useFakeTimers();
    const search = vi.fn().mockResolvedValue([".local/x.png"]);
    providerImpl = { search };
    try {
      render(<ImageDialog />);
      open({ initialUrl: "" });
      const inputs = screen.getAllByRole("textbox");
      fireEvent.change(inputs[1] as HTMLInputElement, { target: { value: ".local" } });
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
    const search = vi.fn().mockResolvedValue(["pic.png"]);
    providerImpl = { search };
    try {
      render(<ImageDialog />);
      open({ initialUrl: "" });
      const inputs = screen.getAllByRole("textbox");
      fireEvent.change(inputs[1] as HTMLInputElement, { target: { value: "pic.png" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120);
      });
      expect(search).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
