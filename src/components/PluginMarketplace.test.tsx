import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
let licenceWarningReturn: string | null = null;
vi.mock("../lib/plugins/marketplace", () => ({
  searchMarketplace: () => searchMarketplace(),
  installPlugin: (...a: unknown[]) => installPlugin(...a),
  licenceWarning: () => licenceWarningReturn,
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

  it("searches on Enter from the search input", async () => {
    searchMarketplace.mockClear();
    render(<PluginMarketplace open onClose={() => {}} />);
    const input = screen.getByPlaceholderText("Search plugins…");
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(searchMarketplace).toHaveBeenCalled());
  });

  it("ignores non-Enter keys in the search input", () => {
    searchMarketplace.mockClear();
    render(<PluginMarketplace open onClose={() => {}} />);
    const input = screen.getByPlaceholderText("Search plugins…");
    fireEvent.keyDown(input, { key: "a" });
    expect(searchMarketplace).not.toHaveBeenCalled();
  });

  it("surfaces an error when searchMarketplace rejects", async () => {
    searchMarketplace.mockRejectedValueOnce(new Error("search boom"));
    render(<PluginMarketplace open onClose={() => {}} />);
    fireEvent.click(screen.getByText("Search"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("search boom"));
  });

  it("stringifies a non-Error rejection from searchMarketplace", async () => {
    searchMarketplace.mockRejectedValueOnce("plain-search-error");
    render(<PluginMarketplace open onClose={() => {}} />);
    fireEvent.click(screen.getByText("Search"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("plain-search-error"));
  });

  it("surfaces an error when installPlugin rejects", async () => {
    render(<PluginMarketplace open onClose={() => {}} />);
    fireEvent.click(screen.getByText("Search"));
    await waitFor(() => expect(screen.getByText("Acme Parser")).toBeTruthy());
    installPlugin.mockRejectedValueOnce(new Error("install boom"));
    await act(async () => {
      fireEvent.click(screen.getByText("Install"));
    });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("install boom"));
  });

  it("stringifies a non-Error rejection from installPlugin", async () => {
    render(<PluginMarketplace open onClose={() => {}} />);
    fireEvent.click(screen.getByText("Search"));
    await waitFor(() => expect(screen.getByText("Acme Parser")).toBeTruthy());
    installPlugin.mockRejectedValueOnce("plain-install-error");
    await act(async () => {
      fireEvent.click(screen.getByText("Install"));
    });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("plain-install-error"));
  });

  it("falls back to a dash when no publisher is provided", async () => {
    searchMarketplace.mockResolvedValueOnce([{ ...listing, publisher: null }]);
    render(<PluginMarketplace open onClose={() => {}} />);
    fireEvent.click(screen.getByText("Search"));
    await waitFor(() => expect(screen.getByText("Acme Parser")).toBeTruthy());
    expect(screen.getByText(/— · v2\.0\.0/)).toBeTruthy();
  });

  it("updates the search input as the user types", () => {
    render(<PluginMarketplace open onClose={() => {}} />);
    const input = screen.getByPlaceholderText("Search plugins…") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "acme" } });
    expect(input.value).toBe("acme");
  });

  it("renders the licence warning when one is returned", async () => {
    licenceWarningReturn = "AGPL-3.0 is copyleft";
    try {
      render(<PluginMarketplace open onClose={() => {}} />);
      fireEvent.click(screen.getByText("Search"));
      await waitFor(() => expect(screen.getByText("Acme Parser")).toBeTruthy());
      expect(screen.getByText("AGPL-3.0 is copyleft")).toBeTruthy();
    } finally {
      licenceWarningReturn = null;
    }
  });
});
