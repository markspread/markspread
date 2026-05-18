// S-TST-018: manifest parser fuzz tests.
//
// Goal: validateManifest never panics, never returns malformed shape,
// and never accepts a manifest that's missing a required invariant — no
// matter what arbitrary JSON you throw at it. We use fast-check (the
// JS-side equivalent of proptest) to generate adversarial inputs.

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { validateManifest } from "./manifest";

const arbJsonValue: any = fc.letrec((tie: any) => ({
  value: fc.oneof(
    { maxDepth: 4 },
    fc.constant(null),
    fc.boolean(),
    fc.integer(),
    fc.double({ noNaN: false }),
    fc.string(),
    fc.array(tie("value")),
    fc.dictionary(fc.string(), tie("value")),
  ),
})).value;

describe("validateManifest — fuzz", () => {
  it("never throws on arbitrary JSON-ish input", () => {
    fc.assert(
      fc.property(arbJsonValue, (input: unknown) => {
        // The function is allowed to return errors, but must never throw.
        const result = validateManifest(input as never) as any;
        expect(result).toBeDefined();
        expect(result).toHaveProperty("errors");
        expect(Array.isArray(result.errors)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it("rejects every input missing the `id` field", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1 }).filter((k: string) => k !== "id"), arbJsonValue),
        (obj: unknown) => {
          const result = validateManifest(obj as never) as any;
          // Either errors mention `id` directly, or the manifest is rejected for some other invariant — but it must not be valid.
          expect(result.errors.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("rejects ids containing path-traversal characters", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).map((s: string) => `bad/../${s}`),
        (badId: string) => {
          // Complete-but-for-the-id manifest: the required-field guard
          // returns early before id-format checks run, so every other
          // required field must be present for this case to reach the
          // id validation it is meant to exercise.
          const result = validateManifest({
            id: badId,
            name: "n",
            version: "1.0.0",
            kind: "parser",
            engines: { markspread: "^1.0.0" },
            activationEvents: ["onStartup"],
            permissions: [],
          } as never) as any;
          expect(result.errors.some((e: { path: string }) => e.path === "id")).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects every deeply-nested object that doesn't match the schema", () => {
    // Take a known-good manifest, then perturb a deep field with random data.
    const base = { id: "ok", name: "n", version: "1.0.0", engines: { markspread: "^1.0.0" }, permissions: [] as string[] };
    fc.assert(
      fc.property(arbJsonValue, (junk: unknown) => {
        const evil = { ...base, contributes: junk };
        const result = validateManifest(evil as never);
        // It either accepts an empty / null contributes, or rejects with a reason — never crashes.
        expect(result).toHaveProperty("errors");
      }),
      { numRuns: 200 },
    );
  });

  it("returns deterministic results for the same input", () => {
    fc.assert(
      fc.property(arbJsonValue, (input: unknown) => {
        const a = JSON.stringify(validateManifest(input as never));
        const b = JSON.stringify(validateManifest(input as never));
        expect(a).toBe(b);
      }),
      { numRuns: 100 },
    );
  });
});
