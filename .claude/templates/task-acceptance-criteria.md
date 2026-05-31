# Task Acceptance Criteria Template

> **목적**: 모든 Markspread Clawket task 의 본문 (body) 작성 시 사용. 디스커버리 직전 본인이 지적한 *문서 부족 + AC 부재* 결핍을 해소하기 위한 표준 양식.
>
> **사용법**: `clawket task create ... --body "$(cat <<'EOF' ... EOF)"` 형식으로 적용. 또는 task body 작성 시 아래 섹션 참조.

---

## (1) Acceptance Criteria — 무엇이 충족되면 done 인가

**측정 가능 + 검증 가능한 형태로 작성**. "잘 동작한다" 같은 모호 표현 ❌.

예시:
```
AC1. `<project>/.claude/discovery/markspread-discovery.md` 의 H{n} 항목이 본 task 산출과 일치
AC2. 신규 vitest 테스트 `src/lib/parsers/__tests__/*.test.ts` 3건 추가, 모두 통과
AC3. 코드 변경 라인이 perf 회귀 측정 (perf-stats.jsonl) 에서 5% 이상 악화 없음
AC4. 변경 후 `pnpm build` 가 15MB 번들 한도 (CONTEXT.md §3 가벼움) 안에 들어옴
AC5. CONTEXT.md 의 관련 섹션 (예: §X.Y) 가 본 task 결과를 반영하도록 update
```

## (2) Scope — 영향 받는 Scenario ID

본 task 가 어느 페르소나 시나리오의 충족점에 닿는지 명시.

예시:
```
- persona-self.md — 만족 매트릭스 H5 (분할별 독립 파일트리)
- persona-nondev.md — 만족 매트릭스 ADR-0016 (다층 방어)
- 새 시나리오 추가 필요 (없으면 작성 task 별도)
```

## (3) Contract Changes — 변경되는 contract

본 task 가 변경하는 *모듈 경계·invariant·schema·외부 인터페이스*.

예시:
```
- `src/lib/plugins/runtime/host.ts` PluginHost 의 `install()` 시그니처에 `trustLevel` 파라미터 추가
- ADR-0012 D3 의 lifecycle state 에 `suspended` 추가
- IPC schema `plugin.install` payload 에 `trust_level: 'local' | 'llm-generated' | 'imported'` 필드 추가
- 기존 vitest 의 fakeWorkerFactory mock 시그니처 호환 깨짐 — 호출자 모두 update
```

## (4) Out of Scope — 명시적으로 안 하는 것

P0 (gold-plating 방지) 위반 회피. *주변 정리·refactor·미래 대비* 같은 것을 명시적으로 제외.

예시:
```
- 본 task 에서는 trust level UI 아이콘 렌더링 안 함 (별도 task)
- 다른 plugin lifecycle hook 추가 안 함
- 기존 worker factory 의 `factory()` 시그니처 변경 안 함 (호환 유지)
```

## (5) Evidence — done 전환 시 필수 입력

clawketd 가 `EVIDENCE_REQUIRED` 강제. 형식:
- `file:line` 참조 (예: `src/lib/plugins/runtime/host.ts:142-198`)
- 또는 자유 텍스트 reasoning summary (예: "AC1-5 모두 충족. vitest 27/27 pass. bundle size 12.4MB (한도 15MB 내).")

`clawket task update <ID> --status done --evidence "..."` 로 입력.

## (6) Discovery Linkage (선택)

본 task 가 디스커버리 결정 (H/T) 의 직접 구현이라면 linkage 명시.

예시:
```
- 구현: H4 (런타임 파서 핫로드, ADR-0013)
- 영향: T5.c (BudgetGuard, ADR-0016)
- 검증: persona-self.md 만족 매트릭스 H7 라인
```

---

## 권장 task body 골격

```markdown
## AC
AC1. ...
AC2. ...

## Scope
- persona-{self,reviewer,hybrid,nondev}.md — ...

## Contract Changes
- ...

## Out of Scope
- ...

## Discovery Linkage
- ...
```

이 양식을 일관 적용하면:
- task done 전환 시 evidence 가 *자동으로 측정 가능* (AC ↔ evidence mapping).
- 회귀 검증 (multi-round audit) 시 *이 task 가 어느 시나리오의 어느 충족점에 닿는가* 즉시 추적 가능.
- 미래 디스커버리 v2 회차에서 *어느 결정이 어느 task 로 구현됐는가* traceability matrix 자동 구축.

---

## Origin (이 템플릿 자체의 도그푸딩)

본 템플릿은 2026-05-30 디스커버리 직전, 본인이 *"실제 개발·테스트·회귀 검증할 때 문서가 너무 부족"* 이라고 지적한 메타 결핍의 해소책. P1 도그푸딩의 환원 — 결핍 발견 → 즉시 메타 자산화. v2 디스커버리 회차에서 사용성·실효성 재평가.
