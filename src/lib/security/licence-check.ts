// S-TST-016 / S-SE-030: SPDX allow-list + OR/AND clause evaluation.
//
// The list is intentionally conservative — anything not on it requires
// an explicit exception in `licence-exceptions.json` (reviewed during
// the legal sweep before each release).

export const SAFE_LICENCES = new Set<string>([
  "MIT",
  "MIT-0",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "Zlib",
  "CC0-1.0",
  "Unlicense",
  "BlueOak-1.0.0",
  "0BSD",
  "Apache-2.0 WITH LLVM-exception",
]);

const TOKEN = /\(|\)|AND|OR|WITH|[A-Za-z0-9.\-+]+/g;

interface Node {
  kind: "id" | "and" | "or";
  value?: string;
  left?: Node;
  right?: Node;
}

// Tiny recursive-descent parser for the SPDX expression grammar we
// actually see in the wild. Good enough for npm/cargo metadata; we
// don't need full SPDX 2.x.
function parse(expr: string): Node {
  const tokens = expr.match(TOKEN) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const eat = () => tokens[i++];

  function parseOr(): Node {
    let left = parseAnd();
    while (peek() === "OR") {
      eat();
      left = { kind: "or", left, right: parseAnd() };
    }
    return left;
  }
  function parseAnd(): Node {
    let left = parseAtom();
    while (peek() === "AND") {
      eat();
      left = { kind: "and", left, right: parseAtom() };
    }
    return left;
  }
  function parseAtom(): Node {
    const t = eat();
    if (t === "(") {
      const inner = parseOr();
      eat();
      return inner;
    }
    // SPDX `WITH` exceptions: re-attach the exception to the id so the
    // allow-list can list `Apache-2.0 WITH LLVM-exception` literally.
    if (peek() === "WITH") {
      eat();
      const exc = eat();
      return { kind: "id", value: `${t} WITH ${exc}` };
    }
    return { kind: "id", value: t ?? "" };
  }

  return parseOr();
}

function evaluate(node: Node): boolean {
  /* v8 ignore next -- parseAtom always sets value on id nodes; the ?? "" guard is type-narrowing only */
  if (node.kind === "id") return SAFE_LICENCES.has(node.value ?? "");
  if (node.kind === "or" || node.kind === "and") {
    const { left, right } = node;
    /* v8 ignore next -- parseOr/parseAnd always populate both children on and/or nodes */
    if (left === undefined || right === undefined) return false;
    return node.kind === "or"
      ? evaluate(left) || evaluate(right)
      : evaluate(left) && evaluate(right);
    /* v8 ignore start -- node.kind is the union "id" | "and" | "or" and all three branches are handled above */
  }
  return false;
}
/* v8 ignore stop */

export function isLicenceAllowed(expr: string): boolean {
  if (!expr) return false;
  try {
    return evaluate(parse(expr.trim()));
    /* v8 ignore start -- parse/evaluate never throw for any string input; the catch is belt-and-braces */
  } catch {
    return false;
  }
  /* v8 ignore stop */
}
