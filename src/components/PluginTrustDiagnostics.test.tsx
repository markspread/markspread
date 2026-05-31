// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DiagnosticSnapshot } from "../lib/plugins/runtime/diagnostics";
import { PluginTrustDiagnostics } from "./PluginTrustDiagnostics";

afterEach(cleanup);

const snapEmpty: DiagnosticSnapshot = {
  enabled: true,
  plugins: [],
  summary: "0 plugin(s) registered",
};

const snapPopulated: DiagnosticSnapshot = {
  enabled: true,
  plugins: [
    {
      pluginName: "wireweave",
      trustLevel: "local",
      trustIcon: "lock",
      hasConsent: true,
      assignedAt: 100,
    },
    {
      pluginName: "figjam-embed",
      trustLevel: "imported",
      trustIcon: "shield",
      hasConsent: false,
      assignedAt: 200,
      origin: "https://github.com/x",
    },
  ],
  summary: "2 plugin(s) registered",
};

describe("PluginTrustDiagnostics", () => {
  it("default collapsed — body hidden", () => {
    render(<PluginTrustDiagnostics snapshot={snapPopulated} />);
    expect(screen.queryByTestId("trust-diag-body")).toBeNull();
  });

  it("toggle expands and shows body", () => {
    render(<PluginTrustDiagnostics snapshot={snapPopulated} />);
    fireEvent.click(screen.getByTestId("trust-diag-toggle"));
    expect(screen.getByTestId("trust-diag-body")).toBeTruthy();
  });

  it("empty snapshot shows 'no plugins' message", () => {
    render(<PluginTrustDiagnostics snapshot={snapEmpty} initiallyExpanded />);
    expect(screen.getByTestId("trust-diag-body").textContent).toMatch(/활성 플러그인 없음/);
  });

  it("populated snapshot renders one row per plugin", () => {
    render(<PluginTrustDiagnostics snapshot={snapPopulated} initiallyExpanded />);
    expect(screen.getByTestId("trust-diag-row-wireweave")).toBeTruthy();
    expect(screen.getByTestId("trust-diag-row-figjam-embed")).toBeTruthy();
  });

  it("local plugin shows lock icon + 동의됨", () => {
    render(<PluginTrustDiagnostics snapshot={snapPopulated} initiallyExpanded />);
    const row = screen.getByTestId("trust-diag-row-wireweave");
    expect(row.querySelector("svg")).toBeTruthy();
    expect(row.querySelector('[aria-label="trust: local"]')).toBeTruthy();
    expect(row.textContent).toMatch(/동의됨/);
    expect(row.textContent).toContain("local");
  });

  it("imported plugin without consent shows shield icon + 동의 대기", () => {
    render(<PluginTrustDiagnostics snapshot={snapPopulated} initiallyExpanded />);
    const row = screen.getByTestId("trust-diag-row-figjam-embed");
    expect(row.querySelector('[aria-label="trust: imported"]')).toBeTruthy();
    expect(row.textContent).toMatch(/동의 대기/);
    expect(row.textContent).toContain("imported");
  });

  it("summary is shown in body header", () => {
    render(<PluginTrustDiagnostics snapshot={snapPopulated} initiallyExpanded />);
    expect(screen.getByTestId("trust-diag-body").textContent).toContain("2 plugin(s) registered");
  });

  it("default empty snapshot when no prop", () => {
    render(<PluginTrustDiagnostics initiallyExpanded />);
    expect(screen.getByTestId("trust-diag-body").textContent).toMatch(/no orchestrator/);
  });
});
