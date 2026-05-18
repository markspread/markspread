import { render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { describe, expect, it } from "vitest";
import { AutoUpdateConsent } from "../components/AutoUpdateConsent";
import { ShortcutHint } from "../components/ShortcutHint";
import { TelemetryConsent } from "../components/TelemetryConsent";
import { WelcomeBanner } from "../components/WelcomeBanner";

// S-A11-001: axe-core sweep over the UI surfaces a screen reader is most
// likely to land on first. We render each component into JSDOM and require
// jest-axe to report zero violations. New screens / components should be
// added to this list as they ship — the goal is "0 axe errors in CI".

expect.extend(toHaveNoViolations);

describe("a11y/axe", () => {
  it("TelemetryConsent has no violations", async () => {
    const { container } = render(<TelemetryConsent />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("AutoUpdateConsent has no violations", async () => {
    const { container } = render(<AutoUpdateConsent />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("WelcomeBanner has no violations", async () => {
    const { container } = render(<WelcomeBanner />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("ShortcutHint has no violations", async () => {
    const { container } = render(<ShortcutHint />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
