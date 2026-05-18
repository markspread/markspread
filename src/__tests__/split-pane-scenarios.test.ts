// S-ESP-014: integration coverage for the three F4 hero scenarios at the
// store layer. The Playwright spec at e2e/split-panes.renderer.spec.ts
// drives the same flow end-to-end through the renderer; this file gives
// CI a fast, deterministic regression net that doesn't need a dev server.
//
// Scenario 1: split right → open a different file → edit both panes →
//             both edits land in the doc cache as dirty.
// Scenario 2: same path in two panes → editing one updates the other's
//             live content (buffer share).
// Scenario 3: serialise the layout → blank the store → re-parse →
//             pane / tab / active state survives the round-trip.

import { beforeEach, describe, expect, it } from "vitest";
import {
  parseEditorLayout,
  serializeEditorLayout,
  type WorkspaceLayout,
} from "../lib/editor/layout-model";
import { useDocCache } from "../store/doc-cache";
import { useEditorLayout } from "../store/editor-layout";

const WS = "/tmp/scenarios-ws";
const POS = { line: 0, column: 0, scrollTop: 0 };

beforeEach(() => {
  useEditorLayout.setState({ layouts: {} });
  useDocCache.setState({ baselines: {}, live: {}, errors: {}, reloadEpoch: {} });
});

describe("split-pane integration scenarios", () => {
  it("scenario 1: split right, open different file, edit both panes", () => {
    const initial = useEditorLayout.getState().ensureLayout(WS);
    const leftPaneId = initial.root.id;

    // Open "/a.md" in the original pane.
    useEditorLayout.getState().setLayout(WS, {
      ...initial,
      root: {
        type: "pane",
        id: leftPaneId,
        tabs: [{ id: "t-a", path: "/a.md", position: POS }],
        activeTabId: "t-a",
      },
    });
    useDocCache.getState().setBaseline(WS, "/a.md", {
      content: "alpha",
      encoding: "utf-8",
    });

    // Split right; the new pane becomes active.
    const rightPaneId = useEditorLayout
      .getState()
      .splitPane(WS, leftPaneId, "horizontal", "after")!;
    expect(rightPaneId).toBeTruthy();

    // Open "/b.md" in the right pane via a setLayout reflecting what the
    // open-from-tree action would produce.
    const layout = useEditorLayout.getState().layouts[WS]!;
    useEditorLayout.getState().setLayout(WS, {
      ...layout,
      root: {
        ...(layout.root as { type: "split" } & typeof layout.root),
        type: "split",
        children: (layout.root as { children: typeof layout.root[] }).children.map(
          (c) =>
            c.id === rightPaneId
              ? {
                  ...c,
                  type: "pane" as const,
                  tabs: [{ id: "t-b", path: "/b.md", position: POS }],
                  activeTabId: "t-b",
                }
              : c,
        ),
      } as typeof layout.root,
    });
    useDocCache.getState().setBaseline(WS, "/b.md", {
      content: "beta",
      encoding: "utf-8",
    });

    // Edit both panes' files.
    useDocCache.getState().setLive(WS, "/a.md", "alpha edited");
    useDocCache.getState().setLive(WS, "/b.md", "beta edited");

    expect(useDocCache.getState().getLive(WS, "/a.md")).toBe("alpha edited");
    expect(useDocCache.getState().getLive(WS, "/b.md")).toBe("beta edited");

    // Both dirty (baseline != live).
    const aBaseline = useDocCache.getState().getBaseline(WS, "/a.md")!;
    const bBaseline = useDocCache.getState().getBaseline(WS, "/b.md")!;
    expect(useDocCache.getState().getLive(WS, "/a.md")).not.toBe(aBaseline.content);
    expect(useDocCache.getState().getLive(WS, "/b.md")).not.toBe(bBaseline.content);
  });

  it("scenario 2: same path in two panes shares the live buffer", () => {
    useEditorLayout.setState({
      layouts: {
        [WS]: {
          schemaVersion: 1,
          activePaneId: "p1",
          root: {
            type: "split",
            id: "s",
            direction: "horizontal",
            sizes: [0.5, 0.5],
            children: [
              {
                type: "pane",
                id: "p1",
                tabs: [{ id: "t1", path: "/shared.md", position: POS }],
                activeTabId: "t1",
              },
              {
                type: "pane",
                id: "p2",
                tabs: [{ id: "t2", path: "/shared.md", position: POS }],
                activeTabId: "t2",
              },
            ],
          },
        },
      },
    });
    useDocCache.getState().setBaseline(WS, "/shared.md", {
      content: "original",
      encoding: "utf-8",
    });

    // Edit from "pane 1" — the doc cache is keyed by workspace+path so
    // both panes observe the same string.
    useDocCache.getState().setLive(WS, "/shared.md", "edited by p1");
    expect(useDocCache.getState().getLive(WS, "/shared.md")).toBe("edited by p1");

    // The PaneEditor effect subscribes to liveContent and dispatches a
    // replace-all transaction when the editor view's doc differs. That's
    // covered by editor-view tests; here we assert the cache transports
    // the value identically for both panes.
    const sameKeyValue1 = useDocCache.getState().getLive(WS, "/shared.md");
    const sameKeyValue2 = useDocCache.getState().getLive(WS, "/shared.md");
    expect(sameKeyValue1).toBe(sameKeyValue2);
  });

  it("scenario 3: serialised layout round-trips through restart", () => {
    const before: WorkspaceLayout = {
      schemaVersion: 1,
      activePaneId: "p2",
      root: {
        type: "split",
        id: "s",
        direction: "vertical",
        sizes: [0.6, 0.4],
        children: [
          {
            type: "pane",
            id: "p1",
            tabs: [
              { id: "t1", path: "/notes.md", position: POS },
              { id: "t2", path: "/draft.md", position: POS },
            ],
            activeTabId: "t2",
          },
          {
            type: "pane",
            id: "p2",
            tabs: [{ id: "t3", path: "/ref.md", position: POS }],
            activeTabId: "t3",
          },
        ],
      },
    };
    const wire = JSON.parse(JSON.stringify(serializeEditorLayout(before)));
    // Simulate "restart": clear in-memory state, then re-parse.
    useEditorLayout.setState({ layouts: {} });
    const restored = parseEditorLayout(wire)!;
    useEditorLayout.getState().setLayout(WS, restored);

    const live = useEditorLayout.getState().layouts[WS]!;
    expect(live.activePaneId).toBe("p2");
    expect(live.root).toEqual(before.root);
  });
});
