// S-PL-SEC-001: e2e renderer spec — boots PluginHost harness, asserts
// that `:::note` / `:::warning` fences are replaced by the plugin's
// HTML output. Validates that the in-renderer plugin pipeline (host +
// sandbox-rpc + render-hooks) wires up end-to-end.

import { expect, test } from "@playwright/test";

test.describe("plugin host renders custom fences", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?harness=plugin-host");
    await expect(page.locator("[data-harness-ready='true']")).toBeVisible();
  });

  test("renders :::note and :::warning fences via plugin output", async ({ page }) => {
    const harness = page.getByTestId("plugin-host-harness");
    await expect(harness).toHaveAttribute("data-plugin-host-status", "ready");

    const note = page.getByTestId("ms-alert-note");
    await expect(note).toBeVisible();
    await expect(note).toContainText("GitHub-style note body.");

    const warning = page.getByTestId("ms-alert-warning");
    await expect(warning).toBeVisible();
    await expect(warning).toContainText("GitHub-style warning body.");

    // Plain paragraph remains intact (graceful pass-through).
    await expect(page.getByTestId("plugin-host-preview")).toContainText(
      "Plain paragraph stays untouched.",
    );
  });
});
