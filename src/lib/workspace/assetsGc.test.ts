// S-MD-011: workspace asset garbage-collection coverage.

import { describe, expect, it, vi } from "vitest";
import { type WorkspaceAssetsGcAdapter, cleanUnusedAssets, findUnusedAssets } from "./assetsGc";

function makeAdapter(opts: {
  docs: Record<string, string>;
  assets: string[];
}): WorkspaceAssetsGcAdapter & { trashed: string[] } {
  const trashed: string[] = [];
  return {
    trashed,
    listMarkdownFiles: async () => Object.keys(opts.docs),
    readMarkdown: async (rel: string) => opts.docs[rel] ?? "",
    listAssets: async () => opts.assets,
    trashAssets: async (paths: string[]) => {
      trashed.push(...paths);
    },
  };
}

describe("findUnusedAssets", () => {
  it("detects an inline image reference", async () => {
    const adapter = makeAdapter({
      docs: { "note.md": "see ![alt](assets/used.png)" },
      assets: ["assets/used.png", "assets/orphan.png"],
    });
    expect(await findUnusedAssets(adapter)).toEqual(["assets/orphan.png"]);
  });

  it("detects a plain link reference and a title-suffixed link", async () => {
    const adapter = makeAdapter({
      docs: { "note.md": '[doc](assets/a.pdf) [t](assets/b.pdf "title")' },
      assets: ["assets/a.pdf", "assets/b.pdf", "assets/c.pdf"],
    });
    expect(await findUnusedAssets(adapter)).toEqual(["assets/c.pdf"]);
  });

  it("detects reference-style definitions", async () => {
    const adapter = makeAdapter({
      docs: { "note.md": "[id]: assets/ref.png\n" },
      assets: ["assets/ref.png", "assets/lost.png"],
    });
    expect(await findUnusedAssets(adapter)).toEqual(["assets/lost.png"]);
  });

  it("ignores external scheme URLs", async () => {
    const adapter = makeAdapter({
      docs: { "note.md": "![x](https://example.com/img.png)" },
      assets: ["assets/local.png"],
    });
    expect(await findUnusedAssets(adapter)).toEqual(["assets/local.png"]);
  });

  it("strips query strings and fragments", async () => {
    const adapter = makeAdapter({
      docs: { "note.md": "![x](assets/q.png?v=2#frag)" },
      assets: ["assets/q.png"],
    });
    expect(await findUnusedAssets(adapter)).toEqual([]);
  });

  it("normalises absolute paths against the workspace root", async () => {
    const adapter = makeAdapter({
      docs: { "sub/note.md": "![x](/assets/abs.png)" },
      assets: ["assets/abs.png"],
    });
    expect(await findUnusedAssets(adapter)).toEqual([]);
  });

  it("resolves relative paths against the doc directory, including ..", async () => {
    const adapter = makeAdapter({
      docs: { "sub/note.md": "![x](../assets/up.png) ![y](./here.png)" },
      assets: ["assets/up.png", "sub/here.png"],
    });
    expect(await findUnusedAssets(adapter)).toEqual([]);
  });

  it("returns all assets when no docs reference anything", async () => {
    const adapter = makeAdapter({
      docs: { "note.md": "no links here" },
      assets: ["assets/x.png", "assets/y.png"],
    });
    expect(await findUnusedAssets(adapter)).toEqual(["assets/x.png", "assets/y.png"]);
  });
});

describe("cleanUnusedAssets", () => {
  it("returns an empty result when nothing is unused", async () => {
    const adapter = makeAdapter({
      docs: { "note.md": "![x](assets/used.png)" },
      assets: ["assets/used.png"],
    });
    const confirm = vi.fn();
    const result = await cleanUnusedAssets(adapter, confirm);
    expect(result.trashed).toEqual([]);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("does not trash when the user declines confirmation", async () => {
    const adapter = makeAdapter({ docs: { "note.md": "" }, assets: ["assets/orphan.png"] });
    const result = await cleanUnusedAssets(adapter, async () => false);
    expect(result.trashed).toEqual([]);
    expect(adapter.trashed).toEqual([]);
  });

  it("trashes the unused assets when confirmed", async () => {
    const adapter = makeAdapter({ docs: { "note.md": "" }, assets: ["assets/orphan.png"] });
    const confirm = vi.fn(async () => true);
    const result = await cleanUnusedAssets(adapter, confirm);
    expect(confirm).toHaveBeenCalledWith(["assets/orphan.png"]);
    expect(result.trashed).toEqual(["assets/orphan.png"]);
    expect(adapter.trashed).toEqual(["assets/orphan.png"]);
  });
});
