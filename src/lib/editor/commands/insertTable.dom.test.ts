import "../extensions/jsdomLayoutShim";
// S-MD-034: tests for the Insert Table command.

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type InsertTableRequest,
  type InsertTableResult,
  buildTableMarkdown,
  insertTable,
  setInsertTableOpener,
} from "./insertTable";

describe("buildTableMarkdown", () => {
  it("builds a 2-column, 1-row table with default alignment", () => {
    const md = buildTableMarkdown({ rows: 1, cols: 2, align: [] });
    const lines = md.split("\n");
    expect(lines[0]).toBe("|  |  |");
    expect(lines[1]).toBe("| --- | --- |");
    expect(lines[2]).toBe("|  |  |");
  });

  it("renders each alignment token", () => {
    const md = buildTableMarkdown({
      rows: 0,
      cols: 4,
      align: ["left", "right", "center", "default"],
    });
    const sep = md.split("\n")[1];
    expect(sep).toBe("| :--- | ---: | :---: | --- |");
  });

  it("pads align array shorter than cols with default", () => {
    const md = buildTableMarkdown({ rows: 0, cols: 3, align: ["center"] });
    expect(md.split("\n")[1]).toBe("| :---: | --- | --- |");
  });

  it("truncates align array longer than cols", () => {
    const md = buildTableMarkdown({
      rows: 0,
      cols: 1,
      align: ["left", "right", "center"],
    });
    expect(md.split("\n")[1]).toBe("| :--- |");
  });

  it("omits body when rows is 0", () => {
    const md = buildTableMarkdown({ rows: 0, cols: 1, align: [] });
    expect(md.split("\n")).toHaveLength(2);
  });
});

describe("insertTable command", () => {
  let resolved: ((r: InsertTableResult | null) => void) | null = null;

  beforeEach(() => {
    resolved = null;
    setInsertTableOpener((req: InsertTableRequest) => {
      resolved = req.resolve;
    });
  });

  afterEach(() => {
    setInsertTableOpener(() => {});
  });

  function mount(doc: string, head: number): EditorView {
    return new EditorView({
      state: EditorState.create({ doc, selection: { anchor: head } }),
    });
  }

  it("returns true synchronously and opens the dialog", () => {
    const view = mount("hello", 5);
    expect(insertTable(view)).toBe(true);
    expect(resolved).not.toBeNull();
    view.destroy();
  });

  it("inserts a newline-prefixed table when not on a blank line", async () => {
    const view = mount("hello", 5);
    insertTable(view);
    resolved?.({ rows: 1, cols: 1, align: [] });
    await Promise.resolve();
    expect(view.state.doc.toString()).toBe("hello\n|  |\n| --- |\n|  |\n");
    view.destroy();
  });

  it("does not prefix a newline on an empty line at line start", async () => {
    const view = mount("", 0);
    insertTable(view);
    resolved?.({ rows: 0, cols: 1, align: [] });
    await Promise.resolve();
    expect(view.state.doc.toString()).toBe("|  |\n| --- |\n");
    view.destroy();
  });

  it("does nothing when the dialog resolves null", async () => {
    const view = mount("abc", 3);
    insertTable(view);
    resolved?.(null);
    await Promise.resolve();
    expect(view.state.doc.toString()).toBe("abc");
    view.destroy();
  });
});
