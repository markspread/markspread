// S-AI-038: structured-output schema validation with one retry + raw fallback.
//
// Several actions (review comments, outline, fact-check) ask the model for
// JSON shaped a specific way. Models occasionally drift — extra prose around
// the JSON, a missing required field, the wrong key casing. Rather than
// fail the whole action, we:
//
//   1. parse + validate the first response
//   2. if it fails, send a single corrective retry with the validation
//      error spelled out and ask the model to return JSON only
//   3. if the retry still fails, surface the *raw* text to the UI so the
//      user can salvage the content manually
//
// The retry is bounded to one attempt — beyond that we burn tokens for
// diminishing returns, and the raw fallback is always available.

export interface SchemaValidator<T> {
  /** Returns parsed value on success, or an error string describing the violation. */
  validate(raw: string): { ok: true; value: T } | { ok: false; error: string };
}

export interface SchemaRunner {
  /** Sends a prompt and returns the raw text response. */
  run(prompt: string, signal?: AbortSignal): Promise<string>;
}

export type SchemaResult<T> =
  | { kind: "ok"; value: T; attempts: 1 | 2 }
  | { kind: "raw"; raw: string; lastError: string };

export async function runWithSchema<T>(
  runner: SchemaRunner,
  validator: SchemaValidator<T>,
  prompt: string,
  signal?: AbortSignal,
): Promise<SchemaResult<T>> {
  const first = await runner.run(prompt, signal);
  const firstCheck = validator.validate(first);
  if (firstCheck.ok) return { kind: "ok", value: firstCheck.value, attempts: 1 };

  // The retry prompt is intentionally minimal — too much scaffolding
  // confuses the model further. We restate the original instruction, paste
  // the offending output, and demand JSON only.
  const retryPrompt = [
    "Your previous response did not parse as the required schema.",
    `Validation error: ${firstCheck.error}`,
    "",
    "Reply ONLY with valid JSON matching the schema. No prose, no code fence.",
    "",
    "Original task:",
    prompt,
    "",
    "Your previous (invalid) response:",
    first,
  ].join("\n");

  const second = await runner.run(retryPrompt, signal);
  const secondCheck = validator.validate(second);
  if (secondCheck.ok) return { kind: "ok", value: secondCheck.value, attempts: 2 };

  return { kind: "raw", raw: second || first, lastError: secondCheck.error };
}

// Extract a JSON blob from a noisy response. The model sometimes wraps
// JSON in ```json fences or sandwiches it between explanatory prose; this
// helper finds the largest balanced { ... } region. Returns null if no
// candidate can be located.
export function extractJsonBlob(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;

  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  if (fence) return (fence[1] as string).trim();

  // Fall back to greedy brace match. Find the first { and last } at the
  // same nesting level.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) return raw.slice(start, end + 1);
  return null;
}

// Convenience validator for "JSON object with required keys". Most action
// schemas can use this directly; richer validation (zod, etc.) plugs in
// via the SchemaValidator interface above.
export function jsonObjectValidator<T extends Record<string, unknown>>(
  requiredKeys: (keyof T)[],
): SchemaValidator<T> {
  return {
    validate(raw) {
      const blob = extractJsonBlob(raw);
      if (!blob) return { ok: false, error: "no JSON object found in response" };
      let parsed: unknown;
      try {
        parsed = JSON.parse(blob);
      } catch (e) {
        return { ok: false, error: `JSON parse error: ${(e as Error).message}` };
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, error: "expected a JSON object" };
      }
      const obj = parsed as Record<string, unknown>;
      for (const k of requiredKeys) {
        if (!(k in obj)) return { ok: false, error: `missing required key: ${String(k)}` };
      }
      return { ok: true, value: obj as T };
    },
  };
}
