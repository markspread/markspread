// S-AI-038: structured-output schema validation coverage.

import { describe, expect, it } from "vitest";
import {
  type SchemaRunner,
  extractJsonBlob,
  jsonObjectValidator,
  runWithSchema,
} from "../schema-retry";

function runnerOf(responses: string[]): { runner: SchemaRunner; prompts: string[] } {
  const prompts: string[] = [];
  let i = 0;
  return {
    prompts,
    runner: {
      async run(prompt) {
        prompts.push(prompt);
        const r = responses[i] ?? "";
        i += 1;
        return r;
      },
    },
  };
}

describe("extractJsonBlob", () => {
  it("returns trimmed input when it starts with {", () => {
    expect(extractJsonBlob('  {"a":1}  ')).toBe('{"a":1}');
  });

  it("returns trimmed input when it starts with [", () => {
    expect(extractJsonBlob("[1,2]")).toBe("[1,2]");
  });

  it("extracts a fenced json block", () => {
    expect(extractJsonBlob('prose\n```json\n{"a":1}\n```\nmore')).toBe('{"a":1}');
  });

  it("extracts a fenced block without the json tag", () => {
    expect(extractJsonBlob('```\n{"b":2}\n```')).toBe('{"b":2}');
  });

  it("falls back to greedy brace match", () => {
    expect(extractJsonBlob('here is { "x": 1 } the end')).toBe('{ "x": 1 }');
  });

  it("returns null when no candidate exists", () => {
    expect(extractJsonBlob("no json at all")).toBeNull();
  });
});

describe("jsonObjectValidator", () => {
  it("accepts an object with all required keys", () => {
    const v = jsonObjectValidator<{ a: number }>(["a"]);
    const r = v.validate('{"a":1}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.a).toBe(1);
  });

  it("rejects when no JSON found", () => {
    const r = jsonObjectValidator(["a"]).validate("nothing");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("no JSON object");
  });

  it("rejects malformed JSON", () => {
    const r = jsonObjectValidator(["a"]).validate("{bad json}");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("parse error");
  });

  it("rejects a JSON array", () => {
    const r = jsonObjectValidator(["a"]).validate("[1,2]");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("expected a JSON object");
  });

  it("rejects a missing required key", () => {
    const r = jsonObjectValidator<{ a: number; b: number }>(["a", "b"]).validate('{"a":1}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("missing required key: b");
  });
});

describe("runWithSchema", () => {
  const validator = jsonObjectValidator<{ ok: boolean }>(["ok"]);

  it("returns ok on first valid response", async () => {
    const { runner } = runnerOf(['{"ok":true}']);
    const r = await runWithSchema(runner, validator, "task");
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.attempts).toBe(1);
  });

  it("retries once and succeeds on second response", async () => {
    const { runner, prompts } = runnerOf(["garbage", '{"ok":true}']);
    const r = await runWithSchema(runner, validator, "task");
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.attempts).toBe(2);
    expect(prompts[1]).toContain("did not parse");
    expect(prompts[1]).toContain("task");
  });

  it("returns raw fallback when retry also fails", async () => {
    const { runner } = runnerOf(["garbage1", "garbage2"]);
    const r = await runWithSchema(runner, validator, "task");
    expect(r.kind).toBe("raw");
    if (r.kind === "raw") {
      expect(r.raw).toBe("garbage2");
      expect(r.lastError).toBeTruthy();
    }
  });

  it("falls back to the first response when retry returns empty", async () => {
    const { runner } = runnerOf(["firstbad", ""]);
    const r = await runWithSchema(runner, validator, "task");
    expect(r.kind).toBe("raw");
    if (r.kind === "raw") expect(r.raw).toBe("firstbad");
  });
});
