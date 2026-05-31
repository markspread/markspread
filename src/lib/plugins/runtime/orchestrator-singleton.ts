// 글로벌 PluginOrchestrator 싱글턴 — boot.ts + SettingsPlugins + 다이얼로그가 공유.
//
// PluginHost 인스턴스는 *production* 에선 실제 WorkerFactory 가 필요하지만
// 본 boot 흐름은 *registry 검증 + trust + consent* 만 다룸. Worker spawn 은
// 호출 시점에 caller 가 결정. fake factory 로 안전한 default 제공.

import { PluginHost } from "./host";
import { PluginOrchestrator } from "./orchestrator";
import type { Message, WorkerLike } from "./sandbox-rpc";
import { createFakeWorkerPair } from "./sandbox-rpc";

let cached: PluginOrchestrator | null = null;

/**
 * 안전한 default factory — 실제 worker 가 필요한 시점에 caller 가 host.factory 를 교체.
 * 본 default 는 *spawn 즉시 plugin:err* 응답해서 invoke 흐름이 정상 폐기되도록.
 */
function defaultWorkerFactory(): WorkerLike {
  const { hostSide, pluginSide } = createFakeWorkerPair();
  pluginSide.addEventListener("message", (ev) => {
    const m = ev.data as Message;
    if (m.type === "host:init") {
      pluginSide.postMessage({
        type: "plugin:err",
        message: "default factory: worker not yet wired — call configureOrchestrator()",
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
