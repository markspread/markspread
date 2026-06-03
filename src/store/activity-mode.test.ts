import { beforeEach, describe, expect, it } from "vitest";
import { shouldShowParserStudio, useActivityMode } from "./activity-mode";

describe("useActivityMode", () => {
  beforeEach(() => {
    useActivityMode.setState({
      mode: "workspace",
      parserPrefillSource: "",
      enteredParserFrom: null,
      parserRenderNonce: 0,
      parserRegistryRev: 0,
    });
  });

  it("defaults to workspace mode with empty carry state", () => {
    const s = useActivityMode.getState();
    expect(s.mode).toBe("workspace");
    expect(s.parserPrefillSource).toBe("");
    expect(s.enteredParserFrom).toBeNull();
    expect(s.parserRenderNonce).toBe(0);
    expect(s.parserRegistryRev).toBe(0);
  });

  it("notifyParserRegistryChanged bumps the registry revision (rail re-eval trigger)", () => {
    useActivityMode.getState().notifyParserRegistryChanged();
    expect(useActivityMode.getState().parserRegistryRev).toBe(1);
    useActivityMode.getState().notifyParserRegistryChanged();
    expect(useActivityMode.getState().parserRegistryRev).toBe(2);
  });

  it("mode transitions never touch the registry revision (T4: no reset on switch)", () => {
    useActivityMode.getState().notifyParserRegistryChanged();
    const rev = useActivityMode.getState().parserRegistryRev;
    useActivityMode.getState().setMode("parser");
    useActivityMode.getState().setMode("workspace");
    useActivityMode.getState().enterParser({ prefillSource: "X" });
    useActivityMode.getState().exitParser();
    expect(useActivityMode.getState().parserRegistryRev).toBe(rev);
  });

  it("switches to parser mode and back via the activity bar", () => {
    useActivityMode.getState().setMode("parser");
    expect(useActivityMode.getState().mode).toBe("parser");
    useActivityMode.getState().setMode("workspace");
    expect(useActivityMode.getState().mode).toBe("workspace");
  });

  it("enterParser records the origin mode and carries the prefill source", () => {
    useActivityMode.getState().enterParser({ prefillSource: "SRC" });
    const s = useActivityMode.getState();
    expect(s.mode).toBe("parser");
    expect(s.parserPrefillSource).toBe("SRC");
    expect(s.enteredParserFrom).toBe("workspace");
  });

  it("enterParser without options carries no prefill", () => {
    useActivityMode.getState().enterParser();
    const s = useActivityMode.getState();
    expect(s.mode).toBe("parser");
    expect(s.parserPrefillSource).toBe("");
    expect(s.enteredParserFrom).toBe("workspace");
  });

  it("enterParser while already in parser mode preserves the original origin", () => {
    useActivityMode.getState().enterParser({ prefillSource: "FIRST" });
    expect(useActivityMode.getState().enteredParserFrom).toBe("workspace");
    // a second entry (e.g. a new code-block click) must not overwrite the origin
    useActivityMode.getState().enterParser({ prefillSource: "SECOND" });
    const s = useActivityMode.getState();
    expect(s.enteredParserFrom).toBe("workspace");
    expect(s.parserPrefillSource).toBe("SECOND");
  });

  it("clearParserPrefill empties the carried source", () => {
    useActivityMode.getState().enterParser({ prefillSource: "SRC" });
    useActivityMode.getState().clearParserPrefill();
    expect(useActivityMode.getState().parserPrefillSource).toBe("");
  });

  it("exitParser returns to the entered review mode and clears carry state", () => {
    useActivityMode.getState().enterParser({ prefillSource: "SRC" });
    useActivityMode.getState().exitParser();
    const s = useActivityMode.getState();
    expect(s.mode).toBe("workspace");
    expect(s.enteredParserFrom).toBeNull();
    expect(s.parserPrefillSource).toBe("");
  });

  it("exitParser falls back to workspace when there is no recorded origin", () => {
    // direct activity-bar entry → enteredParserFrom stays null
    useActivityMode.getState().setMode("parser");
    useActivityMode.getState().exitParser();
    expect(useActivityMode.getState().mode).toBe("workspace");
  });

  it("renderWithParser returns to review, clears carry state, and bumps the nonce", () => {
    useActivityMode.getState().enterParser({ prefillSource: "SRC" });
    useActivityMode.getState().renderWithParser();
    const s = useActivityMode.getState();
    expect(s.mode).toBe("workspace");
    expect(s.enteredParserFrom).toBeNull();
    expect(s.parserPrefillSource).toBe("");
    expect(s.parserRenderNonce).toBe(1);
  });

  it("renderWithParser falls back to workspace when there is no recorded origin", () => {
    useActivityMode.getState().setMode("parser");
    useActivityMode.getState().renderWithParser();
    expect(useActivityMode.getState().mode).toBe("workspace");
    expect(useActivityMode.getState().parserRenderNonce).toBe(1);
  });
});

describe("shouldShowParserStudio (ADR-0019 T5 gate)", () => {
  it("hides the rail when developer mode is off and there are no user parsers", () => {
    expect(shouldShowParserStudio({ developerMode: false, userParserCount: 0 })).toBe(false);
  });

  it("shows the rail when developer mode is on regardless of parser count", () => {
    expect(shouldShowParserStudio({ developerMode: true, userParserCount: 0 })).toBe(true);
  });

  it("shows the rail when at least one user parser exists, even with developer mode off", () => {
    expect(shouldShowParserStudio({ developerMode: false, userParserCount: 1 })).toBe(true);
    expect(shouldShowParserStudio({ developerMode: false, userParserCount: 5 })).toBe(true);
  });
});
