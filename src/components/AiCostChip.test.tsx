import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CostEstimate } from "../lib/ai/cost-estimate";
import { AiCostChip } from "./AiCostChip";

const estimate: CostEstimate = { tokens: 1234, usd: 0.0042 };

afterEach(cleanup);

describe("AiCostChip", () => {
  it("renders the action label and estimate", () => {
    render(
      <AiCostChip
        estimate={estimate}
        actionLabel="Summarize"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText("Summarize")).toBeTruthy();
    expect(screen.getByText(/tokens/)).toBeTruthy();
  });

  it("fires onConfirm and onCancel", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <AiCostChip
        estimate={estimate}
        actionLabel="Translate"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByText("Run"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
