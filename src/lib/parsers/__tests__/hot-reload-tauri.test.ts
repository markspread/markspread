// SC-WB-03 / S-PSDK-004: `.markspread/parsers/` hot-reload 실어댑터 회귀.
//
// hot-reload.test.ts 가 호스트 로직 (debounce/재등록) 을 고정하고, 이 파일은
// Tauri 이벤트 → WatchEvent 매핑, 디스크 로더, 그리고 startParserHotReload
// 조립까지를 고정한다.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FsEventPayload = {
  workspace: string;
  kind: "created" | "modified" | "removed" | "renamed";
  paths: string[];
};
type FsEventHandler = (e: { payload: FsEventPayload }) => void;

const invokeMock = vi.fn();
const listenMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

import { __resetParserRegistryForTests, getParserRegistry } from "../registry";

import {
  createTauriParserSourceLoader,
  createTauriParserWatcher,
  mapFsEvent,
  parserPathInfo,
  parsersDirOf,
  startParserHotReload,
} from "../hot-reload-tauri";

const WS = "/ws";
const PDIR = parsersDirOf(WS); // "/ws/.markspread/parsers"

function manifestJson(id: string, version = "0.1.0", entry = "./index.js"): string {
  return JSON.stringify({
    id,
    version,
    displayName: id,
    fileMatch: { extensions: [".csv"] },
    capabilities: "preview-only",
    entry,
  });
}

const FACTORY_SRC = "export default (input) => ({ ast: { kind: 'csv', rows: [input.content] } })";

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockReset();
  __resetParserRegistryForTests();
});

afterEach(() => {
  vi.useRealTimers();
  __resetParserRegistryForTests();
});

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("parserPathInfo", () => {
  it("parses parser id + inner relative path from an absolute path", () => {
    expect(parserPathInfo("/ws/.markspread/parsers/csv/index.js")).toEqual({
      parserId: "csv",
      rel: "index.js",
    });
    expect(parserPathInfo("/ws/.markspread/parsers/csv/sub/util.js")).toEqual({
      parserId: "csv",
      rel: "sub/util.js",
    });
  });

  it("returns rel '' for the parser directory itself", () => {
    expect(parserPathInfo("/ws/.markspread/parsers/csv")).toEqual({ parserId: "csv", rel: "" });
  });

  it("normalises Windows backslashes", () => {
    expect(parserPathInfo("C:\\ws\\.markspread\\parsers\\csv\\index.js")).toEqual({
      parserId: "csv",
      rel: "index.js",
    });
  });

  it("returns null outside .markspread/parsers/ and for the bare parsers root", () => {
    expect(parserPathInfo("/ws/notes/a.md")).toBeNull();
    expect(parserPathInfo("/ws/.markspread/index.db")).toBeNull();
    expect(parserPathInfo("/ws/.markspread/parsers")).toBeNull();
    // trailing slash with no id segment
    expect(parserPathInfo("/ws/.markspread/parsers/")).toBeNull();
  });
});

describe("mapFsEvent", () => {
  const none = new Set<string>();

  it("maps created/modified inside a parser dir to change", () => {
    for (const kind of ["created", "modified"] as const) {
      expect(mapFsEvent({ workspace: PDIR, kind, paths: [`${PDIR}/csv/index.js`] }, none)).toEqual([
        { kind: "change", parserId: "csv" },
      ]);
    }
  });

  it("ignores paths outside the parsers tree", () => {
    expect(mapFsEvent({ workspace: WS, kind: "modified", paths: [`${WS}/a.md`] }, none)).toEqual(
      [],
    );
  });

  it("maps removal of the parser directory itself to remove", () => {
    expect(mapFsEvent({ workspace: PDIR, kind: "removed", paths: [`${PDIR}/csv`] }, none)).toEqual([
      { kind: "remove", parserId: "csv" },
    ]);
  });

  it("maps removal of an inner file to change (reload attempt → onError path)", () => {
    expect(
      mapFsEvent({ workspace: PDIR, kind: "removed", paths: [`${PDIR}/csv/index.js`] }, none),
    ).toEqual([{ kind: "change", parserId: "csv" }]);
  });

  it("expands removal of the parsers root into removes for every known id", () => {
    const known = new Set(["csv", "wiki"]);
    expect(mapFsEvent({ workspace: PDIR, kind: "removed", paths: [PDIR] }, known)).toEqual([
      { kind: "remove", parserId: "csv" },
      { kind: "remove", parserId: "wiki" },
    ]);
  });

  it("ignores removal of unrelated non-root paths", () => {
    expect(
      mapFsEvent({ workspace: WS, kind: "removed", paths: [`${WS}/a.md`] }, new Set(["csv"])),
    ).toEqual([]);
  });

  it("maps a rename within the same parser dir to a single change", () => {
    expect(
      mapFsEvent(
        {
          workspace: PDIR,
          kind: "renamed",
          paths: [`${PDIR}/csv/a.js`, `${PDIR}/csv/b.js`],
        },
        none,
      ),
    ).toEqual([{ kind: "change", parserId: "csv" }]);
  });

  it("maps a parser dir rename to remove(old) + change(new)", () => {
    expect(
      mapFsEvent({ workspace: PDIR, kind: "renamed", paths: [`${PDIR}/old`, `${PDIR}/new`] }, none),
    ).toEqual([
      { kind: "remove", parserId: "old" },
      { kind: "change", parserId: "new" },
    ]);
  });

  it("maps a parser dir moved out of the parsers tree to remove", () => {
    expect(
      mapFsEvent(
        { workspace: PDIR, kind: "renamed", paths: [`${PDIR}/csv`, `${WS}/csv-backup`] },
        none,
      ),
    ).toEqual([{ kind: "remove", parserId: "csv" }]);
  });

  it("maps an inner file moved to another parser dir to change(old) + change(new)", () => {
    expect(
      mapFsEvent(
        { workspace: PDIR, kind: "renamed", paths: [`${PDIR}/a/x.js`, `${PDIR}/b/x.js`] },
        none,
      ),
    ).toEqual([
      { kind: "change", parserId: "a" },
      { kind: "change", parserId: "b" },
    ]);
  });

  it("maps a file moved in from outside to change(new) only", () => {
    expect(
      mapFsEvent(
        { workspace: PDIR, kind: "renamed", paths: [`${WS}/draft.js`, `${PDIR}/csv/index.js`] },
        none,
      ),
    ).toEqual([{ kind: "change", parserId: "csv" }]);
  });

  it("expands a rename of the parsers root away into removes for known ids", () => {
    const known = new Set(["csv"]);
    expect(
      mapFsEvent({ workspace: PDIR, kind: "renamed", paths: [PDIR, `${WS}/parsers-old`] }, known),
    ).toEqual([{ kind: "remove", parserId: "csv" }]);
  });

  it("returns nothing for a renamed payload with no relevant paths", () => {
    expect(
      mapFsEvent({ workspace: WS, kind: "renamed", paths: [`${WS}/a.md`, `${WS}/b.md`] }, none),
    ).toEqual([]);
    expect(mapFsEvent({ workspace: WS, kind: "renamed", paths: [] }, none)).toEqual([]);
  });
});

describe("createTauriParserWatcher", () => {
  function setup(opts?: { listenReject?: boolean; watchStartReject?: boolean }) {
    let fsHandler: FsEventHandler | null = null;
    const unlisten = vi.fn();
    let resolveListen: (() => void) | null = null;
    listenMock.mockImplementation((event: string, handler: FsEventHandler) => {
      if (opts?.listenReject) return Promise.reject(new Error("no tauri"));
      fsHandler = handler;
      void event;
      return new Promise((resolve) => {
        resolveListen = () => resolve(unlisten);
      });
    });
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "fs_watch_start" && opts?.watchStartReject) throw new Error("missing dir");
      return undefined;
    });
    return {
      unlisten,
      emit: (payload: FsEventPayload) => fsHandler?.({ payload }),
      settleListen: async () => {
        resolveListen?.();
        await flush();
      },
    };
  }

  it("subscribes to fs:event, arms the parsers-dir watch, and forwards mapped events", async () => {
    const t = setup();
    const seen: unknown[] = [];
    const watcher = createTauriParserWatcher(WS);
    const stop = watcher.watch((ev) => seen.push(ev));
    await t.settleListen();

    expect(listenMock).toHaveBeenCalledWith("fs:event", expect.any(Function));
    expect(invokeMock).toHaveBeenCalledWith("fs_create_dir", {
      workspace: WS,
      path: ".markspread/parsers",
    });
    expect(invokeMock).toHaveBeenCalledWith("fs_watch_start", { workspace: PDIR });

    t.emit({ workspace: PDIR, kind: "modified", paths: [`${PDIR}/csv/index.js`] });
    expect(seen).toEqual([{ kind: "change", parserId: "csv" }]);
    stop();
  });

  it("accepts events attributed to the workspace root (future root-watch wiring)", async () => {
    const t = setup();
    const seen: unknown[] = [];
    createTauriParserWatcher(WS).watch((ev) => seen.push(ev));
    await t.settleListen();
    t.emit({ workspace: WS, kind: "modified", paths: [`${PDIR}/csv/index.js`] });
    expect(seen).toHaveLength(1);
  });

  it("ignores events from other workspaces", async () => {
    const t = setup();
    const seen: unknown[] = [];
    createTauriParserWatcher(WS).watch((ev) => seen.push(ev));
    await t.settleListen();
    t.emit({
      workspace: "/other",
      kind: "modified",
      paths: ["/other/.markspread/parsers/csv/index.js"],
    });
    expect(seen).toEqual([]);
  });

  it("tracks known ids so a parsers-root removal unregisters previously seen parsers", async () => {
    const t = setup();
    const seen: { kind: string; parserId: string }[] = [];
    createTauriParserWatcher(WS).watch((ev) => seen.push(ev));
    await t.settleListen();
    t.emit({ workspace: PDIR, kind: "modified", paths: [`${PDIR}/csv/index.js`] });
    t.emit({ workspace: PDIR, kind: "removed", paths: [PDIR] });
    expect(seen).toEqual([
      { kind: "change", parserId: "csv" },
      { kind: "remove", parserId: "csv" },
    ]);
    // the id was forgotten after the remove — a second root removal is a no-op.
    t.emit({ workspace: PDIR, kind: "removed", paths: [PDIR] });
    expect(seen).toHaveLength(2);
  });

  it("unsubscribes, stops the dir watch, and drops late events on dispose", async () => {
    const t = setup();
    const seen: unknown[] = [];
    const stop = createTauriParserWatcher(WS).watch((ev) => seen.push(ev));
    await t.settleListen();
    stop();
    expect(t.unlisten).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("fs_watch_stop", { workspace: PDIR });
    // an event queued before unlisten took effect is ignored by the disposed guard.
    t.emit({ workspace: PDIR, kind: "modified", paths: [`${PDIR}/csv/index.js`] });
    expect(seen).toEqual([]);
  });

  it("immediately unlistens when disposed before the listen promise settles", async () => {
    const t = setup();
    const stop = createTauriParserWatcher(WS).watch(() => {});
    stop(); // listen has not resolved yet
    await t.settleListen();
    expect(t.unlisten).toHaveBeenCalledTimes(1);
  });

  it("stays a no-op outside Tauri (listen rejects) without throwing", async () => {
    const t = setup({ listenReject: true });
    const stop = createTauriParserWatcher(WS).watch(() => {});
    await t.settleListen();
    stop();
  });

  it("swallows fs_create_dir / fs_watch_start / fs_watch_stop failures", async () => {
    const handlers: FsEventHandler[] = [];
    listenMock.mockImplementation((_e: string, handler: FsEventHandler) => {
      handlers.push(handler);
      return Promise.resolve(vi.fn());
    });
    invokeMock.mockRejectedValue(new Error("readonly workspace"));
    const seen: unknown[] = [];
    const stop = createTauriParserWatcher(WS).watch((ev) => seen.push(ev));
    await flush();
    // the fs:event subscription still works even when arming failed — events
    // from a future workspace-root watch keep hot reload alive.
    handlers[0]?.({ payload: { workspace: PDIR, kind: "modified", paths: [`${PDIR}/x/a.js`] } });
    expect(seen).toEqual([{ kind: "change", parserId: "x" }]);
    stop();
    await flush();
  });
});

describe("createTauriParserSourceLoader", () => {
  function mockReads(files: Record<string, string>) {
    invokeMock.mockImplementation(async (cmd: string, args: unknown) => {
      expect(cmd).toBe("fs_read_file");
      const { path } = args as { workspace: string; path: string };
      const content = files[path];
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return { content, encoding: "utf-8" };
    });
  }

  it("loads manifest + entry and evaluates the factory", async () => {
    mockReads({
      ".markspread/parsers/csv/manifest.json": manifestJson("csv"),
      ".markspread/parsers/csv/index.js": FACTORY_SRC,
    });
    const loaded = await createTauriParserSourceLoader(WS).load("csv");
    expect(loaded).not.toBeNull();
    expect(loaded?.manifest.id).toBe("csv");
    const out = loaded?.factory({ path: "/d.csv", content: "a,b", encoding: "utf-8" });
    expect(out).toEqual({ ast: { kind: "csv", rows: ["a,b"] } });
  });

  it("rejects traversal-shaped parser ids without touching the fs", async () => {
    const loader = createTauriParserSourceLoader(WS);
    expect(await loader.load("../escape")).toBeNull();
    expect(await loader.load("a/b")).toBeNull();
    expect(await loader.load("a\\b")).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("returns null for a schema-invalid manifest", async () => {
    mockReads({
      ".markspread/parsers/csv/manifest.json": JSON.stringify({ id: "Bad ID" }),
    });
    expect(await createTauriParserSourceLoader(WS).load("csv")).toBeNull();
  });

  it("returns null when manifest.id does not match the directory name", async () => {
    mockReads({
      ".markspread/parsers/csv/manifest.json": manifestJson("other-id"),
    });
    expect(await createTauriParserSourceLoader(WS).load("csv")).toBeNull();
  });

  it("returns null when the entry escapes the parser directory", async () => {
    mockReads({
      ".markspread/parsers/csv/manifest.json": manifestJson("csv", "0.1.0", "../../evil.js"),
    });
    expect(await createTauriParserSourceLoader(WS).load("csv")).toBeNull();
  });

  it("throws when the entry source is not a factory function", async () => {
    mockReads({
      ".markspread/parsers/csv/manifest.json": manifestJson("csv"),
      ".markspread/parsers/csv/index.js": "42",
    });
    await expect(createTauriParserSourceLoader(WS).load("csv")).rejects.toThrow(
      /factory must be a function/,
    );
  });

  it("propagates fs read failures and manifest JSON parse errors", async () => {
    mockReads({});
    await expect(createTauriParserSourceLoader(WS).load("csv")).rejects.toThrow(/ENOENT/);
    mockReads({ ".markspread/parsers/csv/manifest.json": "{not json" });
    await expect(createTauriParserSourceLoader(WS).load("csv")).rejects.toThrow();
  });
});

describe("startParserHotReload (조립: fs:event → 자동 re-register)", () => {
  function setupRuntime(files: Record<string, string>) {
    let fsHandler: FsEventHandler | null = null;
    listenMock.mockImplementation((_e: string, handler: FsEventHandler) => {
      fsHandler = handler;
      return Promise.resolve(vi.fn());
    });
    invokeMock.mockImplementation(async (cmd: string, args: unknown) => {
      if (cmd === "fs_read_file") {
        const { path } = args as { path: string };
        const content = files[path];
        if (content === undefined) throw new Error(`ENOENT: ${path}`);
        return { content, encoding: "utf-8" };
      }
      return undefined;
    });
    return {
      emit: (payload: FsEventPayload) => fsHandler?.({ payload }),
      files,
    };
  }

  it("SC-WB-03: a saved parser file re-registers the parser (registry wins for its extension)", async () => {
    vi.useFakeTimers();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const t = setupRuntime({
      ".markspread/parsers/csv/manifest.json": manifestJson("csv", "0.2.0"),
      ".markspread/parsers/csv/index.js": FACTORY_SRC,
    });
    const stop = startParserHotReload(WS);
    await flush();

    t.emit({ workspace: PDIR, kind: "modified", paths: [`${PDIR}/csv/index.js`] });
    await vi.advanceTimersByTimeAsync(200);
    await flush();

    const reg = getParserRegistry();
    const parser = reg.list().find((p) => p.manifest.id === "csv");
    expect(parser?.manifest.version).toBe("0.2.0");
    expect(reg.match({ path: "/data.csv" })?.parser.manifest.id).toBe("csv");
    expect(info).toHaveBeenCalledWith("[parser-hot-reload] re-registered 'csv'");

    // 두 번째 저장 → 새 버전으로 교체 (unregister + register 재실행).
    t.files[".markspread/parsers/csv/manifest.json"] = manifestJson("csv", "0.3.0");
    t.emit({ workspace: PDIR, kind: "modified", paths: [`${PDIR}/csv/index.js`] });
    await vi.advanceTimersByTimeAsync(200);
    await flush();
    expect(reg.list().find((p) => p.manifest.id === "csv")?.manifest.version).toBe("0.3.0");

    stop();
    info.mockRestore();
  });

  it("removes the registration when the parser directory is deleted", async () => {
    vi.useFakeTimers();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const t = setupRuntime({
      ".markspread/parsers/csv/manifest.json": manifestJson("csv"),
      ".markspread/parsers/csv/index.js": FACTORY_SRC,
    });
    const stop = startParserHotReload(WS);
    await flush();
    t.emit({ workspace: PDIR, kind: "created", paths: [`${PDIR}/csv/manifest.json`] });
    await vi.advanceTimersByTimeAsync(200);
    await flush();
    expect(
      getParserRegistry()
        .list()
        .some((p) => p.manifest.id === "csv"),
    ).toBe(true);

    t.emit({ workspace: PDIR, kind: "removed", paths: [`${PDIR}/csv`] });
    await vi.advanceTimersByTimeAsync(200);
    await flush();
    expect(
      getParserRegistry()
        .list()
        .some((p) => p.manifest.id === "csv"),
    ).toBe(false);
    expect(info).toHaveBeenCalledWith("[parser-hot-reload] unregistered 'csv'");
    stop();
    info.mockRestore();
  });

  it("reports reload failures via console.warn without crashing the loop", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = setupRuntime({}); // no files on disk → fs_read_file rejects
    const stop = startParserHotReload(WS);
    await flush();
    t.emit({ workspace: PDIR, kind: "modified", paths: [`${PDIR}/ghost/index.js`] });
    await vi.advanceTimersByTimeAsync(200);
    await flush();
    expect(warn).toHaveBeenCalledWith(
      "[parser-hot-reload] reload failed for 'ghost'",
      expect.any(Error),
    );
    stop();
    warn.mockRestore();
  });
});
