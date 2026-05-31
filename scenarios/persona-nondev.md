# Persona Scenario — P-nondev (비개발자 기획자/디자이너)

> **Linked Persona**: CONTEXT.md §4 P-nondev · ADR-0018
> **만족도**: ✅ 완전

## Persona Summary
- 기획자·디자이너·교사·연구자 등 *코드 작성이 본업 아닌* 사람.
- 터미널·CLI 본능적 거부감 (DNA 차이 — 본인 표현).
- Claude Code 같은 코딩 에이전트 도구는 *간접* 사용 (예: 스킬 작성 의뢰, 결과만 활용).
- 마크다운은 쓰지만 *직접 파서 작성* 같은 건 못 함.

## 하루 한 장면

수요일 9시 30분. 디자인팀 PM 이 본인. 어제 디자이너가 *FigJam 워크숍 결과* 를 마크다운 노트로 정리해 공유. 본인이 정리해서 *팀 위키* 에 publish 해야 한다.

Finder 에서 `workshop-notes-2026-05-29.md` 더블 클릭. → 본 도구가 자동 실행 (OS file association, H14). 터미널 안 거치고도 자연 진입.

문서 진입 — 자동 미리보기. 본인은 채팅 패널에 *"이 노트의 액션 아이템만 표로 정리해줘"* 입력 (BYOK Claude API key 가 OS Keychain 에 1회 입력돼 있음 — 또는 본인 Claude.ai 구독으로 OAuth 연결). AI 응답이 그 위치에 인라인 diff. Enter — 수락.

문서 중간에 디자이너가 *FigJam 임베드 마크다운* 같은 비표준 블록을 넣었다. 본 도구는 인식 못 함 — *경고 토스트* 가 뜬다: *"이 형식은 파서 플러그인이 있으면 보입니다. 마켓플레이스에서 찾기?"* 클릭 → 갤러리에 *figjam-embed-md* (`imported` trust level — 🔒 아이콘) 가 있음. 설치 클릭.

**활성 동의 다이얼로그** 뜬다:
> 이 파서는 외부 import 입니다 (LLM 자동 검증 부분 통과). 코드 한 줄 요약: "FigJam 임베드 URL → 정적 스크린샷 + 노드 리스트". [전체 코드 보기 ▾] [Accept] [Reject]
본인은 *전체 코드* 안 봄 — 어차피 못 읽음. Accept 클릭.

파서 활성 → 미리보기에 FigJam 영역이 *예쁘게 렌더*. Sanitizer + BudgetGuard 가 자동 적용돼서 본인은 안전 검증 없이도 *위험 없이* 사용 (P-nondev 보호).

문서 정리 끝. **Publish** 버튼 ($10/mo subscriber) → 팀 위키 URL 받음. 슬랙에 던지면 끝. *외부 방문자* 가 그 페이지 볼 때는 strict 모드 (sanitizer + 50ms budget) 가 강제 적용.

## 만족 매트릭스 검증

| 요구 | 결정 ID | 충족 |
|---|---|---|
| 터미널 없이 진입 | H14 | ✅ Finder 더블 클릭 → OS file association |
| AI 협업 | H13, ADR-0004 | ✅ BYOK 또는 Claude OAuth |
| 비표준 마크업 지원 | H4 | ✅ 파서 플러그인 마켓플레이스 import |
| **안전 보장** (코드 못 읽음) | ADR-0016 H15 | ✅ 다층 방어 (Validator + Sanitizer + BudgetGuard + 활성 동의 + Trust Level) |
| 외부 공유 | ADR-0015 Publish | ✅ Publish 서비스, strict 모드 자동 |
| 가벼움·빠른 진입 | H7, ADR-0013 | ✅ 단일 문서 + Lazy spawn |

## 확장 신호 (v2 디스커버리 입력 후보)
- 활성 동의 다이얼로그의 "AI 한 줄 요약" 이 P-nondev 가 이해 가능한 수준인지 — UI 텍스트 검증.
- 마켓플레이스 import 빈도 vs LLM 으로 파서 *만들기* 빈도 — P-nondev 가 후자 시도하는가? (시도하면 LLM 협업 파서 워크플로 UX 의 P-nondev-친화도 검증 필요)
- BYOK API key 1회 입력 후 잊는 사용자 vs 매번 헤매는 사용자 — 후자 비율 높으면 *간소화 또는 자체 호스팅 LLM 게이트* 재고 (T4 거부 결정 재논의 트리거).
- Publish 의 *AI 코멘트 이력 노출* default — P-nondev 는 이력 *숨김* 을 더 원하는가? 토글 default 정밀 검토 필요.
