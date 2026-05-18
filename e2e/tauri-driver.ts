// S-TST-007: tauri-driver helper.
//
// Spawns the debug-built tauri binary under `tauri-driver` (a thin
// WebDriver-BiDi adapter) and returns a Playwright BrowserContext
// pointed at it. CI installs `tauri-driver` separately — locally,
// `pnpm e2e:install` does it for you.

import { type ChildProcess, spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { type BrowserContext, chromium } from "@playwright/test";

const TAURI_DRIVER_PORT = 4444;
const HEALTHCHECK_TIMEOUT_MS = 30_000;

const BIN_PATH_BY_PLATFORM: Record<NodeJS.Platform, string | undefined> = {
  darwin: "src-tauri/target/debug/markspread",
  linux: "src-tauri/target/debug/markspread",
  win32: "src-tauri/target/debug/markspread.exe",
  // unsupported:
  aix: undefined,
  freebsd: undefined,
  openbsd: undefined,
  sunos: undefined,
  netbsd: undefined,
  haiku: undefined,
  cygwin: undefined,
};

export interface TauriHarness {
  context: BrowserContext;
  shutdown(): Promise<void>;
}

export async function launchTauriHarness(repoRoot: string): Promise<TauriHarness> {
  const binPath = BIN_PATH_BY_PLATFORM[process.platform];
  if (!binPath) throw new Error(`Tauri e2e is not supported on ${process.platform}`);

  const driver = spawn(
    "tauri-driver",
    ["--port", String(TAURI_DRIVER_PORT), "--native-port", "0"],
    {
      stdio: "pipe",
      env: { ...process.env, MARKSPREAD_E2E: "1", MARKSPREAD_AI_MOCK: "1" },
    },
  );

  await waitForDriverReady(driver);

  const context = await chromium.launchPersistentContext("", {
    executablePath: resolve(repoRoot, binPath),
    args: [`--remote-debugging-port=${TAURI_DRIVER_PORT}`],
    headless: false,
  });

  return {
    context,
    async shutdown() {
      await context.close();
      driver.kill("SIGTERM");
    },
  };
}

function waitForDriverReady(child: ChildProcess): Promise<void> {
  return new Promise((resolveReady, rejectReady) => {
    const timer = setTimeout(
      () => rejectReady(new Error("tauri-driver did not become ready in time")),
      HEALTHCHECK_TIMEOUT_MS,
    );
    child.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("Listening on")) {
        clearTimeout(timer);
        resolveReady();
      }
    });
    child.on("exit", (code) =>
      rejectReady(new Error(`tauri-driver exited early with code ${code}`)),
    );
  });
}

// Convenience for tests that need the renderer-side harness regardless
// of whether they run under the renderer project (vite preview) or the
// tauri project (real binary).
export const HARNESS_GLOBAL = "__msTestHarness";

export function harnessSelector(): string {
  return `[data-harness-ready="true"]`;
}

export function repoRoot(): string {
  return resolve(__dirname, "..");
}

export const ARTIFACTS_DIR = join(__dirname, "..", "test-results");
