// S-PL-SEC-001: ADR-0012 D3 — PluginHost registry + lifecycle.
//
// 책임:
//   - 활성 plugin 의 in-memory 레지스트리 (per-plugin worker, R1).
//   - install / enable / disable / uninstall / reload API.
//   - hot reload: 외부 fs 워처 (Tauri) 의 이벤트를 받아 worker 재생성.
//
// Worker 인스턴스 자체는 *호출자가 주입* 하는 factory 로 만든다. 이
// 분리는 두 가지 이유:
//   (a) jsdom 테스트에서 fake worker 로 단위 검증.
//   (b) Vite 의 `new Worker(new URL(...), { type: "module" })` 패턴은
//       파일 시스템 경로 (entry script) 가 필요한데, plugin 의 entry 는
//       동적이라 build 타임에 알 수 없다 — runtime 에 blob URL 로 감싸
//       Worker 를 띄우는 책임은 host wiring (renderer 부트) 에 둔다.

import { type HostInit, type Message, SandboxRpc, type WorkerLike } from "./sandbox-rpc";
import type {
  ContributionMap,
  HookContext,
  PluginCapabilities,
  PluginHandle,
  PluginManifest,
  RenderResult,
} from "./types";

/** D3.4: 8s — esm.sh / 큰 plugin cold start 까지 대응. */
export const HANDSHAKE_TIMEOUT_MS = 8_000;
/** D3.6: 250ms — debounce window 의 기본값. */
export const HOT_RELOAD_DEBOUNCE_MS = 250;

export type WorkerFactory = (manifest: PluginManifest, pluginDir: string) => WorkerLike;

export interface InstallInput {
  manifest: PluginManifest;
  pluginDir: string;
  scope: "user" | "workspace";
}

export interface PluginHostOptions {
  workerFactory: WorkerFactory;
  /** 핸드셰이크 응답 대기 시간. 테스트에서는 짧게 (e.g. 50ms). */
  handshakeTimeoutMs?: number;
}

interface RegistryEntry {
  handle: PluginHandle;
  rpc: SandboxRpc | null;
  /** lang/key → contribution metadata (codeblock 라우팅용). */
  contributions: ContributionMap;
}

/**
 * PluginHost — host 측 plugin 레지스트리의 진입점.
 *
 * 멀티-인스턴스를 허용한다 (테스트 격리), 하지만 production wiring 은
 * 단일 글로벌 인스턴스를 사용한다.
 */
export class PluginHost {
  private readonly factory: WorkerFactory;
  private readonly handshakeTimeoutMs: number;
  private readonly entries = new Map<string, RegistryEntry>();
  private readonly changeListeners = new Set<() => void>();

  constructor(opts: PluginHostOptions) {
    this.factory = opts.workerFactory;
    this.handshakeTimeoutMs = opts.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
  }

  list(): PluginHandle[] {
    return Array.from(this.entries.values()).map((e) => ({ ...e.handle }));
  }

  /**
   * 새 plugin 을 등록 + spawn. 충돌 발생 시 D3.5 에 따라 워크스페이스 로컬
   * 이 우선 — 기존이 user scope 이고 새 등록이 workspace scope 면 교체.
   */
  async install(input: InstallInput): Promise<PluginHandle> {
    const existing = this.entries.get(input.manifest.name);
    if (existing) {
      // D3.5: 워크스페이스 로컬이 우선.
      if (existing.handle.scope === "workspace" && input.scope === "user") {
        return existing.handle; // 무시 — 워크스페이스가 이긴다.
      }
      await this.uninstall(input.manifest.name);
    }

    const handle: PluginHandle = {
      manifest: input.manifest,
      pluginDir: input.pluginDir,
      scope: input.scope,
      workerId: null,
      registered: [],
      state: "loading",
    };
    const entry: RegistryEntry = {
      handle,
      rpc: null,
      contributions: input.manifest.contributes,
    };
    this.entries.set(input.manifest.name, entry);

    try {
      const ready = await this.spawn(entry);
      handle.registered = ready.registered.map((r) => `${r.kind}.${r.key}`);
      handle.state = "ready";
      this.notify();
      return { ...handle };
    } catch (e) {
      handle.state = "error";
      handle.errorMessage = (e as Error).message;
      if (entry.rpc) entry.rpc.dispose();
      entry.rpc = null;
      this.notify();
      return { ...handle };
    }
  }

  /** 활성화 — 비활성 상태의 plugin 을 다시 spawn. */
  async enable(pluginName: string): Promise<void> {
    const entry = this.entries.get(pluginName);
    if (!entry) throw new Error(`unknown plugin: ${pluginName}`);
    if (entry.handle.state === "ready") return;
    entry.handle.state = "loading";
    try {
      const ready = await this.spawn(entry);
      entry.handle.registered = ready.registered.map((r) => `${r.kind}.${r.key}`);
      entry.handle.state = "ready";
      entry.handle.errorMessage = undefined;
    } catch (e) {
      entry.handle.state = "error";
      entry.handle.errorMessage = (e as Error).message;
    }
    this.notify();
  }

  /** 비활성화 — worker 종료, 메타 유지. */
  async disable(pluginName: string): Promise<void> {
    const entry = this.entries.get(pluginName);
    if (!entry) return;
    if (entry.rpc) entry.rpc.dispose();
    entry.rpc = null;
    entry.handle.workerId = null;
    entry.handle.registered = [];
    entry.handle.state = "disabled";
    this.notify();
  }

  /** 완전 제거 — 비활성화 + 레지스트리에서 삭제. */
  async uninstall(pluginName: string): Promise<void> {
    await this.disable(pluginName);
    this.entries.delete(pluginName);
    this.notify();
  }

  /** D3.6: hot reload — 디스크 변경 알림을 받아 worker 재생성. */
  async reload(pluginName: string, nextManifest?: PluginManifest): Promise<void> {
    const entry = this.entries.get(pluginName);
    if (!entry) return;
    if (nextManifest) {
      entry.handle.manifest = nextManifest;
      entry.contributions = nextManifest.contributes;
    }
    await this.disable(pluginName);
    await this.enable(pluginName);
  }

  /**
   * codeblock dispatcher — 주어진 language 에 대해 첫 번째로 매칭되는
   * 활성 plugin 을 찾아 RPC 로 위임. 매칭이 없으면 null.
   *
   * D3.5 의 충돌 해소: 우선순위는 (1) workspace > user, (2) name 알파벳
   * 순. caller 가 정렬을 매번 하면 비용이 크므로 활성 entry 를 한 번
   * 정렬해 캐시한다.
   */
  async renderCodeblock(
    lang: string,
    source: string,
    ctx: Omit<HookContext, "hookKey" | "pluginName">,
  ): Promise<RenderResult | null> {
    const candidates = this.sortedReady().filter((e) =>
      Boolean(e.contributions.codeblocks?.[lang]),
    );
    const winner = candidates[0];
    if (!winner || !winner.rpc) return null;
    try {
      const result = await winner.rpc.invokeHook("codeblock", lang, {
        source,
        documentPath: ctx.documentPath,
      });
      if (result.result.kind === "html") {
        const out: RenderResult = { kind: "html", html: result.result.html };
        if (result.warnings) out.warnings = result.warnings;
        return out;
      }
      return { kind: "error", message: result.result.message };
    } catch (e) {
      return { kind: "error", message: (e as Error).message };
    }
  }

  /** Custom fence (`:::name`) dispatcher. */
  async renderFence(
    name: string,
    source: string,
    ctx: Omit<HookContext, "hookKey" | "pluginName">,
  ): Promise<RenderResult | null> {
    const candidates = this.sortedReady().filter((e) =>
      (e.contributions.fences ?? []).some((f) => f.name === name),
    );
    const winner = candidates[0];
    if (!winner || !winner.rpc) return null;
    try {
      const result = await winner.rpc.invokeHook("fence", name, {
        source,
        documentPath: ctx.documentPath,
      });
      if (result.result.kind === "html") {
        const out: RenderResult = { kind: "html", html: result.result.html };
        if (result.warnings) out.warnings = result.warnings;
        return out;
      }
      return { kind: "error", message: result.result.message };
    } catch (e) {
      return { kind: "error", message: (e as Error).message };
    }
  }

  /** 레지스트리 변경 알림 — UI 가 reactive 하게 갱신. */
  subscribe(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /** 디스포저 — 모든 worker 종료. */
  disposeAll(): void {
    for (const entry of this.entries.values()) {
      if (entry.rpc) entry.rpc.dispose();
      entry.rpc = null;
    }
    this.entries.clear();
    this.notify();
  }

  // ─── internals ──────────────────────────────────────────────────────

  private notify(): void {
    for (const l of this.changeListeners) l();
  }

  private sortedReady(): RegistryEntry[] {
    return Array.from(this.entries.values())
      .filter((e) => e.handle.state === "ready" && e.rpc)
      .sort((a, b) => {
        const scopeRank = (s: PluginHandle["scope"]) => (s === "workspace" ? 0 : 1);
        const sa = scopeRank(a.handle.scope);
        const sb = scopeRank(b.handle.scope);
        if (sa !== sb) return sa - sb;
        return a.handle.manifest.name.localeCompare(b.handle.manifest.name);
      });
  }

  private async spawn(entry: RegistryEntry): Promise<PluginCapabilities> {
    const worker = this.factory(entry.handle.manifest, entry.handle.pluginDir);
    const rpc = new SandboxRpc(worker);
    entry.rpc = rpc;
    entry.handle.workerId = `w-${entry.handle.manifest.name}-${Date.now()}`;
    const ready = await this.handshake(rpc, entry.handle.manifest);
    return ready;
  }

  private handshake(rpc: SandboxRpc, manifest: PluginManifest): Promise<PluginCapabilities> {
    return new Promise<PluginCapabilities>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`handshake timed out after ${this.handshakeTimeoutMs}ms`));
      }, this.handshakeTimeoutMs);
      const unsubscribe = rpc.on((msg: Message) => {
        if (msg.type === "plugin:ready") {
          clearTimeout(timer);
          unsubscribe();
          resolve({ registered: msg.registered });
        } else if (msg.type === "plugin:err") {
          clearTimeout(timer);
          unsubscribe();
          reject(new Error(msg.message));
        }
      });
      const init: HostInit = {
        type: "host:init",
        pluginName: manifest.name,
        capabilities: {
          permissions: manifest.permissions,
          allowedHosts: manifest.allowedHosts,
        },
      };
      rpc.postInit(init);
    });
  }
}
