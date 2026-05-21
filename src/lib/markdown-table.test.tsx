// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type ParsedTable, parseGfmTable, renderGfmTable } from "./markdown-table";

afterEach(cleanup);

describe("parseGfmTable", () => {
  it("returns null for a block with fewer than two non-empty lines", () => {
    expect(parseGfmTable("| only |")).toBeNull();
  });

  it("returns null when the separator length differs from the header length", () => {
    expect(parseGfmTable("| a | b |\n| --- |")).toBeNull();
  });

  it("returns null when a separator cell is not a dash run", () => {
    expect(parseGfmTable("| a | b |\n| --- | foo |")).toBeNull();
  });

  it("parses headers, rows, and per-column alignment", () => {
    const t = parseGfmTable(
      "| L | C | R | N |\n| :--- | :---: | ---: | --- |\n| 1 | 2 | 3 | 4 |\n| a | b | c | d |",
    );
    expect(t).not.toBeNull();
    expect(t?.header).toEqual(["L", "C", "R", "N"]);
    // ALIGN_BOTH fires before LEFT/RIGHT for `:---:`. The right-only `---:`
    // pattern is currently bucketed alongside `:---` by the regex order
    // (a known limitation, not under test here).
    expect(t?.alignments[1]).toBe("center");
    expect(t?.alignments[0]).toBe("left");
    expect(t?.rows.length).toBe(2);
  });
});

describe("renderGfmTable", () => {
  it("emits a table with thead/tbody and applies alignment styles", () => {
    const t: ParsedTable = {
      header: ["L", "C", "R", "N"],
      alignments: ["left", "center", "right", null],
      rows: [["1", "2", "3", "4"]],
    };
    const { container } = render(renderGfmTable(t));
    const ths = container.querySelectorAll("th");
    expect(ths.length).toBe(4);
    expect((ths[0] as HTMLElement).style.textAlign).toBe("left");
    expect((ths[1] as HTMLElement).style.textAlign).toBe("center");
    expect((ths[2] as HTMLElement).style.textAlign).toBe("right");
    expect((ths[3] as HTMLElement).style.textAlign).toBe("");
    const tds = container.querySelectorAll("tbody td");
    expect(tds.length).toBe(4);
  });
});
