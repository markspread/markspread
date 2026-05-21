// S-MD-050..055: `[[wiki-link]]` support.
//
// What lives here:
//   • S-MD-050 — completion source that fires when the cursor sits
//     inside `[[…` and queries the workspace link provider.
//   • S-MD-051 — alias syntax `[[file|display]]` (display text isn't
//     validated against the workspace; we treat the bit before `|` as
//     the target).
//   • S-MD-052 — heading anchor `[[file#heading]]` — the second
//     segment is offered via a heading provider injected by the host
//     (reads remark headings from the indexer).
//   • S-MD-053 — Mod+Click on a wikilink invokes `followWikilink()`
//     which delegates to a host-registered navigator.
//   • S-MD-054 — broken-link decoration: a viewPlugin scans the
//     visible viewport, asks the link provider whether each target
//     resolves, and adds a `cm-wiki-broken` class to the bracket
//     range.
//   • S-MD-055 — Mod+Click on a broken link fires `createWikilink()`
//     which the host can wire up to a "create file" prompt.
//
// We keep the syntactic pattern simple — `[[…]]` matched line-locally
// — to avoid touching the lezer parser. lang-markdown still parses
// the link as plain text; we only paint and intercept clicks.

import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { type Extension, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

import { addCompletionSource } from "./autocompletion";

// -- host hooks --------------------------------------------------

export interface WikilinkProvider {
  /** Up to N file paths matching the query. */
  searchFiles(query: string, limit: number): Promise<string[]>;
  /** Heading list for a given file path. */
  headings(filePath: string): Promise<string[]>;
  /** Resolves true if the file (and optional heading) exist. */
  exists(filePath: string, heading?: string): Promise<boolean>;
  /** Open the target. */
  open(filePath: string, heading?: string): Promise<void>;
  /** Create a new file at the target path; resolves with the path. */
  create(filePath: string): Promise<string>;
}

let provider: WikilinkProvider | null = null;
export function setWikilinkProvider(p: WikilinkProvider | null): void {
  provider = p;
}

// -- inline regex -----------------------------------------------

const WIKI_RE = /\[\[([^\]\n|#]+)(?:#([^\]\n|]+))?(?:\|([^\]\n]+))?\]\]/g;
const TRIGGER_RE = /\[\[([^\]\n|#]*)$/;
const HEADING_TRIGGER_RE = /\[\[([^\]\n|#]+)#([^\]\n|]*)$/;

// -- S-MD-050 / S-MD-051 / S-MD-052: completion -----------------

function fileCompletion(context: CompletionContext): Promise<CompletionResult | null> | null {
  if (!provider) return null;
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const heading = HEADING_TRIGGER_RE.exec(before);
  if (heading) {
    const file = heading[1] as string;
    const headingFrag = heading[2] as string;
    return provider.headings(file).then(
      (heads): CompletionResult => ({
        from: line.from + (context.pos - line.from - headingFrag.length),
        options: heads.map((h) => ({ label: h, type: "interface" })),
        validFor: /^[^\]\n|]*$/,
      }),
      () => null,
    );
  }
  const fileTrigger = TRIGGER_RE.exec(before);
  if (!fileTrigger) return null;
  const query = fileTrigger[1] as string;
  return provider.searchFiles(query, 12).then(
    (paths): CompletionResult => ({
      from: line.from + (context.pos - line.from - query.length),
      options: paths.map((p) => ({ label: p, type: "file" })),
      validFor: /^[^\]\n|#]*$/,
    }),
    () => null,
  );
}

addCompletionSource(fileCompletion as never);

// -- S-MD-053 / S-MD-055: click handling ------------------------

function wikilinkAtPos(line: { text: string; from: number }, pos: number) {
  const local = pos - line.from;
  WIKI_RE.lastIndex = 0;
  let m = WIKI_RE.exec(line.text);
  while (m !== null) {
    if (local >= m.index && local <= m.index + m[0].length) {
      return {
        from: line.from + m.index,
        to: line.from + m.index + m[0].length,
        file: (m[1] as string).trim(),
        heading: m[2]?.trim(),
      };
    }
    m = WIKI_RE.exec(line.text);
  }
  return null;
}

const clickHandler = EditorView.domEventHandlers({
  mousedown(e, view) {
    if (!(e.metaKey || e.ctrlKey)) return false;
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos == null) return false;
    const line = view.state.doc.lineAt(pos);
    const hit = wikilinkAtPos(line, pos);
    if (!hit || !provider) return false;
    e.preventDefault();
    void provider.exists(hit.file, hit.heading).then(async (ok) => {
      if (ok) {
        await provider?.open(hit.file, hit.heading);
      } else {
        // S-MD-055: prompt is delegated to the host's create() impl,
        // which can run an "Are you sure?" UI before returning.
        const created = await provider?.create(hit.file);
        if (created) await provider?.open(created, hit.heading);
      }
    });
    return true;
  },
});

// -- S-MD-054: broken-link decoration ---------------------------

const brokenMark = Decoration.mark({ class: "cm-wiki-broken" });

const brokenCache = new Map<string, boolean>(); // key: `file#heading`

function brokenKey(file: string, heading?: string): string {
  return heading ? `${file}#${heading}` : file;
}

const brokenLinkPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;
    constructor(view: EditorView) {
      this.refresh(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.geometryChanged) {
        this.refresh(u.view);
      }
    }
    refresh(view: EditorView) {
      if (!provider) {
        this.decorations = Decoration.none;
        return;
      }
      const builder = new RangeSetBuilder<Decoration>();
      const pending: { key: string; file: string; heading?: string }[] = [];
      for (const { from, to } of view.visibleRanges) {
        const text = view.state.sliceDoc(from, to);
        WIKI_RE.lastIndex = 0;
        let m = WIKI_RE.exec(text);
        while (m !== null) {
          const start = from + m.index;
          const end = start + m[0].length;
          const fileName = (m[1] as string).trim();
          const headingName = m[2]?.trim();
          const key = brokenKey(fileName, headingName);
          if (brokenCache.has(key)) {
            if (brokenCache.get(key) === false) {
              builder.add(start, end, brokenMark);
            }
          } else {
            pending.push({
              key,
              file: fileName,
              ...(headingName !== undefined && { heading: headingName }),
            });
          }
          m = WIKI_RE.exec(text);
        }
      }
      this.decorations = builder.finish();
      if (pending.length > 0) {
        // Resolve in the background; once filled, request a redraw.
        Promise.all(
          pending.map(async (p) => {
            try {
              const ok = await provider?.exists(p.file, p.heading);
              // No provider means we can't verify — treat as valid, same
              // as the catch branch, to avoid false "broken link" noise.
              brokenCache.set(p.key, ok ?? true);
            } catch {
              brokenCache.set(p.key, true); // treat errors as "valid" to avoid noise
            }
          }),
        ).then(() => {
          // Trigger a no-op transaction so the plugin recomputes.
          queueMicrotask(() => {
            view.dispatch({});
          });
        });
      }
    }
  },
  { decorations: (v) => v.decorations },
);

// -- public API -------------------------------------------------

export function followWikilink(view: EditorView, pos: number): Promise<boolean> {
  if (!provider) return Promise.resolve(false);
  const line = view.state.doc.lineAt(pos);
  const hit = wikilinkAtPos(line, pos);
  if (!hit) return Promise.resolve(false);
  return provider.exists(hit.file, hit.heading).then(async (ok) => {
    if (ok) {
      await provider?.open(hit.file, hit.heading);
    } else {
      const created = await provider?.create(hit.file);
      if (created) await provider?.open(created, hit.heading);
    }
    return true;
  });
}

export function invalidateWikilinkCache(): void {
  brokenCache.clear();
}

export function wikilinkExtension(): Extension {
  return [clickHandler, brokenLinkPlugin];
}
