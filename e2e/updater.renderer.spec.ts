// S-TST-012: auto-update flow under a test-only Ed25519 keypair.
//
// `e2e/fixtures/updater/` ships:
//   - `signing.test-key.pub`  — public key the harness wires into the
//     updater so signed manifests are accepted
//   - `signing.test-key.sec`  — secret key kept *only* under fixtures,
//     never shipped to production builds (CI guards via filename
//     allow-list)
//   - `latest.test.json`      — mock manifest pointing at a fake binary
//   - `latest.test.json.sig`  — signature of the above
//
// `globalSetup` brings up an HTTP server on 127.0.0.1:5173 that serves
// these files; the renderer harness flips `MARKSPREAD_UPDATE_URL` at
// it. Variants below force the manifest into different shapes by query
// string so the same fixtures cover the failure paths.

import { expect, test } from "@playwright/test";

test.describe("auto-update flow (mock signing)", () => {
  test("happy path — detect, download, install on next launch", async ({ page }) => {
    await page.goto("/?harness=updater&variant=happy");

    await page.getByRole("link", { name: /about/i }).click();
    await page.getByRole("button", { name: /check for updates/i }).click();

    await expect(page.getByTestId("update-available")).toBeVisible();
    await expect(page.getByTestId("update-available")).toContainText(/0\.2\.0/);

    await page.getByRole("button", { name: /download/i }).click();
    await expect(page.getByTestId("update-downloading")).toBeVisible();
    await expect(page.getByTestId("update-downloaded")).toBeVisible({ timeout: 15_000 });

    await expect(page.getByTestId("install-on-next-launch")).toBeVisible();
  });

  test("invalid signature is rejected", async ({ page }) => {
    await page.goto("/?harness=updater&variant=bad-sig");
    await page.getByRole("link", { name: /about/i }).click();
    await page.getByRole("button", { name: /check for updates/i }).click();

    await expect(page.getByTestId("update-error")).toBeVisible();
    await expect(page.getByTestId("update-error")).toContainText(/signature/i);
  });

  test("downgrade attempt is rejected", async ({ page }) => {
    await page.goto("/?harness=updater&variant=downgrade");
    await page.getByRole("link", { name: /about/i }).click();
    await page.getByRole("button", { name: /check for updates/i }).click();

    // The UI should report "you're up to date", not offer an older version.
    await expect(page.getByTestId("update-up-to-date")).toBeVisible();
    await expect(page.getByTestId("update-available")).toHaveCount(0);
  });

  test("manifest with security flag surfaces a high-priority badge", async ({ page }) => {
    await page.goto("/?harness=updater&variant=security");
    await page.getByRole("link", { name: /about/i }).click();
    await page.getByRole("button", { name: /check for updates/i }).click();

    const badge = page.getByTestId("update-security-badge");
    await expect(badge).toBeVisible();
    await expect(badge).toContainText(/security/i);
    await expect(badge).toContainText(/CVE-/);
  });
});
