# ADR-0017 — Development Order Policy: Pre-2026-06-15 LLM-Heavy Priority

- **Status**: Accepted (2026-05-30)
- **Cycle**: CYC-01KSWHTW2ZTXRS3HSYGDBNSNX2 (T6 closure 실행)
- **Discovery**: T6 reframe + H11

## Context

Claude Code SDK 가 2026-06-15 부로 정식 지원되며 구독플랜 사용량과 *분리된* 월간 크레딧 ($100/$200/$200) 으로 전환. 그 이전엔 SDK 가 구독플랜 무제한 활용 가능 (Anthropic 비공식 인지). 이 변화가 본 도구 *출시 일정* 또는 *제품 의사결정* 에 어떻게 작용하는가의 결정.

## Decision

### 1. 6/15 = *본인 개발 비용* 데드라인. 제품 출시 일정 무관.

| 항목 | 누구 비용 | 영향 |
|---|---|---|
| 6/15 이전 SDK 무제한 | 본인 개발자 비용 | 본인 productivity |
| 6/15 이후 크레딧 한도 | 본인 개발자 비용 | 본인 productivity 저하 가능 |
| 본 도구 *사용자* LLM 비용 | 사용자 (BYOK or 본인 Claude 구독) | 무관 — 6/15 이후 *정식 지원* = 오히려 좋아짐 |
| 본 도구 *출시 일정* | P0 (완성 시점) | 무관 |

### 2. P0 무위반 — 단계별 출시 ❌

본 결정은 *단계별 출시* 가 아니라 *내부 개발 *순서* 결정*. 출시는 v1 완성 시 1회.

### 3. 개발 순서

| 기간 | 우선 작업 (예시) |
|---|---|
| **6/15 이전 LLM-heavy** | 채팅 셸 (H9) 재설계 · 드래그-채팅 편집 (H13) · 파서 LLM 협업 워크플로 (H4) · AI 통합 전반 (BYOK/SDK/ACP 라우팅) · H15 LLM 자동 검증 부분 |
| **6/15 이후 LLM-light** | 멀티 워크스페이스 UI · 파일트리 (md-only/전체) · Sync/Publish 인프라 · 다층 ignore · CLI 진입 · OS file association · CodeMirror read-only viewer |

### 4. 6/15 이후 지속 개발 가능

- 본인 입장: BYOK API key 병행 + Claude.ai 구독 한도 안에서 계속.
- 속도 감속 가능성 인지, 정지는 X.
- 본인 추정: 2주 내 v1 개발 가능 (LLM-heavy 묶음 6/15 이전 충분히 완료 예측).

## Rationale

- 데드라인 소유자 = 본인 개발 비용. *제품* 또는 *사용자* 의 데드라인 아님.
- P0 (완성 우선) = 출시 일정을 *시간 제약* 으로 깎지 말 것. 본 결정은 그 위배 X.
- 6/15 이후 *정식 지원* 으로 사용자 경험은 오히려 개선.

## Consequences

- U10 task 2 (TASK-01KSWDWG6Q6VD17G6HS2N024N3) = U6/U7/U9 의 LLM-heavy task 식별 후 우선순위 critical 로 승격.
- 출시 KPI 와 6/15 일정 분리 명시.
- 향후 유사 *외부 정책 변화* 가 발생할 때 본 ADR 의 reframe 패턴 (누구 비용? 누구 데드라인?) 재사용.

## Related

- ADR-0004 — Claude Agent SDK Subscription Auth
- CONTEXT.md §11
- TASK-01KSWDWG6Q6VD17G6HS2N024N3 — LLM-heavy 묶음 재정렬
