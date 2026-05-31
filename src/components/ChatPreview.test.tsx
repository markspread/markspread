import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: unknown) => invokeMock(cmd, args),
}));
vi.mock("./SpreadPane", () => ({
  SpreadPane: ({ documentPath, content }: { documentPath: string; content: string }) => (
    <div data-testid="spread-mock" data-doc={documentPath}>
      {content}
    </div>
  ),
}));

import { ChatPreview } from "./ChatPreview";

beforeEach(() => {
  invokeMock.mockReset();
});
afterEach(cleanup);

describe("ChatPreview", () => {
  it("shows the loading state before content resolves", () => {
    invokeMock.mockReturnValue(new Promise(() => {}));
    render(<ChatPreview workspace="/ws" documentPath="/ws/a.md" />);
    expect(screen.getByTestId("chat-preview-loading")).toBeTruthy();
  });

  it("renders the SpreadPane once content resolves", async () => {
    invokeMock.mockResolvedValue({ content: "# Hi", encoding: "utf-8" });
    render(<ChatPreview workspace="/ws" documentPath="/ws/a.md" />);
    await waitFor(() => expect(screen.getByTestId("chat-preview-root")).toBeTruthy());
    expect(screen.getByTestId("spread-mock").dataset.doc).toBe("/ws/a.md");
    expect(screen.getByTestId("spread-mock").textContent).toBe("# Hi");
  });

  it("shows the error state when the read rejects", async () => {
    invokeMock.mockRejectedValue("EACCES");
    render(<ChatPreview workspace="/ws" documentPath="/ws/locked.md" />);
    await waitFor(() => expect(screen.getByTestId("chat-preview-error")).toBeTruthy());
    expect(screen.getByTestId("chat-preview-error").textContent).toMatch(/EACCES/);
  });

  it("drops a resolved read after unmount (active guard)", async () => {
    let resolve: (v: unknown) => void = () => {};
    invokeMock.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { unmount } = render(<ChatPreview workspace="/ws" documentPath="/ws/slow.md" />);
    unmount();
    resolve({ content: "late", encoding: "utf-8" });
    await Promise.resolve();
    // No throw / no leaked render — assertion is implicit via no error.
    expect(screen.queryByTestId("spread-mock")).toBeNull();
  });

  it("drops a rejected read after unmount (active guard)", async () => {
    let reject: (e: unknown) => void = () => {};
    invokeMock.mockReturnValue(
      new Promise((_r, rj) => {
        reject = rj;
      }),
    );
    const { unmount } = render(<ChatPreview workspace="/ws" documentPath="/ws/slow.md" />);
    unmount();
    reject("EACCES");
    await Promise.resolve();
    expect(screen.queryByTestId("chat-preview-error")).toBeNull();
  });
});
