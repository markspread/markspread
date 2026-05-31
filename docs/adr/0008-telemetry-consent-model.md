# ADR-0008: Telemetry consent model

| Field | Value |
|---|---|
| Status | **Accepted** (S-TLM-010) |
| Date | 2026-05-21 |
| Owners | Privacy & Observability unit (v1.2 Sprint 2) |
| Supersedes | — |
| Superseded by | — |
| Related | ADR-0005 (opt-in 디폴트), ADR-0010 D-Telemetry (셸 이벤트 정의 — "`TelemetryConsent` 가 꺼진 사용자는 위 모든 이벤트도 발화 안 함"), ADR-0012 Telemetry 절 ("ADR-0008 의 telemetry opt-in 동의 안에서만 송출"), `src/store/telemetry.ts` |

## Context

ADR-0005 가 *디폴트* 를 disabled 로 박았다면, 본 ADR 은 *동의 모델 자체* — 누가 무엇에 동의했고 그것을 어떻게 표현/저장/회수하느냐 — 를 박는다.

ADR-0010 과 ADR-0012 가 자신의 Telemetry 절에서 본 ADR 을 명시 참조한다. 새 이벤트를 추가할 때 *어디에 동의가 걸리는지* 의 규약 한 곳을 본 ADR 이 제공한다.

요구사항:

1. **Opt-in 단일 게이트** — 모든 이벤트가 한 토글 뒤에 있다. 이벤트 카테고리별 토글로 쪼개지 않는다 (사용자 인지 부담).
2. **회수 가능** — 사용자가 언제든 disable 할 수 있다. 회수 즉시 발화 중단.
3. **투명성** — 무엇이 송출되는지 사용자가 미리 본다 (ADR-0005 D4).
4. **확장 시 재동의** — 송출 스키마가 의미 있게 확장되면 재프롬프트 (silent 추가 차단).

## Decision

### D1. Consent 상태 머신

```ts
// src/store/telemetry.ts
type TelemetryConsent = "enabled" | "disabled" | "unset";
```

| 상태 | 의미 | 진입 경로 |
|---|---|---|
| `"unset"` | 첫 실행 prompt 미응답 | 신규 설치 직후 |
| `"enabled"` | 사용자 명시 동의 | prompt "Enable" / 설정 토글 ON |
| `"disabled"` | 사용자 명시 거부 또는 회수 | prompt "No thanks" / 설정 토글 OFF |

`"unset"` 동안의 송출은 0 (ADR-0005 D1). `"enabled"` → `"disabled"` 회수는 즉시 발효 (ADR-0005 D2).

### D2. Single gate API

```ts
emitTelemetry(event: TelemetryEvent): void
```

- 내부에서 `useTelemetry.getState().consent === "enabled"` 검사 후 subscriber 들에게 전달.
- subscriber 외 다른 경로로 텔레메트리 송출 금지. lint 룰 `scripts/check-telemetry-gate.mjs` (D6 참조) 가 강제.

### D3. 이벤트 schemaVersion

`TelemetryEvent` 의 union 자체에 `schemaVersion` 필드 부착 (런타임이 아닌 *송출 envelope* 에). 의미 있는 확장 (필드 추가 ≠ 새 카테고리 추가) 의 정의:

| 변경 | schemaVersion bump | 재프롬프트 |
|---|---|---|
| 기존 이벤트에 옵셔널 필드 추가 | ❌ | ❌ |
| 기존 이벤트에 필수 필드 추가 | ✅ | ❌ (자동 default 채움) |
| 새 이벤트 카테고리 추가 (예: 새 표면) | ✅ | **✅** |
| 새 외부 sink 추가 | ✅ | **✅** |
| identifier 형식 변경 (hash → raw 등) | ✅ | **✅** (regression 시) |

재프롬프트는 ADR-0005 의 prompt 컴포넌트를 재사용. 사용자가 응답할 때까지 *그 신규 카테고리만* 송출 보류, 기존 카테고리는 계속 동의 범위 안.

### D4. PII 금지 규약

본 ADR 은 어떤 이벤트도 다음을 포함하지 않는다:

- 파일 본문, 파일 경로 (basename 포함 금지 — hash 만 허용).
- 사용자 이름·이메일·자격증명 토큰 일부 (mask 도 금지).
- 워크스페이스 루트 절대 경로 (hash 만).
- 채팅 메시지 본문, LLM 응답 본문.
- 플러그인 소스 코드.

`ProviderId`, `shell` enum 같은 *고정된 enumerable* 만 raw 로 송출. lint 룰 (D6) 이 `TelemetryEvent` 의 string 필드에 fixed-set 주석 (`/** @telemetry-enum */`) 없으면 fail.

### D5. 저장 위치

`zustand persist` 가 `markspread.telemetry` 키로 저장 — ADR-0006 의 appdata 디렉터리 안. 파일 형식:

```json
{
  "state": { "consent": "enabled" | "disabled" | "unset", "firstRunPromptShown": true },
  "version": <schemaVersion>
}
```

사용자는 이 파일을 직접 삭제해 `"unset"` 으로 reset 가능 (Privacy 패널의 "Reset" 버튼도 동일 동작).

### D6. 빌드 시 검증

`scripts/check-telemetry-gate.mjs` (신설):

1. `src/` 안에서 `fetch(`, `invoke("telemetry_*"` 등 *직접* 텔레메트리 송출 가능 경로를 grep.
2. `TelemetryEvent` union 의 모든 string 필드가 enum 주석 또는 hash 처리 표시를 갖는지 검사.
3. 새 이벤트 카테고리 추가 PR 이 본 ADR / ADR-0005 의 prompt 카피 update 도 동반하는지 검사.

`.github/workflows/lint.yml` 에서 실행.

### D7. 회수 후 데이터 처리

- Markspread 자체는 텔레메트리 raw 저장소를 운영하지 않음 (v1 시점, 외부 sink 미연결).
- 외부 sink 가 도입되면 sink 와의 계약으로 "anonymized 집계만 유지, raw event 7일 후 삭제, 사용자 회수 요청 30일 내 반영" 을 명시 — 신규 ADR 로 박는다 (현 시점 OQ).

## Consequences

### 양

- 모든 ADR 이 "동의 안에서" 라는 한 문구로 본 ADR 을 인용하면 끝남.
- 회수 = 즉시 효과 — GDPR/PIPA 의 *철회권* 충족.
- schemaVersion 게이트 + 카테고리 단위 재프롬프트로 "silent 확장" 차단.

### 음

- 카테고리 추가 시 사용자에게 또 prompt — friction. *의도된 비용*.
- lint 룰 유지 부담 — 새 외부 라이브러리가 자체 텔레메트리를 가지면 detect 어려움. → 완화: `check-licences.mjs` 옆에 의존성 audit 항목 추가.

### 위험

- **R1**: 외부 sink 연결 시점에 본 ADR 가 envelope 만 정의하고 *전송 정책* 을 안 박음 — sink 추가 ADR 이 필수. → 완화: 본 ADR 의 D7 이 명시 OQ.
- **R2**: 사용자가 enable 했다가 잊고 sensitive 작업 — 본 ADR 의 D4 (PII 금지) 가 안전망. PII 가 새는 코드 자체가 lint fail.
- **R3**: schemaVersion bump 의 *의미 있는* 의 판단이 주관적. → 완화: D3 의 표를 본 ADR 안에 박았고, PR template 의 체크박스로 강제.

## Validation plan

- S-TLM-010: `emitTelemetry` 가 `consent === "enabled"` 일 때만 subscriber 호출.
- S-TLM-011: 회수 (`setConsent("disabled")`) 이후 다음 호출 0건 전달.
- S-TLM-012: schemaVersion bump + 새 카테고리 추가 시 prompt 가 자동 재등장.
- S-TLM-013: `check-telemetry-gate.mjs` 가 의도적 위반 (raw path 송출) 을 detect.
- S-TLM-014: PII 금지 — `TelemetryEvent` 의 모든 string 필드가 enum 또는 hash 임을 Vitest 로 reflective 검증.

## References

- `src/store/telemetry.ts:5,42~52` — `TelemetryConsent` union, `setConsent` 동작.
- ADR-0005 — *디폴트* 가 disabled (본 ADR 은 *모델* 만).
- ADR-0010 D-Telemetry — 셸 이벤트가 본 ADR 의 게이트 안에서만 발화.
- ADR-0012 Telemetry — 플러그인 이벤트가 본 ADR 의 동의 안에서만 송출.
