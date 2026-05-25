// S-PL-SEC-001: ADR-0012 D8 — runtime permission gating + grant persistence.
//
// ADR-0012 의 핵심 결정 두 가지를 구현한다:
//
//   1. *기본 거부* — manifest 에 권한이 선언되지 않으면 host 측 RPC 가
//      throw. Worker CSP 는 별도 방어막 (이 파일은 호스트 레벨 결정).
//   2. *grant 영속화* — 사용자가 "Allow always" 를 선택하면
//      `<pluginDir>/.granted.json` 에 기록되며, 이후 같은 plugin 의
//      같은 권한은 prompt 없이 통과. version 이 바뀌면 grant 가
//      무효화된다 (R4).
//
// 본 모듈은 *순수 결정 로직* 만 가진다 — 실제 prompt UI 는 상위 layer 가
// resolver 콜백을 주입한다 (단위 테스트 용이성 + 코드 격리).

import type { GrantedPermissions, Permission, PluginManifest } from "./types";

export type PermissionVerdict =
  | { decision: "allow"; reason: string }
  | { decision: "deny"; reason: string }
  | { decision: "prompt"; reason: string };

/**
 * D8: 한 plugin 의 한 권한 요청을 manifest + 이미 grant 된 기록과 대조하여
 * "이 요청을 통과시킬지 / prompt 띄울지 / 거부할지" 결정한다.
 */
export function evaluatePermission(
  manifest: PluginManifest,
  permission: Permission,
  grant: GrantedPermissions | null,
): PermissionVerdict {
  if (!manifest.permissions.includes(permission)) {
    return {
      decision: "deny",
      reason: `manifest does not declare '${permission}'`,
    };
  }
  if (grant && grant.version === manifest.version && grant.permissions.includes(permission)) {
    return { decision: "allow", reason: "previously granted by user" };
  }
  return {
    decision: "prompt",
    reason: "user consent required",
  };
}

/**
 * D8: network 권한이 grant 되어 있더라도 *대상 호스트* 가 manifest 의
 * allowedHosts 안에 있어야 한다. 와일드카드는 `*.example.com` 한 형태만
 * 지원한다 (서브도메인 한 단계 — 더 표현력 있는 패턴은 R2 의 공격면을
 * 키운다).
 */
export function isHostAllowed(targetHost: string, allowedHosts: string[]): boolean {
  const host = targetHost.toLowerCase();
  for (const raw of allowedHosts) {
    const p = raw.toLowerCase();
    if (p.startsWith("*.")) {
      const suffix = p.slice(1); // ".example.com"
      if (host.endsWith(suffix) && host.length > suffix.length) return true;
    } else if (host === p) {
      return true;
    }
  }
  return false;
}

/**
 * URL 문자열을 host 추출 — `host.fetch(url)` 의 첫 단계.
 * 잘못된 URL 은 null 을 반환한다 (caller 는 deny 처리).
 */
export function extractHost(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

export type ConsentResolver = (
  pluginName: string,
  permission: Permission,
  scope: "once" | "always",
) => Promise<boolean>;

export interface GrantStore {
  read(pluginName: string): Promise<GrantedPermissions | null>;
  write(pluginName: string, grant: GrantedPermissions): Promise<void>;
}

/**
 * 한 권한 요청의 전체 결정 라이프사이클. manifest 거부 → 즉시 deny.
 * 영구 grant 있음 → allow. 그 외 → resolver 콜백 (사용자 선택).
 * 사용자가 "Allow always" 인 경우 store 에 영속.
 *
 * scope 콜백 시그니처는 "always" 한 가지를 보내도록 단순화했다 — UI 측이
 * "once" 를 선택했을 때는 resolver 가 true 를 반환하되 store.write 를
 * 호출하지 않는 형태로 차이를 표현한다. 본 함수는 resolver 의 결과만
 * 본다.
 */
export async function gatePermission(
  manifest: PluginManifest,
  permission: Permission,
  store: GrantStore,
  resolver: ConsentResolver,
): Promise<PermissionVerdict> {
  const grant = await store.read(manifest.name);
  const verdict = evaluatePermission(manifest, permission, grant);
  if (verdict.decision !== "prompt") return verdict;
  const allowedAlways = await resolver(manifest.name, permission, "always");
  if (!allowedAlways) {
    const allowedOnce = await resolver(manifest.name, permission, "once");
    if (!allowedOnce) {
      return { decision: "deny", reason: "user denied this permission" };
    }
    return { decision: "allow", reason: "user approved for this session" };
  }
  // "always" — persist before returning so subsequent calls skip the prompt.
  const updated: GrantedPermissions = {
    grantedAt: Date.now(),
    version: manifest.version,
    permissions: mergePermissions(grant, permission),
    allowedHosts: manifest.allowedHosts,
  };
  await store.write(manifest.name, updated);
  return { decision: "allow", reason: "user approved permanently" };
}

function mergePermissions(prior: GrantedPermissions | null, added: Permission): Permission[] {
  const set = new Set<Permission>(prior?.permissions ?? []);
  set.add(added);
  return Array.from(set);
}

/**
 * 인메모리 fallback store — 테스트와 storage 가 없는 환경 (e.g.
 * MARKSPREAD_E2E=1 의 first-launch harness) 에서 사용. 프로덕션은 Tauri
 * fs RPC 로 디스크에 영속하는 `createFsGrantStore` (host.ts) 를 쓴다.
 */
export function createMemoryGrantStore(): GrantStore {
  const map = new Map<string, GrantedPermissions>();
  return {
    async read(pluginName) {
      return map.get(pluginName) ?? null;
    },
    async write(pluginName, grant) {
      map.set(pluginName, grant);
    },
  };
}
