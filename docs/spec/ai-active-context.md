# AI Active Context (S-ESP-010)

Status: Active — adopted for v1.1.
Owners: `editor::layout`, `ai::actions`.

This spec defines **which file, which selection, and which pane** an AI
action targets when the editor surface is split into multiple panes
(F4 — Editor Tabs & Split Panes). Before split panes existed the answer
was trivially "the active editor"; with N panes we need a stable rule
the user can predict.

## Goals

1. **Predictable**: a user invoking an AI action from anywhere (palette,
   right-click, hotkey) should know in advance which document the
   action will read.
2. **Override-friendly**: power users with multi-pane workflows must be
   able to pin context to a specific pane and trust the pin.
3. **Selection-aware**: an explicit text selection always beats focus
   heuristics. If the user highlighted something, that's the context.

## Resolution order

The active AI context is the first rule that matches:

| # | Rule                                                           | Source                              |
|---|----------------------------------------------------------------|-------------------------------------|
| 1 | A user-selected range exists in some pane → that pane          | `CodeMirror selection.main.empty`   |
| 2 | The user has **pinned** a pane via the AI palette → pinned     | `useAiContext.pinnedPaneId`         |
| 3 | The last-focused pane (`activePaneId`)                         | `useEditorLayout.activePaneId`      |
| 4 | The first pane in the layout tree                              | tree walk (`forEachPane`, stop)     |

If after rule 4 there is still no pane (impossible in normal flow — an
empty workspace always has one empty pane), AI actions degrade with the
`ai.context.unavailable` toast and no-op.

### Why selection-first

If the user highlighted three paragraphs and then hit `Cmd+K → Translate`,
they expect those paragraphs translated — not whatever happens to be in
the focused pane. Selection-first matches every other editor (VSCode,
Cursor, Sublime) and avoids a "where did my translation come from?"
support load.

### Why "last focused" instead of pointer position

Pointer-based context flickers as the user moves the cursor toward the
palette button. Focus is stickier: it only changes when the user clicks
into a pane (or `Mod+number` to switch via S-ESP-011). The palette and
hotkeys never steal focus, so the pane that owned focus before the
action stays the active pane.

### Pin behavior

A pinned pane stays the AI context until:

- The user unpins it (palette → "Unpin AI context"); or
- The pinned pane is closed by user / prune / crash recovery.

Pin is **per-workspace** and **session-scoped** (not persisted to
`layout.json`). Pins are an explicit, in-the-moment override; making
them survive a restart would surprise users on the next open. The pin
target id is held in `useAiContext.pinnedPaneId`.

## State shape

```ts
interface AiActiveContext {
  paneId: PaneId;           // resolved per rule above
  tabId: TabId | null;      // pane.activeTabId
  path: string | null;      // tab.path
  selection:
    | { kind: "none" }
    | { kind: "range"; from: number; to: number; text: string };
}
```

Hosts compute this lazily — there is no live store entry. The resolver
sits in `src/lib/ai/active-context.ts` (to be added with S-ESP-012)
and is called by every AI entry point at invocation time.

## UI surface

- The active context preview appears in the AI palette header:
  `<basename(path)> — pane <n>` (one-based pane index by DFS order).
- A "📌 pin to this pane" toggle in the palette flips
  `useAiContext.pinnedPaneId` to the resolved pane.
- The status bar (future S-AI-* work) mirrors the same string so the
  context is visible even without the palette open.

## Telemetry

The AI invocation event carries `paneCount` and a boolean
`pinnedContext`. We track these (not the path) so we can see whether
multi-pane users adopt pinning at the rate we expect. Anything more
detailed would leak document content.

## Open questions (deferred)

- **Multi-pane fan-out** ("apply to all panes showing this file") —
  out of scope for v1.1; the buffer-share work in S-ESP-007 already
  mirrors edits cross-pane, so a single-pane action propagates.
- **Pin per-action vs per-pane** — current design is per-pane; if users
  need "translate is always pane A, summarize is always pane B" we'll
  revisit in a later sprint with usage data in hand.

## References

- ADR-0003: editor tab + split-pane model (`docs/adr/0003-editor-tab-split-pane-model.md`).
- F4 unit (S-ESP-001..S-ESP-014).
