import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarketplaceListing } from "../lib/plugins/marketplace";

const listing: MarketplaceListing = {
  id: "acme.parser",
  name: "Acme Parser",
  publisher: "Acme",
  description: "A parser plugin",
  version: "2.0.0",
  readmeHtml: null,
  permissions: [],
  dependencies: [],
  license: "MIT",
  officialBadge: true,
  weeklyDownloads: 100,
  publishedAt: 0,
  ratingAverage: 4.5,
  ratingCount: 10,
  dist: { tarball: "https://x/a.tgz", sha512: "abc" },
};

const searchMarketplace = vi.fn(() => Promise.resolve([listing]));
const installPlugin = vi.fn((..._a: unknown[]) => Promise.resolve({}));
vi.mock("../lib/plugins/marketplace", () => ({
  searchMarketplace: () => searchMarketplace(),
  installPlugin: (...a: unknown[]) => installPlugin(...a),
  licenceWarning: () => null,
}));

import { PluginMarketplace } from "./PluginMarketplace";

afterEach(cleanup);

describe("PluginMarketplace", () => {
  it("renders nothing while closed", () => {
    const { container } = render(<PluginMarketplace open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the empty hint before searching", () => {
    render(<PluginMarketplace open onClose={() => {}} />);
    expect(screen.getByText("No results yet. Try a search.")).toBeTruthy();
  });

  it("searches and lists results", async () => {
    render(<PluginMarketplace open onClose={() => {}} />);
    fireEvent.click(screen.getByText("Search"));
    await waitFor(() => expect(screen.getByText("Acme Parser")).toBeTruthy());
    expect(searchMarketplace).toHaveBeenCalled();
  });

  it("installs a listing", async () => {
    render(<PluginMarketplace open onClose={() => {}} />);
    fireEvent.click(screen.getByText("Search"));
    await waitFor(() => expect(screen.getByText("Acme Parser")).toBeTruthy());
    fireEvent.click(screen.getByText("Install"));
    await waitFor(() => expect(installPlugin).toHaveBeenCalledWith("acme.parser", "2.0.0"));
  });

  it("closes via the close button", () => {
    const onClose = vi.fn();
    render(<PluginMarketplace open onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Close marketplace"));
    expect(onClose).toHaveBeenCalled();
  });
});
