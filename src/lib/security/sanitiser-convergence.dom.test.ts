// Convergence guard for the two HTML sanitisers in this repo.
//
// We deliberately ship two allowlists (see the cross-reference comment
// at the top of each sanitiser file): a strict one for plugin output
// and a lenient one for the full preview pipeline. They must NEVER
// diverge on the dangerous side — the strict set MUST stay a subset
// of the lenient set, and BOTH MUST drop the universally-dangerous
// constructs (script/style/iframe/object/embed, on* handlers,
// javascript: URLs). Adding a tag to one without the other, or
// loosening one of the dangerous-drop guarantees, is a security
// regression and this file should fail.

import { describe, expect, it } from "vitest";
import { ALLOWED_TAGS as PREVIEW_TAGS, sanitizeHtml } from "../preview/sanitize";
import { ALLOWED_TAGS as STRICT_TAGS, sanitiseMarkdownHtml } from "./markdown-sanitize";

describe("sanitiser convergence (security vs preview)", () => {
  it("strict ALLOWED_TAGS is a subset of preview ALLOWED_TAGS", () => {
    const missing: string[] = [];
    for (const tag of STRICT_TAGS) {
      if (!PREVIEW_TAGS.has(tag)) missing.push(tag);
    }
    expect(missing).toEqual([]);
  });

  // Universally-dangerous tags — neither sanitiser may keep them under
  // any code path. The strict sanitiser flattens unknown tags to text
  // for everything except the explicit drop-list; the lenient one
  // unwraps unknown tags so children survive. Both behaviours are
  // acceptable; the invariant is just "no <tagname> in the output".
  const dangerousTags = ["script", "style", "iframe", "object", "embed"] as const;
  for (const tag of dangerousTags) {
    it(`both sanitisers drop <${tag}> from input`, () => {
      const input = `<p>before</p><${tag}>payload</${tag}><p>after</p>`;
      const strict = sanitiseMarkdownHtml(input);
      const lenient = sanitizeHtml(input);
      expect(strict).not.toMatch(new RegExp(`<${tag}`, "i"));
      expect(lenient).not.toMatch(new RegExp(`<${tag}`, "i"));
    });
  }

  it("both sanitisers strip on* event handler attributes", () => {
    const input = '<a href="/x" onclick="evil()">go</a>';
    const strict = sanitiseMarkdownHtml(input);
    const lenient = sanitizeHtml(input);
    expect(strict).not.toMatch(/onclick/i);
    expect(lenient).not.toMatch(/onclick/i);
  });

  it("both sanitisers reject javascript: URLs on <a href>", () => {
    const input = '<a href="javascript:alert(1)">x</a>';
    const strict = sanitiseMarkdownHtml(input);
    const lenient = sanitizeHtml(input);
    expect(strict).not.toMatch(/javascript:/i);
    expect(lenient).not.toMatch(/javascript:/i);
  });
});
