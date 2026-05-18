// S-SBC-007: end-to-end coverage for the FileTree sidebar collapse.
//
// Three scenarios, one spec:
//   1. Toggling via Mod+B flips visibility 5× without drift.
//   2. After a page reload the last hidden/visible decision is restored
//      from the per-window persisted layout (localStorage fast path).
//   3. Two workspaces keep independent hidden state — collapsing one
//      does not collapse the other when the user switches between them.
//
// Drives the app through the `__ms_dev__` zustand escape hatch that
// `main.tsx` exposes whenever the page is not running inside Tauri. The
// harness param (`?harness=…`) is still aspirational and not wired into
// the renderer yet, so we open a synthetic workspace from the dev store
// instead. When the harness lands this spec keeps working unchanged —
// the store API is the source of truth either way.

import { type Page, expect, test } from "@playwright/test";

type DevStores = {
  workspace: {
    getState: () => {
      current: string | null;
      open: (path: string) => void;
      close: () => void;
    };
  };
};

const WS_A = "/tmp/ms-e2e-ws-a";
const WS_B = "/tmp/ms-e2e-ws-b";

async function waitForDevHooks(page: Page): Promise<void> {
  await page.waitForFunction(() => "__ms_dev__" in globalThis);
}

async function openWorkspace(page: Page, path: string): Promise<void> {
  await page.evaluate((p) => {
    const dev = (globalThis as unknown as { __ms_dev__: DevStores }).__ms_dev__;
    dev.workspace.getState().open(p);
  }, path);
}

async function sidebarHidden(page: Page): Promise<boolean> {
  return await page
    .locator("aside[data-sidebar-aside]")
    .evaluate((el) => el.getAttribute("aria-hidden") === "true");
}

test("Mod+B toggles the sidebar 5× without drift", async ({ page }) => {
  await page.goto("/");
  await waitForDevHooks(page);
  await openWorkspace(page, WS_A);

  const aside = page.locator("aside[data-sidebar-aside]");
  await expect(aside).toBeVisible();

  // Establish a known starting state (visible) regardless of any
  // previously-persisted value the runner picked up.
  if (await sidebarHidden(page)) {
    await page.keyboard.press("Meta+B");
    await expect(aside).toHaveAttribute("aria-hidden", "false");
  }

  let expected = true; // first press hides
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press("Meta+B");
    await expect(aside).toHaveAttribute("aria-hidden", String(expected));
    expected = !expected;
  }
});

test("hidden state survives a page reload", async ({ page }) => {
  await page.goto("/");
  await waitForDevHooks(page);
  await openWorkspace(page, WS_A);

  // Force-hide via the command palette button so we exercise the same
  // setter the user would hit, not a direct store poke.
  const toggle = page.getByRole("button", { name: /hide sidebar|show sidebar/i }).first();
  if (!(await sidebarHidden(page))) {
    await toggle.click();
  }
  await expect(page.locator("aside[data-sidebar-aside]")).toHaveAttribute("aria-hidden", "true");

  await page.reload();
  await waitForDevHooks(page);
  await openWorkspace(page, WS_A);
  await expect(page.locator("aside[data-sidebar-aside]")).toHaveAttribute("aria-hidden", "true");
});

test("two workspaces keep independent collapsed state", async ({ page }) => {
  await page.goto("/");
  await waitForDevHooks(page);

  await openWorkspace(page, WS_A);
  // Hide A.
  if (!(await sidebarHidden(page))) {
    await page.keyboard.press("Meta+B");
  }
  await expect(page.locator("aside[data-sidebar-aside]")).toHaveAttribute("aria-hidden", "true");

  // Switch to B — should default to visible (workspace-scoped state).
  await openWorkspace(page, WS_B);
  await expect(page.locator("aside[data-sidebar-aside]")).toHaveAttribute("aria-hidden", "false");

  // Hop back to A; the previously-hidden state must come back.
  await openWorkspace(page, WS_A);
  await expect(page.locator("aside[data-sidebar-aside]")).toHaveAttribute("aria-hidden", "true");
});
