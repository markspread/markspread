// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useAgentRegistry } from "../store/agent-registry";
import { AgentPicker } from "./AgentPicker";

function reset() {
  useAgentRegistry.getState()._reset();
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
}

describe("AgentPicker", () => {
  beforeEach(reset);
  afterEach(() => {
    cleanup();
    reset();
  });

  it("renders an option per registered agent, grouped by kind", () => {
    const { container } = render(<AgentPicker workspaceId="/ws" />);
    const opts = container.querySelectorAll("option");
    expect(opts.length).toBeGreaterThanOrEqual(3);
    const groups = container.querySelectorAll("optgroup");
    const labels = Array.from(groups).map((g) => g.getAttribute("label"));
    expect(labels).toContain("Subscription");
    expect(labels).toContain("API key");
  });

  it("selecting an agent updates the workspace default", () => {
    const { getByTestId } = render(<AgentPicker workspaceId="/ws" />);
    fireEvent.change(getByTestId("agent-picker-select"), {
      target: { value: "claude-haiku" },
    });
    expect(useAgentRegistry.getState().defaults["/ws"]).toBe("claude-haiku");
  });

  it("with a sessionId, selection also stores a session override", () => {
    const { getByTestId } = render(<AgentPicker workspaceId="/ws" sessionId="sess-A" />);
    fireEvent.change(getByTestId("agent-picker-select"), {
      target: { value: "claude-api-key" },
    });
    expect(useAgentRegistry.getState().overrides["sess-A"]).toBe("claude-api-key");
  });

  it("+ Add toggles the custom form and Save creates the agent", async () => {
    const { getByTestId, queryByTestId } = render(<AgentPicker workspaceId="/ws" />);
    fireEvent.click(getByTestId("agent-picker-add"));
    expect(queryByTestId("agent-picker-custom-form")).toBeTruthy();
    fireEvent.change(getByTestId("agent-picker-custom-id"), { target: { value: "my-acp" } });
    fireEvent.change(getByTestId("agent-picker-custom-label"), {
      target: { value: "My ACP" },
    });
    fireEvent.change(getByTestId("agent-picker-custom-cmd"), {
      target: { value: "my-bin --acp --foo" },
    });
    fireEvent.click(getByTestId("agent-picker-custom-save"));
    await waitFor(() => {
      expect(useAgentRegistry.getState().byId["my-acp"]).toBeDefined();
    });
    const entry = useAgentRegistry.getState().byId["my-acp"];
    expect(entry?.transport?.command).toBe("my-bin");
    expect(entry?.transport?.args).toEqual(["--acp", "--foo"]);
    // Form should auto-close.
    expect(queryByTestId("agent-picker-custom-form")).toBeNull();
  });

  it("falls back to id when label is blank", async () => {
    const { getByTestId } = render(<AgentPicker workspaceId="/ws" />);
    fireEvent.click(getByTestId("agent-picker-add"));
    fireEvent.change(getByTestId("agent-picker-custom-id"), { target: { value: "no-label" } });
    fireEvent.change(getByTestId("agent-picker-custom-cmd"), { target: { value: "x" } });
    fireEvent.click(getByTestId("agent-picker-custom-save"));
    await waitFor(() => {
      expect(useAgentRegistry.getState().byId["no-label"]).toBeDefined();
    });
    expect(useAgentRegistry.getState().byId["no-label"]?.label).toBe("no-label");
  });

  it("Save with empty id is a no-op", () => {
    const { getByTestId } = render(<AgentPicker workspaceId="/ws" />);
    fireEvent.click(getByTestId("agent-picker-add"));
    fireEvent.click(getByTestId("agent-picker-custom-save"));
    expect(invokeMock).not.toHaveBeenCalledWith("agents_save_custom", expect.anything());
  });

  it("Save with empty command is a no-op", () => {
    const { getByTestId } = render(<AgentPicker workspaceId="/ws" />);
    fireEvent.click(getByTestId("agent-picker-add"));
    fireEvent.change(getByTestId("agent-picker-custom-id"), { target: { value: "id-only" } });
    fireEvent.click(getByTestId("agent-picker-custom-save"));
    expect(invokeMock).not.toHaveBeenCalledWith("agents_save_custom", expect.anything());
  });

  it("Cancel button hides the custom form", () => {
    const { getByTestId, queryByTestId } = render(<AgentPicker workspaceId="/ws" />);
    fireEvent.click(getByTestId("agent-picker-add"));
    expect(queryByTestId("agent-picker-custom-form")).toBeTruthy();
    fireEvent.click(getByTestId("agent-picker-add"));
    expect(queryByTestId("agent-picker-custom-form")).toBeNull();
  });

  it("empty registry renders nothing-selected without crashing", () => {
    useAgentRegistry.setState({ byId: {}, order: [] });
    const { getByTestId } = render(<AgentPicker workspaceId="/ws" />);
    expect((getByTestId("agent-picker-select") as HTMLSelectElement).value).toBe("");
  });
});
