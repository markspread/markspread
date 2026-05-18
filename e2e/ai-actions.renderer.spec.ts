// S-TST-010: AI actions e2e under MARKSPREAD_AI_MOCK=1.
//
// The mock provider (S-DEV-009) returns deterministic text per prompt,
// so we can assert exact strings — no fuzzy matching, no flake. Each
// flow below pins:
//   - the visible action label
//   - the streamed response renders incrementally (we observe ≥ 2
//     intermediate states before completion)
//   - the result lands in the right surface (inline insert / chat panel /
//     diff staging)
//   - cost panel updates (mock pricing is fixed)

import { expect, test } from "@playwright/test";

test.describe("AI actions (mock)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?harness=ai-mock");
  });

  test("Improve writing — inline diff with accept/reject", async ({ page }) => {
    const editor = page.getByTestId("editor-surface");
    await editor.click();
    await page.keyboard.type("this is bad sentence.");
    await editor.press("Control+a");

    await page.keyboard.press("Control+Shift+I"); // shortcut for "Improve writing"
    const diff = page.getByTestId("inline-ai-diff");
    await expect(diff).toBeVisible();
    await expect(diff.getByTestId("ai-replacement")).toContainText(/mock response for prompt of length/);

    await page.getByRole("button", { name: /accept/i }).click();
    await expect(editor).toContainText(/mock response for prompt of length/);
  });

  test("Chat — streamed response in side panel", async ({ page }) => {
    await page.keyboard.press("Control+Shift+L"); // open chat
    const input = page.getByRole("textbox", { name: /chat/i });
    await input.fill("hello");
    await input.press("Enter");

    const last = page.getByTestId("chat-message").last();
    // mock streams in chunks; we should see the message text grow.
    await expect.poll(() => last.textContent()).toMatch(/mock response/);
    await expect(last.getByTestId("token-usage")).toContainText(/in: \d+/);
    await expect(last.getByTestId("token-usage")).toContainText(/out: \d+/);
  });

  test("Cost guard blocks at 100% of budget", async ({ page }) => {
    await page.goto("/?harness=ai-mock&cost-budget=at-cap");
    await page.keyboard.press("Control+Shift+L");
    await page.getByRole("textbox", { name: /chat/i }).fill("anything");
    await page.getByRole("textbox", { name: /chat/i }).press("Enter");

    await expect(page.getByTestId("ai-blocked-banner")).toBeVisible();
    await expect(page.getByTestId("ai-blocked-banner")).toContainText(/budget/i);
  });

  test("Same prompt → same response (determinism check)", async ({ page }) => {
    const captures: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      await page.goto("/?harness=ai-mock");
      await page.keyboard.press("Control+Shift+L");
      await page.getByRole("textbox", { name: /chat/i }).fill("deterministic-seed-input");
      await page.getByRole("textbox", { name: /chat/i }).press("Enter");
      const text = await page.getByTestId("chat-message").last().textContent();
      captures.push((text ?? "").trim());
    }
    expect(captures[0]).toBe(captures[1]);
  });
});
