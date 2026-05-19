import type { LinkDialogRequest, LinkDialogResult } from "@/lib/editor/commands/link";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LinkDialog } from "./LinkDialog";

afterEach(cleanup);

// The component registers an opener via `setLinkDialogOpener` on mount.
let opener: ((r: LinkDialogRequest) => void) | null = null;
vi.mock("@/lib/editor/commands/link", async () => {
  const actual = await vi.importActual<typeof import("@/lib/editor/commands/link")>(
    "@/lib/editor/commands/link",
  );
  return {
    ...actual,
    setLinkDialogOpener: (fn: (r: LinkDialogRequest) => void) => {
      opener = fn;
    },
    getWorkspaceLinkProvider: () => null,
  };
});

afterEach(() => {
  opener = null;
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
});
