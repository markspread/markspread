// MAR-1020: github-alerts sample manifest must satisfy the ADR-0012 schema.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseManifestText } from "../../../../src/lib/plugins/runtime/loader";

describe("github-alerts sample manifest", () => {
  it("parses against the ADR-0012 schema and lists three fences", () => {
    const raw = readFileSync(join(__dirname, "..", "markspread-plugin.json"), "utf8");
    const result = parseManifestText(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("github-alerts");
    const fenceNames = (result.value.contributes.fences ?? []).map((f) => f.name).sort();
    expect(fenceNames).toEqual(["note", "tip", "warning"]);
  });
});
