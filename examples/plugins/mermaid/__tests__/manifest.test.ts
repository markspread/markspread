// MAR-1020: ensure the bundled mermaid sample's manifest stays valid.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseManifestText } from "../../../../src/lib/plugins/runtime/loader";

describe("mermaid sample manifest", () => {
  it("parses against the ADR-0012 schema", () => {
    const raw = readFileSync(join(__dirname, "..", "markspread-plugin.json"), "utf8");
    const result = parseManifestText(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("mermaid");
    expect(result.value.contributes.codeblocks?.mermaid?.render).toBe("html");
    expect(result.value.permissions).toEqual([]);
  });
});
