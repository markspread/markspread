// S-MD-007/008/009: link insertion dialog.
//
// Owns three inputs (Text, URL, Title), pre-fills URL from the
// clipboard, and offers workspace-file completions while the URL
// field has focus and the value matches a `path-like` shape (no
// scheme, contains "/" or starts with "."). Completion is async — we
// debounce 80ms then ask the registered WorkspaceLinkProvider for
// matches.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  type LinkDialogRequest,
  type LinkDialogResult,
  getWorkspaceLinkProvider,
  setLinkDialogOpener,
} from "@/lib/editor/commands/link";

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

function looksLikePath(s: string): boolean {
  if (!s) return false;
  if (SCHEME_RE.test(s)) return false;
  return s.includes("/") || s.startsWith(".") || /\.[a-z0-9]+$/i.test(s);
}

export function LinkDialog() {
  const { t } = useTranslation();
  const [req, setReq] = useState<LinkDialogRequest | null>(null);
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [hits, setHits] = useState<string[]>([]);
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLinkDialogOpener((r) => {
      setText(r.initialText);
      setUrl(r.initialUrl);
      setTitle(r.initialTitle);
      setHits([]);
      setReq(r);
    });
    return () => setLinkDialogOpener(() => {});
  }, []);

  // S-MD-009: workspace path autocomplete.
  useEffect(() => {
    if (!req) return;
    const provider = getWorkspaceLinkProvider();
    if (!provider || !looksLikePath(url)) {
      setHits([]);
      return;
    }
    const handle = window.setTimeout(async () => {
      try {
        const results = await provider.search(url, 8);
        setHits(results);
      } catch {
        setHits([]);
      }
    }, 80);
    return () => window.clearTimeout(handle);
  }, [url, req]);

  if (!req) return null;

  const close = (result: LinkDialogResult | null) => {
    req.resolve(result);
    setReq(null);
  };
  const submit = () => {
    if (!url.trim()) return;
    const trimmedTitle = title.trim();
    close({ text: text.trim(), url: url.trim(), ...(trimmedTitle && { title: trimmedTitle }) });
  };

  return (
    <div
      className="ms-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("md.link.title", "Insert link")}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close(null);
        } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          submit();
        }
      }}
    >
      <div className="ms-modal">
        <h2>{t("md.link.title", "Insert link")}</h2>
        <label>
          <span>{t("md.link.text", "Text")}</span>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("md.link.text.placeholder", "Link text")}
          />
        </label>
        <label>
          <span>{t("md.link.url", "URL")}</span>
          <input
            ref={urlRef}
            type="text"
            value={url}
            autoFocus
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t("md.link.url.placeholder", "https://… or ./relative/path.md")}
          />
        </label>
        {hits.length > 0 && (
          <ul className="ms-link-suggestions" role="listbox">
            {hits.map((p) => (
              <li
                key={p}
                role="option"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setUrl(p);
                  setHits([]);
                  urlRef.current?.focus();
                }}
              >
                {p}
              </li>
            ))}
          </ul>
        )}
        <label>
          <span>{t("md.link.titleAttr", "Title (optional)")}</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("md.link.titleAttr.placeholder", "Hover tooltip")}
          />
        </label>
        <div className="ms-modal-actions">
          <button type="button" onClick={() => close(null)}>
            {t("common.cancel", "Cancel")}
          </button>
          <button type="button" onClick={submit} disabled={!url.trim()}>
            {t("common.insert", "Insert")}
          </button>
        </div>
      </div>
    </div>
  );
}
