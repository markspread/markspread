// Unit tests for the error code system + IPC bridge.

import { describe, expect, it } from "vitest";
import {
  ERROR_TABLE,
  describe as describeCode,
  describePosixIpcError,
  fromIpcError,
  makeError,
} from "./codes";

describe("describe", () => {
  it("returns the descriptor for a known code", () => {
    expect(describeCode("E1001")).toBe(ERROR_TABLE.E1001);
  });

  it("falls back to E9999 for unknown codes", () => {
    expect(describeCode("E0000").code).toBe("E9999");
  });
});

describe("makeError", () => {
  it("uses the Error message when given an Error", () => {
    const err = makeError("E1001", new Error("boom"));
    expect(err.code).toBe("E1001");
    expect(err.category).toBe("error");
    expect(err.message).toBe("boom");
  });

  it("coerces a non-Error cause to a string", () => {
    expect(makeError("E1001", "raw cause").message).toBe("raw cause");
  });

  it("falls back to the code when the message is empty", () => {
    expect(makeError("E1001", new Error("")).message).toBe("E1001");
  });

  it("includes context when provided and omits it otherwise", () => {
    const withCtx = makeError("E1001", "x", { path: "/a", count: 2 });
    expect(withCtx.context).toEqual({ path: "/a", count: 2 });
    expect(makeError("E1001", "x").context).toBeUndefined();
  });
});

describe("fromIpcError", () => {
  it("returns E9999 for null or non-object input", () => {
    expect(fromIpcError(null).code).toBe("E9999");
    expect(fromIpcError("string").code).toBe("E9999");
  });

  it("normalises a known IPC error with context", () => {
    const err = fromIpcError({
      code: "E1002",
      message: "denied",
      context: { path: "/x" },
    });
    expect(err.code).toBe("E1002");
    expect(err.message).toBe("denied");
    expect(err.context).toEqual({ path: "/x" });
  });

  it("defaults message to empty string when missing", () => {
    expect(fromIpcError({ code: "E1002" }).message).toBe("");
  });

  it("omits context when it is not an object", () => {
    expect(fromIpcError({ code: "E1002", context: "nope" }).context).toBeUndefined();
  });

  it("falls back to E9999 for an unrecognised code", () => {
    expect(fromIpcError({ code: "EXXXX" }).code).toBe("E9999");
  });
});

describe("describePosixIpcError", () => {
  const cases: Array<[string, string]> = [
    ["EISDIR", "errors.posix.isdir"],
    ["ENOENT", "errors.posix.enoent"],
    ["EACCES", "errors.posix.eacces"],
    ["ENOSPC", "errors.posix.enospc"],
    ["EOUTSIDE_WORKSPACE", "errors.posix.outside_workspace"],
    ["ENOTUTF8", "errors.posix.enotutf8"],
    ["EINVAL", "errors.posix.einval"],
  ];

  for (const [code, key] of cases) {
    it(`maps ${code} to ${key}`, () => {
      const res = describePosixIpcError({ code });
      expect(res.i18nKey).toBe(key);
      expect(res.fallback.length).toBeGreaterThan(0);
    });
  }

  it("falls back to the generic IO message for unknown codes", () => {
    expect(describePosixIpcError({ code: "WHAT" }).i18nKey).toBe("errors.posix.eio");
  });

  it("falls back when input is not an object", () => {
    expect(describePosixIpcError(null).i18nKey).toBe("errors.posix.eio");
    expect(describePosixIpcError("str").i18nKey).toBe("errors.posix.eio");
  });
});
