// MAR-1015: register-time conflict detection.

import { describe, expect, it, vi } from "vitest";
import { type ConflictEntry, assertNoConflict, findConflicts } from "./conflict-check";

const e = (commandId: string, binding: string, scope?: string): ConflictEntry =>
  scope !== undefined ? { commandId, binding, scope } : { commandId, binding };

describe("assertNoConflict — strict mode throws", () => {
  it("rejects two commands claiming the same chord in the same scope", () => {
    const existing = [e("a.cmd", "Mod+T", "always")];
    expect(() =>
      assertNoConflict(e("b.cmd", "Mod+T", "always"), existing, { strict: true }),
    ).toThrow(/Mod\+T/);
  });

  it("treats implicit scope (undefined) as 'always' for collision purposes", () => {
    const existing = [e("a.cmd", "Mod+T")];
    expect(() => assertNoConflict(e("b.cmd", "Mod+T"), existing, { strict: true })).toThrow();
  });

  it("normalises chord modifiers before comparing", () => {
    // Shift+Mod+P should collide with Mod+Shift+P.
    const existing = [e("a.cmd", "Mod+Shift+P")];
    expect(() => assertNoConflict(e("b.cmd", "Shift+Mod+P"), existing, { strict: true })).toThrow();
  });

  it("returns the normalised candidate when no conflict exists", () => {
    const out = assertNoConflict(e("x.cmd", "Shift+Mod+P"), [], { strict: true });
    expect(out.binding).toBe("Mod+Shift+P");
  });

  it("preserves scope on the returned entry", () => {
    const out = assertNoConflict(e("x.cmd", "Mod+T", "editorFocus"), [], { strict: true });
    expect(out.scope).toBe("editorFocus");
  });

  it("allows the same chord in DIFFERENT scopes (Mod+B for sidebar vs bold)", () => {
    const existing = [e("view.toggle_sidebar", "Mod+B", "always")];
    expect(() =>
      assertNoConflict(e("md.bold", "Mod+B", "editorFocus"), existing, { strict: true }),
    ).not.toThrow();
  });

  it("permits idempotent re-register of the same (command, chord, scope) tuple", () => {
    const existing = [e("a.cmd", "Mod+T", "always")];
    expect(() =>
      assertNoConflict(e("a.cmd", "Mod+T", "always"), existing, { strict: true }),
    ).not.toThrow();
  });

  it("skips past existing entries whose binding does not match", () => {
    // First two entries don't share the chord; only the third does.
    const existing = [e("a.cmd", "Mod+1"), e("b.cmd", "Mod+2"), e("dup.cmd", "Mod+T")];
    expect(() => assertNoConflict(e("new.cmd", "Mod+T"), existing, { strict: true })).toThrow();
  });

  it("auto-detects strict mode via import.meta.env (vitest sets MODE=test)", () => {
    // No `strict` override — relies on `isDev()` reading import.meta.env.
    // Vitest sets `import.meta.env.MODE` to a non-production value, so the
    // call should throw on a real collision.
    const existing = [e("a.cmd", "Mod+T")];
    expect(() => assertNoConflict(e("b.cmd", "Mod+T"), existing)).toThrow();
  });
});

describe("assertNoConflict — lax mode warns", () => {
  it("emits a warning instead of throwing", () => {
    const warn = vi.fn();
    const existing = [e("a.cmd", "Mod+T")];
    const out = assertNoConflict(e("b.cmd", "Mod+T"), existing, { strict: false, warn });
    expect(warn).toHaveBeenCalledOnce();
    expect(out.commandId).toBe("b.cmd");
  });

  it("falls back to console.warn when no sink is provided", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      assertNoConflict(e("b.cmd", "Mod+T"), [e("a.cmd", "Mod+T")], { strict: false });
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("findConflicts — bulk report", () => {
  it("returns empty conflicts on a clean list", () => {
    const { conflicts } = findConflicts([
      e("a", "Mod+1"),
      e("b", "Mod+2"),
      e("c", "Mod+B", "editorFocus"),
    ]);
    expect(conflicts).toEqual([]);
  });

  it("flags every dup pair", () => {
    const { conflicts } = findConflicts([e("a", "Mod+T"), e("b", "Mod+T"), e("c", "Mod+T")]);
    // (a,b), (a,c), (b,c) — 3 pairs over 3 entries.
    expect(conflicts).toHaveLength(3);
  });

  it("does not flag dup pairs across different scopes", () => {
    const { conflicts } = findConflicts([
      e("a", "Mod+B", "always"),
      e("b", "Mod+B", "editorFocus"),
    ]);
    expect(conflicts).toEqual([]);
  });

  it("does not flag idempotent self-pairs (same command id)", () => {
    const { conflicts } = findConflicts([e("dup.cmd", "Mod+T"), e("dup.cmd", "Mod+T")]);
    expect(conflicts).toEqual([]);
  });
});
