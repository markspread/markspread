// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConsentPrompt } from "../lib/plugins/runtime/consent";
import { PluginConsentDialog } from "./PluginConsentDialog";

const promptBase: ConsentPrompt = {
  pluginName: "wireweave-parser",
  oneLinerSummary: "graphviz-like DSL renderer",
  fullSource: "export default (s) => renderGraph(s)",
  trustLevel: "llm-generated",
  violations: [],
};

afterEach(cleanup);

describe("PluginConsentDialog", () => {
  it("returns null when prompt is null (hidden)", () => {
    const { container } = render(<PluginConsentDialog prompt={null} onDecision={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders header with plugin name + trust icon + label", () => {
    render(<PluginConsentDialog prompt={promptBase} onDecision={() => {}} />);
    expect(screen.getByTestId("consent-plugin-name").textContent).toBe("wireweave-parser");
    expect(screen.getByTestId("consent-trust-icon").getAttribute("aria-label")).toBe(
      "trust level: llm-generated",
    );
    expect(screen.getByTestId("consent-trust-icon").querySelector("svg")).toBeTruthy();
    expect(screen.getByTestId("consent-trust-label").textContent).toBe("llm-generated");
  });

  it("local trust renders an Icon", () => {
    render(
      <PluginConsentDialog prompt={{ ...promptBase, trustLevel: "local" }} onDecision={() => {}} />,
    );
    expect(screen.getByTestId("consent-trust-icon").getAttribute("aria-label")).toBe(
      "trust level: local",
    );
    expect(screen.getByTestId("consent-trust-icon").querySelector("svg")).toBeTruthy();
  });

  it("imported trust renders an Icon", () => {
    render(
      <PluginConsentDialog
        prompt={{ ...promptBase, trustLevel: "imported" }}
        onDecision={() => {}}
      />,
    );
    expect(screen.getByTestId("consent-trust-icon").getAttribute("aria-label")).toBe(
      "trust level: imported",
    );
    expect(screen.getByTestId("consent-trust-icon").querySelector("svg")).toBeTruthy();
  });

  it("shows the one-liner summary", () => {
    render(<PluginConsentDialog prompt={promptBase} onDecision={() => {}} />);
    expect(screen.getByTestId("consent-summary").textContent).toContain(
      "graphviz-like DSL renderer",
    );
  });

  it("toggle reveals/hides full source code", () => {
    render(<PluginConsentDialog prompt={promptBase} onDecision={() => {}} />);
    expect(screen.queryByTestId("consent-full-code")).toBeNull();
    fireEvent.click(screen.getByTestId("consent-toggle-code"));
    expect(screen.getByTestId("consent-full-code").textContent).toContain("renderGraph");
    fireEvent.click(screen.getByTestId("consent-toggle-code"));
    expect(screen.queryByTestId("consent-full-code")).toBeNull();
  });

  it("displays violations summary when present", () => {
    render(
      <PluginConsentDialog
        prompt={{
          ...promptBase,
          violations: [
            {
              code: "eval",
              span: { line: 1, column: 1, length: 5 },
              message: "eval()",
              snippet: "eval(",
            },
          ],
        }}
        onDecision={() => {}}
      />,
    );
    expect(screen.getByTestId("consent-violations").textContent).toMatch(/eval/);
  });

  it("Accept fires onDecision('accept')", () => {
    const handler = vi.fn();
    render(<PluginConsentDialog prompt={promptBase} onDecision={handler} />);
    fireEvent.click(screen.getByTestId("consent-accept"));
    expect(handler).toHaveBeenCalledWith("accept");
  });

  it("Reject fires onDecision('reject')", () => {
    const handler = vi.fn();
    render(<PluginConsentDialog prompt={promptBase} onDecision={handler} />);
    fireEvent.click(screen.getByTestId("consent-reject"));
    expect(handler).toHaveBeenCalledWith("reject");
  });

  it("recommendation text reflects trust level", () => {
    const { rerender } = render(
      <PluginConsentDialog
        prompt={{ ...promptBase, trustLevel: "imported" }}
        onDecision={() => {}}
      />,
    );
    expect(screen.getByTestId("consent-recommendation").textContent).toMatch(/외부 출처/);
    rerender(
      <PluginConsentDialog
        prompt={{ ...promptBase, trustLevel: "llm-generated" }}
        onDecision={() => {}}
      />,
    );
    expect(screen.getByTestId("consent-recommendation").textContent).toMatch(/LLM/);
  });
});
