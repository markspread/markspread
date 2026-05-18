// S-PLD-001..019: plugin developer SDK + dev-mode runner.
//
// The SDK is what plugin authors `import` from `@markspread/sdk`. We
// publish it as a separate npm package, but the canonical types live
// here so the host code-gens the .d.ts via tsc on release.
//
// Three audiences:
//
//   1. Plugin authors: type-only imports (`PluginContext`, host APIs,
//      contribution shapes). Runtime code in the SDK npm package
//      forwards through `globalThis.__ms_bridge`.
//   2. Host code: imports the same types so contribution validation
//      and bridge dispatch share one source of truth.
//   3. Tests: vitest mocks the bridge by replacing `__ms_bridge` with
//      a recorder (S-PLD-016).

// ─── Lifecycle context ──────────────────────────────────────────────────

export interface PluginContext {
  readonly id: string;
  readonly version: string;
  /**
   * Subscriptions disposed when the plugin deactivates. Plugin code
   * pushes Disposable values; the host calls dispose() on each in
   * registration order during teardown (S-PLD-019).
   */
  readonly subscriptions: Disposable[];
  /** Per-plugin namespaced KV. */
  readonly storage: PluginStorage;
  /** Logger that shows up in View → Plugin Logs. */
  readonly log: PluginLogger;
}

export interface Disposable {
  dispose(): void | Promise<void>;
}

export interface PluginStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface PluginLogger {
  log(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

// ─── Contribution shapes (S-PLD-002..006) ───────────────────────────────

export interface ParserContribution {
  /** Language id this parser handles, e.g. "mermaid". */
  language: string;
  /** Returns rendered markup or a structured error to surface inline. */
  render(input: string, ctx: ParserRenderContext): Promise<ParserRenderResult>;
}

export interface ParserRenderContext {
  /** Document path the input came from — null for ad-hoc renders. */
  documentPath: string | null;
  /** Theme tokens so the parser can colour output to match the editor. */
  theme: Record<string, string>;
}

export type ParserRenderResult =
  | { kind: "html"; html: string }
  | { kind: "svg"; svg: string }
  | { kind: "error"; message: string };

export interface AiActionContribution {
  id: string;
  label: string;
  /** Predicate that runs against the editor state before the action shows up. */
  isApplicable?(state: AiApplicabilityState): boolean;
  /** Builds the prompt; the host runs the provider call and streams the response. */
  buildPrompt(state: AiApplicabilityState): string;
}

export interface AiApplicabilityState {
  selection: string | null;
  documentText: string;
  documentPath: string | null;
  language: string | null;
}

export interface ThemeContribution {
  id: string;
  label: string;
  /** Maps to CSS custom properties applied at the theme root. */
  tokens: Record<string, string>;
}

export interface CommandContribution {
  id: string;
  label: string;
  /** Default keybinding, can be overridden by the user. */
  defaultKey?: string;
  run(ctx: CommandContext): void | Promise<void>;
}

export interface CommandContext {
  selection: string | null;
  documentPath: string | null;
}

export interface ViewContribution {
  id: string;
  label: string;
  /** Where the view renders — sidebar pane or bottom panel. */
  location: "sidebar" | "panel";
  /** Mount handler — receives the iframe's container element. */
  mount(host: HTMLElement, ctx: ViewMountContext): Disposable;
}

export interface ViewMountContext {
  workspace: string | null;
  documentPath: string | null;
}

// ─── Dev-mode runner (S-PLD-008..012) ───────────────────────────────────

// `markspread --plugin-dev <path>` boots the app with a side-loaded
// plugin folder. The dev runner reads the manifest off disk, watches
// `manifest.json` and the bundle entry, and reloads on change.
export interface DevModeOptions {
  pluginPath: string;
  /** When true, dump every bridge message to the dev console (S-PLD-011/012). */
  trace: boolean;
}

export const DEV_HMR_DEBOUNCE_MS = 250;

// File-watch shapes the dev runner reports back so the dev console can
// surface "Plugin reloaded — manifest changed at 2:14:03".
export interface DevHmrEvent {
  pluginId: string;
  trigger: "manifest" | "bundle";
  triggeredAt: number;
}

// ─── Manifest violation diagnostics (S-PLD-011) ─────────────────────────

// The manifest validator returns plain {path,message} entries. The dev
// console enriches them with file/line if the violation maps to a known
// JSON path. We do best-effort source mapping by re-parsing the manifest
// JSON character stream.
export interface ManifestDiagnostic {
  /** "permissions[2].network" or similar. */
  path: string;
  message: string;
  /** 1-based line/column in manifest.json. */
  line: number;
  column: number;
}

export function locateInJson(json: string, path: string): { line: number; column: number } {
  // Walk the dotted/bracketed path and track byte offset; convert to
  // line/column at the end. This isn't a full JSON parser — it's a
  // surface scanner aimed at `permissions[2].network`-style paths,
  // which is the shape of every error the validator emits.
  const segments = path.split(/\.|\[(\d+)\]/).filter((s) => s !== "" && s !== undefined);
  let offset = 0;
  for (const seg of segments) {
    if (/^\d+$/.test(seg)) {
      // Array index — find matching `[`, then advance past N commas at depth 1.
      const bracket = json.indexOf("[", offset);
      if (bracket < 0) break;
      offset = bracket + 1;
      let depth = 1;
      let count = 0;
      const want = Number(seg);
      while (offset < json.length && depth > 0) {
        const ch = json[offset];
        if (ch === "[" || ch === "{") depth += 1;
        else if (ch === "]" || ch === "}") depth -= 1;
        else if (ch === "," && depth === 1) {
          count += 1;
          if (count === want) {
            offset += 1;
            break;
          }
        }
        offset += 1;
      }
    } else {
      const needle = `"${seg}"`;
      const idx = json.indexOf(needle, offset);
      if (idx < 0) break;
      offset = idx + needle.length;
    }
  }
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset && i < json.length; i += 1) {
    if (json[i] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

// ─── CLI build / publish (S-PLD-013 / S-PLD-014) ────────────────────────

// `markspread-cli build` runs preflight and produces the npm-ready tarball.
// We expose the preflight logic here so it can also run in the dev runner
// before the user even attempts to publish — saves a round-trip.
export interface PreflightResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export const PREFLIGHT_REQUIREMENTS = [
  "manifest.json present at package root",
  "manifest passes schema validation",
  "engines.markspread satisfied by current SDK version",
  "package.json `name` matches `markspread-plugin-*` or `@markspread-plugins/*`",
  "package.json `files` includes manifest.json + dist/",
  "no `dependencies` outside the SDK + sandbox-safe shortlist",
];

// ─── Test helpers (S-PLD-016) ───────────────────────────────────────────

// vitest setup helper — drop into `vitest.setup.ts` to install a recording
// bridge. Plugin authors then assert against the recorded calls.
export interface BridgeCallRecord {
  command: string;
  payload: unknown;
}

export interface RecordingBridge {
  calls: BridgeCallRecord[];
  /** Optional canned responses keyed by method. */
  respondWith(method: string, output: unknown): void;
  /** Register a handler that produces the canned response from input. */
  respond(method: string, handler: (input: unknown) => unknown): void;
  /** Invoke a registered handler — used by tests to simulate plugin → host calls. */
  invoke(method: string, input: unknown): Promise<unknown>;
  /** Reset between tests. */
  reset(): void;
}

export function createRecordingBridge(): RecordingBridge {
  const calls: BridgeCallRecord[] = [];
  const responses = new Map<string, unknown>();
  const handlers = new Map<string, (input: unknown) => unknown>();

  // The plugin SDK reads `globalThis.__ms_bridge.request(method, input)`.
  // We assign a function-shape that records the call and returns either
  // the canned response or undefined.
  (globalThis as Record<string, unknown>).__ms_bridge = {
    request(method: string, input: unknown) {
      calls.push({ command: method, payload: input });
      return Promise.resolve(responses.get(method));
    },
  };

  return {
    calls,
    respondWith(method, output) {
      responses.set(method, output);
    },
    respond(method, handler) {
      handlers.set(method, handler);
    },
    async invoke(method, input) {
      calls.push({ command: method, payload: input });
      const h = handlers.get(method);
      if (!h) throw new Error(`missing handler for command: ${method}`);
      return h(input);
    },
    reset() {
      calls.length = 0;
      responses.clear();
      handlers.clear();
    },
  };
}
