import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn((..._args: unknown[]) => Promise.resolve(undefined));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  convertFileSrc: (p: string) => `asset://${p}`,
}));

import { NonTextViewer } from "./NonTextViewer";

afterEach(cleanup);

describe("NonTextViewer", () => {
  it("renders an image inline for image files", () => {
    render(<NonTextViewer path="/ws/pic.png" kind="image" />);
    const img = screen.getByRole("img");
    expect(img.getAttribute("src")).toBe("asset:///ws/pic.png");
    expect(img.getAttribute("alt")).toBe("pic.png");
  });

  it("shows the pdf headline for pdf files", () => {
    render(<NonTextViewer path="/ws/doc.pdf" kind="pdf" />);
    expect(screen.getByText("PDF preview is not yet supported.")).toBeTruthy();
  });

  it("shows a binary placard and wires reveal/open actions", () => {
    render(<NonTextViewer path="/ws/blob.bin" kind="binary" />);
    expect(screen.getByText("This file is not a text document.")).toBeTruthy();
    expect(screen.getByText("blob.bin")).toBeTruthy();
    fireEvent.click(screen.getByText("Reveal in file manager"));
    fireEvent.click(screen.getByText("Open with default app"));
    expect(invoke).toHaveBeenCalledWith("os_reveal_path", { path: "/ws/blob.bin" });
    expect(invoke).toHaveBeenCalledWith("os_open_with", { path: "/ws/blob.bin" });
  });
});
