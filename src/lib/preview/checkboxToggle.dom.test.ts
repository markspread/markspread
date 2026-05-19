// Coverage for the preview-side checkbox toggle handler.

import type { TaskToggleApply } from "@/lib/editor/commands/taskToggle";
import { describe, expect, it, vi } from "vitest";
import { type CheckboxToggleHost, attachCheckboxToggles } from "./checkboxToggle";

function makeHost(source: string): {
  host: CheckboxToggleHost;
  applied: TaskToggleApply[];
} {
  const applied: TaskToggleApply[] = [];
  return {
    applied,
    host: {
      getSource: () => source,
      toggleLine: (a) => applied.push(a),
    },
  };
}

function clickFirstCheckbox(root: ParentNode): void {
  const box = root.querySelector<HTMLInputElement>('input[type="checkbox"]');
  box?.dispatchEvent(new MouseEvent("click", { cancelable: true, bubbles: true }));
}

describe("attachCheckboxToggles", () => {
  it("enables disabled checkboxes and stamps them", () => {
    const root = document.createElement("div");
    root.innerHTML = '<li><input type="checkbox" disabled></li>';
    const { host } = makeHost("- [ ] task");
    attachCheckboxToggles(root, host);
    const box = root.querySelector<HTMLInputElement>("input");
    expect(box?.disabled).toBe(false);
    expect(box?.getAttribute("data-ms-task")).toBe("true");
  });

  it("skips already-stamped checkboxes (idempotent)", () => {
    const root = document.createElement("div");
    root.innerHTML = '<li><input type="checkbox" data-ms-task="true"></li>';
    const { host, applied } = makeHost("- [ ] task");
    attachCheckboxToggles(root, host);
    clickFirstCheckbox(root);
    expect(applied).toEqual([]);
  });

  it("toggles an unchecked task line using the ordinal fallback", () => {
    const root = document.createElement("div");
    root.innerHTML = '<li><input type="checkbox"></li>';
    const { host, applied } = makeHost("- [ ] alpha");
    attachCheckboxToggles(root, host);
    clickFirstCheckbox(root);
    expect(applied).toHaveLength(1);
    expect(applied[0]?.lineIndex).toBe(0);
    expect(applied[0]?.nextLine).toBe("- [x] alpha");
    expect(applied[0]?.oldLength).toBe("- [ ] alpha".length);
  });

  it("toggles a checked task line back to unchecked", () => {
    const root = document.createElement("div");
    root.innerHTML = '<li><input type="checkbox"></li>';
    const { host, applied } = makeHost("- [x] done");
    attachCheckboxToggles(root, host);
    clickFirstCheckbox(root);
    expect(applied[0]?.nextLine).toBe("- [ ] done");
  });

  it("honours the data-task-line attribute (1-based)", () => {
    const root = document.createElement("div");
    root.innerHTML = '<li><input type="checkbox" data-task-line="3"></li>';
    const { host, applied } = makeHost("intro\n\n- [ ] third");
    attachCheckboxToggles(root, host);
    clickFirstCheckbox(root);
    expect(applied[0]?.lineIndex).toBe(2);
  });

  it("maps the Nth checkbox to the Nth task line by ordinal", () => {
    const root = document.createElement("div");
    root.innerHTML = '<li><input type="checkbox"></li><li><input type="checkbox"></li>';
    const { host, applied } = makeHost("- [ ] one\n- [ ] two");
    attachCheckboxToggles(root, host);
    const boxes = root.querySelectorAll<HTMLInputElement>("input");
    boxes[1]?.dispatchEvent(new MouseEvent("click", { cancelable: true }));
    expect(applied[0]?.lineIndex).toBe(1);
    expect(applied[0]?.nextLine).toBe("- [x] two");
  });

  it("no-ops when the ordinal finds no matching task line", () => {
    const root = document.createElement("div");
    root.innerHTML = '<li><input type="checkbox"></li>';
    const { host, applied } = makeHost("just prose, no tasks");
    attachCheckboxToggles(root, host);
    clickFirstCheckbox(root);
    expect(applied).toEqual([]);
  });

  it("no-ops when the target line is out of range", () => {
    const root = document.createElement("div");
    root.innerHTML = '<li><input type="checkbox" data-task-line="99"></li>';
    const { host, applied } = makeHost("- [ ] only");
    attachCheckboxToggles(root, host);
    clickFirstCheckbox(root);
    expect(applied).toEqual([]);
  });

  it("no-ops when the target line is not a task line", () => {
    const root = document.createElement("div");
    root.innerHTML = '<li><input type="checkbox" data-task-line="1"></li>';
    const { host, applied } = makeHost("plain heading");
    attachCheckboxToggles(root, host);
    clickFirstCheckbox(root);
    expect(applied).toEqual([]);
  });

  it("calls preventDefault on the click", () => {
    const root = document.createElement("div");
    root.innerHTML = '<li><input type="checkbox"></li>';
    const { host } = makeHost("- [ ] x");
    attachCheckboxToggles(root, host);
    const box = root.querySelector<HTMLInputElement>("input");
    const ev = new MouseEvent("click", { cancelable: true });
    const spy = vi.spyOn(ev, "preventDefault");
    box?.dispatchEvent(ev);
    expect(spy).toHaveBeenCalled();
  });
});
