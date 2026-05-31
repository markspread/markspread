# Persona Scenario — P-reviewer (Claude Code 산출물 리뷰자)

> **Linked Persona**: CONTEXT.md §4 P-reviewer · ADR-0018
> **만족도**: ✅ 완전

## Persona Summary
- 개발자 본인이나 코드보다 *문서 비중* 이 높음.
- Claude Code 가 만든 ADR, RFC, 기술 명세, PR 설명 등 산출 문서를 면밀히 검토.
- 자기 손으로 다 작성하지 않고 *결정* 이 핵심 행위.

## 하루 한 장면

오전 10시. 슬랙 알림: "Claude Code 가 `chain-pulse` repo 에 ADR-0024 작성 완료." 회의까지 12분 남았다.

```
$ markspread ~/dev/chain-pulse/docs/adr/0024-event-bus-isolation.md
```

본 도구가 *문서 하나만* 로드되며 즉시 뜸 (전체 워크스페이스 열지 않아도 됨). md-only 모드 + read-only 형태로 ADR 본문이 spread pane 에 깔끔히 렌더.

본문에 mermaid 시퀀스 다이어그램이 있다. mermaid 파서 (`local` 또는 imported trust level) 가 활성 — 렌더 OK. 다이어그램의 한 노드 선택 → 드래그-채팅 *"이 흐름이 PR-1842 와 정합?"* 입력.

Claude Code SDK in-process 가 PR-1842 fetch (`gh` 도구 위임) → 비교 분석 → diff 형태로 *문제 지점* 표시. 본인은 ADR 문서로 돌아가 한 단락 선택 → *"이 부분에 retry policy 명시 추가"* 채팅 → 인라인 diff 등장. Cmd+R 한번 더 (다시 — 다른 톤으로) → 더 마음에 듦. Enter accept.

`git add . && git commit -m "ADR-0024: retry policy 명시 추가"` 는 그냥 터미널에서 (본 도구가 git 통합 안 하는 게 P0 의 가벼움 약속과 정합).

회의에 6분 남음. ADR 그대로 슬랙 공유 — 또는 *Publish* 버튼 클릭. $10/mo subscriber 라서 즉시 publish 됨 (`adr-0024.markspread.app` 또는 사용자 도메인). 회의 참석자에게 URL 만 던지면 끝 (AI 코멘트·diff 이력 함께 표시).

## 만족 매트릭스 검증

| 요구 | 결정 ID | 충족 |
|---|---|---|
| 빠른 단일 문서 진입 | H14 | ✅ CLI 한 줄 |
| AI 리뷰 깊이 | H13, ADR-0010, ADR-0014 | ✅ 드래그-채팅 + Claude SDK 도구 위임 |
| 코드 (PR 등) 함께 보기 | T2 B+D | ✅ 전체 보기 토글 시 코드 read-only |
| 결정한 결과 외부 공유 | ADR-0015 Publish | ✅ Publish 서비스 (옵션) |
| 가벼움 (회의 직전 진입) | H7 | ✅ 단일 문서만 로드, 트리 없음 OK |
| AI 자동 도구 사용 | ACP/SDK 통합 | ✅ gh CLI 등 위임 |

## 확장 신호 (v2 디스커버리 입력 후보)
- 단일 문서 진입이 잦다 = "워크스페이스 없는 *플로팅 문서* 모드" 가 v1 의 *워크스페이스 첫 진입* 보다 더 자주 호출되는가?
- Publish 의 *AI 코멘트 이력 노출* 정말 회의 참석자에게 가치 있는지 — 시그널 필요.
- mermaid 외에 자주 쓰는 다이어그램 도구 (Excalidraw, draw.io) 통합 요구가 나오는지.
