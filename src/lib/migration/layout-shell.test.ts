// ADR-0010 Migration validation: v1 → v2, default decision telemetry.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { subscribeTelemetry, useTelemetry } from "../../store/telemetry";
import { LAYOUT_SCHEMA_VERSION, decideInitialShell, migrateLayoutShell } from "./layout-shell";

describe("migrateLayoutShell", () => {
  it("exposes the current schema version constant", () => {
    expect(LAYOUT_SCHEMA_VERSION).toBe(2);
  });

  it("turns v1 into v2 with shell='editor' and chat=null (legacy default)", () => {
    const v1 = { schemaVersion: 1, editor: { foo: 1 }, sidebar: { bar: 2 } };
    const out = migrateLayoutShell(v1);
    expect(out).toEqual({
      schemaVersion: 2,
      shell: "editor",
      editor: { foo: 1 },
      sidebar: { bar: 2 },
      chat: null,
    });
  });

  it("preserves an existing v2 blob and defaults missing fields", () => {
    const v2 = { schemaVersion: 2, shell: "chat", chat: { activeSessionId: "abc" } };
    const out = migrateLayoutShell(v2);
    expect(out?.shell).toBe("chat");
    expect(out?.chat).toEqual({ activeSessionId: "abc" });
  });

  it("defaults shell to editor when v2 has an unexpected shell value", () => {
    const out = migrateLayoutShell({ schemaVersion: 2, shell: "bogus" });
    expect(out?.shell).toBe("editor");
    expect(out?.chat).toBeNull();
  });

  it("returns null for non-objects", () => {
    expect(migrateLayoutShell(null)).toBeNull();
    expect(migrateLayoutShell("nope")).toBeNull();
    expect(migrateLayoutShell([])).toBeNull();
  });

  it("returns null for unknown schemaVersion", () => {
    expect(migrateLayoutShell({ schemaVersion: 99 })).toBeNull();
  });

  it("retains v2 fields verbatim when chat slot is malformed", () => {
    const out = migrateLayoutShell({ schemaVersion: 2, shell: "chat", chat: "broken" });
    expect(out?.chat).toBeNull();
  });
});

describe("decideInitialShell", () => {
  beforeEach(() => useTelemetry.setState({ consent: "enabled" }));
  afterEach(() => useTelemetry.setState({ consent: "unset" }));

  it("returns 'chat' only when both flag is on and credentials exist", () => {
    expect(decideInitialShell({ chatShellEnabled: true, hasCredentials: true })).toBe("chat");
    expect(decideInitialShell({ chatShellEnabled: true, hasCredentials: false })).toBe("editor");
    expect(decideInitialShell({ chatShellEnabled: false, hasCredentials: true })).toBe("editor");
    expect(decideInitialShell({ chatShellEnabled: false, hasCredentials: false })).toBe("editor");
  });

  it("emits migration.shell_default_applied with the choice + credential state", () => {
    const events: { type: string }[] = [];
    const off = subscribeTelemetry((e) => events.push(e));
    try {
      decideInitialShell({ chatShellEnabled: true, hasCredentials: false });
      const evt = events.find((e) => e.type === "migration.shell_default_applied");
      expect(evt).toMatchObject({
        type: "migration.shell_default_applied",
        chosen: "editor",
        hadCredentials: false,
      });
    } finally {
      off();
    }
  });
});
