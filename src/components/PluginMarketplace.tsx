// S-PLM-* host surface: search and install plugins from the
// marketplace. The Rust side returns a curated listing with signature
// verification baked in — this component is purely presentational.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFocusTrap } from "../lib/focus-trap";
import { Icon } from "./Icon";
import {
  installPlugin,
  licenceWarning,
  searchMarketplace,
  type MarketplaceListing,
} from "../lib/plugins/marketplace";

interface PluginMarketplaceProps {
  open: boolean;
  onClose: () => void;
}

export function PluginMarketplace({ open, onClose }: PluginMarketplaceProps) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trapRef = useFocusTrap<HTMLDivElement>({ active: open, onEscape: onClose });

  const search = async () => {
    setBusy(true);
    setError(null);
    try {
      const rows = await searchMarketplace({ text, category: "all", sort: "popular" });
      setListings(rows);
    } catch (e) {
      setError(String((e as { message?: string })?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const install = async (listing: MarketplaceListing) => {
    setBusy(true);
    setError(null);
    try {
      await installPlugin(listing.id, listing.version);
    } catch (e) {
      setError(String((e as { message?: string })?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label={t("plugins.market.aria", "Plugin marketplace")}
    >
      <div
        ref={trapRef}
        className="flex max-h-[80vh] w-[min(640px,90vw)] flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] shadow-xl"
      >
        <header className="flex items-center justify-between border-[var(--color-border)] border-b px-4 py-2.5">
          <h2 className="font-semibold text-base">
            {t("plugins.market.title", "Plugin Marketplace")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-0.5 text-[var(--color-muted)] text-sm hover:bg-[var(--color-border)]/40"
            aria-label={t("plugins.market.close", "Close marketplace")}
          >
            <Icon name="close" size={14} />
          </button>
        </header>
        <div className="flex items-center gap-2 border-[var(--color-border)] border-b px-4 py-2">
          <input
            type="search"
            placeholder={t("plugins.market.search", "Search plugins…")}
            className="flex-1 rounded border border-[var(--color-border)] bg-transparent px-2 py-1 text-xs"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void search();
            }}
          />
          <button
            type="button"
            onClick={() => void search()}
            disabled={busy}
            className="rounded bg-[var(--color-accent)] px-3 py-1 text-white text-xs disabled:opacity-50"
          >
            {t("plugins.market.search_btn", "Search")}
          </button>
        </div>
        {error && (
          <p role="alert" className="px-4 py-2 text-red-500 text-xs">
            {error}
          </p>
        )}
        <ul className="flex-1 overflow-y-auto">
          {listings.length === 0 && !busy && (
            <li className="p-4 text-[var(--color-muted)] text-xs">
              {t("plugins.market.empty", "No results yet. Try a search.")}
            </li>
          )}
          {listings.map((listing) => {
            const warning = licenceWarning(listing.license);
            return (
              <li
                key={listing.id}
                className="flex items-start justify-between gap-3 border-[var(--color-border)] border-b p-3 text-xs"
              >
                <span className="flex flex-col">
                  <span className="font-medium text-sm">
                    {listing.name}
                    {listing.officialBadge && (
                      <Icon
                        name="star"
                        size={12}
                        fill="currentColor"
                        className="ml-2 inline text-[var(--color-accent)]"
                      />
                    )}
                  </span>
                  <span className="text-[var(--color-muted)]">
                    {listing.publisher ?? "—"} · v{listing.version}
                  </span>
                  <span className="mt-1">{listing.description}</span>
                  {warning && (
                    <span className="mt-1 inline-flex items-center gap-1 text-yellow-500">
                      <Icon name="warning" size={12} />
                      {warning}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void install(listing)}
                  className="self-start rounded bg-[var(--color-accent)] px-3 py-1 text-white disabled:opacity-50"
                >
                  {t("plugins.market.install", "Install")}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
