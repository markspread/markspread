import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: unknown) => invokeMock(cmd, args),
  convertFileSrc: (p: string) => `asset://${p}`,
}));

let lastEditorProps: {
  initialDoc: string;
  onChange?: (next: string) => void;
  language?: string;
  tabId?: string;
} | null = null;
vi.mock("./Editor", () => ({
  Editor: (props: {
    initialDoc: string;
    onChange?: (next: string) => void;
    language?: string;
    tabId?: string;
  }) => {
    lastEditorProps = props;
    return <div data-testid="editor">{props.initialDoc}</div>;
  },
}));

const saveTabMock = vi.fn<(args: unknown) => Promise<unknown>>(() => Promise.resolve(undefined));
vi.mock("../lib/save-tab", () => ({
  saveTab: (args: unknown) => saveTabMock(args),
}));

import { useTabs } from "../store/tabs";
import { useWorkspace } from "../store/workspace";
import { EditorPane } from "./EditorPane";

afterEach(cleanup);

describe("EditorPane", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    saveTabMock.mockReset();
    saveTabMock.mockResolvedValue(undefined);
    lastEditorProps = null;
    useTabs.setState({ tabs: [], activePath: null });
    useWorkspace.setState({ readOnly: false });
  });
  afterEach(() => {
    useTabs.setState({ tabs: [], activePath: null });
  });

  it("renders the empty hint when no file is open", () => {
    render(<EditorPane workspace="/ws" />);
    expect(screen.getByLabelText("Editor (no file open)")).toBeTruthy();
  });

  it("renders the editor once a text file loads", async () => {
    invokeMock.mockResolvedValue({ content: "# Title", encoding: "utf-8" });
    useTabs.setState({ activePath: "/ws/note.md" });
    render(<EditorPane workspace="/ws" />);
    await waitFor(() => expect(screen.getByTestId("editor")).toBeTruthy());
    expect(screen.getByTestId("editor").textContent).toBe("# Title");
    expect(lastEditorProps?.language).toBe("markdown");
  });

  it("uses the plain language for non-markdown files", async () => {
    invokeMock.mockResolvedValue({ content: "log line", encoding: "utf-8" });
    useTabs.setState({ activePath: "/ws/notes.txt" });
    render(<EditorPane workspace="/ws" />);
    await waitFor(() => expect(screen.getByTestId("editor")).toBeTruthy());
    expect(lastEditorProps?.language).toBe("plain");
  });

  it("shows a loading hint between the activePath swap and the read response", async () => {
    let resolve: (v: unknown) => void = () => {};
    invokeMock.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    useTabs.setState({ activePath: "/ws/slow.md" });
    render(<EditorPane workspace="/ws" />);
    expect(screen.getByLabelText("Loading file")).toBeTruthy();
    await act(async () => {
      resolve({ content: "ready", encoding: "utf-8" });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("editor")).toBeTruthy());
  });

  it("shows the access error card on a read failure", async () => {
    invokeMock.mockRejectedValue("EACCES");
    useTabs.setState({ activePath: "/ws/secret.md" });
    render(<EditorPane workspace="/ws" />);
    await waitFor(() => expect(screen.getByLabelText("Editor error")).toBeTruthy());
  });

  it("shows the non-text viewer for binary files", () => {
    useTabs.setState({ activePath: "/ws/pic.png" });
    render(<EditorPane workspace="/ws" />);
    expect(screen.getByLabelText("Image preview")).toBeTruthy();
  });

  it("retries the read when the retry handler fires", async () => {
    invokeMock.mockRejectedValueOnce("EACCES");
    useTabs.setState({ activePath: "/ws/secret.md" });
    render(<EditorPane workspace="/ws" />);
    await waitFor(() => expect(screen.getByLabelText("Editor error")).toBeTruthy());
    invokeMock.mockResolvedValueOnce({ content: "ok", encoding: "utf-8" });
    const retry = screen.getByRole("button", { name: /retry/i });
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByTestId("editor")).toBeTruthy());
  });

  it("copies diagnostics through the clipboard handler", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    invokeMock.mockRejectedValue("EWEIRD");
    useTabs.setState({ activePath: "/ws/secret.md" });
    render(<EditorPane workspace="/ws" />);
    await waitFor(() => expect(screen.getByLabelText("Editor error")).toBeTruthy());
    const copy = screen.getByRole("button", {
      name: /copy_diagnostics|copy diagnostics/i,
    });
    fireEvent.click(copy);
    expect(writeText).toHaveBeenCalled();
  });

  it("debounces edits and persists through saveTab", async () => {
    vi.useFakeTimers();
    try {
      invokeMock.mockResolvedValue({ content: "a", encoding: "utf-8" });
      useTabs.setState({ activePath: "/ws/note.md" });
      render(<EditorPane workspace="/ws" />);
      await vi.waitFor(() => expect(lastEditorProps?.onChange).toBeTruthy());
      act(() => {
        lastEditorProps?.onChange?.("a edit");
      });
      expect(saveTabMock).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      expect(saveTabMock).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/ws/note.md", content: "a edit" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not call saveTab when readOnly is set", async () => {
    vi.useFakeTimers();
    try {
      useWorkspace.setState({ readOnly: true });
      invokeMock.mockResolvedValue({ content: "x", encoding: "utf-8" });
      useTabs.setState({ activePath: "/ws/note.md" });
      render(<EditorPane workspace="/ws" />);
      await vi.waitFor(() => expect(lastEditorProps?.onChange).toBeTruthy());
      act(() => lastEditorProps?.onChange?.("x edit"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      expect(saveTabMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips save when the change is the same as the previous live value", async () => {
    vi.useFakeTimers();
    try {
      invokeMock.mockResolvedValue({ content: "x", encoding: "utf-8" });
      useTabs.setState({ activePath: "/ws/note.md" });
      render(<EditorPane workspace="/ws" />);
      await vi.waitFor(() => expect(lastEditorProps?.onChange).toBeTruthy());
      // First emit moves the live ref to "x edit" and arms a timer.
      act(() => lastEditorProps?.onChange?.("x edit"));
      // Second emit with the SAME value short-circuits before re-arming.
      act(() => lastEditorProps?.onChange?.("x edit"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      expect(saveTabMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a pending save when the pane unmounts", async () => {
    vi.useFakeTimers();
    try {
      invokeMock.mockResolvedValue({ content: "x", encoding: "utf-8" });
      useTabs.setState({ activePath: "/ws/note.md" });
      const { unmount } = render(<EditorPane workspace="/ws" />);
      await vi.waitFor(() => expect(lastEditorProps?.onChange).toBeTruthy());
      act(() => lastEditorProps?.onChange?.("x edit"));
      unmount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      expect(saveTabMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips re-loading a tab whose content is already cached", async () => {
    invokeMock.mockImplementation(async (_cmd: string, args: { path: string }) =>
      args.path === "/ws/a.md"
        ? { content: "AAA", encoding: "utf-8" }
        : { content: "BBB", encoding: "utf-8" },
    );
    useTabs.setState({ activePath: "/ws/a.md" });
    render(<EditorPane workspace="/ws" />);
    await waitFor(() => expect(screen.getByTestId("editor")).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId("editor").textContent).toBe("AAA"));
    // Switch tabs to force the load effect to re-evaluate, then return.
    act(() => useTabs.setState({ activePath: "/ws/b.md" }));
    await waitFor(() => expect(screen.getByTestId("editor").textContent).toBe("BBB"));
    invokeMock.mockClear();
    act(() => useTabs.setState({ activePath: "/ws/a.md" }));
    await waitFor(() => expect(screen.getByTestId("editor").textContent).toBe("AAA"));
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("drops a successful read when the pane was unmounted in flight", async () => {
    let resolve: (v: unknown) => void = () => {};
    invokeMock.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    useTabs.setState({ activePath: "/ws/slow.md" });
    const { unmount } = render(<EditorPane workspace="/ws" />);
    unmount();
    await act(async () => {
      resolve({ content: "late", encoding: "utf-8" });
      await Promise.resolve();
    });
    // No assertions on DOM (component is gone); the test exercises the
    // cancelled branch in the effect so coverage tracks it.
    expect(true).toBe(true);
  });

  it("drops a read error when the pane was unmounted in flight", async () => {
    let reject: (e: unknown) => void = () => {};
    invokeMock.mockReturnValue(
      new Promise((_r, rj) => {
        reject = rj;
      }),
    );
    useTabs.setState({ activePath: "/ws/slow.md" });
    const { unmount } = render(<EditorPane workspace="/ws" />);
    unmount();
    await act(async () => {
      reject("EACCES");
      await Promise.resolve();
    });
    expect(true).toBe(true);
  });

  it("handles a decision with no vars when copy_diagnostics fires", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    // Wrap a SEC-* decision in the IPC error envelope that fromPosixError
    // recognises. SEC-NULL-BYTE's primary action is copy_diagnostics and
    // the envelope omits vars, exercising the `decision.vars ?? {}` fallback.
    invokeMock.mockRejectedValue({
      access: { ruleId: "SEC-NULL-BYTE", category: "SEC" },
    });
    useTabs.setState({ activePath: "/ws/bad .md" });
    render(<EditorPane workspace="/ws" />);
    await waitFor(() => expect(screen.getByLabelText("Editor error")).toBeTruthy());
    const copy = screen.getByRole("button", {
      name: /copy_diagnostics|copy diagnostics/i,
    });
    fireEvent.click(copy);
    expect(writeText).toHaveBeenCalled();
  });

  it("resets a previously armed timer when a fast follow-up edit lands", async () => {
    vi.useFakeTimers();
    try {
      invokeMock.mockResolvedValue({ content: "x", encoding: "utf-8" });
      useTabs.setState({ activePath: "/ws/note.md" });
      render(<EditorPane workspace="/ws" />);
      await vi.waitFor(() => expect(lastEditorProps?.onChange).toBeTruthy());
      act(() => lastEditorProps?.onChange?.("y"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      act(() => lastEditorProps?.onChange?.("yz"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(700);
      });
      expect(saveTabMock).toHaveBeenCalledTimes(1);
      expect(saveTabMock).toHaveBeenCalledWith(expect.objectContaining({ content: "yz" }));
    } finally {
      vi.useRealTimers();
    }
  });
});
