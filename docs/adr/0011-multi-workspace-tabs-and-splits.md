# ADR-0011: Multi-workspace shell — tabs × splits

| Field | Value |
|---|---|
| Status | **Proposed** (Architecture Pivot cycle) |
| Date | 2026-05-25 |
| Owners | Architecture Pivot cycle |
| Supersedes | — (ADR-0003 을 **확장**) |
| Superseded by | — |
| Related | [ADR-0003](./0003-editor-tab-split-pane-model.md) (페인/탭 트리 모델), S-SBC-007 (사이드바 collapse 영속화), `src/store/workspace.ts`, `src/store/file-tree.ts`, `src/store/editor-layout.ts`, `src/components/FileTree.tsx`, `.markspread/layout.json` |

## Context

현재(v1.2 직전) Markspread 의 셸은 **한 윈도우 = 한 워크스페이스** 가 강한 불변이다.

- `useWorkspace` (`src/store/workspace.ts`) 는 `current: string | null` — 단일 경로만 보유.
- `useFileTree` (`src/store/file-tree.ts`) 의 `expanded` 는 `Record<workspace, string[]>` 형태로 워크스페이스 단위 expansion 을 키잉하지만, 동시에 화면에 보이는 워크스페이스는 항상 하나라는 가정 위에 서 있다.
- `FileTree.tsx` 는 `props.workspace: string` 한 개를 받아 한 트리만 렌더한다.
- ADR-0003 이 정의한 `WorkspaceLayout` (페인/탭 트리) 은 **그 단일 워크스페이스 내부의** 에디터 분할만 다룬다. 트리의 최상단(`root`) 은 항상 하나의 워크스페이스에 묶인다.

이 모델은 v1.1 까지의 "한 번에 한 문서 폴더" 페르소나에는 충분했다. 그러나 Architecture Pivot 사이클에서 수집한 사용자 인터뷰는 다음 마찰을 일관되게 보고한다.

1. **프로젝트 비교 작업의 단절** — `~/work/spec` 과 `~/work/notes` 를 같이 열어 좌우로 보고 싶을 때, 현재는 윈도우를 두 개 띄우거나 워크스페이스를 닫고 다시 열어야 한다. 둘 다 mental cost 가 크다.
2. **단축키/명령 팔레트의 컨텍스트 점프** — 워크스페이스를 갈아끼울 때마다 사이드바 expansion, 검색어, 스크롤이 초기화되거나 (구현 따라) 잘못 공유되어 혼란.
3. **VSCode "multi-root workspace" 의 단점 그대로 적용 불가** — multi-root 는 파일 트리를 한 패널 안에 평탄화한다. Markspread 의 파일 트리는 정렬·검색·context 메뉴가 워크스페이스 루트 기준으로 동작하는 부분이 많아 평탄화하면 의미가 깨진다 (예: `.markspread/layout.json` 위치, README 강조, 워크스페이스 단위 read-only).

따라서 Markspread 는 **워크스페이스 자체를 다중화** 하되, 그 다중화 축을 사용자가 "탭" 과 "스플릿" 둘 다로 조립할 수 있게 한다. ADR-0003 이 *워크스페이스 내부* 의 분할 트리를 정의했다면, ADR-0011 은 그 위에 *워크스페이스 사이* 의 분할/탭 트리를 한 층 더 얹는다. ADR-0003 의 데이터 모델·직렬화·마이그레이션 규칙은 **그대로 보존** 한다.

## Options

### (a) Status quo — 한 번에 한 워크스페이스

- 장점: 코드 변경 0, 멘탈 모델 단순.
- 단점: 위에서 정리한 세 가지 마찰 그대로. Architecture Pivot 의 동기와 정면 충돌.

### (b) Workspace tabs only — 최상단 탭만

브라우저처럼 윈도우 상단에 워크스페이스 탭 스트립을 두고, 탭 전환으로 워크스페이스를 갈아끼운다. 각 탭은 자기만의 ADR-0003 `WorkspaceLayout` 을 보유.

- 장점: 구현이 가장 단순. 한 시점에 보이는 워크스페이스는 여전히 하나라 사이드바/파일트리 props 변경 폭이 작다.
- 단점: **동시 가시성 0** — 사용자의 핵심 요구(좌우 비교) 를 못 푼다. 탭 클릭으로 컨텍스트 전환이 빠르긴 하지만 "동시에 보기" 와는 다른 문제.

### (c) Workspace splits only — 좌우/상하 스플릿만

윈도우를 분할해 각 스플릿이 하나의 워크스페이스에 핀된다. 탭 개념 없음.

- 장점: 동시 가시성 확보. 데이터 모델은 단순한 분할 트리 하나.
- 단점:
  - 4개 이상 워크스페이스를 다루면 화면이 너무 잘게 쪼개진다 — 실제 사용자 동선은 "5~6개 보유, 그 중 2개 동시 가시" 가 다수.
  - "잠시 숨기지만 닫지는 않음" 의 자연스러운 표현이 없다 — VSCode 의 hidden tab 같은 안전한 보관 슬롯 부재.
  - 단축키로 워크스페이스를 순환할 때 항상 레이아웃이 흔들린다.

### (d) Tabs × splits orthogonal ★ — 최상단 탭 **그리고** 스플릿, 각 스플릿이 자기 탭 스트립을 보유

VSCode 의 "윈도우 탭 × 에디터 그룹 분할" 을 워크스페이스 레벨로 끌어올린 형태. 사용자는 다음 어느 조합이든 만들 수 있다.

- 한 스플릿, N 탭 — (b) 와 사실상 동일.
- 두 스플릿, 각 1 탭 — (c) 와 사실상 동일.
- 좌측 스플릿에 2 탭(`spec`, `notes`), 우측 스플릿에 1 탭(`drafts`) — 진짜 "보유 6개 중 가시 3개" 동선.

- 장점:
  - 동시 가시성과 보관 슬롯을 한 모델로 동시에 충족.
  - 사용자가 익숙한 VSCode 멘탈 모델을 그대로 가져옴.
  - 한 스플릿만 사용하는 사용자는 (b) 의 단순성을 그대로 누림 — degenerate case 가 자연스러움.
- 단점:
  - 데이터 모델이 두 단계 트리(워크스페이스 셸 트리 + ADR-0003 페인 트리) 로 깊어진다.
  - 단축키 디자인이 복잡 — 같은 `Mod+\` 라도 "워크스페이스 분할" vs "페인 분할" 을 사용자가 분별해야 함.
  - 영속화 키 공간이 `(window, ws-split-path, workspace)` 까지 늘어남.

## Decision

**옵션 (d) 를 채택한다.** 사용자의 명시적 요구사항이며, 다른 옵션은 핵심 동선(동시 비교 + 보관 슬롯) 을 동시에 풀지 못한다. 복잡도는 두 단계 트리를 **명확하게 분리** 하고 ADR-0003 트리를 한 글자도 건드리지 않는 방식으로 흡수한다.

### D1. 셸 데이터 모델 — 두 단계 트리

```
WindowLayout = {
  schemaVersion: 2,
  root: WorkspaceSplitNode | WorkspaceTabsNode,
  activeTabId: string,      // 윈도우 통틀어 단 하나의 active workspace 탭
  ...
}

WorkspaceSplitNode = {
  type: "ws-split",
  id: string,
  direction: "horizontal" | "vertical",
  children: (WorkspaceSplitNode | WorkspaceTabsNode)[],   // length >= 2
  sizes: number[],                                        // 자식과 같은 길이
}

WorkspaceTabsNode = {
  type: "ws-tabs",
  id: string,
  tabs: WorkspaceTab[],     // length >= 1
  activeTabId: string,
}

WorkspaceTab = {
  id: string,               // 윈도우 안에서 유일
  workspaceId: string,      // 워크스페이스 경로의 해시. 같은 워크스페이스가 두 탭에 열려 있을 수 있음
  workspacePath: string,    // 원본 경로 (재오픈 시 검증)
  paneTree: LayoutNode,     // ★ ADR-0003 의 트리를 그대로 임베드
  tabState: WorkspaceTabState,
}
```

핵심 결정:

- `WorkspaceTab.paneTree` 는 ADR-0003 의 `LayoutNode` 그대로다. 새 셸은 ADR-0003 트리를 **컨테이너로 감쌀 뿐, 그 내부 의미에 손대지 않는다.** 페인 분할/탭 이동/ViewState 분리 규칙은 ADR-0003 의 D1~D8 이 그대로 유효하다.
- `WorkspaceSplitNode.children` 은 다시 `WorkspaceSplitNode` 일 수도 있고 `WorkspaceTabsNode` 일 수도 있다 — 즉 스플릿이 스플릿을 감쌀 수 있다. ADR-0003 D1 과 동일한 flat-N-children 정책을 이 층에서도 채택 (3-스플릿 균등의 순서 편향 회피 + 드래그 재배치 단순화).
- `WorkspaceTabsNode` 가 leaf 다 — 즉 탭 스트립 안에는 항상 워크스페이스 탭이, 그리고 워크스페이스 탭 안에는 항상 ADR-0003 페인 트리가 들어간다. 스플릿이 직접 워크스페이스 탭을 들거나, 탭이 직접 스플릿을 드는 것은 금지 — 두 단계 사이의 경계를 흐리면 직렬화/단축키 분기가 망가진다.
- `WindowLayout.root` 는 최소 1개 워크스페이스 탭을 갖는 `WorkspaceTabsNode` 가 기본. 분할 없는 사용자는 v1.1 과 시각적으로 동일.

### D2. 워크스페이스 탭 상태

```ts
WorkspaceTabState = {
  // 사이드바 (S-SBC-007 의 collapse 영속화 패턴을 이 키 공간으로 옮긴다 — D4 참조)
  sidebarCollapsed: boolean,
  sidebarWidth?: number,
  // 파일트리
  fileTreeExpanded: string[],       // 절대 경로 목록 — 현재 useFileTree.expanded[workspace] 와 동치
  fileTreeScrollTop: number,
  fileTreeSearchQuery: string,
  fileTreeSortMode: SortMode,
  // 메타
  readOnly: boolean,
  pinned?: boolean,                 // 우클릭 → Pin Tab. close 명령 보호.
  lastVisitedAt: number,
}
```

각 워크스페이스 탭은 **자기만의 사이드바 / 파일트리 / 정렬 / 검색** 을 가진다. 두 스플릿에 같은 워크스페이스를 열어도 두 탭이 서로 다른 expansion/scroll/검색을 가질 수 있다 — 사용자가 "같은 폴더의 다른 부분" 을 동시에 보는 시나리오를 지원하기 위함. 콘텐츠(파일 내용) 자체는 ADR-0003 D2 와 같은 규약으로 공유.

### D3. 활성 워크스페이스 탭 (activeTabId)

윈도우 전체에 단 하나의 active 워크스페이스 탭이 존재. 이 탭의 active 페인 의 active 탭 이 명령 팔레트, 자동 저장, AI 컨텍스트의 대상이 된다. 즉 ADR-0003 D4 의 `activePaneId` 와 함께 **2단 active 체인** 이 형성된다.

```
activeWorkspaceTabId  (이 ADR)
  └── (그 탭의) activePaneId  (ADR-0003 D4)
        └── (그 페인의) activeTabId  (ADR-0003)
```

포커스 이동 단축키는 D5 참조. active 워크스페이스 탭이 트리 단순화로 사라지면(스플릿 해제 시 한 자식만 남아 부모로 흡수되는 경우), preorder 탐색 첫 번째 `WorkspaceTabsNode` 의 activeTabId 로 이전 — ADR-0003 D4 의 동일 규칙을 한 층 위에 그대로 복제.

### D4. 영속화 — S-SBC-007 패턴의 확장

S-SBC-007 은 사이드바 collapse 상태를 `persistKeyFor("markspread.sidebar-collapse")` 로 **윈도우 단위** 키에 저장한다 (`src/store/file-tree.ts`, `src/store/layout.ts` 와 동일 `window-id` 헬퍼). 본 ADR 은 이 키 공간을 한 단계 더 분기한다.

기존:
```
key = (window) → { sidebarCollapsed: bool }
```

신규:
```
key = (window) → WindowLayout
  └── WorkspaceTab[i].tabState.sidebarCollapsed
```

즉 윈도우당 한 개의 `WindowLayout` 만 저장하고, 그 안에서 워크스페이스 탭별 상태가 자연스럽게 키잉된다. `useFileTree.expanded[workspace]` 는 **deprecated** — 같은 워크스페이스가 두 탭에 열려 있을 때 expansion 이 어느 쪽 것인지 모호해진다. 마이그레이션 시 모든 워크스페이스의 expansion 배열을 부팅 시 단일 워크스페이스 탭의 `tabState.fileTreeExpanded` 로 흡수 (D8 마이그레이션 참조).

직렬화 위치는 **per-window app-data 파일** — `.markspread/layout.json` 은 "워크스페이스 내부" 의 레이아웃을 담는 ADR-0003 의 파일이므로, 워크스페이스를 가로지르는 셸 레이아웃을 거기에 쓰는 것은 의미 오용이다. 따라서:

- `${appDataDir}/windows/${windowId}/shell-layout.json` — `WindowLayout` (이 ADR).
- `.markspread/layout.json` — ADR-0003 의 페인 트리 + 사이드바 폴 백. **하지만** 워크스페이스 탭별 상태가 D2 로 옮겨가므로 `.markspread/layout.json` 의 `sidebar` 섹션은 "이 워크스페이스의 기본 상태" 로 의미 격하 — 새 탭으로 열릴 때 초기값으로만 사용.

`schemaVersion` 은 윈도우 셸 파일에서 2 부터 시작 (ADR-0003 의 1 과 구분).

### D5. 단축키

| 단축키 | 동작 | 비고 |
|---|---|---|
| `Mod+T` | 새 워크스페이스 탭 (active `WorkspaceTabsNode` 에 추가) | 최근 워크스페이스 픽커 띄움 |
| `Mod+Shift+T` | 닫은 워크스페이스 탭 재오픈 | recent-workspaces 와 별개 큐 |
| `Mod+W` | active 워크스페이스 탭 닫기 | 마지막 탭이면 빈 placeholder 로 폴백, 윈도우는 유지 |
| `Mod+1`..`Mod+9` | active 스플릿의 n 번째 워크스페이스 탭으로 점프 | ADR-0003 의 `Mod+1..9` 와 충돌 — D7 참조 |
| `Mod+\` | active 워크스페이스 탭을 세로 분할 (좌우) | 현 탭을 복제 후 우측에 핀 |
| `Mod+Shift+\` | active 워크스페이스 탭을 가로 분할 (상하) | 동상 |
| `Mod+K Mod+\` | 분할 해제 (현 스플릿을 형제와 병합) | VSCode 패턴 |
| `Mod+Alt+→/←/↑/↓` | 인접 워크스페이스 스플릿으로 포커스 이동 | ADR-0003 의 `Mod+K Mod+→` (페인 포커스) 와 다른 키 |
| `Mod+Shift+P` | (기존) 명령 팔레트 | 모든 신규 명령 등록 |

드래그 동작:

- 워크스페이스 탭을 스트립 안에서 끌어 순서 변경.
- 워크스페이스 탭을 다른 `WorkspaceTabsNode` 스트립으로 끌어 이동.
- 워크스페이스 탭을 스플릿 가장자리(edge drop) 에 떨어뜨려 새 스플릿 생성.

페인(ADR-0003) 내부 드래그(S-ESP-004) 와 셸 드래그는 **드래그 시작 지점이 어느 zone 인지** 로 구분 — 워크스페이스 탭 스트립에서 시작하면 셸 드래그, 페인 탭 스트립에서 시작하면 페인 드래그. drop target 도 자기 zone 안으로만 허용.

### D6. 파일트리 다중 인스턴스

`FileTree.tsx` 는 현재 `props.workspace: string` 한 개를 받는다. ADR-0011 후 동일 컴포넌트가 **각 워크스페이스 탭의 사이드바에 한 번씩** 마운트된다. props 시그니처는 그대로 두되, expansion/scroll/search 상태 소스를 `useFileTree` 글로벌 스토어에서 **워크스페이스 탭 로컬 selector** 로 교체:

```ts
const tabState = useShell((s) => s.tabs[workspaceTabId].tabState);
```

같은 워크스페이스가 두 탭에 열려 있어도 두 인스턴스의 expansion/scroll/search 는 독립.

### D7. 단축키 충돌 — `Mod+1..9`

ADR-0003 D4 는 `Mod+1..9` 를 페인 점프에 할당했다. 이 ADR 은 같은 키를 워크스페이스 탭 점프에 사용한다. 분기 규칙:

- 단일 스플릿(`WindowLayout.root.type === "ws-tabs"`) 이면 페인 점프 의미가 비어 있지 않으므로 ADR-0003 의미로 fallback — 즉 분할을 안 쓰는 사용자에게는 변화 없음.
- 스플릿이 있으면 `Mod+1..9` 는 active 스플릿의 워크스페이스 탭 점프. 페인 점프는 `Mod+K Mod+1..9` 로 이주 — 점프 빈도가 더 낮은 쪽을 prefix 화.

이 충돌은 본 ADR 의 최대 UX 위험 중 하나다. 베타 채널 텔레메트리(D10) 의 `shortcut_pane_jump_after_split` 가 일정 임계 이하로 떨어지지 않으면 prefix 를 반대로 (페인 점프를 짧게, 워크스페이스 탭 점프를 prefix 로) 뒤집는 재논의 트리거.

### D8. 마이그레이션

기존(ADR-0010 까지) 사용자는 부팅 시 다음 변환을 받는다.

```
v1.x 단일 워크스페이스 ──fromLegacyWorkspace()──▶
  WindowLayout {
    root: { type: "ws-tabs", tabs: [ singleTab ], activeTabId: singleTab.id },
    activeTabId: singleTab.id,
  }

singleTab = {
  workspacePath: useWorkspace.current,
  paneTree: <기존 ADR-0003 LayoutNode 그대로>,
  tabState: {
    sidebarCollapsed: <기존 useLayout 값>,
    fileTreeExpanded: useFileTree.expanded[useWorkspace.current],
    fileTreeSortMode: useLayout.sortMode,
    ...
  }
}
```

`useFileTree.expanded` 의 나머지 워크스페이스 키들은 **버리지 않고** `recent-workspaces` 의 보조 expansion 캐시로 이관 — 사용자가 그 워크스페이스를 다시 열 때 첫 번째로 사용. ADR-0003 D5 의 backward-path 부재 정책을 이 ADR 도 그대로 승계 — 한번 변환된 `WindowLayout` 을 v1.x 형태로 되돌리지 않는다.

### D9. FS watcher 자원 정책

각 워크스페이스 탭이 활성화될 때마다 새로운 file system watcher 를 띄우면 N 개 워크스페이스가 동시에 watcher 를 보유하게 된다 — macOS FSEvents 든 Linux inotify 든 수십 개를 넘기면 노이즈가 급증한다. 정책:

- **가시성 기준 lazy init**: 화면에 렌더링되는(`WorkspaceTabsNode` 의 active 탭) 워크스페이스만 watcher 보유.
- 백그라운드 탭(같은 `WorkspaceTabsNode` 의 비활성 탭) 은 watcher 해제. 활성으로 돌아오면 onMount 시점에 한 번 풀 리프레시 후 재구독.
- LRU 캐시 상한: 동시 watcher 4 개 — 4 스플릿을 넘는 동시 가시는 흔치 않으므로 충분. 초과 시 가장 오래 active 였던 워크스페이스의 watcher 부터 해제.

이 정책은 ADR-0003 가 다루지 않은 영역이며 본 ADR 이 최초로 도입.

### D10. 텔레메트리

`useTelemetry` 를 통해 다음 신호를 수집 (사용자 opt-in 동일):

- `shell.workspace_tab_count` (히스토그램): 윈도우당 동시 보유 워크스페이스 탭 수. 분포 꼬리가 길면 D9 의 LRU 상한 재조정 근거.
- `shell.workspace_split_count` (히스토그램): 윈도우당 스플릿 수. (b)/(c) 와 비교한 옵션 (d) 채택의 정당성 검증.
- `shell.shortcut.<name>` (카운터): `mod_t`, `mod_w`, `mod_backslash`, `mod_shift_backslash`, `mod_1_to_9_pane`, `mod_1_to_9_workspace` 등. D7 충돌 재논의 트리거.
- `shell.watcher_evictions` (카운터): D9 의 LRU 가 watcher 를 해제한 횟수. 비정상적으로 잦으면 상한 상향.

이상 신호는 ADR-0004 와 동일하게 페이로드에 워크스페이스 경로/내용 일체 미포함.

## Consequences

### 양

- **진짜 다중 프로젝트 비교** — 별도 윈도우 / 재오픈 없이 좌우 비교. VSCode multi-root 의 트리 평탄화 부작용 없음 (워크스페이스마다 독립 파일트리).
- 한 스플릿만 쓰는 사용자에게는 시각적 변화가 없다 — degenerate case 가 자연스러움 (D1 끝).
- ADR-0003 의 모델/직렬화/마이그레이션이 한 글자도 안 바뀐다 — 회귀 영향 표면적 최소화.
- 워크스페이스 탭별 사이드바/파일트리 상태가 독립적이라 컨텍스트 점프의 인지 마찰이 줄어든다.

### 음

- 스토어 복잡도 증가 — `useShell` 신설, `useWorkspace`/`useFileTree`/`useLayout` 의 일부 필드가 deprecated 로 이행. 호출 site 약 30~40 곳 예상 수정.
- UI 밀도 — 4 스플릿 × 5 탭 시나리오에서 워크스페이스 탭 스트립이 좁아진다. Tab pinning(D2) 과 overflow chevron 으로 일부 완화하지만 디자인 단계에서 별도 검토.
- 단축키 충돌(D7) — 베타 기간 동안 사용자 혼란 가능성. 텔레메트리로 모니터링.
- `.markspread/layout.json` 의 의미가 격하된다 — 외부 동기화 도구(있다면) 가 기대치 변경. 문서 갱신 필요.

### 위험

| 위험 | 영향 | 완화 |
|---|---|---|
| 다중 워크스페이스 동시 watcher 로 인한 FS 이벤트 폭주 / 배터리 소모 | 高 | D9 의 가시성 기반 lazy init + LRU 4개 상한. 베타 기간 `shell.watcher_evictions` 모니터링 |
| `Mod+1..9` 단축키 충돌로 분할 사용자의 페인 점프 동선 파괴 | 中 | D7 의 prefix 정책 + 베타 텔레메트리 트리거. 최악의 경우 prefix 반대로 뒤집기 |
| 두 단계 트리(셸 + ADR-0003) 의 직렬화/복원 버그 — 한쪽이 깨지면 사용자가 모든 워크스페이스 컨텍스트 상실 | 高 | 셸 파일과 워크스페이스 파일을 분리(D4) 해 부분 손상 시 다른 한쪽으로 부분 복원. 부팅 시 schema validation + corruption 시 빈 윈도우 + 토스트로 폴백 |
| 같은 워크스페이스를 두 탭에 열었을 때 자동저장 race | 中 | ADR-0003 D2 의 충돌 해소 규칙(S-ESP-008) 가 path 단위라 그대로 적용. 두 탭이 같은 워크스페이스라도 path 가 같으면 ADR-0003 가 처리 |
| 워크스페이스 탭 드래그와 페인 탭 드래그의 zone 혼동으로 의도치 않은 이동 | 低 | D5 의 zone 분리 + drop target 제한 |

## Migration

ADR-0003 D5 의 톤을 그대로 잇는다.

1. v1.x 부팅 시 `useWorkspace.current` 가 비어 있지 않으면 `fromLegacyWorkspace()` 가 단일 워크스페이스 탭 하나로 채워진 `WindowLayout` 을 만든다 (D8).
2. `useWorkspace` / `useFileTree` / `useLayout` 은 한동안 그대로 둔다. 신규 `useShell` 이 truth source 이며, 기존 스토어들은 selector 가 `useShell` 로 위임하는 어댑터로 변신.
3. 분할/탭 추가 단축키를 한 번도 안 쓰는 사용자에게는 시각적 변화가 없다 — degenerate single-tab single-split 케이스가 v1.x 와 픽셀 동치.
4. 베타 한 사이클(2 주) 동안 텔레메트리 + 사용자 피드백으로 D7 충돌 정책과 D9 LRU 상한을 조정.
5. v1.3 GA 시점에 deprecated 스토어들의 어댑터 레이어 제거 일정 별도 ADR (예: ADR-0014).

## Alternatives revisited

1. **VSCode multi-root 워크스페이스** — 파일트리 평탄화. Markspread 의 워크스페이스 단위 메타(`.markspread/`, README, read-only) 가 평탄화와 충돌. 거부.
2. **윈도우 다중화로 해결** — 이미 가능하지만 단축키/명령 팔레트/AI 컨텍스트가 윈도우 단위라 비교 작업에서 컨텍스트 손실. 옵션 (a) 와 사실상 동일한 문제 잔존.
3. **셸 트리에서 `ws-tabs` 와 `ws-split` 을 한 노드 타입으로 통합** (`{ type, axis?, tabs?, children? }`) — JSON 은 짧아지지만 분기 코드가 모두 union 풀기 필요. 두 개념을 분리한 D1 의 가독성이 더 낫다.
4. **`Mod+1..9` 를 항상 워크스페이스 탭 점프로** — ADR-0003 의 페인 점프 동선이 깨짐. 페인 분할은 더 빈번하므로 거부 (D7).
5. **`.markspread/layout.json` 에 셸 레이아웃까지 통합** — 워크스페이스를 가로지르는 정보를 워크스페이스 내부 파일에 쓰는 의미 오용. 거부 (D4).

## Validation plan

- S-MWS-001: `WindowLayout` round-trip + schema 2 → 1 분리 마이그레이션 Vitest.
- S-MWS-002: 다중 워크스페이스 탭에서 같은 워크스페이스 두 번 열기 — expansion/scroll 독립 보장 Vitest.
- S-MWS-003: D9 의 watcher LRU 정책 — 5번째 탭 활성화 시 가장 오래된 watcher 해제 mock 검증.
- S-MWS-004: D7 의 `Mod+1..9` 분기 — 단일 스플릿일 때 페인 점프, 다중 스플릿일 때 워크스페이스 탭 점프 E2E.
- S-MWS-005: 드래그 zone 격리 — 워크스페이스 탭을 페인 영역에 drop 시 거부, 반대도 동일.
- 회귀: ADR-0003 의 모든 페인 분할 시나리오가 single-tab single-split 모드에서 변경 없이 통과 (S-ESP-002~014 재실행).

## References

- [ADR-0003: Editor tab + split-pane model](./0003-editor-tab-split-pane-model.md) — 본 ADR 이 확장하는 페인 트리 모델.
- S-SBC-007 (`e2e/sidebar-collapse.renderer.spec.ts`, `src/store/layout.ts`) — 영속화 키 패턴의 원형.
- `src/store/workspace.ts` — 단일 워크스페이스 truth source, 본 ADR 후 어댑터로 변신.
- `src/store/file-tree.ts` — `expanded: Record<workspace, string[]>` 의 deprecated 경로.
- `src/components/FileTree.tsx` — `props.workspace` 시그니처 유지하되 상태 소스만 교체.
- 후속 ADR 후보: 워크스페이스 탭의 드래그 → 새 윈도우 분리 (v1.3+), deprecated 어댑터 제거 (ADR-0014).
