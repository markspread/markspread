// MAR-1011: Tiny inline unified-diff renderer used by ToolDiffDialog.
//
// We deliberately avoid an extra dependency (the `diff` npm package is
// not in the lockfile despite what the spec hint suggested). The two
// public functions cover all of what the dialog needs:
//   - `buildLineDiff(before, after)` returns a flat list of typed lines
//     using the canonical longest-common-subsequence walk.
//   - `formatUnifiedDiff(filePath, before, after)` produces a unified
//     diff string suitable for persistence + display.

export type DiffLineKind = "context" | "add" | "remove";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

/**
 * Pure LCS-driven line diff. Equal-length inputs short-circuit when
 * fully equal so the common "no change" case is O(n).
 */
export function buildLineDiff(before: string, after: string): DiffLine[] {
  if (before === after) {
    if (before.length === 0) return [];
    return before.split("\n").map<DiffLine>((t) => ({ kind: "context", text: t }));
  }
  const a = before.split("\n");
  const b = after.split("\n");
  const m = a.length;
  const n = b.length;
  // LCS table — flat array so TS knows entries exist.
  const stride = n + 1;
  const dp = new Int32Array((m + 1) * stride);
  // Int32Array element access type-narrows to `number | undefined`
  // because of `noUncheckedIndexedAccess`; the runtime never returns
  // undefined for in-range indices, hence the v8 ignore.
  const get = (i: number, j: number): number =>
    /* v8 ignore next */
    dp[i * stride + j] ?? 0;
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i * stride + j] = get(i + 1, j + 1) + 1;
      } else {
        const down = get(i + 1, j);
        const right = get(i, j + 1);
        dp[i * stride + j] = down > right ? down : right;
      }
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    /* v8 ignore next 2 -- in-range index never undefined at runtime */
    const av = a[i] ?? "";
    const bv = b[j] ?? "";
    if (av === bv) {
      out.push({ kind: "context", text: av });
      i++;
      j++;
    } else if (get(i + 1, j) >= get(i, j + 1)) {
      out.push({ kind: "remove", text: av });
      i++;
    } else {
      out.push({ kind: "add", text: bv });
      j++;
    }
  }
  while (i < m) {
    /* v8 ignore next -- in-range index */
    out.push({ kind: "remove", text: a[i] ?? "" });
    i++;
  }
  while (j < n) {
    /* v8 ignore next -- in-range index */
    out.push({ kind: "add", text: b[j] ?? "" });
    j++;
  }
  return out;
}

export function formatUnifiedDiff(filePath: string, before: string, after: string): string {
  const lines = buildLineDiff(before, after);
  const head = `--- a/${filePath}\n+++ b/${filePath}\n`;
  const body = lines
    .map((l) => {
      if (l.kind === "add") return `+${l.text}`;
      if (l.kind === "remove") return `-${l.text}`;
      return ` ${l.text}`;
    })
    .join("\n");
  return head + body;
}
