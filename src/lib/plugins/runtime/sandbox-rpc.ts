// S-PL-SEC-001: ADR-0012 D7 — host ↔ worker RPC protocol.
//
// Worker 격리는 그 자체로는 의미 있는 안전망이지만, 메시지 채널이 좁을
// 때만 *감사 가능* 하다. 본 모듈은:
//
//   - 모든 메시지 variant 의 zod 스키마 (single source of truth).
//   - request 와 response 를 id 로 correlate 하는 RPC.
//   - timeout / cancel / dispose 와 그에 따른 reject 보장.
//
// 본 모듈은 Worker 그 자체를 모른다 — `WorkerLike` 인터페이스만 받는다.
// 따라서 jsdom 환경에서도 fake worker 로 테스트가 가능하다.

import { z } from "zod";

const PERMISSION = z.enum(["network", "fs:read", "fs:write"]);

export const HostInitSchema = z.object({
  type: z.literal("host:init"),
  pluginName: z.string().min(1),
  capabilities: z.object({
    permissions: z.array(PERMISSION),
    allowedHosts: z.array(z.string()),
  }),
});
export type HostInit = z.infer<typeof HostInitSchema>;

export const PluginReadySchema = z.object({
  type: z.literal("plugin:ready"),
  registered: z.array(
    z.object({
      kind: z.enum(["codeblock", "header", "fence", "inline", "transform"]),
      key: z.string().min(1),
    }),
  ),
});
export type PluginReady = z.infer<typeof PluginReadySchema>;

export const PluginErrSchema = z.object({
  type: z.literal("plugin:err"),
  message: z.string().min(1),
  stack: z.string().optional(),
});
export type PluginErr = z.infer<typeof PluginErrSchema>;

export const HookInvokeSchema = z.object({
  type: z.literal("hook:invoke"),
  requestId: z.string().min(1),
  kind: z.enum(["codeblock", "header", "fence", "inline", "transform"]),
  key: z.string().min(1),
  payload: z.object({
    source: z.string(),
    documentPath: z.string().nullable(),
  }),
});
export type HookInvoke = z.infer<typeof HookInvokeSchema>;

export const HookResultSchema = z.object({
  type: z.literal("hook:result"),
  requestId: z.string().min(1),
  result: z.union([
    z.object({ kind: z.literal("html"), html: z.string() }),
    z.object({ kind: z.literal("error"), message: z.string() }),
  ]),
  warnings: z.array(z.string()).optional(),
});
export type HookResult = z.infer<typeof HookResultSchema>;

export const MessageSchema = z.discriminatedUnion("type", [
  HostInitSchema,
  PluginReadySchema,
  PluginErrSchema,
  HookInvokeSchema,
  HookResultSchema,
]);
export type Message = z.infer<typeof MessageSchema>;

/**
 * Worker / 테스트용 fake 가 만족해야 하는 최소 surface. Web Worker 와
 * MessagePort 가 모두 이 모양을 자연스럽게 만족한다.
 */
export interface WorkerLike {
  postMessage(msg: unknown): void;
  addEventListener(type: "message", listener: (ev: { data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (ev: { data: unknown }) => void): void;
  terminate(): void;
}

export interface RpcOptions {
  /** 기본 5초 — D3.4 의 8초 handshake 와 다르다 (hook invoke 는 짧게). */
  timeoutMs?: number;
  /** 외부 cancel 채널. signal.aborted 시 reject 한다. */
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * 한 worker 와의 양방향 RPC 를 캡슐화한다. dispose 시 모든 미해결 RPC 가
 * reject 되어 caller 가 hang 되지 않는다.
 */
export class SandboxRpc {
  readonly worker: WorkerLike;
  private readonly pending = new Map<
    string,
    {
      resolve: (r: HookResult) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly listeners = new Set<(msg: Message) => void>();
  private nextId = 0;
  private disposed = false;
  private readonly onMessage: (ev: { data: unknown }) => void;

  constructor(worker: WorkerLike) {
    this.worker = worker;
    this.onMessage = (ev) => this.handleMessage(ev.data);
    worker.addEventListener("message", this.onMessage);
  }

  /** 외부 listener — handshake (plugin:ready) 수신용. */
  on(listener: (msg: Message) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** host → plugin: capability handshake 메시지 전송 (응답 대기 없음). */
  postInit(init: HostInit): void {
    if (this.disposed) throw new Error("rpc disposed");
    this.worker.postMessage(init);
  }

  /** host → plugin: hook 호출. 응답 correlate + timeout + cancel 지원. */
  invokeHook(
    kind: HookInvoke["kind"],
    key: string,
    payload: HookInvoke["payload"],
    opts: RpcOptions = {},
  ): Promise<HookResult> {
    if (this.disposed) return Promise.reject(new Error("rpc disposed"));
    const requestId = `req-${this.nextId++}`;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return new Promise<HookResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        const entry = this.pending.get(requestId);
        if (!entry) return;
        this.pending.delete(requestId);
        entry.reject(new Error(`hook timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      if (opts.signal) {
        if (opts.signal.aborted) {
          this.settleReject(requestId, new Error("aborted"));
          return;
        }
        opts.signal.addEventListener("abort", () => {
          this.settleReject(requestId, new Error("aborted"));
        });
      }
      const msg: HookInvoke = {
        type: "hook:invoke",
        requestId,
        kind,
        key,
        payload,
      };
      this.worker.postMessage(msg);
    });
  }

  /** 모든 미해결 RPC 를 reject 하고 worker 를 종료. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error("rpc disposed"));
    }
    this.pending.clear();
    this.worker.removeEventListener("message", this.onMessage);
    try {
      this.worker.terminate();
    } catch {
      // terminate 가 실패해도 caller 가 할 수 있는 일은 없다 — swallow.
    }
  }

  private handleMessage(raw: unknown): void {
    const parsed = MessageSchema.safeParse(raw);
    if (!parsed.success) {
      // 스키마에서 떨어지는 메시지는 조용히 폐기 — security audit log 는
      // 호스트 레벨에서 record (이 모듈은 leaf).
      return;
    }
    const msg = parsed.data;
    if (msg.type === "hook:result") {
      const entry = this.pending.get(msg.requestId);
      if (!entry) return;
      this.pending.delete(msg.requestId);
      clearTimeout(entry.timer);
      entry.resolve(msg);
      return;
    }
    for (const l of this.listeners) l(msg);
  }

  private settleReject(requestId: string, error: Error): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    this.pending.delete(requestId);
    clearTimeout(entry.timer);
    entry.reject(error);
  }
}

/**
 * 테스트용 in-memory fake worker. 양 끝에 콜백을 꽂으면 두 SandboxRpc
 * 인스턴스 (호스트 측, 플러그인 측) 가 양방향으로 통신한다.
 */
export function createFakeWorkerPair(): {
  hostSide: WorkerLike;
  pluginSide: WorkerLike;
} {
  const hostListeners = new Set<(ev: { data: unknown }) => void>();
  const pluginListeners = new Set<(ev: { data: unknown }) => void>();
  let alive = true;
  const hostSide: WorkerLike = {
    postMessage(msg) {
      if (!alive) return;
      for (const l of pluginListeners) l({ data: msg });
    },
    addEventListener: (_t, l) => {
      hostListeners.add(l);
    },
    removeEventListener: (_t, l) => {
      hostListeners.delete(l);
    },
    terminate() {
      alive = false;
      hostListeners.clear();
      pluginListeners.clear();
    },
  };
  const pluginSide: WorkerLike = {
    postMessage(msg) {
      if (!alive) return;
      for (const l of hostListeners) l({ data: msg });
    },
    addEventListener: (_t, l) => {
      pluginListeners.add(l);
    },
    removeEventListener: (_t, l) => {
      pluginListeners.delete(l);
    },
    terminate() {
      alive = false;
      hostListeners.clear();
      pluginListeners.clear();
    },
  };
  return { hostSide, pluginSide };
}
