// S-PL-SEC-001: ADR-0012 runtime plugin host — public type surface.
//
// 본 모듈은 ADR-0012 의 D2 (manifest), D3 (lifecycle), D7 (message)
// 결정을 TypeScript 타입으로 옮긴다. 모든 hook 이 worker 안에서만
// 실행되므로 host 측은 *type-only* 표현을 통해 worker 와 React
// 렌더러를 연결한다.
//
// 이 파일은 의도적으로 런타임 코드를 포함하지 않는다 — manifest 검증은
// `./loader.ts`, RPC 는 `./sandbox-rpc.ts`, 권한은 `./permissions.ts`
// 가 책임진다.

import type { ReactNode } from "react";

/** ADR-0012 D2: manifest 가 선언할 수 있는 권한 라벨. */
export type Permission = "network" | "fs:read" | "fs:write";

/** ADR-0012 D2: contribution 점이 어떤 형태로 렌더되는지. */
export type RenderMode = "html" | "react" | "iframe-react";

/** ADR-0012 D2: hook 점별 contribution 선언. */
export interface CodeblockContribution {
  render: RenderMode;
}

export interface HeaderContribution {
  render: RenderMode;
}

/** ADR-0012 D2: custom fence (`:::name`) hook. */
export interface FenceContribution {
  name: string;
  render: RenderMode;
}

/** ADR-0012 D2: inline pattern hook (정규식은 string 으로 직렬화). */
export interface InlineRule {
  pattern: string;
  flags?: string;
  render: RenderMode;
}

export interface ContributionMap {
  codeblocks?: Record<string, CodeblockContribution>;
  headers?: Record<string, HeaderContribution>;
  fences?: FenceContribution[];
  inlineRules?: InlineRule[];
}

/** ADR-0012 D2: `markspread-plugin.json` 의 정확한 형태. */
export interface PluginManifest {
  schemaVersion: 1;
  name: string;
  version: string;
  entry: string;
  displayName?: string;
  description?: string;
  permissions: Permission[];
  /** `network` 권한이 있을 때만 의미 있음 — host 화이트리스트. */
  allowedHosts: string[];
  contributes: ContributionMap;
  render: RenderMode;
  engines: { markspread: string };
}

/** ADR-0012 D3.7: host 가 보관하는 활성 plugin 핸들. */
export interface PluginHandle {
  manifest: PluginManifest;
  /** manifest 가 발견된 디렉터리의 절대 경로 (entry 해석의 prefix). */
  pluginDir: string;
  /** 워크스페이스 로컬 우선순위 판정용. */
  scope: "user" | "workspace";
  /** 현재 active worker 의 식별자. dispose 시 null. */
  workerId: string | null;
  /** 이 plugin 이 등록한 hook key 들 (`codeblocks.wireweave` 등). */
  registered: string[];
  /** 활성/비활성/오류 상태. */
  state: "loading" | "ready" | "disabled" | "error";
  /** state === "error" 일 때 사용자에게 노출할 메시지. */
  errorMessage?: string | undefined;
}

/**
 * Codeblock 렌더러 시그니처. plugin worker 가 export 하는 implementation
 * 의 타입; host 는 이 타입을 직접 호출하지 않고 RPC 를 통해 worker 로
 * 위임한다. React 산출물은 `iframe-react` 에서만 의미가 있고, 그 외
 * 모드는 `string` (HTML) 을 반환한다.
 */
export type CodeBlockRenderer = (
  source: string,
  ctx: HookContext,
) => Promise<RenderResult> | RenderResult;

export interface HookContext {
  /** 현재 렌더 중인 문서의 경로 (없으면 null). */
  documentPath: string | null;
  /** 매칭된 hook key — 디버그/로깅용. */
  hookKey: string;
  /** plugin manifest 의 사본 — worker 가 자신을 식별할 때 사용. */
  pluginName: string;
}

/** ADR-0012 D7: hook 결과. host 는 sanitize 후 React 노드로 변환. */
export type RenderResult =
  | { kind: "html"; html: string; warnings?: string[] }
  | { kind: "react"; node: ReactNode; warnings?: string[] }
  | { kind: "error"; message: string };

/** ADR-0012 D3.4: capability handshake 의 plugin → host 응답. */
export interface PluginCapabilities {
  registered: Array<{
    kind: "codeblock" | "header" | "fence" | "inline" | "transform";
    key: string;
  }>;
}

/** Plugin 측이 권한 grant 를 영속할 때 디스크에 떨어뜨리는 형태. */
export interface GrantedPermissions {
  grantedAt: number;
  version: string;
  permissions: Permission[];
  /** network 권한이 있을 때만 의미 있음. */
  allowedHosts?: string[];
}
