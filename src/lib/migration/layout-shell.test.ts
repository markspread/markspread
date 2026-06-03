// Migration validation: v1 → v2 schema normalisation. ADR-0019 dropped
// the `shell` / `chat` keys, so the migration now only bumps the version
// and strips any dead shell discriminator from legacy v2 blobs.

import { describe, expect, it } from "vitest";
import { LAYOUT_SCHEMA_VERSION, migrateLayoutShell } from "./layout-shell";

describe("migrateLayoutShell", () => {
  it("exposes the current schema version constant", () => {
    expect(LAYOUT_SCHEMA_VERSION).toBe(2);
  });

  it("turns v1 into v2, preserving editor/sidebar blobs", () => {
    const v1 = { schemaVersion: 1, editor: { foo: 1 }, sidebar: { bar: 2 } };
    const out = migrateLayoutShell(v1);
    expect(out).toEqual({
      schemaVersion: 2,
      editor: { foo: 1 },
      sidebar: { bar: 2 },
    });
  });

  it("strips a legacy v2 `shell` / `chat` discriminator", () => {
    const v2 = {
      schemaVersion: 2,
      shell: "chat",
      chat: { activeSessionId: "abc" },
      editor: { foo: 1 },
    };
    const out = migrateLayoutShell(v2);
    expect(out).toEqual({ schemaVersion: 2, editor: { foo: 1 } });
    expect(out).not.toHaveProperty("shell");
    expect(out).not.toHaveProperty("chat");
  });

  it("returns null for non-objects", () => {
    expect(migrateLayoutShell(null)).toBeNull();
    expect(migrateLayoutShell("nope")).toBeNull();
    expect(migrateLayoutShell([])).toBeNull();
  });

  it("returns null for unknown schemaVersion", () => {
    expect(migrateLayoutShell({ schemaVersion: 99 })).toBeNull();
  });
});
