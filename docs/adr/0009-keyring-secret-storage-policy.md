# ADR-0009: Keyring secret storage policy

| Field | Value |
|---|---|
| Status | **Accepted** (S-AIK-001) |
| Date | 2026-05-23 |
| Owners | AI Auth unit (v1.2 Sprint 3) |
| Supersedes | — |
| Superseded by | — |
| Related | ADR-0004 D2 ("토큰 보관" — macOS Keychain / Windows DPAPI / Linux libsecret), `src/lib/ai/key-store.ts`, `src/lib/ai/keychain-status.ts`, `src-tauri/src/ai_keys.rs`, `src-tauri/src/ai_auth.rs`, `docs/spec/file-access-policy.md` |

## Context

ADR-0004 가 자격증명 *데이터 모델* 과 *어느 keystore* 를 쓸지를 정했다. 본 ADR 은 그 위에서 **renderer ↔ host 사이의 비밀 처리 규약** 을 박는다. 누가 어떤 시점에 raw 비밀을 잡고 있을 수 있고, 언제 zeroize 해야 하는지가 분산되어 있으면 한 코드 변경이 사일런트로 표면을 넓힐 수 있다.

`src/lib/ai/key-store.ts:1~12` 의 주석:

> The renderer never holds the raw key in long-lived state. The Add Provider form keeps it just long enough to call `ai_key_save`, which hands it to the Rust side; the Rust side stores it in the keychain and zeroises its in-process copy. From that point on the renderer only ever sees aliases and metadata (provider, model, masked tail). Key material returns to memory only when the runner calls `ai_key_resolve` immediately before a provider request, and is dropped as soon as the request returns.

본 ADR 은 이 코드 주석을 *정책 문서* 로 끌어올린다 — 신규 자격증명 종류 (예: ADR-0004 의 subscription 토큰, OAuth, mTLS 클라이언트 인증서) 가 추가될 때 같은 규약을 따른다.

## Decision

### D1. 비밀 분류

| 종류 | 예시 | 보관 | TTL in renderer |
|---|---|---|---|
| Provider API key | `sk-ant-…`, `sk-…` | OS keyring | 입력 폼 ↔ `ai_key_save` 사이 1턴 |
| Subscription access token | Anthropic OAuth access | OS keyring (별도 키네임) | 호출 직전 `ai_key_resolve` ↔ 호출 종료 사이 |
| Subscription refresh token | Anthropic OAuth refresh | OS keyring (별도 키네임) | renderer 가 *직접* 보유 금지 — Rust 측만 사용 |
| 기타 자격증명 (mTLS, etc.) | 미래 OQ | OS keyring | 동일 |

`renderer 가 직접 보유 금지` 카테고리는 host command 결과를 *마스킹된 형태* 로만 받는다 (`maskedKey: "sk-…••••XYZ"`).

### D2. Renderer 측 규약

1. **Long-lived state 금지** — `zustand` store, React state, localStorage, IndexedDB 에 raw 비밀 저장 금지.
2. **입력 후 즉시 host 호출** — Add Provider form 의 submit 핸들러는 `invoke("ai_key_save", { key })` 호출 직후 form state 의 키 필드를 빈 문자열로 덮어쓴다.
3. **URL/로그/텔레메트리 누락** — `console.log`, error stack trace, ADR-0008 의 telemetry envelope 어디에도 raw 비밀 inclusion 금지. lint 룰 `check-no-plaintext-secrets.mjs` (이미 존재) 가 정규식으로 강제.
4. **Display 표면** — 항상 `maskedKey` 만 표시. unmask UI 는 제공 안 함 — 사용자가 raw 키를 확인하려면 키체인 앱을 직접 사용.

### D3. Host (Rust) 측 규약

1. **Zeroize on drop** — keystore 에 저장한 직후 in-process 사본을 `zeroize::Zeroize::zeroize()`. `String` → `Zeroizing<String>` 래퍼 강제.
2. **Resolve 는 짧게** — `ai_key_resolve` 는 호출자가 즉시 사용할 단 한 번의 라이프타임. 반환된 키 객체는 Drop 시 zeroize.
3. **Logging redaction** — `tracing` macro 의 자체 redaction layer. `ProviderCredential` 의 Debug impl 은 `kind` 와 `providerId` 만 노출.
4. **IPC payload** — `ai_key_resolve` 의 반환은 *호출자가 명시한 destination* 에 한해 plaintext. 그 외는 알리아스/메타데이터만.

### D4. Keystore 키네임 컨벤션

```
markspread.ai.<providerId>.api-key.<alias>
markspread.ai.<providerId>.subscription.access
markspread.ai.<providerId>.subscription.refresh
markspread.ai.<providerId>.subscription.meta      # accountLabel, expiresAt JSON
```

ADR-0004 D2 의 키네임 규칙을 본 ADR 이 정규화. 사용자 관점에서 keychain 앱을 열면 *어떤 키가 어떤 의미인지* 가 prefix 로 명확.

### D5. 만료/회수 동작

- Subscription access token 만료 N분 전 (ADR-0004 D3) host 측 `auth-refresh` 가 refresh → 새 access 를 keystore 에 overwrite + 이전 in-process 사본 zeroize.
- 사용자가 provider 를 "Remove" 하면 host 가 모든 `markspread.ai.<providerId>.*` 키네임을 keystore 에서 삭제. renderer 측 store entry 도 동일 트랜잭션에서 제거.
- 401/403 응답 N회 연속 → 자동 회수 안 함 (사용자 행동 필요), 단 `keychain-status.ts` 가 "재로그인 필요" 상태 노출.

### D6. Linux libsecret 부재 시 fallback

Linux 일부 환경 (헤드리스, gnome-keyring 미설치) 에서 libsecret 미가용 가능. 동작:

1. 마운트 시 `keychain-status.ts` 가 `unavailable` 상태 노출.
2. Add Provider 모달에서 *경고* — "OS 키체인을 찾지 못했습니다. 자격증명이 평문으로 디스크에 저장됩니다." + 진행/취소 선택.
3. 진행 시 fallback 위치는 `<appdata>/secrets/<keyname>.json` — 파일 권한 `0600`. 사용자에게 *명시적 동의* 받은 경우만.

이 fallback 은 보안적으로 약하므로 별도 ADR 후속 가능 (OQ1).

### D7. 자격증명 마이그레이션

- ADR-0004 의 API key 사용자 → 본 ADR 의 키네임 컨벤션으로 rename 마이그레이션. 마이그레이션 step 은 `src/lib/migration/run.ts` 의 신규 단계.
- 마이그레이션 실패 시 (예: 키체인 잠금) 사용자는 *기존 위치* 에서 계속 사용 가능 — destructive 마이그레이션 금지.

## Consequences

### 양

- Raw 비밀의 surface 가 *시간적·공간적으로* 명시 — 감사 가능.
- 새 자격증명 종류 추가 시 D1 표에 한 줄 + D2/D3 규약 자동 적용.
- lint + Rust 타입 (Zeroizing) 양쪽에서 강제 → 사람 검토 없이도 회귀 차단.

### 음

- `Zeroizing` 래퍼가 코드 가독성에 약간의 noise.
- libsecret fallback 의 평문 저장 옵션이 "약한 길" 을 남김 — 사용자 명시 동의로 완충하지만 social engineering 표면.

### 위험

- **R1**: 새 자격증명 종류를 추가하면서 D1 표 update 누락 → 정책 외 상태로 누수. → 완화: PR template 체크박스 + CODEOWNERS 가 AI Auth unit 리뷰 강제.
- **R2**: zeroize 가 컴파일러 최적화로 제거. → 완화: `zeroize` crate 의 `#[inline(never)]` + volatile write 보장.
- **R3**: macOS Keychain UI 가 사용자에게 "markspread 가 키체인 접근" prompt 를 자주 띄움. → 완화: `keychain-status.ts` 가 "Always Allow" 안내 + 한 번의 합법 prompt 가 향후 prompt 를 제거함을 설명.

## Validation plan

- S-AIK-001: renderer state snapshot 에 raw 키 absence 확인 (Vitest).
- S-AIK-002: `ai_key_save` 호출 후 form state 의 키 필드가 비었는지 (Vitest + React Testing Library).
- S-AIK-003: Rust 측 `Zeroizing` 래퍼가 Drop 시 메모리 0 채움 확인 (Rust unit test, `memchr` 로 검증).
- S-AIK-004: keystore 키네임 컨벤션 — provider 삭제 시 모든 prefix 매칭 키 삭제 (mock keystore).
- S-AIK-005: libsecret 부재 환경에서 `keychain-status` 가 `unavailable` 반환 + Add Provider 모달이 경고 표시 (Playwright with fake env).
- S-AIK-006: 텔레메트리 envelope 에 raw 키 absence — fuzz: 모든 이벤트 페이로드 검사 (ADR-0008 D6 의 lint 와 연계).

## Open questions

- **OQ1**: libsecret 미가용 환경의 평문 fallback 을 영구 정책으로 유지할지, 별도 "headless mode" 로 분리할지. → 별도 ADR 후속.
- **OQ2**: 자격증명 export — 사용자가 새 머신으로 자격증명을 옮기는 정식 경로. 현재 OS 키체인 sync (iCloud Keychain) 에만 의존. → 별도 ADR 후속.

## References

- `src/lib/ai/key-store.ts:1~12` — renderer 측 규약의 *코드 주석 origin* (본 ADR 이 정책화).
- `src-tauri/src/ai_keys.rs`, `src-tauri/src/ai_auth.rs` — host 측 구현.
- ADR-0004 D2 (보관소 선택), D3 (만료/갱신).
- `docs/spec/file-access-policy.md` — 본 ADR 의 fallback fs 경로 권한 규약과 정합.
- `scripts/check-no-plaintext-secrets.mjs` — D2.3 강제.
