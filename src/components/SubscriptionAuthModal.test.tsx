import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthFlowHandle, AuthStage } from "../lib/ai/subscription-auth";

let onStage: ((s: AuthStage) => void) | null = null;
const cancel = vi.fn(() => Promise.resolve());
const start = vi.fn(() => Promise.resolve<AuthStage>({ kind: "idle" }));

vi.mock("../lib/ai/subscription-auth", () => ({
  createSubscriptionAuthFlow: (opts: { onStage?: (s: AuthStage) => void }) => {
    onStage = opts.onStage ?? null;
    const handle: AuthFlowHandle = {
      start,
      cancel,
      getStage: () => ({ kind: "idle" }),
    };
    return handle;
  },
}));
vi.mock("../lib/ai/subscription-auth-tauri", () => ({
  createTauriAuthTransport: () => ({}),
}));

import { SubscriptionAuthModal } from "./SubscriptionAuthModal";

afterEach(cleanup);

describe("SubscriptionAuthModal", () => {
  it("renders nothing while closed", () => {
    const { container } = render(
      <SubscriptionAuthModal open={false} onClose={() => {}} onSuccess={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the starting state when opened", () => {
    render(<SubscriptionAuthModal open onClose={() => {}} onSuccess={() => {}} />);
    expect(screen.getByText("Sign in with Claude")).toBeTruthy();
    expect(screen.getByText("Starting sign-in…")).toBeTruthy();
  });

  it("shows the verification URL when awaiting the user", () => {
    render(<SubscriptionAuthModal open onClose={() => {}} onSuccess={() => {}} />);
    act(() => {
      onStage?.({
        kind: "awaiting-user",
        verificationUrl: "https://verify.example",
        userCode: "ABCD-1234",
      });
    });
    expect(screen.getByText("https://verify.example")).toBeTruthy();
    expect(screen.getByText("ABCD-1234")).toBeTruthy();
  });

  it("cancels the flow via the cancel button", () => {
    const onClose = vi.fn();
    render(<SubscriptionAuthModal open onClose={onClose} onSuccess={() => {}} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(cancel).toHaveBeenCalled();
  });

  it("renders the exchanging stage", () => {
    render(<SubscriptionAuthModal open onClose={() => {}} onSuccess={() => {}} />);
    act(() => {
      onStage?.({ kind: "exchanging" });
    });
    expect(screen.getByText("Finishing sign-in…")).toBeTruthy();
  });

  it("renders the success stage and the Close label", () => {
    render(<SubscriptionAuthModal open onClose={() => {}} onSuccess={() => {}} />);
    act(() => {
      onStage?.({
        kind: "success",
        credential: { type: "subscription", accessToken: "t" } as unknown as never,
      });
    });
    expect(screen.getByText("Signed in successfully.")).toBeTruthy();
    expect(screen.getByText("Close")).toBeTruthy();
  });

  it("surfaces an error message when the flow rejects", () => {
    render(<SubscriptionAuthModal open onClose={() => {}} onSuccess={() => {}} />);
    act(() => {
      onStage?.({
        kind: "error",
        error: { code: "internal", i18nKey: "auth.error.internal", message: "auth failed" },
      });
    });
    expect(screen.getByRole("alert").textContent).toBe("auth failed");
  });

  it("omits the user-code line when the device-code response has no userCode", () => {
    render(<SubscriptionAuthModal open onClose={() => {}} onSuccess={() => {}} />);
    act(() => {
      onStage?.({
        kind: "awaiting-user",
        verificationUrl: "https://verify.example/nocode",
        userCode: "",
      });
    });
    expect(screen.queryByText(/^Code:/)).toBeNull();
  });

  it("cancels via Escape from inside the focus trap", () => {
    const onClose = vi.fn();
    render(<SubscriptionAuthModal open onClose={onClose} onSuccess={() => {}} />);
    const evt = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    document.dispatchEvent(evt);
    expect(cancel).toHaveBeenCalled();
  });

  it("invokes onSuccess when the start promise resolves to success", async () => {
    const onSuccess = vi.fn();
    start.mockResolvedValueOnce({
      kind: "success",
      credential: { type: "subscription", accessToken: "tok" } as unknown as never,
    });
    render(<SubscriptionAuthModal open onClose={() => {}} onSuccess={onSuccess} />);
    await Promise.resolve();
    await Promise.resolve();
    expect(onSuccess).toHaveBeenCalled();
  });
});
