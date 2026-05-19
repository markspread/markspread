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
});
