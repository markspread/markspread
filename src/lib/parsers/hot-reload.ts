// S-PSDK-004: 파서 작성자 DX — dev 모드에서 `.markspread/parsers/` 감시,
// 변경 감지 시 ParserRegistry 의 해당 파서를 자동 unregister + re-register.
//
// 프로덕션 빌드에서는 `isDev=false` 가 들어와 `start()` 가 no-op disposer
// 만 반환한다. 실제 fs watch 어댑터는 Tauri 측에서 주입되며, 단위 테스트는
// fake watcher 를 통해 호스트 로직만 검증한다.

import type { ParserFactory } from "@markspread/parser-sdk";
import { type ParserManifest, parseManifest } from "@markspread/parser-sdk";
import type { ParserRegistry } from "@markspread/parser-sdk";

export type WatchEvent =
  | { kind: "change"; parserId: string }
  | { kind: "remove"; parserId: string };

export type Unsubscribe = () => void;

export type ParserWatcher = {
  /**
   * 디렉토리 감시 시작. 콜백은 `.markspread/parsers/<id>/...` 변경 시 호출.
   * 반환된 함수로 감시 중단.
   */
  watch: (handler: (ev: WatchEvent) => void) => Unsubscribe;
};

export type ParserSourceLoader = {
  /**
   * `.markspread/parsers/<id>/manifest.json` + entry 를 읽어 factory 까지 만들어
   * 반환. 검증 실패 시 null.
   */
  load: (parserId: string) => Promise<{ manifest: ParserManifest; factory: ParserFactory } | null>;
};

export type HotReloaderOptions = {
  registry: ParserRegistry;
  watcher: ParserWatcher;
  loader: ParserSourceLoader;
  isDev: boolean;
  /** 변경 burst 합치는 ms (기본 200). */
  debounceMs?: number;
  /** 재등록 직후 호출 — 프리뷰가 다시 그릴 수 있도록 알림. */
  onReload?: (parserId: string) => void;
  /** 등록 해제 직후 호출. */
  onRemove?: (parserId: string) => void;
  /** 로딩/검증 실패 보고. */
  onError?: (parserId: string, error: Error) => void;
};

export type Disposer = () => void;

const NOOP: Disposer = () => {};

export function createParserHotReloader(opts: HotReloaderOptions): {
  start: () => Disposer;
} {
  if (!opts.isDev) {
    return { start: () => NOOP };
  }
  return {
    start: () => startDev(opts),
  };
}

function startDev(opts: HotReloaderOptions): Disposer {
  const debounceMs = opts.debounceMs ?? 200;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let stopped = false;

  const handle = (ev: WatchEvent) => {
    if (stopped) return;
    const existing = timers.get(ev.parserId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      timers.delete(ev.parserId);
      void apply(ev, opts);
    }, debounceMs);
    timers.set(ev.parserId, timer);
  };

  const unsubscribe = opts.watcher.watch(handle);

  return () => {
    stopped = true;
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    unsubscribe();
  };
}

async function apply(ev: WatchEvent, opts: HotReloaderOptions): Promise<void> {
  if (ev.kind === "remove") {
    if (opts.registry.unregisterParser(ev.parserId)) {
      opts.onRemove?.(ev.parserId);
    }
    return;
  }
  try {
    const loaded = await opts.loader.load(ev.parserId);
    if (!loaded) {
      opts.onError?.(ev.parserId, new Error("loader returned null"));
      return;
    }
    // 안전한 재등록: 기존 매니페스트가 있다면 먼저 제거 — id 중복 throw 회피.
    opts.registry.unregisterParser(loaded.manifest.id);
    opts.registry.registerParser(loaded.manifest, loaded.factory);
    opts.onReload?.(loaded.manifest.id);
  } catch (err) {
    opts.onError?.(ev.parserId, err instanceof Error ? err : new Error(String(err)));
  }
}

/**
 * raw manifest JSON 을 검증해 factory 와 함께 묶어주는 헬퍼. loader 구현체가
 * fs 에서 읽은 JSON 을 그대로 검증할 때 사용한다.
 */
export function buildLoaderResult(
  rawManifest: unknown,
  factory: ParserFactory,
): { manifest: ParserManifest; factory: ParserFactory } | null {
  const parsed = parseManifest(rawManifest);
  if (!parsed.ok) return null;
  return { manifest: parsed.manifest, factory };
}
