// S-TST-007: Playwright e2e infrastructure.
//
// Two test surfaces share this config:
//
//   1. Renderer-only (`projects.renderer`) — fast feedback. Runs against
//      `pnpm vite preview` so we catch routing / DOM regressions in
//      seconds without paying for a Tauri build. The renderer is
//      pre-fed a `__msTestHarness` global that stubs the Tauri IPC
//      bridge, so most user flows are testable here.
//
//   2. Tauri shell (`projects.tauri`) — slow but real. Runs against the
//      built debug bundle via `tauri-driver` + WebDriver-BiDi, so we
//      can cover the actual webview, the Rust IPC handlers, file-system
//      side-effects, and platform integrations (menus, file dialogs).
//      CI runs this only on the OS that owns the change (macOS for
//      .dmg, Windows for .msi, Ubuntu otherwise) — full matrix lives
//      in S-TST-019.
//
// Both projects share a `globalSetup` that materialises a deterministic
// home directory under `e2e/.fixtures/home`, sets `MARKSPREAD_HOME` to
// it, and (for the renderer project) starts the preview server.

import { defineConfig, devices } from "@playwright/test";

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : undefined,
  reporter: isCI
    ? [
        ["html", { open: "never" }],
        ["junit", { outputFile: "test-results/playwright-junit.xml" }],
        ["github"],
      ]
    : [["list"], ["html", { open: "on-failure" }]],

  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",

  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
  },

  projects: [
    {
      name: "renderer",
      testMatch: /.*\.renderer\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://127.0.0.1:4173",
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: "tauri",
      testMatch: /.*\.tauri\.spec\.ts/,
      // The Tauri project doesn't share `use.baseURL` — each spec spawns
      // the binary itself via the helper in `e2e/tauri-driver.ts`.
      use: {
        actionTimeout: 20_000,
      },
    },
  ],

  webServer: {
    command: "pnpm vite preview --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !isCI,
    timeout: 60_000,
    env: {
      MARKSPREAD_E2E: "1",
      MARKSPREAD_AI_MOCK: "1",
    },
  },
});
