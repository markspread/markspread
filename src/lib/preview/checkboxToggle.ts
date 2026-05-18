// S-MD-027: preview-side click toggle for task-list checkboxes.
//
// The preview unit (PR) renders task-list items as `<li><input
// type="checkbox" disabled> ...</li>`. We re-enable the checkbox in
// place and capture the click so the host can rewrite the source line
// in the editor instead of toggling the DOM (the rerender then drives
// the visual update).
//
// We need a way to map a clicked checkbox back to its source line.
// rehype/remark plugins typically emit a `data-task-line` attribute
// (1-based source line); we honour that, falling back to a per-render
// counter so even pipelines without the attribute work — clicked
// checkbox at index N => N-th task in source order.

import type { TaskToggleApply } from "@/lib/editor/commands/taskToggle";

export interface CheckboxToggleHost {
  /** Source markdown for the currently previewed doc. */
  getSource(): string;
  /** Apply a toggle at the given 0-based source line index. */
  toggleLine(apply: TaskToggleApply): void;
}

const STAMP = "data-ms-task";

const TASK_RE = /^(\s*[-*+]\s+\[)([ xX])(\])/;

export function attachCheckboxToggles(
  root: ParentNode,
  host: CheckboxToggleHost,
): void {
  const boxes = root.querySelectorAll<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  let counter = 0;
  boxes.forEach((box) => {
    if (box.getAttribute(STAMP) === "true") return;
    box.setAttribute(STAMP, "true");
    box.disabled = false;
    const lineAttr = box.getAttribute("data-task-line");
    const ordinal = counter++;
    box.addEventListener("click", (e) => {
      e.preventDefault();
      const src = host.getSource();
      const target = lineAttr
        ? Number(lineAttr) - 1
        : findTaskLineByOrdinal(src, ordinal);
      if (target < 0) return;
      const lines = src.split(/\r?\n/);
      const line = lines[target];
      if (line === undefined) return;
      const m = TASK_RE.exec(line);
      if (!m) return;
      const checked = m[2] !== " ";
      const newLine = line.replace(TASK_RE, `$1${checked ? " " : "x"}$3`);
      host.toggleLine({
        lineIndex: target,
        oldLength: line.length,
        nextLine: newLine,
      });
    });
  });
}

function findTaskLineByOrdinal(src: string, ordinal: number): number {
  const lines = src.split(/\r?\n/);
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    if (TASK_RE.test(lines[i] ?? "")) {
      if (seen === ordinal) return i;
      seen++;
    }
  }
  return -1;
}
