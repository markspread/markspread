// S-TST-011: plugin install/uninstall lifecycle.
//
// Stand up a local verdaccio (started in `globalSetup` for the
// `plugin-lifecycle` harness, see `e2e/fixtures/verdaccio.config.yaml`)
// preloaded with two fake plugins:
//   - `@markspread-fixtures/hello`        — basic command + view
//   - `@markspread-fixtures/wants-shell`  — declares blocked permission
//
// We assert: install → consent → enable → command appears in palette;
// uninstall → cleanup; permission-blocked plugin refuses install.

import { expect, test } from "@playwright/test";

test.describe("plugin install / uninstall", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?harness=plugin-lifecycle");
  });

  test("install + run a hello plugin", async ({ page }) => {
    await page.getByRole("link", { name: /marketplace/i }).click();
    await page.getByPlaceholder(/search plugins/i).fill("hello");
    await page.getByRole("button", { name: /^install$/i }).first().click();

    const consent = page.getByTestId("permission-consent");
    await expect(consent).toBeVisible();
    await expect(consent).toContainText(/fs.read/);
    await page.getByRole("button", { name: /allow/i }).click();

    await expect(page.getByTestId("plugin-installed-toast")).toBeVisible();
    await expect(page.getByTestId(`plugin-row-@markspread-fixtures/hello`)).toContainText(/enabled/i);

    // Command palette should now expose `Hello: greet`.
    await page.keyboard.press("Control+Shift+P");
    await page.getByRole("textbox", { name: /command/i }).fill("Hello: greet");
    await page.getByRole("option", { name: /Hello: greet/ }).click();
    await expect(page.getByTestId("notification-toast")).toContainText(/hello from fixtures/i);
  });

  test("uninstall removes the plugin and its sandboxed data", async ({ page }) => {
    await page.goto("/?harness=plugin-lifecycle&preinstalled=hello");
    await page.getByRole("link", { name: /plugins/i }).click();

    await page.getByTestId("plugin-row-@markspread-fixtures/hello").getByRole("button", { name: /uninstall/i }).click();
    await page.getByRole("button", { name: /confirm/i }).click();

    await expect(page.getByTestId("plugin-row-@markspread-fixtures/hello")).toHaveCount(0);

    await page.keyboard.press("Control+Shift+P");
    await page.getByRole("textbox", { name: /command/i }).fill("Hello: greet");
    await expect(page.getByRole("option", { name: /Hello: greet/ })).toHaveCount(0);
  });

  test("plugin requesting `shell` permission is rejected at install", async ({ page }) => {
    await page.getByRole("link", { name: /marketplace/i }).click();
    await page.getByPlaceholder(/search plugins/i).fill("wants-shell");
    await page.getByRole("button", { name: /^install$/i }).first().click();

    await expect(page.getByTestId("install-error")).toBeVisible();
    await expect(page.getByTestId("install-error")).toContainText(/shell/i);
    await expect(page.getByTestId("install-error")).toContainText(/not allowed/i);
  });
});
