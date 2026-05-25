# ADR-0010: Agent-Chat-First shell architecture

| Field | Value |
|---|---|
| Status | **Proposed** (Architecture Pivot · MAR-966) |
| Date | 2026-05-25 |
| Owners | Architecture Pivot cycle |
| Supersedes | — |
| Superseded by | — |
| Related | ADR-0003 (Editor tab + split-pane model), ADR-0004 (Claude Agent SDK subscription auth), `src/screens/Main.tsx`, `src/screens/SingleFile.tsx`, `src/components/EditorPane.tsx`, `src/components/FileTree.tsx`, `src/components/Editor.tsx`, `src/store/workspace.ts`, `src/store/editor-layout.ts`, [Google Antigravity 2.0 (TNW)](https://thenextweb.com/news/google-antigravity-2-desktop-cli-sdk-io-2026), [Gemini CLI → Antigravity CLI 전환 공지](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/) |

## Context

v1.2 까지의 Markspread 셸 (`src/screens/Main.tsx`) 은 전통적 **3-pane 에디터** 구조다: 좌측 `FileTree` · 중앙 `EditorPane` (분할 가능, ADR-0003) · 우측 미리보기. AI 기능은 `AiActionPalette` 같은 **부수적 호출 지점** 으로만 노출된다. 사용자가 의도적으로 팔레트를 호출하지 않는 한 AI 는 화면에 없다.

2026-05 들어 동종 도구의 셸 디자인이 명확히 한 방향으로 수렴했다:

- **Google Antigravity 2.0** (I/O 2026, 5/19 공개) — VSCode 기반 에이전트-퍼스트 데스크탑 IDE. 병렬 서브에이전트, 음성, CLI/SDK 가 모두 chat 표면을 중심으로 배치된다. Gemini CLI 의 컨슈머 접근은 2026-06-18 종료되며 Antigravity CLI 로 대체된다.
- **Claude Desktop**, **OpenAI Codex CLI**, **Anthropic Claude Code** — 모두 chat 을 1차 표면으로, 파일/디프/터미널을 그 옆 컨텍스트 패널로 둔다.

같은 시기에 우리 페르소나 데이터(v1.2 비개발 사용자 인터뷰, MAR-940 시리즈) 는 "**파일을 직접 열기 전에 먼저 묻는다**" 라는 일관된 행동을 보였다. 파일트리는 컨텍스트 확인용으로만 쓰이고, 첫 액션의 80% 이상이 "이 문서를 요약해줘 / 이 부분 다듬어줘" 다.

한편 Markspread 의 원칙은 변하지 않았다:

1. **가볍다** — 단일 `.md` 파일을 더블클릭해서 빠르게 열고 닫는 사용 사례가 있다 (`SingleFile` 스크린).
2. **마크다운 중심 문서/아티팩트 리뷰·편집** — LLM 없이도 동작해야 하는 핵심.
3. **비개발자 접근성** — ADR-0004 의 subscription auth 채택 이유와 같은 줄기.

따라서 셸을 chat-first 로 옮기되, **LLM 없이 동작하는 가벼운 리뷰 모드** 를 동등 시민으로 보존해야 한다. 두 사용 모드는 한쪽이 다른 쪽의 "고급 옵션" 이 아니라 **다른 진입점** 으로 공존한다.

## Options

### (a) 현 EditorShell 유지 + AI 는 팔레트로만

- 장점: 구현 비용 0. 기존 사용자 학습 곡선 0.
- 단점:
  - 페르소나 인터뷰의 "먼저 묻는다" 행동을 셸이 막는다 — 매번 팔레트 호출 단축키를 외워야 한다.
  - 동종 도구가 모두 떠난 방향. 외부에서 봤을 때 "2024 년산 마크다운 에디터" 로 보인다.
  - ADR-0004 로 진입 마찰을 낮춰놓고 셸이 다시 마찰을 만든다.

### (b) Chat-only 셸로 **교체** — 에디터 라우트 제거

- 장점: 코드 표면 단일. 셸 하나만 유지.
- 단점:
  - "가볍게 한 파일만 열어 본다" 사용 사례 (`SingleFile`) 가 LLM 부팅 비용을 짊어진다 — "가볍다" 원칙 위배.
  - 오프라인 / 자격증명 미설정 상태에서 앱이 사실상 비기능.
  - v1.x 사용자의 핵심 동선 (트리 → 탭 → 분할편집, ADR-0003) 을 강제 폐기 → 이탈.
  - 엔터프라이즈 / 보안 환경에서 LLM 차단 시 앱 전체가 못 쓰임.

### (c) **Dual-mode** — ChatShell 을 1차로, EditorShell 을 2차 라우트로 보존 ★ 채택

- 장점:
  - 비개발 / AI 우선 사용자: ChatShell 이 기본.
  - 순수 리뷰 / 오프라인 / LLM 미설정 사용자: EditorShell 로 한 클릭 이동, 기능 손실 없음.
  - ADR-0003 의 split-pane 모델이 EditorShell 안에서 그대로 살아남음 → 마이그레이션 비용 0.
  - 한쪽 셸이 망가져도 다른 쪽으로 우회 가능 (장애 격리).
- 단점:
  - 셸이 두 개 → 워크스페이스 store 동기화, 라우팅, 키바인딩 경합 등 표면 확장.
  - 사용자가 "어느 셸에 있어야 하지?" 를 한 번 학습해야 함 — 첫 진입 UX 로 완충 필요.

### (d) 단일 셸이 모드에 따라 morph (토글)

- 장점: 라우트 한 개. 모드 전환이 같은 화면 안에서 일어남.
- 단점:
  - 같은 컴포넌트 트리에 두 레이아웃을 끼워넣으면 마운트/언마운트 비용이 항상 발생하거나, 양쪽 트리가 동시에 살아 있어 메모리·이벤트 핸들러 경합.
  - 키바인딩 / 명령 팔레트가 현재 모드에 따라 다른 의미를 갖는 모드드리븐 UI 가 됨 — 비개발자에게 가장 혼란스러운 패턴.
  - 디버깅·텔레메트리 시 "어느 모드에서 일어난 일인가" 가 라우트로 안 잡혀 분석 비용 증가.

## Decision

**옵션 (c) Dual-mode 를 채택한다.** ChatShell 을 1차 진입으로, 기존 `Main` 스크린을 `EditorShell` 로 명시적으로 재명명·라우트화하여 2차로 유지한다.

### D1. 라우트 구조

`react-router` 는 도입하지 않는다 — 현재 `App.tsx` 가 store 기반 분기 (`useWorkspace`, `useSingleFile`) 로 스크린을 고른다. 이 패턴을 유지하되 한 단계 추가한다:

```
RealApp
 ├─ singleFilePath 있음               → <SingleFile />            (기존 유지, "가벼움" 진입점)
 ├─ workspace 있음 && shell === chat  → <ChatShell />             (신설, 기본값)
 ├─ workspace 있음 && shell === editor → <EditorShell />          (Main 의 재명명)
 └─ 그 외                             → <Welcome />
```

`shell` 은 워크스페이스 store 의 새 필드 `preferredShell: 'chat' | 'editor'` 로 정해진다. 워크스페이스 단위 설정이며 `.markspread/layout.json` (ADR-0003 D3 의 같은 파일) 에 `shell` 키로 저장한다. 사용자는 셸 상단의 토글 / 명령 팔레트 `View: Switch to Editor Shell` 로 즉시 이동.

`SingleFile` 은 **항상 EditorShell 의 축약형** 으로 동작한다 — 단일 파일 사용자가 챗을 원하면 워크스페이스로 승격 후 ChatShell 로 들어가는 동선 (Welcome 의 "Convert to Workspace" CTA).

### D2. ChatShell 레이아웃

```
┌──────────────┬─────────────────────────────────┬──────────────────────┐
│ WorkspaceNav │  ChatStream                     │ ContextPanel         │
│              │  ─ message list (assistant/user)│  ┌ FileTree (축약)  │
│ - 워크스페이스 │  ─ tool call cards               │  ├ ActivePreview   │
│   목록        │  ─ artifact diffs                │  └ PinnedSnippets  │
│ - 채팅 세션    │                                  │                     │
│ - 새 채팅      │  [입력 박스 + 첨부]              │ [컨텍스트 토큰 게이지]│
└──────────────┴─────────────────────────────────┴──────────────────────┘
       180px            flex (남는 공간)               320px (접힘 가능)
```

- **좌측 (WorkspaceNav)** — 워크스페이스 + 채팅 세션 트리. ChatShell 안에서만 의미가 있는 좌측 네비. 기존 `FileTree` 는 좌측이 아닌 **우측 ContextPanel 안의 축약형 트리** 로 위치한다 (D3 참조).
- **중앙 (ChatStream)** — 메시지 스트림이 화면의 주인공. 입력 박스는 하단 고정. 첨부 칩 (현재 파일·선택 영역·핀 스니펫) 이 입력 박스 위에 보임 → 다음 메시지에 어떤 컨텍스트가 같이 갈지 사용자가 한눈에 본다.
- **우측 (ContextPanel)** — 현재 파일의 라이브 미리보기 + 축약 파일트리 + 핀된 스니펫. **여기 보이는 것이 LLM 에 들어간다** 가 1:1 규약 (D4).

좌·우 패널은 모두 접을 수 있다. 둘 다 접으면 ChatStream 만 남는 "글쓰기 모드" 가 된다.

### D3. EditorShell 레이아웃 (기존 유지)

`src/screens/Main.tsx` 의 현재 구조를 그대로 보존하고 파일명만 `EditorShell.tsx` 로 옮긴다. ADR-0003 의 split-pane 트리, ADR-0001/0002 의 사이드바 동작, 모든 키바인딩이 변경 없이 동작한다. ChatShell 의 ContextPanel 안에 들어간 축약 파일트리는 EditorShell 의 사이드바 `FileTree` 와 **같은 store (`src/store/file-tree.ts`)** 를 공유하므로, 열림 상태·정렬·peek 동작이 두 셸 사이에서 일관된다.

### D4. 컨텍스트 주입 파이프라인

ChatShell 의 입력 박스가 메시지 전송 직전 다음을 자동으로 시스템 블록으로 첨부한다 (사용자 동의: 첫 회 다이얼로그 후 워크스페이스 단위 기억):

1. **활성 워크스페이스 메타** — 루트 경로, 워크스페이스명, 파일 수.
2. **활성 파일** — ContextPanel 의 ActivePreview 가 보고 있는 파일 본문.
3. **선택 영역** — 사용자가 ActivePreview 안에서 드래그한 텍스트 (있을 때만).
4. **최근 변경** — 마지막 N 분(기본 10) 내 편집된 파일의 unified diff. 사용자가 작업 중인 흐름을 LLM 이 안다.
5. **핀 스니펫** — 사용자가 명시적으로 핀한 임의 텍스트 블록.

각 블록은 우선순위(`selection > activeFile > recentChanges > pinned > workspaceMeta`) 순으로 토큰 예산 안에 채워 넣는다. 예산 초과 시 낮은 우선순위부터 잘라낸다. ContextPanel 의 **토큰 게이지** 가 현재 채워진 비율을 실시간으로 보여줌 → 사용자가 "왜 이 파일이 안 들어갔지?" 를 즉시 본다.

구현은 `src/lib/ai/context-pack.ts` (신설) 가 단일 진입점. ChatShell 외 호출지점 (예: `AiActionPalette`) 도 같은 함수를 쓰도록 점진 정리.

### D5. 두 셸이 공유하는 store

| Store | 공유 여부 | 비고 |
|---|---|---|
| `workspace` | 공유 | 활성 워크스페이스, `preferredShell` 필드 추가 |
| `editor-layout` (ADR-0003) | EditorShell 전용 | ChatShell 의 ActivePreview 는 layout 트리를 안 거치고 단일 파일만 본다 |
| `tabs` | EditorShell 전용 | ChatShell 은 탭 개념 없음 |
| `file-tree` | 공유 | 양 셸의 트리가 같은 열림 상태를 본다 |
| `doc-cache` | 공유 | 파일 본문 캐시. ChatShell 의 ActivePreview · context-pack 모두 여기서 읽음 |
| `chat-sessions` (신설) | ChatShell 전용 | 채팅 세션 목록·메시지 스트림. 워크스페이스 단위로 `.markspread/chats/` 에 저장 |

**활성 파일** 의 의미가 두 셸에서 다르다:
- EditorShell: 활성 페인의 활성 탭 (ADR-0003 D4)
- ChatShell: ContextPanel 의 ActivePreview 가 보고 있는 파일

셸 전환 시: EditorShell → ChatShell 이동 시 활성 탭의 path 를 ChatShell ActivePreview 에 인계. 반대 방향은 ActivePreview path 를 EditorShell 활성 페인에 새 탭으로 연다 (이미 열려 있으면 활성화).

### D6. URL · 윈도우 라벨

Tauri 멀티윈도우 (S-WS-015) 환경에서 윈도우당 셸이 다를 수 있다. `getWindowInfo()` 가 반환하는 window label 에 셸 이름을 접미사로 붙이지는 않는다 — 셸 선호는 워크스페이스의 속성이지 윈도우의 속성이 아니므로. 같은 워크스페이스를 두 윈도우로 열면 두 윈도우 모두 같은 `preferredShell` 을 본다.

## Consequences

### 양

- 동종 도구의 셸 디자인과 정렬 — 외부 사용자가 학습 비용 없이 익숙함.
- 비개발자가 첫 화면에서 즉시 "묻고 받는" 진입을 한다 — 페르소나와 일치.
- EditorShell 이 보존되어 오프라인 / LLM 미설정 / 순수 리뷰 사용 사례가 손상되지 않음.
- 두 셸이 각각 독립 라우트이므로 텔레메트리·에러 보고가 "어느 셸" 인지 자연히 라벨됨.
- ChatShell 이 시장 트렌드를 못 따라가도 EditorShell 만으로도 v1 의 제품 가치는 유지.

### 음

- 셸 두 개 = UI 회귀 테스트 매트릭스 두 배. Playwright 시나리오는 셸 라벨로 분기.
- 워크스페이스 store 가 `preferredShell` 을 갖게 되면서 `.markspread/layout.json` schemaVersion 증가 (ADR-0003 D3 의 v1 → v2). 마이그레이션 규칙: 기존 워크스페이스는 `preferredShell: 'editor'` 로 채워 무손실. **신규 워크스페이스는 `'chat'`** (D-Migration 참조).
- ChatShell 의 ContextPanel ↔ EditorShell 의 사이드바가 같은 `file-tree` store 를 본다 → 한쪽에서의 변경이 다른 쪽에 즉시 반영. 디바운싱·로컬 시각 상태 분리에 주의.

### 위험

- **R1 — "가볍다" 원칙이 깨진다.** ChatShell 이 LLM SDK · 메시지 스트림 · 마크다운 렌더러를 다 끌어오면 첫 페인트 시간이 늘어난다.
  - 완화: ChatShell 의 LLM·SDK 의존은 모두 `import()` 동적 분할. 첫 페인트는 ChatStream 빈 골격만. SDK 는 첫 메시지 전송 시점에 로드. ADR-0004 의 auth refresh 부트는 그대로 idle 시점.
  - 완화: 번들 사이즈 ceiling (현재 15MB) 안에 EditorShell + ChatShell 둘 다 들어가는지 매 PR 의 size-limit 체크에 추가.
  - 탈출구: ChatShell 이 끝내 무거우면 사용자는 `preferredShell` 토글로 EditorShell 로 도망 가능 — 옵션 (b) 와 달리 막다른 길이 없다.
- **R2 — 컨텍스트 의도와 실제 불일치.** ContextPanel 에 보이지 않는 것이 첨부되거나, 보이는데 잘려서 안 들어가면 사용자 신뢰 붕괴.
  - 완화: D4 의 토큰 게이지 + 첨부 칩 두 표시 모두 메시지 전송 직전 상태와 1:1.
  - 완화: 첨부된 시스템 블록을 사용자가 메시지 카드의 "Context used" 토글로 사후 확인 가능.
- **R3 — 두 셸의 키바인딩 충돌.** ADR-0003 의 페인 단축키와 ChatShell 의 새 단축키 (메시지 전송, 첨부 토글) 가 겹칠 수 있음.
  - 완화: 키바인딩 등록 시 `scope: 'chat' | 'editor' | 'global'` 라벨 필수. `registerKeybindings()` 가 활성 셸에 맞는 scope 만 활성.

## Migration

### 첫 진입 동선

- **기존 사용자 (v1.x 워크스페이스 보유)**: 셸 변경 없음. `preferredShell: 'editor'` 로 자동 채워져 기존 화면 그대로. 상단 배너로 "ChatShell 을 사용해 보시겠어요?" 1회 안내 (dismiss 가능, 워크스페이스 단위 기억).
- **신규 사용자**: 워크스페이스 생성 마법사 마지막 단계에 셸 초이서 — "AI 와 대화하며 작업 (권장)" / "전통 에디터 화면" 두 카드. 기본 선택은 ChatShell. 자격증명이 하나도 없으면 (`ai/credentials` 비어 있음) 기본을 EditorShell 로 자동 전환하고 ChatShell 카드에 "Sign in 필요" 라벨.
- **단일 파일 진입 (`SingleFile`)**: 변경 없음. 챗 사용 의사 표명 시 "Convert to Workspace" 로만 ChatShell 진입 가능.

### 피쳐 플래그

`MS_SHELL_CHAT_ENABLED` (env / settings) — 기본 `true`. 문제 발생 시 즉시 `false` 로 떨어뜨리면 라우팅이 항상 EditorShell 로 강제된다. 워크스페이스의 `preferredShell` 값은 보존되며 플래그를 다시 켜면 복원.

### Schema migration

`.markspread/layout.json` schemaVersion 1 → 2:

```jsonc
// before (v1)
{ "schemaVersion": 1, "editor": { … }, "sidebar": { … } }

// after (v2)
{
  "schemaVersion": 2,
  "shell": "editor",        // 기존 워크스페이스 기본값
  "editor":  { … },
  "sidebar": { … },
  "chat":    null            // 첫 ChatShell 진입 시 생성
}
```

마이그레이션 코드는 `src/lib/migration/run.ts` (이미 존재) 에 신규 step 추가. 다운그레이드 경로는 만들지 않는다 — v1.x 바이너리는 `schemaVersion: 2` 를 만나면 알 수 없는 필드를 무시하고 v1 동작을 유지하므로 사실상 안전.

## Telemetry

채택 추적 + R1/R2 모니터링을 위한 필수 이벤트:

| Event | 페이로드 | 목적 |
|---|---|---|
| `shell.mounted` | `{ shell, workspaceId, firstPaintMs }` | 채택률 + R1 (ChatShell 첫 페인트가 EditorShell 대비 1.5배 이내인지) |
| `shell.switched` | `{ from, to, trigger: 'toolbar' \| 'palette' \| 'banner' }` | 사용자가 어느 방향으로 도망가는지. ChatShell → EditorShell 이 일정 임계치 초과 시 R1 적신호 |
| `chat.message_sent` | `{ workspaceId, contextBlocks: [...], tokensUsed, tokensBudget }` | R2 (게이지와 실제 컨텍스트 일치 여부). 청구 추적은 ADR-0004 의 `ai.usage` 를 그대로 사용 |
| `chat.context_trimmed` | `{ trimmedKinds: [...], reason: 'budget' }` | R2 (어떤 종류가 자주 잘리는지) |
| `chat.session_created` / `chat.session_resumed` | `{ workspaceId, messageCount }` | ChatShell 의 stickiness |
| `migration.shell_default_applied` | `{ chosen, hadCredentials }` | 마이그레이션 디폴트가 사용자 의도와 맞는지 |
| `editor.opened_via_escape_hatch` | `{ from: 'chat', reason }` | EditorShell 이 "탈출구" 로 얼마나 쓰이는지 — 0 에 수렴하면 옵션 (b) 재고 신호 |

기존 텔레메트리 동의 (`TelemetryConsent`) 가 꺼진 사용자는 위 모든 이벤트도 발화 안 함. 셸 라벨은 `shell.mounted` 외 모든 이벤트의 컨텍스트에 자동 부착되도록 `useTelemetry` 미들웨어에 일괄 주입.

## Validation plan

- M-PIV-001: 셸 선택 라우팅 단위 테스트 (`App.test.tsx` 확장) — `preferredShell` 값과 자격증명 유무 조합 매트릭스.
- M-PIV-002: `context-pack.ts` 우선순위 + 토큰 예산 트리밍 Vitest.
- M-PIV-003: ChatShell ↔ EditorShell 전환 시 활성 파일 인계 Playwright 시나리오.
- M-PIV-004: schemaVersion 1 → 2 마이그레이션 (기존 워크스페이스 무손실) Vitest.
- M-PIV-005: 번들 사이즈 회귀 — ChatShell 추가 후 dmg 15MB ceiling 유지 확인 (CI size-limit).
- M-PIV-006: 키바인딩 scope 격리 — EditorShell 단축키가 ChatShell 입력 박스에서 발화하지 않음 (그 반대도).

## References

- ADR-0003: Editor tab + split-pane model — EditorShell 의 데이터 모델은 이 ADR 위에 그대로 존재.
- ADR-0004: Claude Agent SDK subscription auth — ChatShell 의 기본 진입을 가능하게 한 선행 결정.
- Google Antigravity 2.0 (TNW, 2026-05-19): https://thenextweb.com/news/google-antigravity-2-desktop-cli-sdk-io-2026
- Gemini CLI → Antigravity CLI 전환: https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/
- 후속 ADR 후보: ChatShell 의 멀티-에이전트 / 서브에이전트 패널 (Antigravity 의 parallel agents 와 정렬), 보이스 입력 통합.
