// S-TST-009: workspace creation + authoring round-trip.
//
// Covers the path a new user actually walks the first time:
//   - create a fresh workspace at a chosen location
//   - create a folder, then a markdown file inside it
//   - type content, observe the spread/preview update
//   - rename a file, watch references in other files update
//   - delete a file, confirm trash recovery works

import { expect, test } from "@playwright/test";

test("create workspace, author a file, observe preview", async ({ page }) => {
  await page.goto("/?harness=empty-home");

  await page.getByRole("button", { name: /create new workspace/i }).click();
  await page.getByLabel(/workspace name/i).fill("design-notes");
  await page.getByRole("button", { name: /^create$/i }).click();

  // Tree gets focus; create a folder via the palette.
  await page.keyboard.press("Control+Shift+P");
  await page.getByRole("textbox", { name: /command/i }).fill("New folder");
  await page.getByRole("option", { name: /new folder/i }).click();
  await page.getByLabel(/folder name/i).fill("articles");
  await page.keyboard.press("Enter");

  // New file in that folder.
  await page.getByRole("treeitem", { name: "articles" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /new file/i }).click();
  await page.getByLabel(/file name/i).fill("intro.md");
  await page.keyboard.press("Enter");

  const editor = page.getByTestId("editor-surface");
  await editor.click();
  await page.keyboard.type("# Intro\n\nMarkspread treats markdown like source.\n");

  await expect(page.getByTestId("spread-pane")).toContainText("Intro");
  await expect(page.getByTestId("spread-pane")).toContainText(
    "Markspread treats markdown like source.",
  );
});

test("rename file updates wiki-links in referencing files", async ({ page }) => {
  await page.goto("/?harness=workspace-with-links");

  await expect(page.getByTestId("editor-surface")).toContainText("[[old-title]]");

  await page.getByRole("treeitem", { name: "old-title.md" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /rename/i }).click();
  await page.getByLabel(/new name/i).fill("new-title.md");
  await page.getByRole("checkbox", { name: /update references/i }).check();
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("editor-surface")).toContainText("[[new-title]]");
  await expect(page.getByTestId("editor-surface")).not.toContainText("[[old-title]]");
});

test("delete file lands in app trash with one-click restore", async ({ page }) => {
  await page.goto("/?harness=workspace-with-links");

  await page.getByRole("treeitem", { name: "scratch.md" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /delete/i }).click();
  await page.getByRole("button", { name: /move to trash/i }).click();

  await expect(page.getByRole("treeitem", { name: "scratch.md" })).toHaveCount(0);

  await page.getByRole("button", { name: /undo/i }).click();
  await expect(page.getByRole("treeitem", { name: "scratch.md" })).toBeVisible();
});
