// S-ED-050..S-ED-055: clipboard + drag-and-drop integration.
//
// What CM6 ships out of the box:
//
//   • Plain-text copy/cut/paste via the contentEditable host. Multi-
//     selection copy joins ranges with `\n` and writes them as a
//     single clipboard payload tagged with CM6's selection markers,
//     so a paste back into N cursors does the expected zip-style
//     distribution. (S-ED-050 acceptance: "다중 커서 zip-style".)
//   • Line-ending preservation: when `EditorState.lineSeparator` is
//     set (usually at file-load time, see file IO module), Text.slice
//     emits the document's native EOL on copy, so CRLF→CRLF round-
//     trips correctly.
//
// What we add here:
//
//   • S-ED-050: external-clipboard zip fallback. CM6's built-in zip
//     paste only triggers when the clipboard payload was *also*
//     produced by CM6. Pasting from elsewhere into N cursors lands
//     the entire blob at every cursor — usually unhelpful. We
//     intercept paste and, if the external text has exactly N lines
//     and there are N (>1) cursors, distribute one line per cursor.
//   • S-ED-051: image paste → write to `<workspaceDir>/assets/<sha-
//     short>.<ext>` via Tauri fs and insert `![alt](relative)`.
//   • S-ED-052/053: HTML / rich-text paste → strip styles and convert
//     to markdown via `htmlToMarkdown()`. We prefer markdown when both
//     `text/html` and `text/plain` are present and the html looks
//     non-trivial; otherwise we keep the plain text path.
//   • S-ED-054: external image file drop → mirror S-ED-051 path with
//     the dropped File instead of a clipboard blob.
//   • S-ED-055: external `.md`/`.txt` file drop → read content and
//     insert at the drop point.
//
// The Tauri-dependent paths (image write to assets/) live behind a
// `WorkspaceFs` interface so unit tests can stub them.

import { EditorSelection, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { htmlToMarkdown } from "@/lib/markdown/htmlToMarkdown";

export interface WorkspaceFs {
  /** Save a binary blob into `assets/` and return the relative path. */
  saveAsset(bytes: Uint8Array, ext: string): Promise<string>;
  /** Read a text file (drop target) as a UTF-8 string. */
  readText(path: string): Promise<string>;
}

let workspaceFs: WorkspaceFs | null = null;
export function setClipboardWorkspaceFs(fs: WorkspaceFs | null): void {
  workspaceFs = fs;
}

const IMAGE_MIME = /^image\//;
const TEXT_FILE_EXT = /\.(md|markdown|txt)$/i;

function extFromMime(mime: string): string {
  const sub = mime.split("/")[1] ?? "bin";
  if (sub === "jpeg") return "jpg";
  if (sub === "svg+xml") return "svg";
  return sub.replace(/[^a-z0-9]/gi, "");
}

function looksLikeRealHtml(html: string): boolean {
  // CM6's own copy round-trips HTML in the clipboard too; we want to
  // skip the conversion for that case so an in-app copy/paste stays
  // byte-identical. CM6's payload begins with a comment marker.
  if (html.includes("data-cm-clipboard")) return false;
  // A "real" HTML payload almost always contains at least one block
  // element. A bare span wrapping plain text isn't worth converting.
  return /<(p|h[1-6]|ul|ol|li|pre|code|blockquote|table|img|a|strong|em|b|i)\b/i.test(html);
}

async function pasteImage(view: EditorView, blob: Blob): Promise<boolean> {
  if (!workspaceFs) return false;
  const ext = extFromMime(blob.type);
  const buf = new Uint8Array(await blob.arrayBuffer());
  const relPath = await workspaceFs.saveAsset(buf, ext);
  const insert = `![](${relPath})`;
  const { state } = view;
  view.dispatch(
    state.update(state.replaceSelection(insert), {
      userEvent: "input.paste.image",
      scrollIntoView: true,
    }),
  );
  return true;
}

function zipPasteText(view: EditorView, text: string): boolean {
  const { state } = view;
  const ranges = state.selection.ranges;
  if (ranges.length < 2) return false;
  const lines = text.split(/\r?\n/);
  if (lines.length !== ranges.length) return false;
  let i = 0;
  const tr = state.changeByRange((range) => {
    const insert = lines[i++] ?? "";
    const from = range.from;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(from + insert.length),
    };
  });
  view.dispatch(state.update(tr, { userEvent: "input.paste", scrollIntoView: true }));
  return true;
}

function pasteHandler(view: EditorView, event: ClipboardEvent): boolean {
  const data = event.clipboardData;
  if (!data) return false;

  // S-ED-051: image first — clipboard.items also exposes Files.
  for (const item of Array.from(data.items)) {
    if (item.kind === "file" && IMAGE_MIME.test(item.type)) {
      const blob = item.getAsFile();
      if (blob) {
        event.preventDefault();
        void pasteImage(view, blob);
        return true;
      }
    }
  }

  // S-ED-052/053: HTML → Markdown when meaningful.
  const html = data.getData("text/html");
  if (html && looksLikeRealHtml(html)) {
    const md = htmlToMarkdown(html);
    if (md) {
      event.preventDefault();
      view.dispatch(
        view.state.update(view.state.replaceSelection(md), {
          userEvent: "input.paste",
          scrollIntoView: true,
        }),
      );
      return true;
    }
  }

  // S-ED-050 zip-paste fallback.
  const text = data.getData("text/plain");
  if (text && zipPasteText(view, text)) {
    event.preventDefault();
    return true;
  }
  return false;
}

async function dropHandler(view: EditorView, event: DragEvent): Promise<boolean> {
  const dt = event.dataTransfer;
  if (!dt) return false;

  for (const file of Array.from(dt.files)) {
    if (IMAGE_MIME.test(file.type)) {
      // S-ED-054
      event.preventDefault();
      await pasteImage(view, file);
      return true;
    }
    if (TEXT_FILE_EXT.test(file.name)) {
      // S-ED-055
      event.preventDefault();
      const text = await file.text();
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      const at = pos == null ? view.state.selection.main.from : pos;
      view.dispatch(
        view.state.update({
          changes: { from: at, insert: text },
          selection: { anchor: at + text.length },
          userEvent: "input.drop",
          scrollIntoView: true,
        }),
      );
      return true;
    }
  }
  return false;
}

export function clipboardExtension(): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      return pasteHandler(view, event);
    },
    drop(event, view) {
      // domEventHandlers expects a sync return; we kick the async
      // path and return true so CM6 doesn't ALSO insert the dropped
      // payload as plain text below us.
      const dt = event.dataTransfer;
      if (!dt || dt.files.length === 0) return false;
      const handled = Array.from(dt.files).some(
        (f) => IMAGE_MIME.test(f.type) || TEXT_FILE_EXT.test(f.name),
      );
      if (!handled) return false;
      event.preventDefault();
      void dropHandler(view, event);
      return true;
    },
  });
}
