# ADR-0019 — 2-Mode Shell IA (Workspace + Parser Studio) + Parser Workbench

- **Status**: Accepted (2026-05-31)
- **Cycle**: CYC-01KRP76JH8KE7HQXT54TX3HV95
- **Discovery**: 사용자 발의 (활동바식 모드 전환) → spike·tension·revise → (D) 2모드 + 파서 워크벤치 채택. 잔여 텐션은 페르소나 근거로 결정.
- **Supersedes (부분)**: ADR-0010 라우팅 매트릭스의 ChatShell/EditorShell 이중 셸 (`preferredShell` 토글).

## Context

사용자 관찰 두 가지에서 출발:
1. 런타임 파서가 *주요 기능*인데 **모달**로 제공됨 — 파서 개발은 *코드 작성 → 파싱 테스트 → 미리보기 → 수정*의 반복 루프라 일회성 모달과 구조적으로 불일치.
2. 현재 `ChatShell`(Agent-Chat-First)과 `EditorShell`이 **둘 다** 트리+에디터+프리뷰를 그리며 `preferredShell`("Switch to Editor Shell")로 토글 — 같은 표면의 중복. (이 중복 표면에서 `EditorPane` StrictMode 로드 고착 버그도 발생.)

VSCode/Cursor의 좌측 활동바(activity bar)식 모드 전환을 차용하되, 모드 수와 컴포넌트 공유 범위를 결정.

## Decision

### 1. 2-Mode IA + 활동바 (T1·T6 closure)

좌측 상시 **활동바(rail)** 로 모드 전환. 모드는 **2개**, 파서는 모드가 아닌 **워크벤치 표면**:

```
AppShell (rail 상시)
  ├─ ▦ Workspace    : FileTree(공유) + 문서(미리뷰/편집) + Chat(토글)
  ├─ ▣ Parser Studio: 파서 코드(편집) + 라이브 프리뷰 + Chat(파서 스코프)
  └─ ⚙ Settings
singleFile → rail 없는 플로팅 1문서 (P-reviewer 동선, 특수 유지)
```

- **"Edit"는 독립 모드 아님** — 코드는 read-only(ADR-0014 T2 B+D), md 편집은 드래그-채팅이 핵심 동작이므로, "Edit"는 Workspace에서 *Chat 패널을 접은 상태*일 뿐. 별도 모드로 분리하면 이중 셸 중복이 재생산됨.
- **ChatShell/EditorShell 통합** → 단일 **Workspace** 셸 + Chat 토글. `preferredShell` 개념 폐기. ADR-0010 라우팅의 chat/editor 분기 제거.

### 2. Persona → Mode

| | ▦ Workspace | ▣ Parser Studio |
|---|---|---|
| P-self (도그푸드) | ✅ | ✅ (자작 파서, local trust) |
| P-nondev | ✅ | — (마켓플레이스 import만) |
| P-reviewer | ✅ | — (소비만) |
| P-hybrid | ✅ | — (소비만) |

Parser Studio는 **P-self 전용 표면**. 이 niche성이 아래 T2·T5 결정의 근거.

### 3. Parser Studio = 파서 모달 대체 워크벤치 (T5 closure)

- 기존 `CreateParserDialog`(모달) → **Parser Studio**(3-pane 워크벤치: 파서 코드 편집 | 샘플 md 라이브 프리뷰 | Chat).
- **범위 판정**: Parser Studio는 U4(런타임 파서 커스터마이징)의 **완성**으로 간주 → v1 포함. "런타임 파서"를 정의 범위에 넣은 이상, 반복 개발 표면이 없으면 그 범위가 미완(P0 — 정의 범위는 완성). *새 범위 확장이 아님* — 모달이 하던 일을 올바른 표면으로 옮기는 것.

### 4. 컴포넌트 공유 (T3·T4 closure)

- **FileTree**: 단일 컴포넌트 공유. 상태(collapse/선택)는 *워크스페이스 컨텍스트별* persist, **모드 전환에 리셋 안 됨**(▦↔▣ 오가도 유지). 분할별 독립 트리(P-self, ADR-0011)는 그 위에 직교 유지.
- **Chat**: 단일 컴포넌트 공유, **세션은 표면별 분리**. Workspace Chat = "이 문서/워크스페이스 질문"; Parser Studio Chat = "이 파서 빌드/수정". 세션 store는 surface scope로 키잉.

### 5. 활동바 노출 규칙 (T2 closure)

- ▦ Workspace, ⚙ Settings = **상시**.
- ▣ Parser Studio = **조건부** — `개발자 모드` 설정 ON *또는* local trust 파서가 1개 이상 존재할 때만 rail에 등장. P-nondev/reviewer 기본 화면은 ▦/⚙만 (잡음 제거). P-self는 첫 자작 파서 등록 즉시 자동 등장.

### 6. `+ Parser` 진입 동선 (T7 closure)

- Workspace Chat의 `js` 코드블록 옆 버튼: "파서로 만들기" → **Parser Studio 열림(소스 prefill) + 돌아가기 breadcrumb**. (모달 prefill → 모드 전환 prefill로 승격.)
- 운반은 *소스 prefill만*, 풀 채팅 세션은 안 이어감(T4 일관).
- P-nondev는 JS 블록 자체를 드물게 보므로 이 동선은 자연히 희소 — 갑작스러운 모드 전환 빈도 낮음.

## Consequences

### 긍정
- 이중 셸 중복 제거 → 유지보수 표면 1개. EditorPane 로드 고착 버그가 난 중복 표면 자체가 사라짐(통합 시 재구현).
- 파서 개발이 반복 루프에 맞는 표면을 얻음(모달 탈피).
- 활동바 = VSCode/Cursor 사용자에게 친숙한 멘탈모델.

### 비용 / 영향 범위
- `App.tsx` 라우팅 재작성 (chat/editor 분기 → rail 모드 라우터).
- `ChatShell`+`EditorShell` → `WorkspaceShell` 통합 (FileTree/Chat/Preview를 공유 패널로 추출).
- `CreateParserDialog` → `ParserStudio` 표면으로 재구성 (기존 dialog 로직·테스트 이관).
- 새 store: `useActivityMode`(현재 모드), Chat 세션 store에 surface scope 추가.
- 활동바 컴포넌트 신규 + 조건부 노출 로직.
- 100% 커버리지 게이트 유지 필요 — 통합/신규 표면 전부 테스트 동반.

### 비-목표 (gold-plating 방지)
- Workspace에 "코드 편집" 추가 안 함 (ADR-0014 T2.f 유지 — 코드 read-only).
- 3번째 모드 추가 안 함.
- 활동바 커스터마이징(아이콘 재배치 등) v1 scope 밖.

## 잔여 신호 (v2 디스커버리 후보)
- P-self 외 페르소나가 Parser Studio를 여는 빈도 → 0에 수렴하면 조건부 노출 정당, 유의미하면 상시 노출 재고.
- Workspace Chat ↔ Parser Studio Chat 세션 분리가 맥락 점프 비용을 유발하는지(T4 재방문 트리거).
