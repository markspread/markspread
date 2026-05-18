// T-U15-003: bootstrap AuthRefreshScheduler at app boot when an
// anthropic subscription credential exists. Tokens themselves never
// leave the OS keychain — the renderer holds only the credential
// metadata (expiry, alias, account label) so the scheduler can decide
// when to fire `ai_auth_refresh_subscription`.

import { invoke } from "@tauri-apps/api/core";
import {
  createAuthRefreshScheduler,
  type AuthRefreshScheduler,
  type RefreshTransport,
} from "./auth-refresh";
import type { SubscriptionCredential } from "./credentials";

let active: AuthRefreshScheduler | null = null;
let current: SubscriptionCredential | null = null;

function createRefreshTransport(): RefreshTransport {
  return {
    async refresh(cred) {
      const next = await invoke<SubscriptionCredential>("ai_auth_refresh_subscription", {
        alias: cred.alias,
      });
      return next;
    },
  };
}

export async function startAuthRefreshScheduler(): Promise<void> {
  if (active) return;
  try {
    const cred = await invoke<SubscriptionCredential | null>("ai_keys_get_subscription");
    if (!cred) return;
    current = cred;
    const sched = createAuthRefreshScheduler({
      transport: createRefreshTransport(),
      getCurrentCredential: () => current,
      onCredentialUpdate: (next) => {
        current = next;
      },
      onRefreshFailed: (reason, err) => {
        console.warn("[ai-auth-refresh]", reason, err.message);
      },
    });
    sched.start();
    active = sched;
  } catch (e) {
    console.warn("[ai-auth-refresh] boot skipped", e);
  }
}

export function stopAuthRefreshScheduler(): void {
  active?.stop();
  active = null;
  current = null;
}
