# ADR-0013 — Plugin Scope = Parser Only (v1) + VSCode/Cursor Export Compat

- **Status**: Accepted (2026-05-30)
- **Cycle**: CYC-01KSWHTW2ZTXRS3HSYGDBNSNX2 (T1 closure 실행)
- **Discovery**: T1 + T3 + H4 + H8 + H12 통합 결정
- **Supersedes (partial)**: PLAN-01KRE5JF06ES5SCMRMTE5SZHQN (v1.2 Custom Parser Platform) 의 plugin 호환성 미결정

## Context

Markspread v1 의 *플러그인* 범위와 VSCode/Cursor 마켓플레이스 호환 방향에 대한 결정. 디스커버리 T1 (가벼움 vs 플러그인 풍요) 과 T3 (자체 플러그인 vs VSCode 호환) 가 결합되어 본 결정으로 수렴.

## Decision

1. **Plugin scope (v1) = 런타임 파서만**
   - "파서" = 입력 텍스트 → 미리보기 변환 (HTML/SVG/컴포넌트) 모듈
   - 다른 plugin 카테고리 (테마, 스니펫, 언어서버, 디버거, AI 액션 등) v1 scope 밖
   - LLM 과 함께 사용자가 *런타임* 에 핫로드 (재시작 불필요)

2. **VSCode/Cursor 호환 = export only**
   - VSCode 플러그인을 Markspread 안에서 *설치* ❌
   - 여기서 만든 파서를 VSCode/Cursor `contributes.markdown` spec 호환 형태로 *export* ✓
   - 정체성 = "VSCode/Cursor 마켓플레이스 파서를 *만드는* 에디터 + 만드는 동안 즉시 보는 에디터"

3. **확장 가능 정의**: "마크다운 + 활성화된 파서 플러그인의 대상 확장자 = 문서 (편집 가능). 나머지 = 코드 (read-only)" — ADR-0014 와 결합.

## Rationale

- **Cursor / VSCode 의 무거움 원인** = plugin 카테고리의 무제한 확장. 본 도구는 *파서 한 카테고리* 로 제한해 가벼움 보장.
- VSCode 플러그인 *설치* 흡수 시 정체성이 "VSCode 일변종" 으로 수렴 → 차별축 소실 (T3).
- *export 방향* 채택 시 VSCode/Cursor 사용자 풀을 *우리 도구로 유입* (그들이 우리 도구로 파서 개발 후 자기 마켓플레이스 배포).
- LLM 시대 = 사용자가 직접 파서 작성. 결정적 미리보기 도구로 빠르게 검증·반복.

## Consequences

- ADR-0012 (Runtime Plugin Security Model) D3 의 plugin lifecycle 은 파서 한정으로 simplification.
- 기존 `vscode-compat.ts` (MAR-1021, import 방향 translator) 는 export 방향으로 재구조화 필요 (TASK-01KSVPRM7GT5ZBVKA68K9Z6NZ0).
- Plugin 진단 패널, BudgetManager, LazySpawner, IdleReaper, ResurrectQueue 구현 필요 (TASK-01KSVPRM7TGX45RGGEJPG0AC5K).
- ADR-0014 (문서/코드 비대칭) 의 "활성 파서 대상 확장자 자동 승격" 로직과 결합.

## Alternatives Considered

- **A. 자체 마켓플레이스 풀 운영**: 본인 1인 운영 + 거래량 0 시작 = 불합리.
- **B. VSCode 플러그인 import 만 (read-only 호환)**: 정체성 흡수 위험 + 사용자 가치 미흡.
- **C. 양방향 import+export**: 운영 부담 2배 + 정체성 흐림.
- **D. 자체 포맷 only (호환 X)**: 생태계 분리 → 시장 진입 어려움.
- ✅ **E. Export only**: 본 결정.

## Related

- ADR-0012 — Runtime Plugin Security Model
- ADR-0014 — Document/Code Asymmetry (T2 closure)
- ADR-0016 — Parser Safety Model (T5 closure)
- CONTEXT.md §5.7, §6
- `.claude/discovery/markspread-discovery.md` — H4, H8, H12
- TASK-01KSVPRM7GT5ZBVKA68K9Z6NZ0 (vscode-compat 방향 전환)
- TASK-01KSVPRM7TGX45RGGEJPG0AC5K (PluginHost 모듈 확장)
