// S-AI-AUTH-002 (ADR-0004): provider 자격 증명 union.
//
// 두 형태:
//   - api-key       : 사용자가 console 에서 발급해 붙여넣은 종량제 키.
//                     기존 v1 자격 증명 — 마이그레이션 시 자동 라벨링.
//   - subscription  : Claude Agent SDK 의 OAuth/디바이스 코드 흐름으로
//                     획득한 Pro/Max 세션 (anthropic 전용).
//
// 토큰 자체는 모두 secret-storage (macOS Keychain / Windows DPAPI /
// Linux libsecret) 에 보관된다. 본 모듈은 핸들 + 메타데이터만 메모리에
// 다룬다. encryptedAccessToken / encryptedKey 필드명은 "secret-storage 가
// 암호화한 값" 이라는 사실을 호출자가 잊지 않도록 명시한 라벨일 뿐, 다시
// 평문화하지는 않는다.

import { z } from "zod";
import type { AuthMode, ProviderId } from "./providers";

export const ApiKeyCredentialSchema = z.object({
  kind: z.literal("api-key"),
  providerId: z.string().min(1),
  alias: z.string().min(1),
  encryptedKey: z.string().min(1),
});
export type ApiKeyCredential = z.infer<typeof ApiKeyCredentialSchema> & {
  providerId: ProviderId;
};

export const SubscriptionCredentialSchema = z.object({
  kind: z.literal("subscription"),
  providerId: z.literal("anthropic"),
  alias: z.string().min(1),
  encryptedAccessToken: z.string().min(1),
  encryptedRefreshToken: z.string().min(1),
  expiresAt: z.number().int().nonnegative(),
  accountLabel: z.string().optional(),
});
export type SubscriptionCredential = z.infer<typeof SubscriptionCredentialSchema>;

export const ProviderCredentialSchema = z.discriminatedUnion("kind", [
  ApiKeyCredentialSchema,
  SubscriptionCredentialSchema,
]);
export type ProviderCredential = ApiKeyCredential | SubscriptionCredential;

export type ParseCredentialResult =
  | { ok: true; credential: ProviderCredential }
  | { ok: false; reason: string };

export function parseCredential(input: unknown): ParseCredentialResult {
  const r = ProviderCredentialSchema.safeParse(input);
  if (r.success) return { ok: true, credential: r.data as ProviderCredential };
  return { ok: false, reason: r.error.issues[0]?.message ?? "invalid credential" };
}

/** S-AI-AUTH-002: 만료 N 분 전부터 갱신 대상. */
const REFRESH_LEAD_MS = 5 * 60 * 1000;

export function isSubscriptionExpired(
  cred: SubscriptionCredential,
  now: number = Date.now(),
): boolean {
  return cred.expiresAt <= now;
}

export function shouldRefreshSubscription(
  cred: SubscriptionCredential,
  now: number = Date.now(),
  leadMs: number = REFRESH_LEAD_MS,
): boolean {
  return cred.expiresAt - now <= leadMs;
}

/**
 * v1 마이그레이션 — 기존 사용자의 raw 자격 증명 레코드는 `kind` 필드가
 * 없는 `{ providerId, alias, encryptedKey }` 형태였다. 자동으로
 * `kind: 'api-key'` 를 부여해 union 으로 끌어올린다. 이미 kind 가 있으면
 * 그대로 검증만 한다.
 */
export function migrateLegacyCredential(input: unknown): ParseCredentialResult {
  if (typeof input !== "object" || input === null) {
    return { ok: false, reason: "not an object" };
  }
  const obj = input as Record<string, unknown>;
  if (!("kind" in obj)) {
    obj.kind = "api-key";
  }
  return parseCredential(obj);
}

export function authModeOf(cred: ProviderCredential): AuthMode {
  return cred.kind === "subscription" ? "subscription" : "api-key";
}
