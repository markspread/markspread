// S-TST-007: shared e2e setup — deterministic home + cleanup.
//
// We sandbox MARKSPREAD_HOME under the test workspace so e2e never
// touches the developer's actual `~/.markspread`. The harness flag
// (`MARKSPREAD_E2E=1`) tells the renderer to expose `window.__msTestHarness`
// with deterministic-clock + IPC-mock helpers — see
// `src/lib/test-harness/install.ts` (registered behind the flag).

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let home: string | null = null;

export default async function globalSetup(): Promise<void> {
  home = mkdtempSync(join(tmpdir(), "ms-e2e-home-"));
  mkdirSync(join(home, "snapshots"), { recursive: true });
  mkdirSync(join(home, "logs"), { recursive: true });
  process.env.MARKSPREAD_HOME = home;
  process.env.MARKSPREAD_E2E_HOME = home;
}

export async function teardown(): Promise<void> {
  if (home) {
    rmSync(home, { recursive: true, force: true });
    home = null;
  }
}
