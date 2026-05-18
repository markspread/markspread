import type { ReactElement } from "react";

// S-A11-012: GFM table renderer that emits the structure screen readers need.
// `<thead>` carries the header row with each cell as `<th scope="col">`, and
// the body rows live in a real `<tbody>`. We intentionally do not collapse
// the header into a single `<tr>` of `<td>`s when the source markdown has a
// header separator — even an empty header row is meaningful for table-mode
// navigation in NVDA / VoiceOver.

export interface ParsedTable {
  header: string[];
  alignments: ("left" | "center" | "right" | null)[];
  rows: string[][];
}

const ALIGN_LEFT = /^:?-+/;
const ALIGN_RIGHT = /-+:$/;
const ALIGN_BOTH = /^:-+:$/;

function splitRow(line: string): string[] {
  // GFM uses `|` as the cell delimiter; we drop empty leading / trailing
  // cells produced by surrounding pipes.
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

function parseAlignment(cell: string): "left" | "center" | "right" | null {
  if (ALIGN_BOTH.test(cell)) return "center";
  if (ALIGN_RIGHT.test(cell) && !ALIGN_LEFT.test(cell)) return "right";
  if (ALIGN_LEFT.test(cell)) return "left";
  return null;
}

export function parseGfmTable(block: string): ParsedTable | null {
  const lines = block.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;
  const header = splitRow(lines[0] ?? "");
  const sep = splitRow(lines[1] ?? "");
  if (sep.length !== header.length) return null;
  if (!sep.every((c) => /^:?-+:?$/.test(c))) return null;
  const alignments = sep.map(parseAlignment);
  const rows = lines.slice(2).map(splitRow);
  return { header, alignments, rows };
}

export function renderGfmTable(table: ParsedTable): ReactElement {
  return (
    <table className="markspread-table">
      <thead>
        <tr>
          {table.header.map((cell, i) => (
            <th
              key={i}
              scope="col"
              style={table.alignments[i] ? { textAlign: table.alignments[i]! } : undefined}
            >
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, r) => (
          <tr key={r}>
            {row.map((cell, c) => (
              <td
                key={c}
                style={table.alignments[c] ? { textAlign: table.alignments[c]! } : undefined}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
