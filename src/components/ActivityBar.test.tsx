import { registerParser } from "@markspread/parser-sdk";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  STUDIO_PREVIEW_PARSER_ID,
  __resetParserRegistryForTests,
  getParserRegistry,
} from "../lib/parsers/registry";
import { useActivityMode } from "../store/activity-mode";
import { useSettings } from "../store/settings";
import { ActivityBar } from "./ActivityBar";

function registerUserParser(id: string, ext: string): void {
  registerParser(
    {
      id,
      version: "0.1.0",
      displayName: id,
      fileMatch: { extensions: [ext] },
      capabilities: "preview-only",
      entry: "./e.js",
    },
    () => ({ ast: null }),
  );
}

describe("ActivityBar", () => {
  beforeEach(() => {
    __resetParserRegistryForTests();
    getParserRegistry(); // bootstrap the system markdown parser
    useActivityMode.setState({ mode: "workspace", parserRegistryRev: 0 });
    useSettings.setState({ developerMode: false });
  });
  afterEach(cleanup);

  it("renders Workspace always but hides Parser Studio by default (ADR-0019 T5)", () => {
    render(<ActivityBar />);
    expect(screen.getByTestId("activity-workspace").getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByTestId("activity-parser")).toBeNull();
  });

  it("shows Parser Studio when developer mode is enabled", () => {
    useSettings.setState({ developerMode: true });
    render(<ActivityBar />);
    expect(screen.getByTestId("activity-parser")).not.toBeNull();
    expect(screen.getByTestId("activity-parser").getAttribute("aria-pressed")).toBe("false");
  });

  it("shows Parser Studio once a self-authored parser is registered (T5 auto-appear)", () => {
    registerUserParser("wiki", ".wiki");
    // registry mutated → the UI gets notified via the registry revision bump.
    useActivityMode.setState({ parserRegistryRev: 1 });
    render(<ActivityBar />);
    expect(screen.getByTestId("activity-parser")).not.toBeNull();
  });

  it("keeps Parser Studio hidden when only the Studio temp preview parser exists", () => {
    registerUserParser(STUDIO_PREVIEW_PARSER_ID, ".__studiopreview__");
    useActivityMode.setState({ parserRegistryRev: 1 });
    render(<ActivityBar />);
    expect(screen.queryByTestId("activity-parser")).toBeNull();
  });

  it("still shows the Parser Studio button while in parser mode even if the gate is off", () => {
    // P-self entered via the chat 'make a parser' breadcrumb (enterParser sets
    // mode='parser' directly); the back-to-Workspace path must not disappear.
    useActivityMode.setState({ mode: "parser" });
    render(<ActivityBar />);
    expect(screen.getByTestId("activity-parser").getAttribute("aria-pressed")).toBe("true");
  });

  it("switches to parser mode on click when the rail is visible", () => {
    useSettings.setState({ developerMode: true });
    render(<ActivityBar />);
    fireEvent.click(screen.getByTestId("activity-parser"));
    expect(useActivityMode.getState().mode).toBe("parser");
    expect(screen.getByTestId("activity-parser").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("activity-workspace").getAttribute("aria-pressed")).toBe("false");
  });

  it("switches back to workspace mode on click", () => {
    useActivityMode.setState({ mode: "parser" });
    render(<ActivityBar />);
    fireEvent.click(screen.getByTestId("activity-workspace"));
    expect(useActivityMode.getState().mode).toBe("workspace");
  });

  it("re-evaluates the gate reactively when the registry revision bumps", () => {
    render(<ActivityBar />);
    expect(screen.queryByTestId("activity-parser")).toBeNull();
    act(() => {
      registerUserParser("wiki", ".wiki");
      useActivityMode.getState().notifyParserRegistryChanged();
    });
    expect(screen.getByTestId("activity-parser")).not.toBeNull();
  });
});
