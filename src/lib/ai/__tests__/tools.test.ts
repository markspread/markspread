// S-AI-040: function calling (tools) coverage.

import { describe, expect, it } from "vitest";
import {
  type ToolCall,
  type ToolContext,
  type ToolDefinition,
  aiTools,
  dispatchToolCall,
  renderToolsForProvider,
} from "../tools";

const ctx: ToolContext = {
  workspace: "/ws",
  documentPath: "/ws/a.md",
  documentText: "doc",
  signal: new AbortController().signal,
};

function makeTool(over: Partial<ToolDefinition>): ToolDefinition {
  return {
    name: `tool-${Math.random().toString(36).slice(2)}`,
    description: "a tool",
    parameters: [{ name: "p", description: "param", required: true, type: "string" }],
    mutating: false,
    async run() {
      return { ok: true };
    },
    ...over,
  };
}

describe("renderToolsForProvider", () => {
  it("synthesises an input_schema with properties and required keys", () => {
    const tool = makeTool({
      parameters: [
        { name: "path", description: "the path", required: true, type: "string" },
        { name: "depth", description: "the depth", required: false, type: "number" },
      ],
    });
    const [rendered] = renderToolsForProvider([tool]) as {
      name: string;
      input_schema: { properties: Record<string, unknown>; required: string[] };
    }[];
    expect(rendered?.input_schema.required).toEqual(["path"]);
    expect(Object.keys(rendered?.input_schema.properties ?? {})).toEqual(["path", "depth"]);
  });
});

describe("ToolRegistry", () => {
  it("registers and retrieves a tool by name", () => {
    const tool = makeTool({});
    aiTools.register(tool);
    expect(aiTools.get(tool.name)).toBe(tool);
  });

  it("throws when registering a duplicate name", () => {
    const tool = makeTool({});
    aiTools.register(tool);
    expect(() => aiTools.register(tool)).toThrow(/already registered/);
  });

  it("schema lists all registered tools", () => {
    const tool = makeTool({});
    aiTools.register(tool);
    expect(aiTools.schema().some((t) => t.name === tool.name)).toBe(true);
  });
});

describe("dispatchToolCall", () => {
  it("returns a failure for an unknown tool", async () => {
    const call: ToolCall = { id: "1", name: "no-such-tool", input: {} };
    const r = await dispatchToolCall(call, ctx, async () => true);
    expect(r.ok).toBe(false);
    expect(r.content).toEqual({ error: "unknown tool: no-such-tool" });
  });

  it("runs a non-mutating tool and returns its output", async () => {
    const tool = makeTool({
      async run() {
        return { value: 42 };
      },
    });
    aiTools.register(tool);
    const r = await dispatchToolCall(
      { id: "1", name: tool.name, input: {} },
      ctx,
      async () => true,
    );
    expect(r.ok).toBe(true);
    expect(r.content).toEqual({ value: 42 });
    expect(r.userDecision).toBeUndefined();
  });

  it("requires confirmation for a mutating tool and runs on accept", async () => {
    const tool = makeTool({ mutating: true });
    aiTools.register(tool);
    const r = await dispatchToolCall(
      { id: "1", name: tool.name, input: {} },
      ctx,
      async () => true,
    );
    expect(r.ok).toBe(true);
    expect(r.userDecision).toBe("accepted");
  });

  it("returns a rejection when the user declines a mutating tool", async () => {
    const tool = makeTool({ mutating: true });
    aiTools.register(tool);
    const r = await dispatchToolCall(
      { id: "1", name: tool.name, input: {} },
      ctx,
      async () => false,
    );
    expect(r.ok).toBe(false);
    expect(r.userDecision).toBe("rejected");
  });

  it("captures a thrown error as a structured failure", async () => {
    const tool = makeTool({
      async run() {
        throw new Error("tool exploded");
      },
    });
    aiTools.register(tool);
    const r = await dispatchToolCall(
      { id: "1", name: tool.name, input: {} },
      ctx,
      async () => true,
    );
    expect(r.ok).toBe(false);
    expect(r.content).toEqual({ error: "tool exploded" });
  });
});
