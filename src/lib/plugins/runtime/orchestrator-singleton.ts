// 글로벌 PluginOrchestrator 싱글턴 — boot.ts + SettingsPlugins + 다이얼로그 +
// register-from-source(trust/consent) + preview/render.ts(sandbox 게이트)가 공유.
//
// PluginHost 의 WorkerFactory 는 *plugin hook*(codeblock/fence) 실행용이며
// 아직 프로덕션 배선이 없다 — default 는 spawn 즉시 plugin:err 로 응답하는
// fail-closed fake. 런타임 *파서* 의 Worker 격리는 이 host 가 아니라
// src/lib/parsers/runtime-transport.ts 가 담당한다 (ADR-0012 D1).

import { PluginHost } from "./host";
import { PluginOrchestrator } from "./orchestrator";
import type { Message, WorkerLike } from "./sandbox-rpc";
import { createFakeWorkerPair } from "./sandbox-rpc";

let cached: PluginOrchestrator | null = null;

/**
 * 안전한 default factory — plugin hook worker 배선 전까지 fail-closed.
 * 본 default 는 *spawn 즉시 plugin:err* 응답해서 invoke 흐름이 정상 폐기되도록.
 */
function defaultWorkerFactory(): WorkerLike {
  const { hostSide, pluginSide } = createFakeWorkerPair();
  pluginSide.addEventListener("message", (ev) => {
    const m = ev.data as Message;
    if (m.type === "host:init") {
      pluginSide.postMessage({
        type: "plugin:err",
        message: "default factory: plugin hook worker is not wired in this build",
      });
    }
  });
  return hostSide;
}

/**
 * lazy singleton. 첫 호출 시 PluginHost + Orchestrator 생성.
 */
export function getOrchestrator(): PluginOrchestrator {
  if (!cached) {
    const host = new PluginHost({
      workerFactory: defaultWorkerFactory,
      handshakeTimeoutMs: 100,
    });
    cached = new PluginOrchestrator(host);
  }
  return cached;
}

/** 테스트용 reset — 테스트 격리 보장. */
export function resetOrchestrator(): void {
  cached = null;
}
