// S-MD-010: image dialog. Alt + URL/path inputs, with a "Pick file…"
// button that uses Tauri's open-file picker (host-injected). When a
// local file is picked we save it to assets/ via the registered
// WorkspaceFs and back-fill the URL field with the relative path.
// Workspace-relative path autocomplete piggybacks on the link
// provider used by LinkDialog (S-MD-009).

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  type ImageDialogRequest,
  type ImageDialogResult,
  setImageDialogOpener,
} from "@/lib/editor/commands/image";
import { getWorkspaceLinkProvider } from "@/lib/editor/commands/link";

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
function looksLikePath(s: string): boolean {
  if (!s) return false;
  if (SCHEME_RE.test(s)) return false;
  return s.includes("/") || s.startsWith(".") || /\.[a-z0-9]+$/i.test(s);
}

export function ImageDialog() {
  const { t } = useTranslation();
  const [req, setReq] = useState<ImageDialogRequest | null>(null);
  const [alt, setAlt] = useState("");
  const [url, setUrl] = useState("");
  const [hits, setHits] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    setImageDialogOpener((r) => {
      setAlt(r.initialAlt);
      setUrl(r.initialUrl);
      setHits([]);
      setReq(r);
    });
    return () => setImageDialogOpener(() => {});
  }, []);

  useEffect(() => {
    if (!req) return;
    const provider = getWorkspaceLinkProvider();
    if (!provider || !looksLikePath(url)) {
      setHits([]);
      return;
    }
    const handle = window.setTimeout(async () => {
      try {
        const matches = await provider.search(url, 8);
        setHits(matches.filter((p) => /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(p)));
      } catch {
        setHits([]);
      }
    }, 80);
    return () => window.clearTimeout(handle);
  }, [url, req]);

  if (!req) return null;

  const close = (result: ImageDialogResult | null) => {
    req.resolve(result);
    setReq(null);
  };
  const submit = () => {
    if (!url.trim()) return;
    close({ alt: alt.trim(), url: url.trim() });
  };
  const pick = async () => {
    /* v8 ignore next -- the Pick file… button is only rendered when req.pickFile is provided, so this guard only protects against future callers */
    if (!req.pickFile) return;
    setPicking(true);
    try {
      const file = await req.pickFile();
      if (!file) return;
      const relPath = file.name; // host-injected picker returns the
      // already-saved relative path under file.name when it copies into
      // assets/. See setImageFilePicker docs.
      setUrl(relPath);
      if (!alt) setAlt(file.name.replace(/\.[^/.]+$/, ""));
    } finally {
      setPicking(false);
    }
  };

  return (
    <div
      className="ms-modal-backdrop"
      // biome-ignore lint/a11y/useSemanticElements: dialog overlay keeps div for layout/portal control
      role="dialog"
      aria-modal="true"
      aria-label={t("md.image.title", "Insert image")}
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
        <h2>{t("md.image.title", "Insert image")}</h2>
        <label>
          <span>{t("md.image.alt", "Alt text")}</span>
          <input
            type="text"
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            placeholder={t("md.image.alt.placeholder", "Describe the image")}
          />
        </label>
        <label>
          <span>{t("md.image.url", "URL or path")}</span>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t("md.image.url.placeholder", "./assets/figure.png  or  https://…")}
          />
        </label>
        {hits.length > 0 && (
          <ul className="ms-link-suggestions">
            {hits.map((p) => (
              <li
                key={p}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setUrl(p);
                  setHits([]);
                }}
              >
                {p}
              </li>
            ))}
          </ul>
        )}
        <div className="ms-modal-actions">
          {req.pickFile && (
            <button type="button" onClick={pick} disabled={picking}>
              {picking ? t("md.image.picking", "Saving…") : t("md.image.pick", "Pick file…")}
            </button>
          )}
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
