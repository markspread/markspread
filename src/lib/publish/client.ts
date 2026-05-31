// ADR-0015 §3 Publish: Obsidian-pattern publish client API.
//
// 사용자 선택 문서 → 정적 사이트 publish.
// 차별점 (ADR-0014): AI 리뷰 코멘트·diff 이력 함께 표시 (옵션).
//
// 본 클라이언트는 backend (markspread-publish, 별도 서비스) 와 통신.
// 본 모듈은 *프로토콜 + 클라이언트 측 패키징* 만.
//
// Publish 단계:
//   1. 문서 + AI 이력 → 패키지 (HTML + meta + 코멘트 ledger)
//   2. Sanitizer strict 강제 적용 (ADR-0016 publish strict)
//   3. backend POST → URL 반환
//   4. 도메인 (markspread.app subdomain 또는 사용자 도메인 CNAME)

import { sanitize } from "../preview/sanitizer";

export interface PublishCredentials {
  authToken: string;
  customerId: string;
}

export interface PublishBackendConfig {
  baseUrl: string;
  fetch: typeof fetch;
}

export interface PublishOptions {
  /** site subdomain or custom domain — backend 가 충돌 시 fail */
  sitename: string;
  /** AI 리뷰 코멘트·diff 이력 함께 노출? default true */
  includeAiHistory?: boolean;
  /** 추가 메타 */
  title?: string;
  description?: string;
}

export interface PublishedDocument {
  /** 원본 markdown 경로 (audit) */
  sourcePath: string;
  /** sanitised HTML (publish strict 적용 완료) */
  htmlBody: string;
  /** AI 리뷰 코멘트·diff 이력 (optional) */
  aiHistory?: AiHistoryEntry[];
}

export interface AiHistoryEntry {
  timestamp: string;
  /** "edit" | "comment" 등 */
  kind: string;
  /** 사용자 prompt */
  prompt?: string;
  /** AI 응답 요약 (이미 accept 된 결과만) */
  result?: string;
}

export interface PublishResult {
  ok: boolean;
  url?: string;
  errors?: readonly string[];
}

export class PublishClient {
  constructor(
    private readonly creds: PublishCredentials,
    private readonly cfg: PublishBackendConfig,
  ) {}

  /**
   * 단일 문서 publish.
   * 호출자는 본 함수 호출 전 raw markdown → HTML 변환 + AI 이력 첨부 + sanitize 책임.
   * sanitize 는 본 함수 안에서도 한 번 더 적용 (defence-in-depth).
   */
  async publish(doc: PublishedDocument, opts: PublishOptions): Promise<PublishResult> {
    const sanitised = await sanitize(doc.htmlBody, { strict: true });
    const payload = {
      sourcePath: doc.sourcePath,
      htmlBody: sanitised.html,
      aiHistory: opts.includeAiHistory === false ? [] : (doc.aiHistory ?? []),
      sitename: opts.sitename,
      title: opts.title,
      description: opts.description,
    };
    const res = await this.cfg.fetch(`${this.cfg.baseUrl}/v1/publish`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.creds.authToken}`,
        "x-customer-id": this.creds.customerId,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return { ok: false, errors: [`publish failed: ${res.status}`] };
    }
    const data = (await res.json()) as { url?: string; errors?: string[] };
    if (data.url) return { ok: true, url: data.url };
    return { ok: false, errors: data.errors ?? ["unknown error"] };
  }

  /**
   * 기존 site 의 도메인·통계 fetch.
   */
  async getSite(sitename: string): Promise<{ url: string; views: number } | null> {
    const res = await this.cfg.fetch(
      `${this.cfg.baseUrl}/v1/sites/${encodeURIComponent(sitename)}`,
      {
        headers: {
          authorization: `Bearer ${this.creds.authToken}`,
          "x-customer-id": this.creds.customerId,
        },
      },
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`site fetch failed: ${res.status}`);
    return (await res.json()) as { url: string; views: number };
  }
}
