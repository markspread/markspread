// S-MD-010: image insertion dialog.
//
// Mirrors the link command (alt + URL/path) but also offers a "Pick
// file…" affordance backed by Tauri's open-dialog (the host wires the
// picker through `setImageFilePicker`). On pick we copy the chosen
// file into `<workspace>/assets/` via WorkspaceFs.saveAsset (same
// machinery used by S-ED-051), then insert `![alt](relPath)`.

import type { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";

import type { WorkspaceFs } from "../extensions/clipboard";

let workspaceFs: WorkspaceFs | null = null;
export function setImageWorkspaceFs(fs: WorkspaceFs | null): void {
  workspaceFs = fs;
}

let imageFilePicker: (() => Promise<File | null>) | null = null;
export function setImageFilePicker(fn: (() => Promise<File | null>) | null): void {
  imageFilePicker = fn;
}

export type ImageDialogRequest = {
  initialAlt: string;
  initialUrl: string;
  pickFile: (() => Promise<File | null>) | null;
  resolve: (result: ImageDialogResult | null) => void;
};
export type ImageDialogResult = { alt: string; url: string };

let imageDialogOpener: (req: ImageDialogRequest) => void = () => {};
export function setImageDialogOpener(fn: (req: ImageDialogRequest) => void): void {
  imageDialogOpener = fn;
}

export async function insertImage(view: EditorView): Promise<boolean> {
  const sel = view.state.selection.main;
  const initialAlt = sel.empty ? "" : view.state.sliceDoc(sel.from, sel.to);
  const result = await new Promise<ImageDialogResult | null>((resolve) => {
    imageDialogOpener({
      initialAlt,
      initialUrl: "",
      pickFile: imageFilePicker,
      resolve,
    });
  });
  if (!result) return false;
  let { alt, url } = result;
  // If url points at a File-via-picker payload (data: URL we tagged
  // ourselves), the dialog passes us the File via a separate path —
  // in this code path the dialog has already saved the asset and
  // returned the relative path.
  if (!url) return false;
  // No reference to workspaceFs here — the dialog handles asset save.
  void workspaceFs;
  const insert = `![${alt}](${url})`;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert },
    selection: EditorSelection.cursor(sel.from + insert.length),
    userEvent: "input.image",
    scrollIntoView: true,
  });
  return true;
}
