import "../extensions/jsdomLayoutShim";
// S-MD-010: tests for image insertion.

import { EditorState, type EditorStateConfig } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import {
  type ImageDialogRequest,
  type ImageDialogResult,
  insertImage,
  setImageDialogOpener,
  setImageFilePicker,
  setImageWorkspaceFs,
} from "./image";

function mount(doc: string, selection?: NonNullable<EditorStateConfig["selection"]>): EditorView {
  return new EditorView({
    state: EditorState.create(selection ? { doc, selection } : { doc }),
  });
}

afterEach(() => {
  setImageDialogOpener(() => {});
  setImageFilePicker(null);
  setImageWorkspaceFs(null);
});

describe("insertImage", () => {
  it("inserts an image with alt + url at the cursor", async () => {
    const view = mount("before after", { anchor: 6 });
    setImageDialogOpener((req: ImageDialogRequest) => {
      req.resolve({ alt: "logo", url: "logo.png" });
    });
    const ok = await insertImage(view);
    expect(ok).toBe(true);
    expect(view.state.doc.toString()).toBe("before![logo](logo.png) after");
    view.destroy();
  });

  it("uses the current selection as the initial alt text", async () => {
    const view = mount("pick me", { anchor: 0, head: 7 });
    let seenAlt = "";
    setImageDialogOpener((req: ImageDialogRequest) => {
      seenAlt = req.initialAlt;
      req.resolve({ alt: req.initialAlt, url: "x.png" });
    });
    await insertImage(view);
    expect(seenAlt).toBe("pick me");
    expect(view.state.doc.toString()).toBe("![pick me](x.png)");
    view.destroy();
  });

  it("returns false when the dialog is cancelled", async () => {
    const view = mount("abc");
    setImageDialogOpener((req: ImageDialogRequest) => req.resolve(null));
    expect(await insertImage(view)).toBe(false);
    expect(view.state.doc.toString()).toBe("abc");
    view.destroy();
  });

  it("returns false when the resolved url is empty", async () => {
    const view = mount("abc");
    setImageDialogOpener((req: ImageDialogRequest) => {
      req.resolve({ alt: "a", url: "" } as ImageDialogResult);
    });
    expect(await insertImage(view)).toBe(false);
    view.destroy();
  });

  it("forwards the registered file picker to the dialog", async () => {
    const view = mount("");
    const picker = () => Promise.resolve<File | null>(null);
    setImageFilePicker(picker);
    let forwarded: unknown = "unset";
    setImageDialogOpener((req: ImageDialogRequest) => {
      forwarded = req.pickFile;
      req.resolve(null);
    });
    await insertImage(view);
    expect(forwarded).toBe(picker);
    view.destroy();
  });
});
