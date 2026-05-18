// S-AI-040: function calling (tools) — v2.
//
// v1 (pre-Phase-5) shipped two tools — `read_file` and `list_workspace`.
// v2 generalises that into a registry pattern so new tools can be added
// without touching the dispatcher, plus three new tools the editor needs
// for genuinely useful agentic behaviour:
//
//   - `read_file`         — read any workspace file, gitignore-aware
//   - `list_workspace`    — list files matching a glob
//   - `search_workspace`  — ripgrep-backed text search (S-PF aligned)
//   - `get_outline`       — return current document headings
//   - `apply_edit`        — propose a structured edit (user must confirm)
//
// Every tool round-trip is shown to the user in the AI activity panel so
// they can see exactly what the model touched. `apply_edit` never writes
// directly — it returns a proposal that requires the user's click. This
// keeps the model's destructive surface zero by default; the user is
// always the one in the driver's seat.

export interface ToolParameter {
  name: string;
  description: string;
  required: boolean;
  /** JSON-schema type. We keep this small — `string`/`number`/`boolean` cover every current tool. */
  type: "string" | "number" | "boolean";
}

export interface ToolDefinition<I = Record<string, unknown>, O = unknown> {
  name: string;
  description: string;
  parameters: ToolParameter[];
  /** True when the tool can mutate user state. The dispatcher requires user confirmation for these. */
  mutating: boolean;
  run(input: I, ctx: ToolContext): Promise<O>;
}

export interface ToolContext {
  workspace: string | null;
  documentPath: string | null;
  documentText: string;
  /** Honour user-aborts mid-tool by surfacing this signal to long ops. */
  signal: AbortSignal;
}

class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** Schema list used to advertise the tools to the model in the API request. */
  schema(): ToolDefinition[] {
    return [...this.tools.values()];
  }
}

export const aiTools = new ToolRegistry();

// Render the registry into the JSON-shape the provider expects. Anthropic
// tool definitions take `input_schema` (JSON-schema), so we synthesise it
// from the parameter list — no hand-written schemas to drift.
export function renderToolsForProvider(tools: ToolDefinition[]): unknown[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: "object",
      properties: Object.fromEntries(
        t.parameters.map((p) => [p.name, { type: p.type, description: p.description }]),
      ),
      required: t.parameters.filter((p) => p.required).map((p) => p.name),
    },
  }));
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  callId: string;
  ok: boolean;
  content: unknown;
  /** When the tool was mutating, what the user clicked. */
  userDecision?: "accepted" | "rejected";
}

// Dispatch a tool call against the registry. Mutating tools are never
// auto-run — the caller must supply a `confirmMutation` callback that
// asks the user; if they reject we return a structured failure the model
// can read ("user declined to apply edit").
export async function dispatchToolCall(
  call: ToolCall,
  ctx: ToolContext,
  confirmMutation: (call: ToolCall) => Promise<boolean>,
): Promise<ToolResult> {
  const tool = aiTools.get(call.name);
  if (!tool) {
    return { callId: call.id, ok: false, content: { error: `unknown tool: ${call.name}` } };
  }
  if (tool.mutating) {
    const ok = await confirmMutation(call);
    if (!ok) {
      return {
        callId: call.id,
        ok: false,
        content: { error: "user declined to apply this change" },
        userDecision: "rejected",
      };
    }
  }
  try {
    const out = await tool.run(call.input, ctx);
    return {
      callId: call.id,
      ok: true,
      content: out,
      ...(tool.mutating ? { userDecision: "accepted" as const } : {}),
    };
  } catch (e) {
    return { callId: call.id, ok: false, content: { error: (e as Error).message } };
  }
}
