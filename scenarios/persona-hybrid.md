# Persona Scenario — P-hybrid (코드+문서 병행 개발자)

> **Linked Persona**: CONTEXT.md §4 P-hybrid · ADR-0018
> **만족도**: ⚠ **부분** (명시 수용) · ADR-0014 의 외부 위임 버튼 거부 (T2.f) 로 인한 한계.

## Persona Summary
- 개발자 + 문서 작업 비중 50/50.
- 코드 수정 자주 필요. 마크다운만으로 부족함을 직접 느낌.
- VSCode/Cursor 와 본 도구 사이를 자주 왕복.

## 하루 한 장면

오후 2시. `auth-service` repo 에서 OAuth 흐름 리팩토링 진행 중. JIRA 티켓 + ADR 문서 + 코드 변경이 함께 굴러간다.

```
$ markspread ~/dev/auth-service
```

본 도구로 ADR 작성: `docs/adr/0042-oauth-pkce-migration.md` 신규. 드래그-채팅 편집으로 빠르게 *문서* 초안 완성. PR 머지하기 전에 *코드 구현* 도 같이 봐야 한다.

파일트리 전체 보기 토글 → `src/auth/oauth.ts` 클릭 → CodeMirror 6 read-only viewer. syntax highlight 만, 편집 X. 본인이 `src/auth/oauth.ts:142` 의 redirect_uri 검증 로직을 *수정* 하고 싶다.

옵션 1: **Claude Code SDK in-process 위임** — 채팅에 *"src/auth/oauth.ts 142번 줄 redirect_uri 화이트리스트 검증 추가"* 입력. Claude Code agent 가 그 자리에서 코드 변경. 본인은 변경된 코드를 본 도구 view 에서 확인 (자동 새로고침).

옵션 2: **외부 터미널에서 VSCode/Cursor 열어 직접 수정** — `code src/auth/oauth.ts`. 본 도구 가 "VSCode 로 이 파일 열기" *전용 버튼* 을 제공하지 않음 (T2.f 거부) — 본인이 직접 OS 레벨로 처리해야.

본인 평가: AI 위임이 빠를 때도 있고 (단순 추가), 직접 수정이 빠를 때도 있음 (복잡 로직 + AI 가 못 따라옴). 본인 의 *왕복 비용* 이 살짝 남음 — 이게 본 도구의 부분 만족 한계.

ADR 다시 본 도구로 와서 마무리 (코드 변경 결과 반영). `docs/adr/0042-oauth-pkce-migration.md` 의 *"## Implementation"* 섹션 드래그 → *"방금 코드 변경 내용 요약해서 채워줘"* → 인라인 diff → accept.

## 만족 매트릭스 검증

| 요구 | 결정 ID | 충족 |
|---|---|---|
| 문서 작성 + AI 협업 | H13 | ✅ |
| 코드 보기 | T2 B+D | ✅ read-only |
| **코드 수정** | T2.f (외부 위임 버튼) | ❌ **거부** — AI 위임 또는 OS 직접 |
| AI 가 코드 수정 위임 (Claude Code SDK) | ADR-0004 + 5.2 | ✅ |
| 가벼움 | H7 | ✅ |
| 다중 워크스페이스 | H2 | ✅ |

## 부분 만족의 명시 수용

- T2.f 의 "외부 위임 버튼 미제공" 결정은 본 도구의 *정체성 자기부정 회피* (= "여기서 할 수 있는 일을 다른 도구에 떠넘기지 않는다") 가 우선.
- P-hybrid 가 v1 출시 후 *주요 사용층* 으로 드러나면 ADR-0018 의 v2 디스커버리 트리거 발동 → 외부 위임 버튼 재고 또는 *블록 단위 AI 편집* 으로 확장.

## 확장 신호 (v2 디스커버리 입력 후보)
- P-hybrid 가 본 도구를 *주로 ADR/문서 도구* 로 쓰고 코드는 다른 데서 한다면 부분 만족 받아들임.
- P-hybrid 가 본 도구를 코드 *수정* 도 하려고 시도하면서 매번 막힌다면 = 외부 위임 또는 inline edit 재고 필요.
- AI 위임의 신뢰성 (Claude Code SDK 결과 검증 비용) 시그널 — 이게 높으면 외부 직접 편집 수요 증가.
