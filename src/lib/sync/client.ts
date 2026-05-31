// ADR-0015 §3 Sync: Obsidian-pattern 동기화 client API (TypeScript 측).
//
// 본 클라이언트는 Cloudflare Workers 백엔드 (markspread-sync, 별도 repo) 와 통신.
// 본 모듈은 *프로토콜* + *클라이언트 측 e2e 암호화* + *재시도 정책* 만 담당.
// 실제 backend 구현 (R2 스토리지, Stripe 검증, auth) 은 별도 서비스.
//
// 동기화 대상 (CONTEXT.md §9):
//   - workspace 설정 (.markspread/settings.json)
//   - 활성 플러그인 구성 + trust level
//   - AI 리뷰 세션 이력
//   - **문서 파일 X** (로컬 우선 절대 유지)
//
// 클라이언트 측 e2e 암호화: passphrase 기반 키 유도 (PBKDF2 / Argon2id).

export interface SyncCredentials {
  /** auth token (Stripe customer + subscription 검증 후 발급) */
  authToken: string;
  /** e2e 암호화 키 유도용 passphrase. 본 도구 안에서만 사용. */
  passphrase: string;
  /** 디바이스 식별자 (사용자가 디바이스 N개 추적) */
  deviceId: string;
}

export interface SyncEnvelope {
  /** workspace identifier (URL-safe hash of root path + git origin) */
  workspaceKey: string;
  /** sync target kind */
  kind: "settings" | "plugin-config" | "review-session";
  /** content version (server-side conflict detection) */
  version: number;
  /** encrypted payload (base64) */
  ciphertext: string;
  /** content-hash 으로 dedup */
  contentHash: string;
}

export interface SyncBackendConfig {
  /** API base URL — production: https://sync.markspread.app */
  baseUrl: string;
  /** HTTP fetch 구현 — node test 에서 mock 주입 */
  fetch: typeof fetch;
}

export interface SyncResult {
  ok: boolean;
  version?: number;
  conflict?: boolean;
  message?: string;
}

/**
 * 단순 client — push/pull/list 만 노출.
 * 호출자 (UI store) 는 본 client 의 결과를 store 에 반영.
 */
export class SyncClient {
  constructor(
    private readonly creds: SyncCredentials,
    private readonly cfg: SyncBackendConfig,
  ) {}

  async push(envelope: SyncEnvelope): Promise<SyncResult> {
    const res = await this.cfg.fetch(`${this.cfg.baseUrl}/v1/push`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(envelope),
    });
    if (!res.ok) {
      return { ok: false, message: `push failed: ${res.status}` };
    }
    const data = (await res.json()) as { version?: number; conflict?: boolean };
    const out: SyncResult = { ok: !data.conflict };
    if (data.version !== undefined) out.version = data.version;
    if (data.conflict) out.conflict = true;
    return out;
  }

  async pull(workspaceKey: string, kind: SyncEnvelope["kind"]): Promise<SyncEnvelope | null> {
    const url = `${this.cfg.baseUrl}/v1/pull?key=${encodeURIComponent(workspaceKey)}&kind=${encodeURIComponent(kind)}`;
    const res = await this.cfg.fetch(url, { headers: this.headers() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`pull failed: ${res.status}`);
    return (await res.json()) as SyncEnvelope;
  }

  async list(
    workspaceKey: string,
  ): Promise<Array<{ kind: SyncEnvelope["kind"]; version: number }>> {
    const url = `${this.cfg.baseUrl}/v1/list?key=${encodeURIComponent(workspaceKey)}`;
    const res = await this.cfg.fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`list failed: ${res.status}`);
    return (await res.json()) as Array<{ kind: SyncEnvelope["kind"]; version: number }>;
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      authorization: `Bearer ${this.creds.authToken}`,
      "x-device-id": this.creds.deviceId,
    };
  }
}

/**
 * 클라이언트 측 e2e 암호화 — placeholder. 실제로는 WebCrypto SubtleCrypto.
 * PBKDF2(passphrase, deviceId) → AES-GCM key.
 * 본 함수는 *인터페이스* 만 — 실제 암호화는 SubtleCrypto 호출 (브라우저/Tauri WebView).
 */
export interface CryptoBackend {
  encrypt(plaintext: string, passphrase: string): Promise<string>;
  decrypt(ciphertext: string, passphrase: string): Promise<string>;
  hash(data: string): Promise<string>;
}

/**
 * 동기화 envelope 생성 helper — UI 가 settings JSON 을 envelope 으로.
 */
export async function makeEnvelope(
  workspaceKey: string,
  kind: SyncEnvelope["kind"],
  plaintext: string,
  version: number,
  crypto: CryptoBackend,
  passphrase: string,
): Promise<SyncEnvelope> {
  const [ciphertext, contentHash] = await Promise.all([
    crypto.encrypt(plaintext, passphrase),
    crypto.hash(plaintext),
  ]);
  return { workspaceKey, kind, version, ciphertext, contentHash };
}
