// S-TY-003..009: live font-family / size / spacing CSS-variable effect.

import { render } from "@testing-library/react";
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocale } from "../store/locale";
import { useSettings } from "../store/settings";
import { useFontFamilyEffect } from "./font-effect";

function Host(): null {
  useFontFamilyEffect();
  return null;
}

const initial = useSettings.getState();

beforeEach(() => {
  useSettings.setState({
    uiFontFamily: "",
    editorFontFamily: "",
    fontSizePx: initial.fontSizePx,
    lineHeight: initial.lineHeight,
    letterSpacingPx: 0,
    fontWeight: initial.fontWeight,
  });
  useLocale.setState({ locale: "en" });
  const root = document.documentElement;
  root.style.cssText = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useFontFamilyEffect", () => {
  it("applies the default font stacks when no custom family is set", () => {
    render(h(Host));
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--font-sans")).toContain("Inter");
    expect(root.style.getPropertyValue("--font-mono")).toContain("monospace");
  });

  it("prepends a custom UI font family", () => {
    useSettings.setState({ uiFontFamily: "My Font", editorFontFamily: "Mono X" });
    render(h(Host));
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--font-sans")).toContain('"My Font"');
    expect(root.style.getPropertyValue("--font-mono")).toContain('"Mono X"');
  });

  it("does not quote a single-word family without spaces", () => {
    useSettings.setState({ uiFontFamily: "Roboto" });
    render(h(Host));
    expect(document.documentElement.style.getPropertyValue("--font-sans")).toContain("Roboto,");
  });

  it("applies size, line-height and weight to the root", () => {
    useSettings.setState({ fontSizePx: 18, lineHeight: 1.6, fontWeight: "medium" });
    render(h(Host));
    const root = document.documentElement;
    expect(root.style.fontSize).toBe("18px");
    expect(root.style.lineHeight).toBe("1.6");
    expect(root.style.fontWeight).toBe("500");
  });

  it("clears letter-spacing when it is zero", () => {
    useSettings.setState({ letterSpacingPx: 0 });
    render(h(Host));
    expect(document.documentElement.style.letterSpacing).toBe("");
  });

  it("applies a non-zero letter-spacing", () => {
    useSettings.setState({ letterSpacingPx: 1 });
    render(h(Host));
    expect(document.documentElement.style.letterSpacing).toBe("1px");
  });

  it("uses the Japanese CJK chain for the ja locale", () => {
    useLocale.setState({ locale: "ja" });
    render(h(Host));
    expect(document.documentElement.style.getPropertyValue("--font-sans")).toContain(
      "Noto Sans JP",
    );
  });

  it("uses the Simplified Chinese chain for zh by default", () => {
    vi.stubGlobal("navigator", { languages: ["zh-CN"], language: "zh-CN" });
    useLocale.setState({ locale: "zh" });
    render(h(Host));
    expect(document.documentElement.style.getPropertyValue("--font-sans")).toContain(
      "Noto Sans SC",
    );
  });

  it("uses the Traditional Chinese chain for a zh-TW navigator", () => {
    vi.stubGlobal("navigator", { languages: ["zh-TW"], language: "zh-TW" });
    useLocale.setState({ locale: "zh" });
    render(h(Host));
    expect(document.documentElement.style.getPropertyValue("--font-sans")).toContain(
      "Noto Sans TC",
    );
  });
});
