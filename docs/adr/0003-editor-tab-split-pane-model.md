# ADR-0003: Editor tab + split-pane model

| Field | Value |
|---|---|
| Status | **Accepted** (S-ESP-001 · MAR-874) |
| Date | 2026-05-13 |
| Owners | Editor Ergonomics unit (F4) |
| Supersedes | — |
| Superseded by | — |
| Related | `src/lib/editor/layout-model.ts`, `src/store/tabs.ts` (legacy), `src-tauri/src/workspace.rs` (layout.json), F4 unit (S-ESP-002 ~ S-ESP-014) |

## Context

v1.0 의 에디터 셸은 **단일 페인 · flat tabs 배열** 모델이다. `useTabs` 는 `OpenTab[]` 와 단일 `activePath` 만 안다. F4 는 같은 워크스페이스 안에서 동시 다중 편집(좌우 분할, 상하 분할, 같은 파일 두 곳에서 다른 위치) 을 도입한다. 이를 위해서는:

1. 페인이 재귀적으로 분할되는 트리 형태 데이터 모델
2. 페인별 독립 탭 스트립 + active 탭 추적
3. 같은 `path` 를 두 페인이 공유할 때 콘텐츠는 공유, ViewState(커서·스크롤)는 분리
4. 워크스페이스 재오픈 시 레이아웃 복원
5. 기존 단일 페인 사용자가 무손실로 마이그레이션

기존 `useTabs` 는 한동안 그대로 두고 새 모델을 옆에 세운 뒤, 단계적으로 사용자를 옮긴다.

## Decision

### D1. 트리 형태

```
LayoutNode = PaneNode | SplitNode
PaneNode   = { type: "pane",  id, tabs[], activeTabId }
SplitNode  = { type: "split", id, direction: "horizontal" | "vertical",
               children[], sizes[] }
```

- `direction: "horizontal"` 은 **가로로 늘어선** 분할 — 좌우(`A | B`)
- `direction: "vertical"` 은 **세로로 늘어선** 분할 — 상하(`A / B`)
- `SplitNode.children.length >= 2` 여야 한다. 1개 자식의 분할은 무의미하므로 단순화 시점에 `PaneNode` 또는 부모로 흡수된다 (S-ESP-003 에서 보장).
- `sizes` 는 같은 길이의 상대 비율. 정규화는 렌더 시점.

이항 트리(2-children-only) 가 아닌 **flat N-children** 을 선택한 이유:

- 3-페인 균등 분할이 `((A|B)|C)` vs `(A|(B|C))` 두 가지로 표현될 수 있어 순서 편향이 코드로 새어 들어옴
- 드래그 재배치 시 동일 축의 자식 순서만 바꾸면 끝 — 트리 재구성 불필요
- VSCode 도 같은 구조

### D2. 탭과 ViewState

`PaneTab = { id, path, position, preview?, pinned?, dirty?, orphaned? }`

- `id` 는 **path 와 분리**. 같은 path 를 두 페인이 열고 있어도 서로 다른 `id`.
- `position: EditorPosition` 은 페인 로컬. 같은 파일을 두 페인이 열면 각각 다른 커서 / 스크롤
- `preview` / `pinned` / `dirty` / `orphaned` 의 의미는 v1.0 과 동일

같은 path 를 갖는 두 PaneTab 은 **같은 파일 콘텐츠(저장된 텍스트)** 를 공유한다. 한 페인에서 편집한 결과는 동일 path 의 다른 페인 PaneTab 에도 자동저장 후 반영된다 (S-ESP-008 자동저장 동기화). 충돌 해소 규칙은 S-ESP-008 에서 별도 정의.

### D3. 직렬화 포맷 (layout.json)

`.markspread/layout.json` 에 다음 스키마로 저장한다.

```jsonc
{
  "schemaVersion": 1,
  "editor": {
    "root": {
      "type": "split",
      "id": "s0",
      "direction": "horizontal",
      "sizes": [0.6, 0.4],
      "children": [
        {
          "type": "pane",
          "id": "p0",
          "activeTabId": "t1",
          "tabs": [
            { "id": "t0", "path": "notes/intro.md", "position": {"line":1,"column":1,"scrollTop":0} },
            { "id": "t1", "path": "spec/api.md",    "position": {"line":42,"column":3,"scrollTop":640} }
          ]
        },
        {
          "type": "pane",
          "id": "p1",
          "activeTabId": "t2",
          "tabs": [
            { "id": "t2", "path": "spec/api.md",    "position": {"line":1,"column":1,"scrollTop":0} }
          ]
        }
      ]
    },
    "activePaneId": "p0"
  },
  /* sidebar / hidden / sortMode etc. — S-SBC-004 */
  "sidebar": { … }
}
```

- 기존 `layout.json` (S-SBC-004) 와 같은 파일을 공유한다 — 사이드바 상태도 워크스페이스 단위 레이아웃이므로 한 곳에 모은다
- `schemaVersion` 충돌 시 D5 의 마이그레이션 경로
- `tabs[].dirty` / `orphaned` 는 **저장하지 않는다** — 런타임 상태이며 재오픈 시 콘텐츠로부터 재계산

### D4. 활성 페인 (activePaneId)

워크스페이스 차원에서 단 하나의 active 페인이 존재. 마우스 클릭 / `Mod+1..9` / `Mod+K Mod+→` 등으로 변경 (S-ESP-011). 활성 페인의 활성 탭이 명령 팔레트의 `Close Tab` / `Save` 등의 대상이 된다.

`activePaneId` 가 가리키는 페인이 트리 단순화로 사라진 경우(분할 해제 등) 가까운 형제 페인으로 이전한다 — preorder 탐색 첫 번째 페인. 트리에 페인이 없을 수는 없다 (D1 의 항상-최소-1-페인 불변).

### D5. 마이그레이션

```
v1.0 useTabs (flat) ──fromLegacyTabs()──▶ v1 WorkspaceLayout (single pane)
```

`fromLegacyTabs(tabs, activePath)` 가 단일 페인 트리 하나를 만들고, 기존 `OpenTab.path` 별로 새 `tabId` 를 할당한다. 첫 마운트 시점에 호출되고 결과를 새 store 로 흘려보낸다. 기존 `useTabs` 는 일정 기간 fallback 으로 유지하다가 F4 가 fully replace 되는 시점에 제거.

backward path 는 만들지 않는다 — 사용자가 v1.0 으로 돌아갈 수단이 다른 통로(파일트리에서 다시 열기) 로 충분히 보장된다.

### D6. 화면에 단일 페인만 있는 경우

`root.type === "pane"` 인 분할 없는 상태는 v1.0 과 시각적으로 동일하다. F4 가 들어와도 분할을 하지 않은 사용자는 기능 변화를 거의 못 느낀다 — 추가된 키보드 단축키(분할 명령) 만 새로 등장.

### D7. 식별자 발급

`id` 는 `crypto.randomUUID().slice(0, 8)` 로 발급. 디스크에 저장되므로 짧고 안정적이어야 함. 충돌 가능성: 8 문자 hex 는 약 16M 분의 1 — 한 워크스페이스에 수십 페인/탭 정도면 사실상 0.

테스트는 팩토리 주입(`paneIdFactory`, `tabIdFactory`) 으로 결정적 id 발급. (S-ESP-014 의 E2E 시나리오에서 활용).

### D8. 모델 외 동작

- 페인 간 드래그 이동(S-ESP-004), CodeMirror 다중 인스턴스(S-ESP-005), 페인별 독립 스크롤(S-ESP-006), AI active context(S-ESP-010) 는 같은 모델 위에 얹는 동작 정의. 이 ADR 은 데이터 모양만 책임짐.

## Consequences

- 모든 새 페인/탭 관련 코드는 `WorkspaceLayout` 트리에 대고 작성된다. flat-array 가정이 남아 있는 코드(현재 `useTabs.tabs`) 는 F4 단위 안에서 점진 마이그레이션.
- `.markspread/layout.json` 의 스키마가 확장된다 — 기존 S-SBC-004 의 schemaVersion 1 는 `editor` 필드를 무시했다. 추가가 안전한 추가(additive) 이므로 schemaVersion 은 유지.
- 다중 페인이 같은 파일을 열 때 자동저장 충돌 해소 규칙(S-ESP-008) 이 새 필수 항목. 모델 자체로는 충돌이 안 막힘.
- ID 가 디스크에 저장되므로 무엇이 "같은 탭" 인지가 path 가 아니라 id 로 결정됨 — 외부 도구(예: 백업 스크립트) 가 layout.json 을 깎아 쓰려면 이 규약을 알아야 함.

## Alternatives considered

1. **단일 active 페인 + tab 그룹** — 현재 `useTabs` 의 `tabs` 를 그룹화. 분할 시각화는 가능하지만 페인별 독립 ViewState 가 어렵다. 거부
2. **이진 트리** — VSCode 가 한때 사용. 자식 순서 편향이 코드로 새는 단점이 있어 거부 (D1)
3. **DOM-based layout (CSS grid)** — 데이터 모델 없이 DOM 위치만으로 저장. 복원이 어렵고 드래그 이벤트 처리 복잡. 거부
4. **layout.json 분리 (editor-layout.json)** — 사이드바 layout 과 분리. 같은 시점에 변경되는 데이터를 두 파일로 쪼개면 atomic write 보장이 깨짐. 한 파일에 통합
