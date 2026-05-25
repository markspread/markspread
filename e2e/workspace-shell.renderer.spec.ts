// S-MWS-003 / S-MWS-004: end-to-end smoke for the workspace shell
// (workspace tabs × splits) driven through the renderer's `__ms_dev__`
// zustand escape hatch. Mirrors `src/components/WorkspaceShell.test.tsx`
// at the renderer-mount level so a mount-order / dev-hook / persistence
// regression lands before users hit it.

import { type Page, expect, test } from "@playwright/test";

type WorkspaceLayoutNode =
  | {
      type: "ws-tabs";
      id: string;
      tabs: { id: string; workspacePath: string }[];
      activeTabId: string;
    }
  | {
      type: "ws-split";
      id: string;
      direction: "horizontal" | "vertical";
      sizes: number[];
      children: WorkspaceLayoutNode[];
    };

type WindowLayout = {
  schemaVersion: 2;
  root: WorkspaceLayoutNode;
  activeTabId: string;
};

type DevStores = {
  workspace: {
    getState: () => { current: string | null; open: (p: string) => void };
  };
  workspaceLayout: {
    getState: () => {
      layout: WindowLayout | null;
      ensure: (path: string) => WindowLayout;
      addWorkspaceTab: (path: string) => string | null;
      splitVertical: (tabId?: string) => string | null;
      splitHorizontal: (tabId?: string) => string | null;
      closeWorkspaceTab: (tabId: string) => boolean;
      setActiveTab: (tabId: string) => void;
    };
  };
};

const WS_A = "/tmp/ms-e2e-mws-a";
const WS_B = "/tmp/ms-e2e-mws-b";

async function waitForDevHooks(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const dev = (globalThis as unknown as { __ms_dev__?: Record<string, unknown> }).__ms_dev__;
    return dev != null && "workspaceLayout" in dev;
  });
}

async function openWorkspace(page: Page, path: string): Promise<void> {
  await page.evaluate((p) => {
    const dev = (globalThis as unknown as { __ms_dev__: DevStores }).__ms_dev__;
    dev.workspace.getState().open(p);
    dev.workspaceLayout.getState().ensure(p);
  }, path);
}

test.describe("workspace shell — multi-tab × split", () => {
  test("opens a second workspace tab and renders the tab strip", async ({ page }) => {
    await page.goto("/");
    await waitForDevHooks(page);
    await openWorkspace(page, WS_A);

    // Fast path: single tab → no WorkspaceShell wrapper.
    await expect(page.locator('[data-workspace-shell="true"]')).toHaveCount(0);

    await page.evaluate((p) => {
      const dev = (globalThis as unknown as { __ms_dev__: DevStores }).__ms_dev__;
      dev.workspaceLayout.getState().addWorkspaceTab(p);
    }, WS_B);

    // Multi-shell path: WorkspaceShell mounts, tab strip shows 2 tabs.
    await expect(page.locator('[data-workspace-shell="true"]')).toHaveCount(1);
    await expect(page.locator("[data-ws-tab-id]")).toHaveCount(2);
  });

  test("Mod+\\ creates a vertical split with two workspace tab leaves", async ({ page }) => {
    await page.goto("/");
    await waitForDevHooks(page);
    await openWorkspace(page, WS_A);

    await page.evaluate(() => {
      const dev = (globalThis as unknown as { __ms_dev__: DevStores }).__ms_dev__;
      dev.workspaceLayout.getState().splitVertical();
    });

    await expect(page.locator('[data-ws-split-direction="horizontal"]')).toHaveCount(1);
    await expect(page.locator("[data-ws-tabs-id]")).toHaveCount(2);
  });

  test("closing the last tab in a leaf merges the split", async ({ page }) => {
    await page.goto("/");
    await waitForDevHooks(page);
    await openWorkspace(page, WS_A);

    await page.evaluate(() => {
      const dev = (globalThis as unknown as { __ms_dev__: DevStores }).__ms_dev__;
      dev.workspaceLayout.getState().splitVertical();
    });
    await expect(page.locator("[data-ws-tabs-id]")).toHaveCount(2);

    // Close the active leaf's only tab → split should collapse to a single ws-tabs.
    await page.evaluate(() => {
      const dev = (globalThis as unknown as { __ms_dev__: DevStores }).__ms_dev__;
      const layout = dev.workspaceLayout.getState().layout;
      if (!layout) throw new Error("no layout");
      dev.workspaceLayout.getState().closeWorkspaceTab(layout.activeTabId);
    });

    // After merge: no split + a single ws-tabs leaf containing one tab.
    await expect(page.locator('[data-ws-split-direction="horizontal"]')).toHaveCount(0);
  });
});
