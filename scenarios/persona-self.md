# Persona Scenario — P-self (다중 프로젝트 운영자, dogfood origin)

> **Linked Persona**: CONTEXT.md §4 P-self · ADR-0018
> **만족도**: ✅ 완전 · **Origin**: 본인 (swlee@mz.co.kr) — dogfood 1번 사용자.

## Persona Summary
- 메인 PC 20+ repo, 서브 PC 4-5 repo 동시 운영.
- 작업은 기분·우선순위에 따라 산발적 진행. 한참 후 다시 와서 산출물 점검.
- Cursor 의 메모리 강제종료가 가장 큰 차단 issue.
- LLM 시대에 *지식베이스 관리 + 문서 리뷰* 가 본질로 이동.

## 하루 한 장면

화요일 오후, 카페에서 노트북을 연다. 어제 Claude Code 가 `wireweave-engine` repo 에서 만든 DSL 파서 산출물을 확인해야 한다.

```
$ markspread ~/dev/wireweave-engine
```

본 도구가 즉시 뜬다 (Cursor 대비 1/10 시간). 좌측에 워크트리 자동 인식 — `main`, `feat/dsl-v2`, `feat/parser-rewrite` 세 워크스페이스가 자동 탭으로 열려 있다. 어제 `feat/dsl-v2` 에서 작업했으니 거기 탭으로 들어간다.

파일트리는 **md-only 모드** (default). `node_modules/`, `target/`, `.git/` 은 `.gitignore` 로 숨김. ADR 폴더와 `README.md`, `docs/dsl-spec.md` 만 보인다. 깔끔.

`docs/dsl-spec.md` 클릭 → 우측 spread pane 에 미리보기. 본인이 만든 `wireweave` 코드블록이 *제대로 렌더* 됨 — 본인이 직접 작성한 wireweave 파서 플러그인이 `local` trust level 로 활성됐기 때문 (🔓 아이콘).

문서 중간 단락 선택 → 채팅에 자동 컨텍스트 주입. *"이 구조 도식 좀 풀어서 다시 써줘"* 입력. AI 응답이 그 위치에 인라인 diff 로 나타난다. Enter — 수락.

코드 분기 어떻게 됐는지 보고 싶다. 파일트리 헤더의 📁 아이콘 클릭 → **전체 보기** 토글. `src/parser.ts` 보인다. 클릭 → CodeMirror 6 read-only viewer 로 syntax highlight 만 뜸 (typescript lang module lazy load — 첫 .ts 라 약간 다운로드). 본인은 *수정 안 함, 리뷰만*. 만약 한 줄 고치고 싶으면 채팅에 *"src/parser.ts 의 normalize() 함수에 trim 추가해줘"* 위임 — Claude Code SDK 가 작업.

분할 → `feat/parser-rewrite` 워크트리도 같은 창에서 동시 본다. 분할 화면별 *독립 파일트리* (collapse 상태 다름) 가 알아서 유지된다. 메모리 사용량 진단 패널은 default 꺼져 있음 — 본인은 가끔 설정에서 켜서 확인 (P-self 신뢰).

작업 완료. Cmd+W 로 창 닫음. 다음에 열면 토글·탭·분할 상태 모두 복원.

## 만족 매트릭스 검증

| 요구 | 결정 ID | 충족 |
|---|---|---|
| 가벼움 (Cursor 강제종료 해소) | H7, ADR-0013 | ✅ Lazy spawn + 100MB budget + worker isolation |
| 다중 워크스페이스 동시 | H2, ADR-0011 | ✅ 워크트리 자동 탭 + 분할 |
| 분할별 독립 파일트리 | H5 | ✅ collapse 상태 분할별 persist |
| 한참 후 빠른 진입 | H14 | ✅ CLI `markspread <path>` + OS association |
| 본인 워크플로 그대로 흡수 | P1 도그푸딩 | ✅ md-viewer 스킬 → 본 도구 격상 |
| 자가 만든 파서 즉시 미리보기 | H4 | ✅ 런타임 핫로드 + local trust level |
| AI 협업 깊이 | H13, ADR-0010 | ✅ 드래그-채팅 + Claude SDK in-process |
| 리뷰는 가볍게, 수정은 강력하게 | T2 B+D | ✅ 코드 read-only, md 강력 편집 |

## 확장 신호 (v2 디스커버리 입력 후보)
- 워크트리 N개 (예: 20+) 일 때 탭 한계 — 그룹화·검색?
- 파서 plugin 누적 시 trust level imported 갈 일 거의 없음 (본인이 직접 작성). 외부 import 사용 신호 약함 = scope 재검토?
- Sync 의 *세션 이력* 동기화 가치 — 본인은 PC 간 작업 이력 따라가는지?
