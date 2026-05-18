// S-AI-AUTH-003: "Subscribe with Claude" sign-in modal.
//
// Wraps `createSubscriptionAuthFlow` + `createTauriAuthTransport` and
// renders a stage-aware UI so the user can see the verification URL +
// user code, retry, or cancel. The actual OAuth happens Rust-side; this
// component only relays metadata.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusTrap } from "../lib/focus-trap";
import {
  createSubscriptionAuthFlow,
  type AuthFlowHandle,
  type AuthStage,
} from "../lib/ai/subscription-auth";
import { createTauriAuthTransport } from "../lib/ai/subscription-auth-tauri";
import type { SubscriptionCredential } from "../lib/ai/credentials";

interface SubscriptionAuthModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (cred: SubscriptionCredential) => void;
}

export function SubscriptionAuthModal({
  open,
  onClose,
  onSuccess,
}: SubscriptionAuthModalProps) {
  const { t } = useTranslation();
  const [stage, setStage] = useState<AuthStage>({ kind: "idle" });
  const flowRef = useRef<AuthFlowHandle | null>(null);
  const trapRef = useFocusTrap<HTMLDivElement>({
    active: open,
    onEscape: () => void cancel(),
  });

  useEffect(() => {
    if (!open) return;
    const flow = createSubscriptionAuthFlow({
      transport: createTauriAuthTransport(),
      onStage: setStage,
    });
    flowRef.current = flow;
    void flow.start("anthropic").then((finalStage) => {
      if (finalStage.kind === "success") onSuccess(finalStage.credential);
    });
    return () => {
      void flow.cancel();
      flowRef.current = null;
    };
  }, [open, onSuccess]);

  const cancel = async () => {
    await flowRef.current?.cancel();
    onClose();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label={t("subscription.auth.aria", "Sign in with Claude")}
    >
      <div
        ref={trapRef}
        className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-6 shadow-xl"
      >
        <h2 className="font-semibold text-base">
          {t("subscription.auth.title", "Sign in with Claude")}
        </h2>
        <div className="mt-4 text-sm">
          {stage.kind === "idle" || stage.kind === "starting" ? (
            <p className="text-[var(--color-muted)]">
              {t("subscription.auth.starting", "Starting sign-in…")}
            </p>
          ) : stage.kind === "awaiting-user" ? (
            <div className="flex flex-col gap-2">
              <p>
                {t(
                  "subscription.auth.open_browser",
                  "Open the link below in your browser and approve the request.",
                )}
              </p>
              <a
                href={stage.verificationUrl}
                target="_blank"
                rel="noreferrer"
                className="break-all rounded border border-[var(--color-border)] px-3 py-2 font-mono text-[var(--color-accent)] text-xs hover:underline"
              >
                {stage.verificationUrl}
              </a>
              {stage.userCode && (
                <p className="font-mono text-xs">
                  {t("subscription.auth.code", "Code")}: <strong>{stage.userCode}</strong>
                </p>
              )}
            </div>
          ) : stage.kind === "exchanging" ? (
            <p className="text-[var(--color-muted)]">
              {t("subscription.auth.exchanging", "Finishing sign-in…")}
            </p>
          ) : stage.kind === "success" ? (
            <p className="text-green-500">
              {t("subscription.auth.success", "Signed in successfully.")}
            </p>
          ) : (
            <p role="alert" className="text-red-500">
              {stage.error.message}
            </p>
          )}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm"
            onClick={() => void cancel()}
          >
            {stage.kind === "success"
              ? t("subscription.auth.close", "Close")
              : t("subscription.auth.cancel", "Cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
