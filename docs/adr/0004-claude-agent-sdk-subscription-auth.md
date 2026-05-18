# ADR-0004: Claude Agent SDK subscription auth mode

| Field | Value |
|---|---|
| Status | **Accepted** (S-AI-AUTH-001 · MAR-892) |
| Date | 2026-05-14 |
| Owners | AI Auth unit (v1.2 Sprint 1) |
| Supersedes | — |
| Superseded by | — |
| Related | `src/lib/ai/providers.ts`, `src/lib/ai/credentials.ts` (신설), `src-tauri/src/secret_storage.rs`, Anthropic 지원 문서 ["Use the Claude Agent SDK with your Claude plan"](https://support.claude.com/en/articles/15036540) |

## Context

v1 시점의 anthropic provider 는 **API key 단일 인증** 만 지원한다. 사용자는 console.anthropic.com 에서 키를 발급받아 `ProviderSettingsSheet` 에 붙여넣는 흐름이다. 이 방식은:

- **요금 모델 분리**: API key 사용량은 console 의 종량제 청구로 간다. 사용자가 이미 보유한 Claude Pro / Max **구독은 활용되지 않는다**.
- 발급 절차가 비개발자에게 마찰이 크다. v1.2 가 채택한 페르소나("비개발 업무 중심") 와 정면 충돌한다.
- 키 노출 시 한도 없는 청구 위험. 사용자가 직접 콘솔에서 회수해야 한다.

2026-05 Anthropic 이 [Claude Agent SDK 를 Claude 구독으로 사용](https://support.claude.com/en/articles/15036540) 할 수 있는 경로를 공개했다. SDK 가 OAuth/디바이스 코드 흐름으로 claude.ai 세션을 획득하고, 그 세션을 기반으로 모델 호출을 수행한다. 호출 사용량은 사용자의 Pro/Max 한도에서 차감된다.

이를 통합하면 Markspread 사용자는 **별도 키 발급 없이** 자신의 Claude 구독으로 AI 기능을 사용할 수 있다 — v1.2 의 "문서 워크스페이스" 페르소나와 정확히 맞는 진입 곡선이다.

## Options

### (a) 기존 API key 유지 + 신규 모드 추가 안 함

- 장점: 코드 변경 없음, 다른 provider 와 형태 일관.
- 단점: 페르소나 충돌, 사용자 진입 마찰 유지, 핵심 차별점 상실.

### (b) Subscription 모드로 **교체** (API key 폐기)

- 장점: 코드/UX 단순. 한 가지 흐름만 유지.
- 단점:
  - 기존 사용자 강제 이주 → v1.1 사용자 이탈.
  - 엔터프라이즈/팀 시나리오 (공용 API key 사용) 차단.
  - SDK 의존성 단일 장애점 (SDK 인증 다운 = anthropic 전체 사용 불가).
  - Anthropic 의 SDK 정책 변경 시 회복 경로 없음.

### (c) **두 모드 병행** — 사용자가 provider 추가 시 auth 모드 선택 ★ 채택

- 장점:
  - 비개발자: Subscription (한 번 로그인, 별도 키 없음).
  - 개발자/팀: API key (예측 가능한 청구, 자동화 친화).
  - 한쪽 장애 시 다른 쪽으로 즉시 우회.
  - 마이그레이션 비용 0 — 기존 자격 증명은 `kind: 'api-key'` 로 라벨링만.
- 단점:
  - 자격 증명 모델이 union 으로 확장 — 저장/직렬화/UI 분기 필요.
  - 테스트 매트릭스가 2배. (현실적: 두 모드 모두 단순한 헤더 차이이므로 host 측 분기는 얕다.)

## Decision

**옵션 (c) 두 모드 병행을 채택한다.**

핵심 설계:

### D1. 자격 증명 데이터 모델

```ts
// src/lib/ai/credentials.ts (S-AI-AUTH-002 에서 신설)
export type ProviderCredential =
  | { kind: "api-key"; providerId: ProviderId; encryptedKey: string }
  | {
      kind: "subscription";
      providerId: "anthropic";  // 현재 anthropic 만 지원
      encryptedAccessToken: string;
      encryptedRefreshToken: string;
      expiresAt: number;        // unix ms
      accountLabel?: string;    // "swlee@…" 표시용
    };
```

`ProviderDefinition` 에 `supportedAuthModes: ('api-key' | 'subscription')[]` 필드를 추가. `anthropic` 만 두 값 모두 보유, 나머지는 `['api-key']`.

### D2. 토큰 보관

기존 secret-storage 레이어 재사용:
- macOS: Keychain (`security-framework`)
- Windows: DPAPI (`win32-security`)
- Linux: libsecret (`secret-service`)

`kind: 'subscription'` 자격 증명도 같은 keystore 의 별도 키네임(`markspread.ai.<provider>.subscription`) 으로 저장. 토큰 두 종(access/refresh)을 한 JSON blob 으로 직렬화 후 keystore 가 암호화.

### D3. 토큰 만료/갱신

- **갱신 권한은 SDK 가 보유** (refresh 토큰 회전 정책은 SDK 가 정의).
- Markspread 측은 만료 N분 전(기본 5분) `auth-refresh.ts` 가 SDK 의 refresh API 호출.
- 갱신 실패 → 토스트 + 설정 시트의 "Re-sign in" CTA. 호출 자체는 401 에러로 떨어지므로 자동 fallback 없음 (사용자 행동 필요).

### D4. 사용량 표시

조사 결과 (Anthropic 지원 문서 + SDK 응답 헤더 분석):
- API key 응답: `anthropic-ratelimit-{requests,tokens}-{limit,remaining,reset}` 헤더.
- SDK 구독 응답: 동일 헤더 + `x-claude-subscription-quota` (분기당 한도/사용량) 추가.

→ `useAiUsage` 스토어는 두 종 모두 수용. UI 는 자격 증명 kind 에 따라:
- API key: 시간당 토큰 사용량 (기존 표시 유지).
- Subscription: **분기 한도 대비 % + 남은 일수** 추가 표시. 80% 도달 시 비차단 배너.

### D5. UX 흐름

```
[Add Provider] → Anthropic 선택 →
  ┌─ "Sign in with Claude" (Subscription)
  └─ "Paste API key" (API key)
```

`Sign in with Claude` 버튼:
1. Rust 측 `ai_auth_begin_subscription("anthropic")` 호출.
2. 로컬 콜백 listener(랜덤 포트) 띄움 + 시스템 브라우저로 claude.ai OAuth 페이지 열림.
3. 사용자 로그인 완료 → 콜백 수신 → SDK 토큰 교환 → secret-storage 저장.
4. UI 는 진행 상태 토스트로 단계 표시. 취소(브라우저 닫기) 5분 타임아웃.

### D6. 비-anthropic provider

OpenAI/Google/xAI 등도 비슷한 구독 흐름이 가능하지만 v1.2 스코프 외. `supportedAuthModes` 가 provider 별이므로 추후 확장 용이.

## Consequences

### 양

- 비개발자 사용자가 별도 키 발급 없이 AI 기능 즉시 사용 가능.
- 두 자격 증명 형태가 명시적으로 분리되어 로그/감사 추적 용이.
- SDK 정책 변경 시 API key 흐름이 fallback.

### 음

- 자격 증명 union 으로 인한 호출 site 분기 (≈ 10 곳 예상).
- SDK 의존 추가 — 패키지 사이즈 + 업데이트 추적 부담. v1 의 `bundle.dmg` ceiling 15MB 안에 들어가는지 S-AI-AUTH-003 에서 확인.
- Subscription 모드 사용자는 오프라인 환경에서 토큰 만료 시 재로그인 필요 — 문서 명시.

## Validation plan

- S-AI-AUTH-002: `ProviderCredential` round-trip + 만료 감지 Vitest.
- S-AI-AUTH-003: mock SDK 로 begin → 콜백 → 호출 성공 E2E.
- S-AI-AUTH-004: refresh 타이머 + 사용량 store 갱신 Vitest, 80% 배너 시각 회귀.
- 회귀: 기존 API key 사용자 동선 무손실 (마이그레이션 시 `kind: 'api-key'` 자동 라벨링) — Vitest.

## References

- Anthropic 지원 문서: ["Use the Claude Agent SDK with your Claude plan"](https://support.claude.com/en/articles/15036540).
- v1 인증 코드: `src/lib/ai/providers.ts:46~`, `src-tauri/src/secret_storage.rs`.
- 후속 ADR 후보: Subscription auth 의 OpenAI / Google 확장 (v1.3+).
