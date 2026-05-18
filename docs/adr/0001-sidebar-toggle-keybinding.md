# ADR-0001: Sidebar toggle keybinding

| Field | Value |
|---|---|
| Status | **Accepted** (S-SBC-001 · MAR-857) |
| Date | 2026-05-13 |
| Owners | Editor Ergonomics unit (F1) |
| Supersedes | — |
| Superseded by | — |
| Related | `src/lib/keybindings/`, `src/lib/commands/registry.ts`, `src/store/layout.ts`, F1 unit (S-SBC-002 ~ S-SBC-007) |

## Context

F1 — Sidebar Collapse 유닛의 첫 산출물. 사이드바를 접고 펴는 사용자 명령에 어떤 키 시퀀스를 배정할지, OS별로 어떻게 매핑할지, 그리고 마크다운 에디터 안에서의 `Bold` 충돌을 어떻게 해소할지를 결정한다.

기존 코드 상태:

- `src/lib/commands/sidebar.ts` 에 `toggleSidebarCommand()` 가 이미 존재 — `useLayout(workspace).toggleSidebar` 를 호출하여 워크스페이스별 사이드바 표시 상태를 토글한다.
- `src/lib/commands/registry.ts` 에 `view.toggle_sidebar` 가 `defaultBinding: "Mod+B"` 로 등록되어 있다.
- `src/lib/keybindings/presets/vscode.ts` 의 vscode 프리셋도 `view.toggle_sidebar → Mod+B` 를 기본값으로 깔아둔다.
- 다만 현재 `view.toggle_sidebar` 의 `when` 절이 `"treeFocus"` 로 좁혀져 있어 파일 트리에 포커스가 있는 경우에만 동작한다. 환영 화면·에디터·팔레트 등 다른 컨텍스트에서는 `Mod+B` 가 무시된다.

이 ADR은 (a) 어떤 키 시퀀스가 정답인지, (b) 충돌하는 `md.bold` 와의 컨텍스트 분리 규칙, (c) `when` 절 정정이 필요한 이유를 문서화한다.

## Decision

### D1. 키 시퀀스

| OS | 사이드바 토글 |
|---|---|
| macOS | `Cmd+B` |
| Windows / Linux | `Ctrl+B` |

`src/lib/keybindings/` 의 정규화 표기로는 단일 엔트리 `"Mod+B"` 로 표현한다. `Mod` 는 디스패처가 macOS 에서 `Meta` (Cmd), 그 외에서 `Ctrl` 로 해석한다 (`src/lib/keybindings/index.ts` 참조).

대체안과의 비교:

| 후보 | 채택 여부 | 근거 |
|---|---|---|
| **`Mod+B`** (VSCode) | ✅ 채택 | 마크다운 에디터 사용자층의 절대다수가 VSCode/Cursor/Obsidian/Typora 에서 학습한 근육 기억. 첫 실행 시 인지 비용 0. |
| `Mod+\` (Figma) | ❌ | 마크다운/에디터 도메인 관습이 아니며, 한국어/일본어 IME 사용자 키보드의 `\` 위치가 비표준일 수 있음 (백슬래시가 `¥` 등으로 매핑). |
| `Mod+0` | ❌ | `view.zoom_reset` 이 이미 점유. 충돌 시 가독성 손해. |
| `Mod+Shift+B` | ❌ | `md.bold` 와 동시 사용 시 손가락 거리 멀어짐. VSCode 마이그레이션 이점도 없음. |
| 자체 신규(`Alt+1` 등) | ❌ | 학습 비용 대비 이득 없음. 자체 단축키는 신중하게 — 본 유닛의 목적은 호환성. |

### D2. `md.bold` 충돌 해소 — `when` 절 기반 컨텍스트 라우팅

`Mod+B` 는 두 명령에 동시에 등록된다:

- `view.toggle_sidebar` — `when: "always"`
- `md.bold` — `when: "editorFocus"`

디스패처(`src/lib/keybindings/dispatch.ts`)는 "specific wins over always" 규칙을 가지므로:

| 활성 컨텍스트 | 발화 명령 |
|---|---|
| `editorFocus` (CodeMirror 포커스) | `md.bold` |
| `treeFocus` (파일 트리 포커스) | `view.toggle_sidebar` |
| `paletteOpen` / `sheetOpen` / `spreadFocus` | `view.toggle_sidebar` |
| `always` (환영 화면 등) | `view.toggle_sidebar` |

요점: 사용자는 **에디터 밖 어디서든** `Mod+B` 로 사이드바를 토글할 수 있고, 에디터 안에서는 `Bold` 로 의도가 자연스럽게 갈린다. 별도 모달 상태 없이 포커스만으로 분기되므로 학습 부담이 없다.

> **현재 코드 정정 필요**: `src/lib/commands/registry.ts:77` 의 `when: "treeFocus"` 는 D2 와 모순된다. S-SBC-002 (토글 컴포넌트) 작업에서 `when: "always"` (혹은 `when` 절 제거 — 기본값이 `"always"`) 로 정정한다. 단독 코드 변경은 본 ADR의 범위를 넘어가므로 후속 태스크에 위임.

### D3. 명령 ID / 영구 저장 / 명령 팔레트

- 명령 ID: `view.toggle_sidebar` (안정 식별자). 키바인딩 영구 저장 포맷(`src/lib/keybindings/io.ts` 참조)에서 사용자 오버라이드의 키가 됨 → 절대 변경 금지.
- 사이드바 표시 상태 영구 저장은 **워크스페이스별** (S-SBC-004 의 산출물). 위치는 `useLayout` 스토어 → `workspace-settings.json` 의 `layout.sidebarOpen` 키. 본 ADR 범위 밖.
- 명령 팔레트에는 "Toggle Sidebar" 라는 영문 제목으로 노출(`registry.ts` 의 `title` 필드). i18n 후속(S-CP unit) 시 `commands.view.toggle_sidebar.title` 키로 다국어화.

### D4. 사용자 오버라이드

키바인딩 시스템(`src/lib/keybindings/`)이 이미 사용자 레이어를 지원한다 (`source: "user"` 가 `source: "preset"` 을 덮어쓴다). 사용자가 `Mod+B` 를 다른 명령으로 재배정하면 `md.bold` 가 우선되는 컨텍스트도 함께 무효화될 수 있음을 키바인딩 편집 UI(S-KB-007 이후)에서 안내 텍스트로 노출한다. 본 ADR은 안내 문구의 영문 정본만 정의:

> "Mod+B is used by both Toggle Sidebar (outside the editor) and Bold (inside the editor). Rebinding will affect both contexts."

## Consequences

**양성**

- VSCode/Cursor/Obsidian 사용자가 첫 실행 시 즉시 익숙한 단축키 사용 가능.
- `when` 절 기반 컨텍스트 라우팅이 이미 디스패처에서 검증되어 있어(`dispatch.ts` 의 specific-wins 로직) 신규 인프라 도입 없음.
- 사이드바·`md.bold` 외에 `Mod+/`(toggle_comment / help.shortcuts) 등 기존 충돌도 동일 패턴으로 해소 가능 → ADR 선례로 활용.

**음성 / 위험**

- 사용자가 키바인딩 편집기에서 `view.toggle_sidebar` 만 다른 키로 재배정해도 `md.bold` 는 `Mod+B` 를 유지 → 에디터 밖에서 `Mod+B` 가 "무명령" 이 되어 혼란 가능. → S-KB-007 편집기에서 충돌 페어를 동시 표시한다 (별도 태스크).
- 한국어 윈도우 환경의 일부 키보드에서 `Ctrl+B` 가 한자 변환 키와 겹친다는 보고가 있다 (드물지만 존재). 발생 시 사용자 오버라이드 가이드로 대응.

## Alternatives considered

- **에디터 안에서도 사이드바를 토글**(예: `Mod+0` 신설) — VSCode 관습과 어긋나며, 마크다운 작성 흐름을 끊는 추가 단축키를 도입하는 것은 본 유닛의 "최소 침습" 원칙에 반함.
- **트리/에디터 외 모든 곳에서 발화하는 별도 글로벌 단축키** — `pushContext("always")` 가 이미 디스패처에서 처리하는 케이스이므로 신규 도입 불필요.
- **`Mod+B` 대신 `F8` 같은 펑션키** — 좌측 손 위치에서 멀고, 노트북 사용자에게 Fn 조합 비용이 큼.

## DoD

- [x] 키 시퀀스 결정 + OS 매핑 정문화
- [x] `md.bold` 충돌 해소 규칙(`when` 절 컨텍스트 라우팅) 명문화
- [x] 명령 ID 안정성 약정
- [x] 현재 코드와의 차이(`when: "treeFocus"` → `when: "always"`) 명시 + 후속 태스크 지정
- [x] ADR 머지 (본 문서)
