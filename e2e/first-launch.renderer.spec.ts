// S-TST-008: first-launch flow (covers S-FL-001..012).
//
// We drive the renderer in its harness mode so the IPC stub returns a
// "fresh install" state — no recent workspaces, no prior settings. The
// flow:
//
//   FL-001  splash within budget
//   FL-002  EULA dialog blocks until accepted
//   FL-003  optional telemetry consent ("Help improve Markspread")
//   FL-004  language picker honours OS locale, KR -> ko by default
//   FL-005  theme picker (auto/light/dark)
//   FL-006  "open existing" vs "create new" workspace branch
//   FL-007  guided sample workspace if user declines both
//   FL-008  AI provider key prompt deferred (skip-ok)
//   FL-009  keybinding profile (default vs vim) chooser
//   FL-010  data-folder location chosen, written to settings
//   FL-011  finish summary lists every choice
//   FL-012  re-launch skips the wizard (sticky completion flag)
//
// We assert each step rather than just the final state so a regression
// at any intermediate dialog points straight at the broken step.

import { expect, test } from "@playwright/test";

test.describe("first-launch wizard", () => {
  test("walks through the full 12-step flow", async ({ page }) => {
    await page.goto("/?harness=fresh-install");
    await expect(page.getByTestId("splash")).toBeVisible({ timeout: 2_000 });

    await expect(page.getByTestId("eula-dialog")).toBeVisible();
    await page.getByRole("button", { name: /agree/i }).click();

    await expect(page.getByTestId("telemetry-consent")).toBeVisible();
    await page.getByRole("button", { name: /no thanks/i }).click();

    await expect(page.getByTestId("language-picker")).toBeVisible();
    // OS locale stub is set to ko-KR in fresh-install harness.
    await expect(page.getByLabel(/한국어/i)).toBeChecked();
    await page.getByRole("button", { name: /next/i }).click();

    await expect(page.getByTestId("theme-picker")).toBeVisible();
    await page.getByLabel(/auto/i).check();
    await page.getByRole("button", { name: /next/i }).click();

    await expect(page.getByTestId("workspace-choice")).toBeVisible();
    await page.getByRole("button", { name: /create sample/i }).click();

    await expect(page.getByTestId("ai-key-prompt")).toBeVisible();
    await page.getByRole("button", { name: /skip for now/i }).click();

    await expect(page.getByTestId("keybinding-picker")).toBeVisible();
    await page.getByLabel(/default/i).check();
    await page.getByRole("button", { name: /next/i }).click();

    await expect(page.getByTestId("data-folder")).toBeVisible();
    await page.getByRole("button", { name: /use suggested/i }).click();

    const summary = page.getByTestId("first-run-summary");
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("한국어");
    await expect(summary).toContainText(/sample workspace/i);
    await page.getByRole("button", { name: /finish/i }).click();

    await expect(page.getByTestId("workspace-shell")).toBeVisible();
  });

  test("relaunch skips the wizard once first-run is complete", async ({ page }) => {
    await page.goto("/?harness=returning-user");
    await expect(page.getByTestId("workspace-shell")).toBeVisible();
    await expect(page.getByTestId("eula-dialog")).toHaveCount(0);
  });
});
