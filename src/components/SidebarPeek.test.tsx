import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_: string, fallback?: string) => fallback ?? "" }),
}));

vi.mock("./FileTree", () => ({
  FileTree: ({ workspace }: { workspace: string }) => (
    <div data-testid="filetree" data-ws={workspace}>
      <div role="tree" data-filetree-root="true" tabIndex={-1} data-testid="tree-root" />
    </div>
  ),
}));

vi.mock("./Icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}));

import { useSidebarPeek } from "../store/sidebar-peek";
import { useWorkspace } from "../store/workspace";
import { SidebarPeek } from "./SidebarPeek";

afterEach(cleanup);

beforeEach(() => {
  act(() => {
    useSidebarPeek.setState({ open: false, pinned: false, restoreFocusEl: null });
    useWorkspace.setState({ current: null, readOnly: false });
  });
});

describe("SidebarPeek", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<SidebarPeek />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the dialog with FileTree when open and workspace set", () => {
    act(() => {
      useWorkspace.setState({ current: "/ws", readOnly: false });
      useSidebarPeek.setState({ open: true });
    });
    const { getByRole, getByTestId } = render(<SidebarPeek />);
    expect(getByRole("dialog")).toBeTruthy();
    expect(getByTestId("filetree")).toBeTruthy();
  });

  it("omits FileTree when no workspace", () => {
    act(() => {
      useSidebarPeek.setState({ open: true });
    });
    const { queryByTestId } = render(<SidebarPeek />);
    expect(queryByTestId("filetree")).toBeNull();
  });

  it("closes on Escape", () => {
    act(() => {
      useSidebarPeek.setState({ open: true });
    });
    render(<SidebarPeek />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(useSidebarPeek.getState().open).toBe(false);
  });

  it("toggles pin on Mod+Shift+B", () => {
    act(() => {
      useSidebarPeek.setState({ open: true, pinned: false });
    });
    render(<SidebarPeek />);
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "b", metaKey: true, shiftKey: true }),
      );
    });
    expect(useSidebarPeek.getState().pinned).toBe(true);
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "B", ctrlKey: true, shiftKey: true }),
      );
    });
    expect(useSidebarPeek.getState().pinned).toBe(false);
  });

  it("ignores unrelated keys", () => {
    act(() => {
      useSidebarPeek.setState({ open: true });
    });
    render(<SidebarPeek />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true }));
    });
    expect(useSidebarPeek.getState().open).toBe(true);
    expect(useSidebarPeek.getState().pinned).toBe(false);
  });

  it("does not register keydown when closed", () => {
    render(<SidebarPeek />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    // still closed and nothing throws
    expect(useSidebarPeek.getState().open).toBe(false);
  });

  it("closes on pointerdown outside the dialog and the rail", () => {
    act(() => {
      useSidebarPeek.setState({ open: true });
    });
    render(<SidebarPeek />);
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    act(() => {
      const evt = new Event("pointerdown", { bubbles: true });
      outside.dispatchEvent(evt);
    });
    expect(useSidebarPeek.getState().open).toBe(false);
    outside.remove();
  });

  it("ignores pointerdown inside the dialog", () => {
    act(() => {
      useSidebarPeek.setState({ open: true });
    });
    const { getByRole } = render(<SidebarPeek />);
    const dialog = getByRole("dialog");
    act(() => {
      fireEvent.pointerDown(dialog);
    });
    expect(useSidebarPeek.getState().open).toBe(true);
  });

  it("ignores pointerdown on the sidebar rail", () => {
    act(() => {
      useSidebarPeek.setState({ open: true });
    });
    render(<SidebarPeek />);
    const rail = document.createElement("button");
    rail.setAttribute("data-sidebar-rail", "");
    document.body.appendChild(rail);
    act(() => {
      const evt = new Event("pointerdown", { bubbles: true });
      rail.dispatchEvent(evt);
    });
    expect(useSidebarPeek.getState().open).toBe(true);
    rail.remove();
  });

  it("ignores pointerdown targets that are not Nodes", () => {
    act(() => {
      useSidebarPeek.setState({ open: true });
    });
    render(<SidebarPeek />);
    act(() => {
      const evt = new Event("pointerdown", { bubbles: true });
      Object.defineProperty(evt, "target", { value: { not: "a node" }, configurable: true });
      document.dispatchEvent(evt);
    });
    expect(useSidebarPeek.getState().open).toBe(true);
  });

  it("skips pointerdown-outside when pinned", () => {
    act(() => {
      useSidebarPeek.setState({ open: true, pinned: true });
    });
    render(<SidebarPeek />);
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    act(() => {
      const evt = new Event("pointerdown", { bubbles: true });
      outside.dispatchEvent(evt);
    });
    expect(useSidebarPeek.getState().open).toBe(true);
    outside.remove();
  });

  it("closes on focusin outside the dialog and rail", () => {
    act(() => {
      useSidebarPeek.setState({ open: true });
    });
    render(<SidebarPeek />);
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    act(() => {
      const evt = new FocusEvent("focusin", { bubbles: true });
      Object.defineProperty(evt, "target", { value: outside, configurable: true });
      document.dispatchEvent(evt);
    });
    expect(useSidebarPeek.getState().open).toBe(false);
    outside.remove();
  });

  it("ignores focusin inside the dialog", () => {
    act(() => {
      useSidebarPeek.setState({ open: true });
    });
    const { getByRole } = render(<SidebarPeek />);
    const dialog = getByRole("dialog");
    act(() => {
      const evt = new FocusEvent("focusin", { bubbles: true });
      Object.defineProperty(evt, "target", { value: dialog, configurable: true });
      document.dispatchEvent(evt);
    });
    expect(useSidebarPeek.getState().open).toBe(true);
  });

  it("ignores focusin on the sidebar rail", () => {
    act(() => {
      useSidebarPeek.setState({ open: true });
    });
    render(<SidebarPeek />);
    const rail = document.createElement("button");
    rail.setAttribute("data-sidebar-rail", "");
    document.body.appendChild(rail);
    act(() => {
      const evt = new FocusEvent("focusin", { bubbles: true });
      Object.defineProperty(evt, "target", { value: rail, configurable: true });
      document.dispatchEvent(evt);
    });
    expect(useSidebarPeek.getState().open).toBe(true);
    rail.remove();
  });

  it("ignores focusin targets that are not Elements", () => {
    act(() => {
      useSidebarPeek.setState({ open: true });
    });
    render(<SidebarPeek />);
    act(() => {
      const evt = new FocusEvent("focusin", { bubbles: true });
      Object.defineProperty(evt, "target", { value: null, configurable: true });
      document.dispatchEvent(evt);
    });
    expect(useSidebarPeek.getState().open).toBe(true);
  });

  it("skips focusin-outside when pinned", () => {
    act(() => {
      useSidebarPeek.setState({ open: true, pinned: true });
    });
    render(<SidebarPeek />);
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    act(() => {
      const evt = new FocusEvent("focusin", { bubbles: true });
      Object.defineProperty(evt, "target", { value: outside, configurable: true });
      document.dispatchEvent(evt);
    });
    expect(useSidebarPeek.getState().open).toBe(true);
    outside.remove();
  });

  it("focuses the tree root after the mount microtask when workspace set", () => {
    vi.useFakeTimers();
    act(() => {
      useWorkspace.setState({ current: "/ws", readOnly: false });
      useSidebarPeek.setState({ open: true });
    });
    const { getByTestId } = render(<SidebarPeek />);
    const tree = getByTestId("tree-root") as HTMLElement;
    const spy = vi.spyOn(tree, "focus");
    act(() => {
      vi.runAllTimers();
    });
    expect(spy).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("falls back to the dialog wrapper when no tree is mounted", () => {
    vi.useFakeTimers();
    act(() => {
      useSidebarPeek.setState({ open: true });
    });
    const { getByRole } = render(<SidebarPeek />);
    const dialog = getByRole("dialog") as HTMLElement;
    const spy = vi.spyOn(dialog, "focus");
    act(() => {
      vi.runAllTimers();
    });
    expect(spy).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("toggles pin via the header button", () => {
    act(() => {
      useSidebarPeek.setState({ open: true, pinned: false });
    });
    const { getByRole } = render(<SidebarPeek />);
    const btn = getByRole("button", { name: "Pin peek" });
    fireEvent.click(btn);
    expect(useSidebarPeek.getState().pinned).toBe(true);
  });

  it("renders the unpin label when pinned", () => {
    act(() => {
      useSidebarPeek.setState({ open: true, pinned: true });
    });
    const { getByRole, getByTestId } = render(<SidebarPeek />);
    expect(getByRole("button", { name: "Unpin peek" })).toBeTruthy();
    expect(getByTestId("icon-pin")).toBeTruthy();
  });
});
