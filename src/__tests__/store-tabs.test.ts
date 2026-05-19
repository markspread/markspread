// Unit tests for the editor tabs store: open/close, preview promotion,
// pin/unpin, reorder, rename, and orphan tracking.

import { beforeEach, describe, expect, it } from "vitest";
import { type OpenTab, useTabs } from "../store/tabs";

const POS = { line: 1, column: 1, scrollTop: 0 };

function tab(path: string, over: Partial<OpenTab> = {}): OpenTab {
  return { path, position: POS, ...over };
}

beforeEach(() => {
  useTabs.setState({ tabs: [], activePath: null });
});

describe("tabs store - open", () => {
  it("opens a new pinned (non-preview) tab by default", () => {
    useTabs.getState().open("/a.md");
    const t = useTabs.getState().tabs[0];
    expect(t?.path).toBe("/a.md");
    expect(t?.preview).toBe(false);
    expect(useTabs.getState().activePath).toBe("/a.md");
  });

  it("opens a preview tab and replaces the prior preview slot", () => {
    useTabs.getState().open("/a.md", { preview: true });
    useTabs.getState().open("/b.md", { preview: true });
    const paths = useTabs.getState().tabs.map((t) => t.path);
    expect(paths).toEqual(["/b.md"]);
  });

  it("a preview open keeps existing non-preview tabs", () => {
    useTabs.getState().open("/keep.md");
    useTabs.getState().open("/preview.md", { preview: true });
    expect(useTabs.getState().tabs.map((t) => t.path)).toEqual(["/keep.md", "/preview.md"]);
  });

  it("re-opening an existing tab just activates it", () => {
    useTabs.getState().open("/a.md");
    useTabs.getState().open("/b.md");
    useTabs.getState().open("/a.md");
    expect(useTabs.getState().tabs).toHaveLength(2);
    expect(useTabs.getState().activePath).toBe("/a.md");
  });

  it("re-opening a preview tab non-preview promotes it to pinned", () => {
    useTabs.getState().open("/a.md", { preview: true });
    useTabs.getState().open("/a.md");
    expect(useTabs.getState().tabs[0]?.preview).toBe(false);
  });

  it("re-opening a preview tab as preview keeps it preview", () => {
    useTabs.getState().open("/a.md", { preview: true });
    useTabs.getState().open("/a.md", { preview: true });
    expect(useTabs.getState().tabs[0]?.preview).toBe(true);
  });

  it("re-opening an orphaned tab clears the orphan flag", () => {
    useTabs.setState({ tabs: [tab("/a.md", { orphaned: true })], activePath: null });
    useTabs.getState().open("/a.md");
    expect(useTabs.getState().tabs[0]?.orphaned).toBe(false);
    expect(useTabs.getState().activePath).toBe("/a.md");
  });
});

describe("tabs store - close", () => {
  it("removes a tab and keeps the active path when another tab was active", () => {
    useTabs.getState().open("/a.md");
    useTabs.getState().open("/b.md");
    useTabs.getState().setActive("/b.md");
    useTabs.getState().close("/a.md");
    expect(useTabs.getState().tabs.map((t) => t.path)).toEqual(["/b.md"]);
    expect(useTabs.getState().activePath).toBe("/b.md");
  });

  it("activates the last remaining tab when the active one closes", () => {
    useTabs.getState().open("/a.md");
    useTabs.getState().open("/b.md");
    useTabs.getState().setActive("/b.md");
    useTabs.getState().close("/b.md");
    expect(useTabs.getState().activePath).toBe("/a.md");
  });

  it("clears the active path when the last tab closes", () => {
    useTabs.getState().open("/a.md");
    useTabs.getState().close("/a.md");
    expect(useTabs.getState().tabs).toEqual([]);
    expect(useTabs.getState().activePath).toBeNull();
  });
});

describe("tabs store - setActive / setPosition / setDirty", () => {
  it("setActive updates the active path", () => {
    useTabs.getState().open("/a.md");
    useTabs.getState().setActive("/x.md");
    expect(useTabs.getState().activePath).toBe("/x.md");
  });

  it("setPosition updates the matching tab only", () => {
    useTabs.getState().open("/a.md");
    useTabs.getState().open("/b.md");
    const next = { line: 9, column: 3, scrollTop: 100 };
    useTabs.getState().setPosition("/a.md", next);
    expect(useTabs.getState().tabs[0]?.position).toEqual(next);
    expect(useTabs.getState().tabs[1]?.position).toEqual(POS);
  });

  it("setDirty flags the matching tab", () => {
    useTabs.getState().open("/a.md");
    useTabs.getState().setDirty("/a.md", true);
    expect(useTabs.getState().tabs[0]?.dirty).toBe(true);
  });
});

describe("tabs store - pin / unpin", () => {
  it("pin sets pinned and clears preview", () => {
    useTabs.getState().open("/a.md", { preview: true });
    useTabs.getState().pin("/a.md");
    const t = useTabs.getState().tabs[0];
    expect(t?.pinned).toBe(true);
    expect(t?.preview).toBe(false);
  });

  it("unpin clears pinned without touching preview", () => {
    useTabs.getState().open("/a.md", { preview: true });
    useTabs.getState().pin("/a.md");
    useTabs.getState().unpin("/a.md");
    expect(useTabs.getState().tabs[0]?.pinned).toBe(false);
  });
});

describe("tabs store - reorder", () => {
  it("moves a tab after the target when before=false", () => {
    useTabs.setState({
      tabs: [tab("/a.md"), tab("/b.md"), tab("/c.md")],
      activePath: "/a.md",
    });
    useTabs.getState().reorder("/a.md", "/c.md", false);
    expect(useTabs.getState().tabs.map((t) => t.path)).toEqual(["/b.md", "/c.md", "/a.md"]);
  });

  it("moves a tab before the target when before=true", () => {
    useTabs.setState({
      tabs: [tab("/a.md"), tab("/b.md"), tab("/c.md")],
      activePath: "/a.md",
    });
    useTabs.getState().reorder("/c.md", "/a.md", true);
    expect(useTabs.getState().tabs.map((t) => t.path)).toEqual(["/c.md", "/a.md", "/b.md"]);
  });

  it("is a no-op when source or target is unknown", () => {
    useTabs.setState({ tabs: [tab("/a.md")], activePath: "/a.md" });
    useTabs.getState().reorder("/a.md", "/missing.md", false);
    expect(useTabs.getState().tabs.map((t) => t.path)).toEqual(["/a.md"]);
  });

  it("is a no-op when source equals target", () => {
    useTabs.setState({ tabs: [tab("/a.md"), tab("/b.md")], activePath: "/a.md" });
    useTabs.getState().reorder("/a.md", "/a.md", false);
    expect(useTabs.getState().tabs.map((t) => t.path)).toEqual(["/a.md", "/b.md"]);
  });

  it("flips the pinned flag when dragged across the pinned boundary", () => {
    useTabs.setState({
      tabs: [tab("/p.md", { pinned: true }), tab("/u.md")],
      activePath: "/p.md",
    });
    useTabs.getState().reorder("/u.md", "/p.md", true);
    const moved = useTabs.getState().tabs.find((t) => t.path === "/u.md");
    expect(moved?.pinned).toBe(true);
  });
});

describe("tabs store - rename", () => {
  it("renames an exact path match", () => {
    useTabs.setState({ tabs: [tab("/a.md")], activePath: "/a.md" });
    useTabs.getState().rename("/a.md", "/renamed.md");
    expect(useTabs.getState().tabs[0]?.path).toBe("/renamed.md");
    expect(useTabs.getState().activePath).toBe("/renamed.md");
  });

  it("renames descendants on a folder rename (forward slash)", () => {
    useTabs.setState({
      tabs: [tab("/dir/a.md"), tab("/dir/sub/b.md"), tab("/other.md")],
      activePath: "/dir/a.md",
    });
    useTabs.getState().rename("/dir", "/newdir");
    expect(useTabs.getState().tabs.map((t) => t.path)).toEqual([
      "/newdir/a.md",
      "/newdir/sub/b.md",
      "/other.md",
    ]);
  });

  it("renames descendants on a folder rename (backslash)", () => {
    useTabs.setState({ tabs: [tab("C:\\dir\\a.md")], activePath: "C:\\dir\\a.md" });
    useTabs.getState().rename("C:\\dir", "C:\\new");
    expect(useTabs.getState().tabs[0]?.path).toBe("C:\\new\\a.md");
  });

  it("clears orphan flag on renamed tabs", () => {
    useTabs.setState({
      tabs: [tab("/a.md", { orphaned: true })],
      activePath: "/a.md",
    });
    useTabs.getState().rename("/a.md", "/b.md");
    expect(useTabs.getState().tabs[0]?.orphaned).toBe(false);
  });

  it("leaves an unrelated tab object untouched", () => {
    const unrelated = tab("/other.md");
    useTabs.setState({ tabs: [unrelated], activePath: null });
    useTabs.getState().rename("/a.md", "/b.md");
    expect(useTabs.getState().tabs[0]).toBe(unrelated);
    expect(useTabs.getState().activePath).toBeNull();
  });
});

describe("tabs store - orphan tracking", () => {
  it("setOrphaned marks an exact path", () => {
    useTabs.setState({ tabs: [tab("/a.md")], activePath: "/a.md" });
    useTabs.getState().setOrphaned("/a.md", true);
    expect(useTabs.getState().tabs[0]?.orphaned).toBe(true);
  });

  it("setOrphaned marks descendants under a folder", () => {
    useTabs.setState({
      tabs: [tab("/dir/a.md"), tab("/dir\\b.md"), tab("/other.md")],
      activePath: null,
    });
    useTabs.getState().setOrphaned("/dir", true);
    expect(useTabs.getState().tabs[0]?.orphaned).toBe(true);
    expect(useTabs.getState().tabs[1]?.orphaned).toBe(true);
    expect(useTabs.getState().tabs[2]?.orphaned).toBeUndefined();
  });

  it("setOrphaned can clear the flag", () => {
    useTabs.setState({ tabs: [tab("/a.md", { orphaned: true })], activePath: null });
    useTabs.getState().setOrphaned("/a.md", false);
    expect(useTabs.getState().tabs[0]?.orphaned).toBe(false);
  });
});

describe("tabs store - replaceAll", () => {
  it("replaces the whole tab list and active path", () => {
    useTabs.getState().open("/old.md");
    useTabs.getState().replaceAll([tab("/new.md")], "/new.md");
    expect(useTabs.getState().tabs.map((t) => t.path)).toEqual(["/new.md"]);
    expect(useTabs.getState().activePath).toBe("/new.md");
  });
});
