// Unit tests for the small zustand stores: ai-palette, dialogs,
// single-file, sidebar-peek, onboarding.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionContext } from "../lib/ai/actions";
import { useAiPalette } from "../store/ai-palette";
import { useDialogs } from "../store/dialogs";
import { TOUR_STEPS, useOnboarding } from "../store/onboarding";
import { useSidebarPeek } from "../store/sidebar-peek";
import { useSingleFile } from "../store/single-file";

const EMPTY_CONTEXT: ActionContext = {
  hasSelection: false,
  documentLength: 0,
  inCodeBlock: false,
};

describe("ai-palette store", () => {
  beforeEach(() => {
    useAiPalette.setState({ open: false, context: EMPTY_CONTEXT });
  });

  it("opens with the supplied context", () => {
    const ctx: ActionContext = {
      hasSelection: true,
      documentLength: 42,
      inCodeBlock: true,
    };
    useAiPalette.getState().openPalette(ctx);
    expect(useAiPalette.getState().open).toBe(true);
    expect(useAiPalette.getState().context).toEqual(ctx);
  });

  it("opens with the empty context when none is supplied", () => {
    useAiPalette.getState().openPalette();
    expect(useAiPalette.getState().open).toBe(true);
    expect(useAiPalette.getState().context).toEqual(EMPTY_CONTEXT);
  });

  it("closes", () => {
    useAiPalette.setState({ open: true });
    useAiPalette.getState().close();
    expect(useAiPalette.getState().open).toBe(false);
  });
});

describe("dialogs store", () => {
  beforeEach(() => {
    useDialogs.setState({
      insertTable: false,
      image: false,
      link: false,
      exportDoc: false,
    });
  });

  it("toggles insert table", () => {
    useDialogs.getState().showInsertTable();
    expect(useDialogs.getState().insertTable).toBe(true);
    useDialogs.getState().hideInsertTable();
    expect(useDialogs.getState().insertTable).toBe(false);
  });

  it("toggles image", () => {
    useDialogs.getState().showImage();
    expect(useDialogs.getState().image).toBe(true);
    useDialogs.getState().hideImage();
    expect(useDialogs.getState().image).toBe(false);
  });

  it("toggles link", () => {
    useDialogs.getState().showLink();
    expect(useDialogs.getState().link).toBe(true);
    useDialogs.getState().hideLink();
    expect(useDialogs.getState().link).toBe(false);
  });

  it("toggles export", () => {
    useDialogs.getState().showExport();
    expect(useDialogs.getState().exportDoc).toBe(true);
    useDialogs.getState().hideExport();
    expect(useDialogs.getState().exportDoc).toBe(false);
  });

  it("keeps dialogs independent", () => {
    useDialogs.getState().showImage();
    expect(useDialogs.getState().link).toBe(false);
    expect(useDialogs.getState().insertTable).toBe(false);
    expect(useDialogs.getState().exportDoc).toBe(false);
  });
});

describe("single-file store", () => {
  beforeEach(() => {
    useSingleFile.setState({ path: null, content: "", dirty: false });
  });

  it("opens a file clean", () => {
    useSingleFile.getState().open("/a.md", "hello");
    expect(useSingleFile.getState().path).toBe("/a.md");
    expect(useSingleFile.getState().content).toBe("hello");
    expect(useSingleFile.getState().dirty).toBe(false);
  });

  it("setContent marks dirty", () => {
    useSingleFile.getState().open("/a.md", "hello");
    useSingleFile.getState().setContent("world");
    expect(useSingleFile.getState().content).toBe("world");
    expect(useSingleFile.getState().dirty).toBe(true);
  });

  it("markSaved clears dirty", () => {
    useSingleFile.getState().open("/a.md", "hello");
    useSingleFile.getState().setContent("world");
    useSingleFile.getState().markSaved();
    expect(useSingleFile.getState().dirty).toBe(false);
    expect(useSingleFile.getState().content).toBe("world");
  });

  it("close resets to initial state", () => {
    useSingleFile.getState().open("/a.md", "hello");
    useSingleFile.getState().setContent("world");
    useSingleFile.getState().close();
    expect(useSingleFile.getState().path).toBeNull();
    expect(useSingleFile.getState().content).toBe("");
    expect(useSingleFile.getState().dirty).toBe(false);
  });
});

describe("sidebar-peek store", () => {
  beforeEach(() => {
    useSidebarPeek.setState({ open: false, pinned: false, restoreFocusEl: null });
  });

  it("show opens and remembers the restore element", () => {
    const el = { focus: vi.fn() } as unknown as HTMLElement;
    useSidebarPeek.getState().show(el);
    expect(useSidebarPeek.getState().open).toBe(true);
    expect(useSidebarPeek.getState().restoreFocusEl).toBe(el);
  });

  it("show defaults restore element to null", () => {
    useSidebarPeek.getState().show();
    expect(useSidebarPeek.getState().open).toBe(true);
    expect(useSidebarPeek.getState().restoreFocusEl).toBeNull();
  });

  it("show is a no-op when already open", () => {
    const first = { focus: vi.fn() } as unknown as HTMLElement;
    useSidebarPeek.getState().show(first);
    const second = { focus: vi.fn() } as unknown as HTMLElement;
    useSidebarPeek.getState().show(second);
    expect(useSidebarPeek.getState().restoreFocusEl).toBe(first);
  });

  it("hide restores focus and clears state", () => {
    const el = { focus: vi.fn() } as unknown as HTMLElement;
    useSidebarPeek.setState({ open: true, pinned: true, restoreFocusEl: el });
    useSidebarPeek.getState().hide();
    expect(useSidebarPeek.getState().open).toBe(false);
    expect(useSidebarPeek.getState().pinned).toBe(false);
    expect(useSidebarPeek.getState().restoreFocusEl).toBeNull();
    expect(el.focus).toHaveBeenCalledTimes(1);
  });

  it("hide is a no-op when already closed", () => {
    const el = { focus: vi.fn() } as unknown as HTMLElement;
    useSidebarPeek.setState({ open: false, restoreFocusEl: el });
    useSidebarPeek.getState().hide();
    expect(el.focus).not.toHaveBeenCalled();
  });

  it("hide tolerates a null restore element", () => {
    useSidebarPeek.setState({ open: true, restoreFocusEl: null });
    expect(() => useSidebarPeek.getState().hide()).not.toThrow();
    expect(useSidebarPeek.getState().open).toBe(false);
  });

  it("togglePinned flips the pinned flag", () => {
    useSidebarPeek.getState().togglePinned();
    expect(useSidebarPeek.getState().pinned).toBe(true);
    useSidebarPeek.getState().togglePinned();
    expect(useSidebarPeek.getState().pinned).toBe(false);
  });
});

describe("onboarding store", () => {
  beforeEach(() => {
    useOnboarding.setState({
      welcomeBannerDismissed: false,
      tourCompleted: false,
      tourStep: null,
      shortcutHintDismissed: false,
    });
  });

  it("dismissBanner sets the flag", () => {
    useOnboarding.getState().dismissBanner();
    expect(useOnboarding.getState().welcomeBannerDismissed).toBe(true);
  });

  it("resetBanner clears banner + tour completion", () => {
    useOnboarding.setState({ welcomeBannerDismissed: true, tourCompleted: true });
    useOnboarding.getState().resetBanner();
    expect(useOnboarding.getState().welcomeBannerDismissed).toBe(false);
    expect(useOnboarding.getState().tourCompleted).toBe(false);
  });

  it("startTour begins at step 0 and dismisses the banner", () => {
    useOnboarding.getState().startTour();
    expect(useOnboarding.getState().tourStep).toBe(0);
    expect(useOnboarding.getState().welcomeBannerDismissed).toBe(true);
  });

  it("nextTourStep advances through the tour", () => {
    useOnboarding.getState().startTour();
    useOnboarding.getState().nextTourStep();
    expect(useOnboarding.getState().tourStep).toBe(1);
  });

  it("nextTourStep is a no-op when no tour is running", () => {
    useOnboarding.getState().nextTourStep();
    expect(useOnboarding.getState().tourStep).toBeNull();
  });

  it("nextTourStep completes the tour at the last step", () => {
    useOnboarding.setState({ tourStep: TOUR_STEPS.length - 1 });
    useOnboarding.getState().nextTourStep();
    expect(useOnboarding.getState().tourStep).toBeNull();
    expect(useOnboarding.getState().tourCompleted).toBe(true);
  });

  it("endTour clears the step and records completion", () => {
    useOnboarding.setState({ tourStep: 2 });
    useOnboarding.getState().endTour(true);
    expect(useOnboarding.getState().tourStep).toBeNull();
    expect(useOnboarding.getState().tourCompleted).toBe(true);
  });

  it("endTour can record an abandoned tour", () => {
    useOnboarding.setState({ tourStep: 2 });
    useOnboarding.getState().endTour(false);
    expect(useOnboarding.getState().tourStep).toBeNull();
    expect(useOnboarding.getState().tourCompleted).toBe(false);
  });

  it("dismissShortcutHint sets the flag", () => {
    useOnboarding.getState().dismissShortcutHint();
    expect(useOnboarding.getState().shortcutHintDismissed).toBe(true);
  });
});
