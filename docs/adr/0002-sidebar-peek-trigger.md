# ADR-0002: Sidebar Peek — activation triggers

| Field | Value |
|---|---|
| Status | **Accepted** (S-SBP-001 · MAR-864) |
| Date | 2026-05-13 |
| Owners | Editor Ergonomics unit (F2) |
| Supersedes | — |
| Superseded by | — |
| Related | `src/components/SidebarPeek.tsx` (planned, S-SBP-002), `src/screens/Main.tsx` rail (S-SBC-003), `src/lib/keybindings/`, F2 unit (S-SBP-002 ~ S-SBP-010) |

## Context

F1 가 사이드바를 완전히 접는/펴는 영구 상태를 다뤘다면, F2 는 **잠깐 펴서 본다** 의 경량 모드를 다룬다. VSCode 의 "Activity Bar peek" / "Explorer overlay", Cursor 의 hover-to-peek, JetBrains 의 "Floating Side Bar" 와 같은 패턴이다.

해결해야 할 트리거 설계:

1. 어떤 입력으로 peek 이 뜨는가 (호버, 키보드, 양쪽?)
2. 호버 인/아웃의 지연(debounce) 은?
3. peek 이 떠 있을 때 자동 닫힘 트리거는?
4. 영구 펼침(F1) 으로 승격(pin) 하는 시퀀스는?
5. F1 의 슬림 레일(`data-sidebar-rail`, 6px) 과의 관계는?

## Decision

### D1. 활성화 트리거

| 트리거 | 조건 | 동작 |
|---|---|---|
| **호버 (1차)** | F1 슬림 레일 위에 포인터가 150ms 이상 머무름 | peek 열림 |
| **키보드 (2차)** | `Mod+Shift+E` (Explorer-style) | peek 열림 + 트리에 포커스 |
| **명령 팔레트** | `commands.view.peek_sidebar` | peek 열림 + 트리에 포커스 |

F1 의 사이드바가 이미 펴져 있는 경우(`!sidebarHidden`) 호버/키보드 peek 는 **no-op**. 펴진 상태에서는 자체 사이드바가 이미 활성 영역이므로 추가 오버레이는 잡음이다.

### D2. 호버 지연

| 단계 | 지연 |
|---|---|
| **enter** (레일 hover → peek 열림) | **150 ms** |
| **leave** (peek 영역 이탈 → peek 닫힘) | **200 ms** |
| **leave during enter wait** | 즉시 취소, 열리지 않음 |

enter 가 leave 보다 짧은 비대칭은 의도된 것이다. 사용자가 마우스를 잠깐 빗겨가는 경우(우발적 진입) 보다 잠깐 떼는 경우(피드백 확인 / 스크롤 진입) 가 더 흔하다. 동일 지연(200/200)을 시도해 봤지만 우발 트리거가 잦았다.

`prefers-reduced-motion` 사용자도 같은 지연 적용 — 지연 자체는 모션이 아니라 의도 감지이므로 OS 설정과 무관하다.

### D3. 자동 닫힘 트리거

peek 가 떠 있는 동안 다음 중 하나가 발생하면 자동으로 닫힌다(단, **pin 상태가 아닐 때만**):

1. 포인터가 peek 영역 밖으로 200ms 동안 나가 있음
2. 에디터/탭/스프레드 등 peek 외부에서 클릭 발생
3. 다른 모달(설정 시트, 명령 팔레트) 이 열림
4. `Esc` 키 — peek 가 떠 있을 때 무조건 닫힘 (포커스가 peek 밖이면 이벤트가 전파됨)
5. 워크스페이스 닫힘 / 전환

### D4. Pin (고정) 시퀀스

| 입력 | 결과 |
|---|---|
| Peek 헤더의 📌 버튼 클릭 | pin 토글 |
| `Mod+Shift+B` (peek 떠 있을 때) | pin 토글 |
| 트리 항목 더블클릭 | pin 토글 (S-SBP-007 확정) |

pin 이 켜진 peek 는 자동 닫힘 트리거(D3) 를 모두 무시한다. 다만 사용자가 명시적으로 닫는(`Esc`, 📌 토글 해제, F1 `view.hide_sidebar` 명령) 동작은 여전히 동작한다.

Pin 상태는 **세션 스코프**다. 워크스페이스 재오픈 시 항상 false 로 시작 — peek 의 본질은 임시 조회이고, 사용자가 peek 를 영구화하고 싶다면 F1 의 펼침(`Mod+B`) 이 이미 그 역할을 한다. 매 워크스페이스마다 pin 상태를 별도로 영구화하는 건 두 메커니즘이 같은 의미를 다투게 만든다.

### D5. F1 슬림 레일과의 관계

F1 의 슬림 레일(`[data-sidebar-rail]`) 은 peek 의 1차 호버 영역이다. 6px 폭의 좁은 막대 위에서:

- 단순 클릭 → F1 의 `toggleSidebar` (즉시 영구 펼침)
- 호버 150ms 유지 → F2 의 peek 열림 (임시)
- 호버 후 클릭 → 클릭 발생 시점에 peek 닫고 영구 펼침

즉 peek 은 클릭의 일부가 아니라 **호버만의 부수효과**. 사용자가 단호하게 클릭하면 F1 동작이 항상 이긴다.

이 결정은 슬림 레일을 단일 명시적 트리거(클릭)로 보존한다. peek 가 클릭 흐름에 끼어들면 "한 번 더 클릭해야 닫힌다" 같은 회의가 시작된다.

### D6. 키보드 단축키

| 명령 ID | 기본 바인딩 | when |
|---|---|---|
| `view.peek_sidebar` | `Mod+Shift+E` | `always` |
| `view.unpeek_sidebar` | (없음, `Esc` 가 처리) | `peekOpen` |
| `view.pin_peek` | `Mod+Shift+B` | `peekOpen` |

`Mod+Shift+E` 는 VSCode "Show Explorer" 와 동일 — 사용자가 옮겨와도 근육 기억이 그대로 적용된다. 충돌 없는 슬롯이며 `keybindings/presets/vscode.ts` 에 그대로 들어간다.

새로운 `when` 절: `peekOpen`. 디스패처는 F1 의 `editorFocus`/`treeFocus` 처럼 이 컨텍스트를 평가한다. 구현은 S-SBP-009 에서.

### D7. ARIA / 접근성 요약

- peek 컨테이너: `role="dialog"`, `aria-label="File tree (peek)"`, `aria-modal="false"`
- 첫 포커스: 트리의 `[role="tree"]` 노드. 닫힘 시 포커스는 peek 호출 직전 위치로 복원
- pin 버튼: `aria-pressed`, 라벨은 i18n `commands.view.pin_peek`
- D9 의 자동 닫힘은 포커스가 peek 외부에 있을 때만 — 키보드 사용자가 트리 위에서 빠르게 화살표를 누르는 동안 사라지면 안 된다

세부 키보드 동선은 S-SBP-009 에서 별도 검증.

## Consequences

- F1 의 슬림 레일은 그대로 유지된다 — peek 가 같은 표면을 공유하므로 추가 DOM 없이 트리거가 붙는다
- peek 의 포지셔닝/z-index 는 S-SBP-002 에서 확정. ADR 은 트리거 의도까지만 책임진다
- F1 의 `inert` 사이드바와 동시에 peek 가 떠 있을 수 없는 불변(invariant) 이 생긴다 — 컴포넌트 마운트 가드(`sidebarHidden && peek`) 로 강제한다
- 호버 지연 150/200ms 는 성능 예산이 아니라 사용성 예산이다. S-SBP-005 의 60fps 측정은 별개 — peek 가 떠 있는 동안 입력 응답이 60fps 를 유지해야 한다는 약속

## Alternatives considered

1. **호버 단독, 키보드 없음** — 마우스 없는 사용자가 peek 에 접근 불가. 거부
2. **클릭 1회 = peek, 2회 = 펼침** — 클릭의 의미가 컨텍스트 의존적이 되어 학습 비용 ↑. 거부
3. **호버 지연 없음 (즉시 열림)** — 마우스가 레일을 지나가기만 해도 열리는 우발 트리거. 거부
4. **Pin 영구 저장** — `view.toggle_sidebar` 와 같은 의미가 되어 두 명령이 다투게 됨. 거부 (D4 참조)
5. **`Mod+B` 더블 탭 = peek** — 더블 탭은 키보드에 비표준이고 KB 시스템의 단일 매핑 가정을 깨뜨림. 거부
