import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));
vi.mock("../lib/i18n-init", () => ({
  i18n: { t: (_key: string, fallback: string) => fallback },
}));

import { ErrorBoundary } from "./ErrorBoundary";

function Bomb({ explode }: { explode: boolean }): React.ReactNode {
  if (explode) throw new Error("kaboom");
  return <div>safe child</div>;
}

afterEach(cleanup);

describe("ErrorBoundary", () => {
  it("renders children when nothing throws", () => {
    render(
      <ErrorBoundary boundaryId="b1">
        <Bomb explode={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("safe child")).toBeTruthy();
  });

  it("renders the default fallback on a render error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary boundaryId="b2">
        <Bomb explode={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("kaboom")).toBeTruthy();
    spy.mockRestore();
  });

  it("renders a custom fallback and supports reset", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary
        boundaryId="b3"
        fallback={(reset, err) => (
          <button type="button" onClick={reset}>
            recover {err.message}
          </button>
        )}
      >
        <Bomb explode={true} />
      </ErrorBoundary>,
    );
    const btn = screen.getByText(/recover kaboom/);
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    spy.mockRestore();
  });
});
