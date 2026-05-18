// S-MD-007 / S-MD-008 / S-MD-009: link insertion.
//
// The user invokes the command from the menu / palette / keybinding.
// We open a small dialog asking for URL + optional Title; the dialog
// uses the editor's selection as the link text. If the selection is
// empty we accept a Text field too (S-MD-007 acceptance bullet 2).
//
// On open we pre-fill URL from the system clipboard when its content
// matches a URL pattern (S-MD-008 acceptance). Tauri's clipboard API
// is async — we treat clipboard read as best-effort (any failure
// just leaves the field blank).
//
// While typing into URL we offer workspace-file completions (S-MD-009).
// The completion source is supplied by a host registration so this
// module stays decoupled from the FS unit's workspace index.

import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export interface WorkspaceLinkProvider {
  /** Return up to N relative paths matching the query. */
  search(query: string, limit: number): Promise<string[]>;
  /** Convert an absolute path to a workspace-relative path. */
  toRelative(path: string): string;
}

let linkProvider: WorkspaceLinkProvider | null = null;
export function setWorkspaceLinkProvider(p: WorkspaceLinkProvider | null): void {
  linkProvider = p;
}
export function getWorkspaceLinkProvider(): WorkspaceLinkProvider | null {
  return linkProvider;
}

export type LinkDialogRequest = {
  initialText: string;
  initialUrl: string;
  initialTitle: string;
  resolve: (result: LinkDialogResult | null) => void;
};
export type LinkDialogResult = {
  text: string;
  url: string;
  title?: string;
};

let linkDialogOpener: (req: LinkDialogRequest) => void = () => {};
export function setLinkDialogOpener(fn: (req: LinkDialogRequest) => void): void {
  linkDialogOpener = fn;
}

const URL_RE = /^(?:https?:\/\/|\/|\.{0,2}\/|mailto:|tel:)\S+$/i;

async function readClipboardUrl(): Promise<string> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
      const text = (await navigator.clipboard.readText()).trim();
      if (URL_RE.test(text)) return text;
    }
  } catch {
    /* silent — common when permission dialog dismissed */
  }
  return "";
}

export async function insertLink(view: EditorView): Promise<boolean> {
  const sel = view.state.selection.main;
  const initialText = sel.empty ? "" : view.state.sliceDoc(sel.from, sel.to);
  const initialUrl = await readClipboardUrl();
  const result = await new Promise<LinkDialogResult | null>((resolve) => {
    linkDialogOpener({
      initialText,
      initialUrl,
      initialTitle: "",
      resolve,
    });
  });
  if (!result) return false;
  const { text, url, title } = result;
  const titlePart = title ? ` "${title.replace(/"/g, '\\"')}"` : "";
  const insert = `[${text || url}](${url}${titlePart})`;
  const from = sel.from;
  const to = sel.to;
  view.dispatch({
    changes: { from, to, insert },
    selection: EditorSelection.cursor(from + insert.length),
    userEvent: "input.link",
    scrollIntoView: true,
  });
  return true;
}
