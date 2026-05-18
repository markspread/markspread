// S-TST-014: automated accessibility checks (delegates to S-A11-001).
//
// We run @axe-core/playwright against every primary surface and assert
// zero violations at WCAG 2.1 AA. Issues that we have a tracked
// exception for are routed through `EXPECTED_EXCEPTIONS` so the build
// stays green while remediation is in flight — the list is reviewed in
// the nightly accessibility audit (see CI workflow `a11y-nightly.yml`,
// which expands the surface list and runs against multiple themes).

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const SURFACES: { name: string; url: string }[] = [
  { name: "first-run", url: "/?harness=fresh-install" },
  { name: "main-editor", url: "/?harness=workspace-with-content" },
  { name: "settings", url: "/?harness=workspace-with-content&route=/settings/general" },
  { name: "command-palette", url: "/?harness=workspace-with-content&overlay=palette" },
  { name: "ai-chat", url: "/?harness=ai-mock&overlay=chat" },
  { name: "marketplace", url: "/?harness=plugin-lifecycle&route=/marketplace" },
];

const EXPECTED_EXCEPTIONS: { surface: string; rule: string; ticket: string }[] = [
  // Empty initially. Add entries with a tracking ticket; CI reviews this list.
];

function isExpected(surface: string, rule: string): boolean {
  return EXPECTED_EXCEPTIONS.some((e) => e.surface === surface && e.rule === rule);
}

for (const { name, url } of SURFACES) {
  test(`a11y: ${name} has no WCAG 2.1 AA violations`, async ({ page }) => {
    await page.goto(url);
    await page.waitForSelector('[data-harness-ready="true"]');

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    const unexpected = results.violations.filter((v) => !isExpected(name, v.id));
    if (unexpected.length > 0) {
      const summary = unexpected
        .map(
          (v) =>
            `  - ${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.length} nodes\n    ${v.helpUrl}`,
        )
        .join("\n");
      throw new Error(`A11y violations on ${name}:\n${summary}`);
    }

    expect(unexpected).toEqual([]);
  });
}

test("keyboard-only flow: tab order reaches every interactive control on the editor", async ({
  page,
}) => {
  await page.goto("/?harness=workspace-with-content");
  await page.waitForSelector('[data-harness-ready="true"]');

  const reached = new Set<string>();
  for (let i = 0; i < 50; i += 1) {
    await page.keyboard.press("Tab");
    const id = await page.evaluate(
      () => document.activeElement?.getAttribute("data-a11y-id") ?? null,
    );
    if (id) reached.add(id);
  }

  // The editor surface tags every required focus stop with a unique data-a11y-id.
  const required = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("[data-a11y-required-focus]"));
    return els.map((el) => el.getAttribute("data-a11y-id") ?? "");
  });

  for (const id of required) {
    expect(reached.has(id), `tab order missed ${id}`).toBe(true);
  }
});
