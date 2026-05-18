// S-TST-007: tear down the deterministic home directory.

import { rmSync } from "node:fs";

export default async function globalTeardown(): Promise<void> {
  const home = process.env.MARKSPREAD_E2E_HOME;
  if (home) rmSync(home, { recursive: true, force: true });
}
