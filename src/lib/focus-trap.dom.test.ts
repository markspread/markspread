// S-A11-003: focus-trap hook.

import { render } from "@testing-library/react";
import { type ReactNode, createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FocusTrapOptions, useFocusTrap } from "./focus-trap";

// jsdom reports offsetParent === null for everything; `focusable()` filters
// on that. Stub it on the prototype so rendered buttons survive the filter.
let offsetSpy: { mockRestore: () => void } | null = null;

function Trap(props: { opts: FocusTrapOptions; children?: ReactNode }): ReactNode {
  const ref = useFocusTrap<HTMLDivElement>(props.opts);
  return h("div", { ref, "data-testid": "trap" }, props.children);
}

function btn(id: string): ReactNode {
  return h("button", { type: "button", id, key: id }, id);
}

beforeEach(() => {
  document.body.innerHTML = "";
  offsetSpy = vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockReturnValue(document.body);
});

afterEach(() => {
  offsetSpy?.mockRestore();
  document.body.innerHTML = "";
});

describe("useFocusTrap", () => {
  it("does nothing when inactive", () => {
    const r = render(h(Trap, { opts: { active: false } }, btn("a")));
    expect(r.getByTestId("trap")).toBeDefined();
  });

  it("focuses the first focusable child when activated", () => {
    render(h(Trap, { opts: { active: true } }, [btn("a"), btn("b")]));
    expect(document.activeElement?.id).toBe("a");
  });

  it("makes the container focusable when there are no focusable children", () => {
    render(h(Trap, { opts: { active: true } }, h("span", null, "plain")));
    const trap = document.querySelector<HTMLElement>('[data-testid="trap"]');
    expect(trap?.tabIndex).toBe(-1);
  });

  it("invokes onEscape on the Escape key", () => {
    const onEscape = vi.fn();
    render(h(Trap, { opts: { active: true, onEscape } }, btn("a")));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onEscape).toHaveBeenCalled();
  });

  it("wraps Tab from the last element back to the first", () => {
    render(h(Trap, { opts: { active: true } }, [btn("a"), btn("b")]));
    document.querySelector<HTMLElement>("#b")?.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(document.activeElement?.id).toBe("a");
  });

  it("wraps Shift+Tab from the first element to the last", () => {
    render(h(Trap, { opts: { active: true } }, [btn("a"), btn("b")]));
    document.querySelector<HTMLElement>("#a")?.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true }));
    expect(document.activeElement?.id).toBe("b");
  });

  it("ignores non-Tab non-Escape keys", () => {
    const onEscape = vi.fn();
    render(h(Trap, { opts: { active: true, onEscape } }, btn("a")));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
    expect(onEscape).not.toHaveBeenCalled();
  });

  it("restores focus to the previously focused element on cleanup", () => {
    const trigger = document.createElement("button");
    trigger.id = "trigger";
    document.body.appendChild(trigger);
    trigger.focus();
    const r = render(h(Trap, { opts: { active: true } }, btn("a")));
    r.unmount();
    expect(document.activeElement?.id).toBe("trigger");
  });
});
