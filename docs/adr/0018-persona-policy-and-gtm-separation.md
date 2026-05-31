# ADR-0018 — Persona Policy + GTM Separation + v2 Discovery Trigger

- **Status**: Accepted (2026-05-30)
- **Cycle**: CYC-01KSWHTW2ZTXRS3HSYGDBNSNX2 (T7 closure 실행)
- **Discovery**: T7 reframe

## Context

P0 "정의 범위 안 모두 만족" 원칙에서 페르소나도 *전원 만족* 이 자연 귀결. 그러나 자원 배분 현실 (P-self 만족 = niche / P-nondev 포함 = UX 난이도 폭증) 의 압력은 남음. T1-T5 closure 의 결정 매트릭스가 이미 4 페르소나 만족 구조 도출 — T7 자체는 *가짜 텐션*.

## Decision

### 1. v1 = 4 페르소나 모두 만족 (T1-T5 closure 로 도출 완료)

| 페르소나 | 만족도 | 핵심 충족점 |
|---|---|---|
| **P-self** (다중 프로젝트 운영자 20+ repo) | ✅ 완전 | 가벼움 + 멀티 워크스페이스 + 워크트리 + dogfood origin |
| **P-reviewer** (Claude Code 산출물 리뷰자) | ✅ 완전 | AI-native 리뷰 셸 + 드래그-채팅 편집 |
| **P-hybrid** (코드+문서 병행) | ⚠ 부분 (수용) | 코드 read-only. 편집은 외부 도구 또는 AI 위임. *T2.f 외부 위임 버튼 거부 사유 유지* |
| **P-nondev** (비개발자, 터미널 기피) | ✅ 완전 | CLI 없이 OS 더블 클릭 + 드래그-채팅 + trust level 다이얼로그 + Publish |

### 2. GTM = *제품 디스커버리 범위 밖*

- 어느 페르소나부터 알리는가, 채널, 카피 = *마케팅 결정*.
- 제품 v1 출시 완성 후 별도 *GTM 디스커버리 회차* 진행.
- 본 ADR 범위에서는 GTM 결정 안 함.

### 3. v2 Discovery Trigger

**v1 출시 후 1-3개월 사용 신호 누적** 시 별도 디스커버리 회차 (v2).

근거:
- P1 (도그푸딩 always) — 본인 사용 + 외부 사용자 시그널이 다음 회차 입력.
- 신호 항목 예: 페르소나 비중, P-hybrid 부분 만족이 차단 issue 가 되는가, plugin 작성 빈도, Sync/Publish 전환율.

### 4. P-hybrid 재논의 조건

P-hybrid 가 v1 출시 후 *주요 사용층* 으로 드러나면 v2 에서:
- 외부 위임 버튼 (T2.f) 재고
- 또는 read-only 코드 뷰를 *블록 단위 AI 편집* 으로 확장
- 본 ADR 에서는 미결.

## Rationale

- P0 + T1-T5 결정 매트릭스 = 이미 모든 페르소나 만족 도출됨.
- "자원 배분 압력" = 제품 결정 아닌 *마케팅 자원* 압력 → GTM 회차로 분리.
- v2 트리거 명시 = 도그푸딩 루프의 *형식적* 결합점.

## Consequences

- 신규 시나리오 docs `markspread/scenarios/persona-{self,reviewer,hybrid,nondev}.md` 작성 필요 (U12 task 3).
- GTM 디스커버리 = v1 완성 후 트리거되도록 별도 cycle 또는 별도 plan 으로 분리.
- 만족도 매트릭스 = Acceptance Criteria 의 traceability 입력으로 사용.

## Related

- CONTEXT.md §4
- ADR-0013, ADR-0014, ADR-0015, ADR-0016 — 페르소나 만족 매트릭스의 기반 결정들
- TASK-01KSWHB0G43G78P55FBFQYN1EX (페르소나 시나리오 작성)
