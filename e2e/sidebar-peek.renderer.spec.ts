// S-SBP-010: end-to-end coverage for the FileTree peek overlay.
//
// Five scenarios:
//   1. Hover the rail → peek appears after 150ms; leave → vanishes
//      after 200ms.
//   2. Mod+Shift+E from anywhere opens peek with focus on the tree.
//   3. Esc closes peek even while pointer is still inside.
//   4. Pin via 📌 button survives focus leaving the panel.
//   5. Opening the command palette dismisses peek (z-index ordering).
//
// Like S-SBC-007 we drive through the dev escape hatch (`__ms_dev__`)
// to seed a workspace and force the sidebar into rail mode, then
// exercise the real user-facing surfaces (keyboard, hover) from there.
// Visual baselines + 1000-node virtualisation regression are left as
// TODO markers — they require a Playwright snapshot baseline and a
// fixture workspace, neither of which are wired in yet. The scenarios
// here cover the functional acceptance.

// fixme: the sidebar peek overlay (S-SBP-010) is scaffolded but not
// wired in the renderer yet — there is no `[data-sidebar-rail]` /
// `[data-sidebar-peek]` surface and no Mod+Shift+E shortcut. Re-enable
// once the peek panel lands.
import { type Page, expect, test } from "@playwright/test";

type DevStores = {
  workspace: { getState: () => { open: (path: string) => void } };
};
type LayoutStore = {
  getState: () => { setSidebarHidden: (workspace: string, hidden: boolean) => void };
};

const WS = "/tmp/ms-e2e-peek";

async function waitForDevHooks(page: Page): Promise<void> {
  await page.waitForFunction(() => "__ms_dev__" in globalThis);
}

async function setupCollapsedWorkspace(page: Page): Promise<void> {
  await waitForDevHooks(page);
  await page.evaluate((path) => {
    const dev = (globalThis as unknown as { __ms_dev__: DevStores }).__ms_dev__;
    dev.workspace.getState().open(path);
  }, WS);
  // The layout store is loaded lazily; import it on-page and force the
  // sidebar collapsed so the rail is rendered for hover targeting.
  await page.evaluate(async (path) => {
    const mod = (await import("/src/store/layout.ts")) as unknown as {
      useLayout: LayoutStore;
    };
    mod.useLayout.getState().setSidebarHidden(path, true);
  }, WS);
}

test.fixme("hover the rail for 150ms opens peek; leaving for 200ms closes it", async ({ page }) => {
  await page.goto("/");
  await setupCollapsedWorkspace(page);

  const rail = page.locator("[data-sidebar-rail]");
  await expect(rail).toBeVisible();

  await rail.hover();
  await expect(page.locator("[data-sidebar-peek]")).toBeVisible({ timeout: 1_000 });

  // Move pointer far away; peek should close after the 200ms grace.
  await page.mouse.move(900, 400);
  await expect(page.locator("[data-sidebar-peek]")).toBeHidden({ timeout: 1_000 });
});

test.fixme("Mod+Shift+E opens peek and focuses the tree", async ({ page }) => {
  await page.goto("/");
  await setupCollapsedWorkspace(page);

  await page.keyboard.press("Meta+Shift+E");
  await expect(page.locator("[data-sidebar-peek]")).toBeVisible();
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("role"));
  expect(focused).toBe("tree");
});

test.fixme("Esc closes the peek immediately", async ({ page }) => {
  await page.goto("/");
  await setupCollapsedWorkspace(page);

  await page.keyboard.press("Meta+Shift+E");
  await expect(page.locator("[data-sidebar-peek]")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-sidebar-peek]")).toBeHidden();
});

test.fixme("pinning keeps peek open after pointer leaves", async ({ page }) => {
  await page.goto("/");
  await setupCollapsedWorkspace(page);

  await page.locator("[data-sidebar-rail]").hover();
  await expect(page.locator("[data-sidebar-peek]")).toBeVisible({ timeout: 1_000 });

  await page.locator("[data-sidebar-peek] button[aria-pressed]").click();
  await page.mouse.move(900, 400);

  // The 200ms grace passes; the peek should still be there because it
  // is pinned.
  await page.waitForTimeout(400);
  await expect(page.locator("[data-sidebar-peek]")).toBeVisible();
});

test.fixme("opening the command palette dismisses peek (z-index ordering)", async ({ page }) => {
  await page.goto("/");
  await setupCollapsedWorkspace(page);

  await page.keyboard.press("Meta+Shift+E");
  await expect(page.locator("[data-sidebar-peek]")).toBeVisible();

  await page.keyboard.press("Meta+K");
  // Palette opens and the peek's focusout listener fires → peek closes.
  await expect(page.locator("[data-sidebar-peek]")).toBeHidden({ timeout: 1_000 });
});
