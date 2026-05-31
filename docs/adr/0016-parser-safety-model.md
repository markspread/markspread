# ADR-0016 — Parser Safety Model (다층 방어 + Trust Levels + Publish Strict)

- **Status**: Accepted (2026-05-30)
- **Cycle**: CYC-01KSWHTW2ZTXRS3HSYGDBNSNX2 (T5 closure 실행)
- **Discovery**: T5 + H15
- **Builds on**: ADR-0012 (Runtime Plugin Security Model) — *실행 환경 격리*
- **Adds**: *기능적 안전성* layer

## Context

ADR-0012 의 워커/iframe 격리는 RCE 차단 (실행 환경 안전). 그러나 LLM 이 생성한 파서는 *기능적* 으로 잘못된 출력 가능 (xss-like, 악성 SVG, 무한 루프, 잘못된 파싱). P-nondev (비개발자 페르소나) 는 코드 한 줄 한 줄 검증 불가 — 자동 검증 layer 필요.

## Decision

**다층 방어** (T5: B+C+D+F+G 조합. A·E 거부).

### 1. Trust Level 3단계 (G)

| Level | 의미 | 정책 |
|---|---|---|
| `local` | 본인 직접 작성 | 모든 권한, 활성 동의 다이얼로그 skip |
| `llm-generated` | LLM 작성 | Validator + Sanitizer + BudgetGuard + 활성 동의 모두 적용 |
| `imported` | 외부 import | `llm-generated` + 더 엄격 (Sanitizer strict 강제) |

UI: 파일트리·플러그인 패널에 미니 아이콘 🔓 / 🤖 / 🔒.

### 2. Validator — 작성 시점 AST 정적 분석 (B)

- 차단 패턴:
  - `eval`, `new Function`
  - 직접 DOM 조작 (`document.write`, `innerHTML` 직접 할당)
  - 의도 외 `fetch` / `XMLHttpRequest`
  - 무한 루프 heuristic (보수적)
- false positive 시 사용자 override 가능 (단 `local` trust level 만).

### 3. Sanitizer — 출력 sanitization (C)

- **DOMPurify** + Markspread strict allowlist.
- 로컬 미리보기: toggle 가능 (사용자 의도 명시 시 strict 해제).
- Publish 사이트 (외부 방문자): **강제 strict, toggle 불가**.

### 4. BudgetGuard — 자원 budget 강제 (D, T1 BudgetManager 와 결합)

| 환경 | 실행 시간 cap | 메모리 |
|---|---|---|
| 로컬 미리보기 | 100ms | T1 의 100MB total 공유 |
| Publish strict | **50ms** | 동일 |

초과 = 자동 suspend + UI 에러 표시 (silent ❌).

### 5. 활성 동의 (F)

- *신규* 파서 활성 시점에 *1회* 다이얼로그.
- 수정마다 X (마찰 너무 큼).
- 다이얼로그 내용:
  - AI 생성 한 줄 요약
  - "전체 코드 보기" 토글
  - Accept / Reject 버튼
- `local` trust level = 다이얼로그 skip.

### 6. Publish strict mode (T5.f)

- Publish 된 사이트 = *외부 방문자 = 우리 책임* → 타협 X.
- Sanitization toggle 비활성 (강제 strict).
- BudgetGuard 50ms (로컬 100ms 보다 타이트).
- ADR-0015 Publish 서비스의 운영 책임 일부.

## Rationale

- **A (격리만 신뢰)** 거부: P-nondev 명시 페르소나 — 격리만으로 부족, 책임 전가 불가.
- **E (LLM 자동 리뷰)** 거부: LLM 이 LLM 평가 = 신뢰성 한계 + 비용. B+C+D+F 조합으로 충분.
- 다층 방어 = 단일 layer 실패 시 다음 layer 가 catch.
- Trust level 도입 = 사용자 의도 반영 (본인 직접 작성한 파서는 신뢰).

## Consequences

- 신규 모듈:
  - `src/lib/plugins/runtime/validator.ts` — AST 정적 분석
  - `src/lib/preview/sanitizer.ts` — DOMPurify + allowlist
  - PluginHost 의 BudgetManager (ADR-0012 D3) 확장 — 시간 cap 추가
  - `src/lib/plugins/runtime/trust-registry.ts` — 3단계 레벨 관리
  - 활성 다이얼로그 컴포넌트
- 의존성 추가: **DOMPurify** (소형).
- Publish 서비스 (ADR-0015) 의 sanitization 강제 정책 통합.

## Related

- ADR-0012 — Runtime Plugin Security Model (실행 환경 격리)
- ADR-0013 — Plugin Scope = Parser Only
- ADR-0015 — Revenue Model (Publish layer 의 운영 책임)
- CONTEXT.md §6.2, §8
- U9 task 들 (TASK-01KSWCHK*)
