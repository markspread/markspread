// SC-WB-03 / S-PSDK-004: `.markspread/parsers/` hot-reload 실배선.
//
// hot-reload.ts 의 호스트 로직 (debounce + unregister/register) 은 순수하고
// 유닛테스트로 고정돼 있다 — 이 모듈은 그 호스트에 꽂는 *실어댑터* 둘과
// 부트스트랩 헬퍼를 제공한다:
//
//   1. createTauriParserWatcher  — Rust watcher 의 `fs:event` 채널 구독.
//      이벤트 소스는 워크스페이스 루트가 아니라 `<ws>/.markspread/parsers`
//      한 곳만 `fs_watch_start` 로 감시한다. WatcherRegistry 는 경로 문자열
//      키라 다른 소비자 (FileTree 등) 의 워크스페이스 감시와 충돌하지 않고,
//      `.markspread/index.db` WAL 노이즈도 애초에 이벤트로 오지 않는다.
//   2. createTauriParserSourceLoader — `manifest.json` + entry 를 fs_read_file
//      로 읽어 factory 까지 평가. evaluate 규칙은 워크벤치의 등록 경로
//      (register-from-source.ts) 와 동일 함수를 재사용한다.
//   3. startParserHotReload — App 셸이 워크스페이스 단위로 호출하는 조립.
//
// isDev 게이트: createParserHotReloader 의 `isDev` 는 호스트 로직 유닛테스트용
// 시임으로 유지하되, 실배선은 항상 true 를 넘긴다. SC-WB-03 의 "수정·저장 →
// 자동 re-register" 는 파서 작성자 (패키징된 앱을 쓰는 최종 사용자) 의 제품
// 동작이고, 프로덕션 차단을 정한 ADR 은 없다 (0012/0013/0016/0019 확인).

import { parseManifest } from "@markspread/parser-sdk";
import { invoke } from "@tauri-apps/api/core";
import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import { isEntryWithinPluginDir } from "../plugins/runtime/loader";
import {
  type Disposer,
  type ParserSourceLoader,
  type ParserWatcher,
  type WatchEvent,
  buildLoaderResult,
  createParserHotReloader,
} from "./hot-reload";
import { evaluateFactory } from "./register-from-source";
import { getParserRegistry } from "./registry";

const PARSERS_SEGMENT = "/.markspread/parsers/";

type FsEventPayload = {
  workspace: string;
  kind: "created" | "modified" | "removed" | "renamed";
  paths: string[];
};

export type ParserPathInfo = {
  parserId: string;
  /** 파서 디렉토리 내부 상대 경로. 디렉토리 자체를 가리키면 "". */
  rel: string;
};

/** `<ws>/.markspread/parsers` — fs_watch_start / payload 필터 키. */
export function parsersDirOf(workspace: string): string {
  return `${workspace}/.markspread/parsers`;
}

/**
 * 절대 경로에서 `.markspread/parsers/<id>/...` 를 파싱. 마커 substring 으로
 * 찾으므로 workspace 문자열과 이벤트 경로의 canonicalize 차이 (macOS 의
 * /tmp → /private/tmp 등) 에 영향받지 않는다.
 */
export function parserPathInfo(path: string): ParserPathInfo | null {
  const normalised = path.replace(/\\/g, "/");
  const idx = normalised.indexOf(PARSERS_SEGMENT);
  if (idx < 0) return null;
  const remainder = normalised.slice(idx + PARSERS_SEGMENT.length);
  const [parserId = "", ...rest] = remainder.split("/");
  if (!parserId) return null;
  return { parserId, rel: rest.join("/") };
}

function isParsersRoot(path: string): boolean {
  return path.replace(/\\/g, "/").endsWith("/.markspread/parsers");
}

/**
 * `fs:event` → WatchEvent 매핑 규칙 (순수 — 테스트가 직접 고정):
 *   created/modified               → change
 *   removed  (파서 디렉토리 자체)   → remove
 *   removed  (내부 파일)           → change (리로드 시도 → 실패 시 onError)
 *   removed  (parsers 루트)        → 알려진 모든 id remove
 *   renamed  [old, new]            → old 가 디렉토리 자체로 빠져나가면 remove,
 *                                    내부 파일이 다른 id 로 가면 old 는 change;
 *                                    new 가 파서 경로면 change.
 */
export function mapFsEvent(payload: FsEventPayload, knownIds: ReadonlySet<string>): WatchEvent[] {
  const out: WatchEvent[] = [];
  if (payload.kind === "renamed") {
    const [oldPath, newPath] = payload.paths;
    const oldInfo = oldPath ? parserPathInfo(oldPath) : null;
    const newInfo = newPath ? parserPathInfo(newPath) : null;
    if (oldInfo && oldInfo.parserId !== newInfo?.parserId) {
      out.push(
        oldInfo.rel === ""
          ? { kind: "remove", parserId: oldInfo.parserId }
          : { kind: "change", parserId: oldInfo.parserId },
      );
    }
    if (newInfo) {
      out.push({ kind: "change", parserId: newInfo.parserId });
    }
    if (!newInfo && oldPath && isParsersRoot(oldPath)) {
      for (const id of knownIds) out.push({ kind: "remove", parserId: id });
    }
    return out;
  }
  for (const path of payload.paths) {
    const info = parserPathInfo(path);
    if (!info) {
      if (payload.kind === "removed" && isParsersRoot(path)) {
        for (const id of knownIds) out.push({ kind: "remove", parserId: id });
      }
      continue;
    }
    if (payload.kind === "removed" && info.rel === "") {
      out.push({ kind: "remove", parserId: info.parserId });
    } else {
      out.push({ kind: "change", parserId: info.parserId });
    }
  }
  return out;
}

/**
 * Tauri 이벤트 기반 ParserWatcher. watch() 는 즉시 Unsubscribe 를 반환하고
 * 내부에서 비동기로 (1) `fs:event` 구독, (2) parsers 디렉토리 감시 시작을
 * 진행한다. Tauri 밖 (browser harness) 에서는 둘 다 조용히 실패 — no-op.
 */
export function createTauriParserWatcher(workspace: string): ParserWatcher {
  const parsersDir = parsersDirOf(workspace);
  return {
    watch: (handler) => {
      let disposed = false;
      let unlisten: UnlistenFn | null = null;
      // 이 감시 세션에서 change 를 흘려보낸 id 들 — parsers 루트 전체가
      // 삭제/이동될 때 개별 remove 로 환원하기 위한 최소 상태.
      const knownIds = new Set<string>();

      void listen<FsEventPayload>("fs:event", (e) => {
        if (disposed) return;
        // 멀티 워크스페이스: 다른 워크스페이스의 parsers 이벤트는 무시.
        // 자기 워크스페이스 루트 감시 (향후 배선) 를 통해 와도 수용한다.
        if (e.payload.workspace !== parsersDir && e.payload.workspace !== workspace) return;
        for (const ev of mapFsEvent(e.payload, knownIds)) {
          if (ev.kind === "change") knownIds.add(ev.parserId);
          else knownIds.delete(ev.parserId);
          handler(ev);
        }
      })
        .then((u) => {
          if (disposed) u();
          else unlisten = u;
        })
        .catch(() => {
          // Tauri 이벤트 채널 없음 (browser harness) — 감시 불가, no-op.
        });

      void (async () => {
        // 디렉토리가 없으면 fs_watch_start 의 canonicalize 가 실패하므로
        // 먼저 만들어 둔다 (create_dir_all — 이미 있으면 no-op). 읽기 전용
        // 워크스페이스 등으로 실패해도 감시 시작은 시도한다.
        try {
          await invoke("fs_create_dir", { workspace, path: ".markspread/parsers" });
        } catch {
          // best-effort — 아래 fs_watch_start 가 최종 판정.
        }
        try {
          await invoke("fs_watch_start", { workspace: parsersDir });
        } catch {
          // 감시 시작 실패 (디렉토리 없음 / Tauri 밖) — hot reload 만 비활성.
        }
      })();

      return () => {
        disposed = true;
        unlisten?.();
        unlisten = null;
        void invoke("fs_watch_stop", { workspace: parsersDir }).catch(() => {});
      };
    },
  };
}

type FsReadResult = { content: string };

/**
 * `.markspread/parsers/<id>/manifest.json` + entry 를 읽어 factory 로 평가.
 * 반환 규약은 hot-reload.ts 의 ParserSourceLoader 그대로 — 검증 실패는 null
 * (onError "loader returned null"), 읽기/평가 실패는 throw (onError 원문).
 */
export function createTauriParserSourceLoader(workspace: string): ParserSourceLoader {
  return {
    load: async (parserId) => {
      // 방어: load() 는 export 표면이므로 경로 조립 전에 traversal 차단.
      if (parserId.includes("/") || parserId.includes("\\") || parserId.includes("..")) {
        return null;
      }
      const base = `.markspread/parsers/${parserId}`;
      const manifestFile = await invoke<FsReadResult>("fs_read_file", {
        workspace,
        path: `${base}/manifest.json`,
      });
      const raw: unknown = JSON.parse(manifestFile.content);
      const parsed = parseManifest(raw);
      if (!parsed.ok) return null;
      // 디렉토리명과 manifest.id 가 다르면 remove(디렉토리명) 가 등록된
      // id 를 못 지우는 유령 등록이 생긴다 — 불일치는 검증 실패로 처리.
      if (parsed.manifest.id !== parserId) return null;
      if (!isEntryWithinPluginDir(parsed.manifest.entry)) return null;
      // "./index.js" 표기 정규화 — Rust 측 join 은 "." 세그먼트를 견디지만
      // 경로 문자열을 결정적으로 유지한다.
      const entryRel = parsed.manifest.entry.replace(/^\.\//, "");
      const entryFile = await invoke<FsReadResult>("fs_read_file", {
        workspace,
        path: `${base}/${entryRel}`,
      });
      const factory = evaluateFactory(entryFile.content);
      if (factory instanceof Error) throw factory;
      return buildLoaderResult(raw, factory);
    },
  };
}

/**
 * 워크스페이스 하나에 대한 hot-reload 조립 + 시작. App 셸이 워크스페이스
 * 변경 effect 에서 호출하고, 반환된 Disposer 로 정리한다.
 */
export function startParserHotReload(workspace: string): Disposer {
  const reloader = createParserHotReloader({
    registry: getParserRegistry(),
    watcher: createTauriParserWatcher(workspace),
    loader: createTauriParserSourceLoader(workspace),
    isDev: true,
    onReload: (parserId) => {
      console.info(`[parser-hot-reload] re-registered '${parserId}'`);
    },
    onRemove: (parserId) => {
      console.info(`[parser-hot-reload] unregistered '${parserId}'`);
    },
    onError: (parserId, error) => {
      console.warn(`[parser-hot-reload] reload failed for '${parserId}'`, error);
    },
  });
  return reloader.start();
}
