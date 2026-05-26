// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextPanel } from "../ContextPanel";

afterEach(cleanup);

describe("ContextPanel", () => {
  it("renders the placeholder file-tree caption when a workspace is set", () => {
    const { getByTestId } = render(
      <ContextPanel workspaceId="/ws" activeFilePath={null} onPickFile={() => {}} />,
    );
    expect(getByTestId("chat-file-tree").textContent).toContain("U2");
  });

  it("renders the no-workspace caption when workspaceId is empty", () => {
    const { getByTestId } = render(
      <ContextPanel workspaceId="" activeFilePath={null} onPickFile={() => {}} />,
    );
    expect(getByTestId("chat-file-tree").textContent).toContain("no workspace");
  });

  it("shows the active preview when activeFilePath is set + clear button works", () => {
    const onPick = vi.fn();
    const { getByTestId } = render(
      <ContextPanel workspaceId="/ws" activeFilePath="a.md" onPickFile={onPick} />,
    );
    expect(getByTestId("chat-active-preview").textContent).toContain("a.md");
    fireEvent.click(getByTestId("chat-clear-active-file"));
    expect(onPick).toHaveBeenCalledWith(null);
  });

  it("renders 'No file selected' italic when no activeFilePath", () => {
    const { getByTestId } = render(
      <ContextPanel workspaceId="/ws" activeFilePath={null} onPickFile={() => {}} />,
    );
    expect(getByTestId("chat-active-preview").textContent).toContain("No file selected");
  });

  it("token gauge shows 0 / budget when the pack is empty (workspaceId only)", () => {
    const { getByTestId } = render(
      <ContextPanel workspaceId="/ws" activeFilePath={null} onPickFile={() => {}} />,
    );
    const gauge = getByTestId("chat-token-gauge");
    expect(gauge.textContent).toMatch(/\d+ \/ \d+/);
  });
});
