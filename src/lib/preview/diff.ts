// S-PR-017: Diff tab — compute a side-by-side diff between two
// markdown snapshots and emit decorated HTML.
//
// We use a minimal LCS-based line diff (good enough for prose; the
// review unit will plug in a more sophisticated implementation
// later). Output shape:
//
//   { left: DiffRow[], right: DiffRow[] }
//
// Each row carries `kind: "same" | "add" | "del" | "pad"`. The
// consumer renders rows as <pre> lines paired by index — pads
// preserve alignment when one side has more lines than the other.

export type DiffKind = "same" | "add" | "del" | "pad";

export interface DiffRow {
  kind: DiffKind;
  text: string;
  /** 1-based line number in the original side, or null for pads. */
  line: number | null;
}

export interface DiffResult {
  left: DiffRow[];
  right: DiffRow[];
  stats: { adds: number; dels: number };
}

export function diffMarkdown(a: string, b: string): DiffResult {
  const left = a.split(/\r?\n/);
  const right = b.split(/\r?\n/);
  const ops = lcsDiff(left, right);
  const out: DiffResult = { left: [], right: [], stats: { adds: 0, dels: 0 } };
  let li = 0;
  let ri = 0;
  for (const op of ops) {
    if (op === "same") {
      out.left.push({ kind: "same", text: left[li] ?? "", line: li + 1 });
      out.right.push({ kind: "same", text: right[ri] ?? "", line: ri + 1 });
      li++;
      ri++;
    } else if (op === "del") {
      out.left.push({ kind: "del", text: left[li] ?? "", line: li + 1 });
      out.right.push({ kind: "pad", text: "", line: null });
      out.stats.dels++;
      li++;
    } else {
      out.left.push({ kind: "pad", text: "", line: null });
      out.right.push({ kind: "add", text: right[ri] ?? "", line: ri + 1 });
      out.stats.adds++;
      ri++;
    }
  }
  return out;
}

type Op = "same" | "del" | "add";

function lcsDiff(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  // Full DP table. For prose docs (a few hundred lines) this is
  // fine; the review unit will swap in Myers when we hit large diffs.
  const dp: number[][] = Array(n + 1)
    .fill(0)
    .map(() => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const row = dp[i]!;
      const rowNext = dp[i + 1]!;
      if (a[i] === b[j]) row[j] = rowNext[j + 1]! + 1;
      else row[j] = Math.max(rowNext[j]!, row[j + 1]!);
    }
  }
  const out: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push("same");
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push("del");
      i++;
    } else {
      out.push("add");
      j++;
    }
  }
  while (i < n) {
    out.push("del");
    i++;
  }
  while (j < m) {
    out.push("add");
    j++;
  }
  return out;
}
