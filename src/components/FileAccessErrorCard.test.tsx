import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccessDecision } from "../lib/access-policy/types";
import { FileAccessErrorCard } from "./FileAccessErrorCard";

const decision: AccessDecision = {
  ruleId: "PRM-OS-EACCES",
  category: "PRM",
  vars: { path: "/ws/x.md" },
};

afterEach(cleanup);

describe("FileAccessErrorCard", () => {
  it("renders the rule id and category badge", () => {
    render(<FileAccessErrorCard decision={decision} />);
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("data-rule-id")).toBe("PRM-OS-EACCES");
    expect(alert.getAttribute("data-access-category")).toBe("PRM");
  });

  it("renders the primary action button when a handler is supplied", () => {
    const retry = vi.fn();
    render(<FileAccessErrorCard decision={decision} handlers={{ retry }} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
    // biome-ignore lint/style/noNonNullAssertion: at least one button rendered
    fireEvent.click(buttons[0]!);
    expect(retry).toHaveBeenCalled();
  });

  it("omits action buttons when no handlers are given", () => {
    render(<FileAccessErrorCard decision={decision} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("uses a custom whyHref for the learn-more link", () => {
    render(<FileAccessErrorCard decision={decision} whyHref="https://example.com/why" />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("https://example.com/why");
  });

  it("applies an extra className", () => {
    render(<FileAccessErrorCard decision={decision} className="max-w-lg" />);
    expect(screen.getByRole("alert").className).toContain("max-w-lg");
  });

  it("derives the category from the rule id when none is given and tolerates missing vars", () => {
    const bareDecision = { ruleId: "PRM-OS-EACCES" } as unknown as AccessDecision;
    render(<FileAccessErrorCard decision={bareDecision} />);
    expect(screen.getByRole("alert").getAttribute("data-access-category")).toBe("PRM");
  });
});
