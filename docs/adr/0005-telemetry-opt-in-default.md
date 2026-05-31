# ADR-0005: Telemetry opt-in default

| Field | Value |
|---|---|
| Status | **Accepted** (S-TLM-001) |
| Date | 2026-05-15 |
| Owners | Privacy & Observability unit (v1.2 Sprint 1) |
| Supersedes | — |
| Superseded by | — |
| Related | ADR-0008 (telemetry consent model), `src/store/telemetry.ts`, `docs/ops/post-release-smoke.md` ("Telemetry consent defaults to opt-out") |

## Context

Markspread 는 단일 `.md` 파일을 빠르게 열고 닫는 가벼움 (15MB 번들, <600ms cold start; ADR-0007) 과 비개발자 페르소나(ADR-0004) 를 동시에 노린다. 두 축 모두 *첫 실행 직후에 외부로 어떤 데이터도 새지 않는다* 라는 신뢰가 전제다.

업계 디폴트는 갈라져 있다.

- VSCode / JetBrains: 설치 직후 자동 enabled, 설정에서 끄기.
- Obsidian / Logseq / Sublime: 디폴트 **disabled**.
- Antigravity / Cursor: 첫 실행 시 prompt.

Markspread 의 포지셔닝 (개인 문서 · 워크스페이스 로컬 우선) 과 EU/한국 사용자 비중을 감안하면 *암묵적 opt-out* 은 GDPR/PIPA 의 명시적 동의 요구와도 충돌한다. 텔레메트리 자체가 v1 의 핵심 기능이 아니므로 *기본 꺼짐 + 첫 실행 1회 prompt* 가 양 축 모두를 만족한다.

## Decision

### D1. 기본값 = **disabled**

`useTelemetry` 의 초기 `consent` 는 `"unset"` 으로 시작한다. 어떤 이벤트도 `"enabled"` 가 명시되기 전까지 송출되지 않는다 (`src/store/telemetry.ts`).

- `consent === "unset"` 동안 `emitTelemetry()` 는 silent no-op.
- 첫 실행 마운트 시 1회 비차단 카드: "익명 사용 통계로 Markspread 개선에 도와주실래요? [Enable] [No thanks]". 둘 다 `consent` 를 확정 값으로 set 하고 `firstRunPromptShown: true` 영속화.
- "No thanks" 후에는 다시 묻지 않는다. 설정 → Privacy → "Send anonymous usage stats" 로만 켤 수 있다.

### D2. 변경 즉시 발효

토글 변경은 다음 이벤트부터 적용. 큐에 남아있던 이벤트는 *변경 전 상태* 로 발화 여부 결정 — 사용자가 toggle 한 시점 이후 발생한 행위만 송출/억제.

### D3. 자식 이벤트 자동 라벨링

`shell.mounted` 외 모든 이벤트는 `useTelemetry` 미들웨어가 활성 셸·워크스페이스 hash 를 자동 부착한다 (ADR-0010 D-Telemetry). 자식 이벤트가 consent 게이트를 우회할 수 없도록, **모든 송출 경로는 `useTelemetry` 를 통과**한다.

### D4. 사용자 가시 데이터 미리보기

설정 → Privacy 에 "What gets sent" 패널 — 송출되는 이벤트의 *스키마와 샘플 페이로드* 를 정적으로 표시. 실제 송출 로그가 아닌 *코드가 송출할 수 있는 최대 표면* 이다. 변경 시점은 ADR-0008 의 consent flow 와 동일하게 schemaVersion bump 가 트리거.

## Consequences

### 양

- 첫 실행 = zero outbound. EU/한국 사용자 신뢰선 보존.
- Opt-in 모집단이 작아도 변화가 "스스로 켠 사용자" 에서 온다 — 시그널 품질이 높다.
- 페르소나 (비개발 문서 사용자) 가 silent-disable 을 위해 추가 액션 안 함.

### 음

- 채택률이 자동 enabled 대비 낮다 — 정량 분석 모집단 제한.
- Bug 추적이 "Repro 부탁드립니다" 로 회귀 — `INCIDENT_PLAYBOOK.md` 가 사용자 협조 의존을 명시.
- 첫 실행 prompt 가 비차단이라도 noise.

### 위험

- **R1**: 새 이벤트를 추가하면서 consent 게이트를 깜빡 — `emitTelemetry()` 외 별도 fetch 가 생기는 경우. → 완화: lint 룰 (`check-no-plaintext-secrets.mjs` 옆에 `check-telemetry-gate.mjs`) 로 직접 `fetch` 호출에서 텔레메트리 엔드포인트 호출 금지.
- **R2**: prompt 가 비차단이라 사용자가 dismiss 후 잊음 → consent 영구 `"unset"` 으로 남고 송출 안 됨. *의도된 동작* — Privacy by default.

## Validation plan

- S-TLM-001: 첫 부트에서 `consent === "unset"`, 이벤트 0건 송출 확인 (Vitest, store snapshot).
- S-TLM-002: prompt 후 enable → 다음 `chat.message_sent` 이벤트가 subscriber 에 도달 확인.
- S-TLM-003: disable 토글 후 진행 중 큐 이벤트 0건 통과 (race).
- S-TLM-004: `consent === "unset"` 상태에서 외부 네트워크 트래픽 0 — Playwright network-intercept.

## References

- `src/store/telemetry.ts:1~50` — `TelemetryConsent` union, 초기값 `"unset"`.
- ADR-0008 — 동의 모델 자체 (이 ADR 은 *디폴트* 만 결정).
- `docs/ops/post-release-smoke.md` — release smoke 의 "Telemetry consent defaults to opt-out" 체크 항목.
