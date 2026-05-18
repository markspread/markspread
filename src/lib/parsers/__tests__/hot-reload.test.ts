// S-PSDK-004: hot reload 호스트 회귀.

import { ParserRegistry, type ParserManifest } from "@markspread/parser-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildLoaderResult,
  createParserHotReloader,
  type ParserSourceLoader,
  type ParserWatcher,
  type WatchEvent,
} from "../hot-reload";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function makeManifest(id: string, version = "0.1.0"): ParserManifest {
  return {
    id,
    version,
    displayName: id,
    fileMatch: { extensions: [".x"] },
    capabilities: "preview-only",
    entry: "./e.js",
  };
}

function makeWatcher(): {
  watcher: ParserWatcher;
  emit: (ev: WatchEvent) => void;
  unsubscribe: ReturnType<typeof vi.fn>;
} {
  let handler: ((ev: WatchEvent) => void) | null = null;
  const unsubscribe = vi.fn(() => {
    handler = null;
  });
  return {
    watcher: {
      watch: (h) => {
        handler = h;
        return unsubscribe;
      },
    },
    emit: (ev) => handler?.(ev),
    unsubscribe,
  };
}

describe("createParserHotReloader", () => {
  it("returns a no-op start in production mode", () => {
    const registry = new ParserRegistry();
    const watcher = makeWatcher();
    const loader: ParserSourceLoader = { load: vi.fn() };
    const r = createParserHotReloader({
      registry,
      watcher: watcher.watcher,
      loader,
      isDev: false,
    });
    const stop = r.start();
    watcher.emit({ kind: "change", parserId: "x" });
    expect(loader.load).not.toHaveBeenCalled();
    stop();
  });

  it("re-registers a parser when its source file changes (dev mode)", async () => {
    const registry = new ParserRegistry();
    registry.registerParser(makeManifest("csv"), () => ({ ast: 1 }));
    const watcher = makeWatcher();
    const newFactory = vi.fn(() => ({ ast: 2 }));
    const loader: ParserSourceLoader = {
      load: vi.fn(async () => ({
        manifest: makeManifest("csv", "0.2.0"),
        factory: newFactory,
      })),
    };
    const onReload = vi.fn();
    const r = createParserHotReloader({
      registry,
      watcher: watcher.watcher,
      loader,
      isDev: true,
      onReload,
    });
    r.start();

    watcher.emit({ kind: "change", parserId: "csv" });
    await vi.advanceTimersByTimeAsync(200);
    await Promise.resolve();
    await Promise.resolve();

    expect(loader.load).toHaveBeenCalledWith("csv");
    expect(onReload).toHaveBeenCalledWith("csv");
    const reloaded = registry.list().find((p) => p.manifest.id === "csv");
    expect(reloaded?.manifest.version).toBe("0.2.0");
  });

  it("debounces burst changes into a single reload", async () => {
    const registry = new ParserRegistry();
    registry.registerParser(makeManifest("csv"), () => ({ ast: 1 }));
    const watcher = makeWatcher();
    const loader: ParserSourceLoader = {
      load: vi.fn(async () => ({
        manifest: makeManifest("csv", "0.2.0"),
        factory: () => ({ ast: 2 }),
      })),
    };
    const r = createParserHotReloader({
      registry,
      watcher: watcher.watcher,
      loader,
      isDev: true,
      debounceMs: 100,
    });
    r.start();
    watcher.emit({ kind: "change", parserId: "csv" });
    watcher.emit({ kind: "change", parserId: "csv" });
    watcher.emit({ kind: "change", parserId: "csv" });
    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();
    expect(loader.load).toHaveBeenCalledTimes(1);
  });

  it("unregisters when watcher reports remove", async () => {
    const registry = new ParserRegistry();
    registry.registerParser(makeManifest("csv"), () => ({ ast: 1 }));
    const watcher = makeWatcher();
    const onRemove = vi.fn();
    const r = createParserHotReloader({
      registry,
      watcher: watcher.watcher,
      loader: { load: vi.fn() },
      isDev: true,
      debounceMs: 50,
      onRemove,
    });
    r.start();
    watcher.emit({ kind: "remove", parserId: "csv" });
    await vi.advanceTimersByTimeAsync(50);
    await Promise.resolve();
    expect(registry.list()).toHaveLength(0);
    expect(onRemove).toHaveBeenCalledWith("csv");
  });

  it("surfaces loader errors via onError", async () => {
    const registry = new ParserRegistry();
    const watcher = makeWatcher();
    const onError = vi.fn();
    const r = createParserHotReloader({
      registry,
      watcher: watcher.watcher,
      loader: {
        load: vi.fn(async () => {
          throw new Error("ENOENT");
        }),
      },
      isDev: true,
      debounceMs: 10,
      onError,
    });
    r.start();
    watcher.emit({ kind: "change", parserId: "csv" });
    await vi.advanceTimersByTimeAsync(10);
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[1]?.message).toBe("ENOENT");
  });

  it("disposer stops further reloads", async () => {
    const registry = new ParserRegistry();
    const watcher = makeWatcher();
    const loader: ParserSourceLoader = {
      load: vi.fn(async () => ({
        manifest: makeManifest("csv"),
        factory: () => ({ ast: 1 }),
      })),
    };
    const r = createParserHotReloader({
      registry,
      watcher: watcher.watcher,
      loader,
      isDev: true,
      debounceMs: 10,
    });
    const stop = r.start();
    stop();
    watcher.emit({ kind: "change", parserId: "csv" });
    await vi.advanceTimersByTimeAsync(50);
    expect(loader.load).not.toHaveBeenCalled();
    expect(watcher.unsubscribe).toHaveBeenCalled();
  });
});

describe("buildLoaderResult", () => {
  it("returns null when raw manifest is invalid", () => {
    const r = buildLoaderResult({ id: "Bad ID" }, () => ({ ast: null }));
    expect(r).toBeNull();
  });

  it("returns parsed manifest + factory when raw passes the schema", () => {
    const r = buildLoaderResult(makeManifest("ok"), () => ({ ast: null }));
    expect(r).not.toBeNull();
    expect(r?.manifest.id).toBe("ok");
  });
});
