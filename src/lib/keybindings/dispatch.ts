// S-KB-005: context-aware dispatcher. The naive resolver in index.ts
// returns the first commandId whose binding matches; this layer
// filters candidates by the current UI context and warns when a
// single context still has multiple matches.
//
// "Context" is a small enum (WhenClause) the focus tracker keeps in
// sync with what's actually focused / open. The editor host calls
// setContext("editorFocus") on focus, the file tree's onFocus calls
// "treeFocus", and the modeless overlays (palette, sheet) call
// their respective context strings on open.
//
// Priority within a context, when multiple commands legitimately
// share a binding (rare): the *last* registered wins, and we log a
// warning. Plugin bindings (S-KB-012) come last in the registration
// order, so user-installed plugins can intentionally override
// built-ins by reusing a binding.

import { commands, type WhenClause } from "@/lib/commands/registry";
import {
  bindingFromEvent,
  listActiveBindings,
  normaliseBinding,
} from ".";
import { isComposing } from "./ime";

let activeContext: WhenClause = "always";
const stack: WhenClause[] = [];
let warned: Set<string> = new Set();

/**
 * Push a context onto the stack. Call from focus/open handlers; pair
 * with `popContext` in blur/close.
 */
export function pushContext(context: WhenClause): void {
  stack.push(context);
  activeContext = context;
}

export function popContext(context: WhenClause): void {
  const idx = stack.lastIndexOf(context);
  if (idx >= 0) stack.splice(idx, 1);
  activeContext = stack[stack.length - 1] ?? "always";
}

export function getContext(): WhenClause {
  return activeContext;
}

/**
 * Pick the command id (if any) that should fire for the given event.
 * Honours the active context and chord prefixes. Returns null if no
 * binding matches in the current context.
 */
export function dispatch(event: KeyboardEvent, prefix?: string): string | null {
  // S-KB-008: never resolve a binding while the IME is composing.
  // Esc/Enter naturally fall through to the IME (cancel/commit) since
  // we return null here without consuming the event.
  if (isComposing(event)) return null;
  const step = bindingFromEvent(event);
  if (!step) return null;
  const want = normaliseBinding(prefix ? `${prefix} ${step}` : step);

  const matches: { commandId: string; when: WhenClause }[] = [];
  for (const entry of listActiveBindings()) {
    if (normaliseBinding(entry.binding) !== want) continue;
    const cmd = commands.find((c) => c.id === entry.commandId);
    if (!cmd) continue;
    matches.push({ commandId: cmd.id, when: cmd.when ?? "always" });
  }
  if (matches.length === 0) return null;

  // Filter by context: a command with `when: "editorFocus"` only
  // fires when activeContext is "editorFocus". `when: "always"`
  // fires in any context.
  const inContext = matches.filter(
    (m) => m.when === "always" || m.when === activeContext,
  );

  // Prefer the most specific binding: a context-scoped match always
  // wins over an "always" match when both are present.
  const specific = inContext.filter((m) => m.when !== "always");
  const finalists = specific.length > 0 ? specific : inContext;

  if (finalists.length === 0) return null;

  if (finalists.length > 1) {
    // Last-registered wins. We warn once per (binding, context) pair
    // so the developer console highlights ambiguous registrations
    // without spamming on every keystroke.
    const key = `${want}@${activeContext}`;
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(
        `[keybindings] '${want}' matches ${finalists.length} commands in context '${activeContext}': ${finalists
          .map((m) => m.commandId)
          .join(", ")}. Last one wins; rebind to disambiguate.`,
      );
    }
  }
  return finalists[finalists.length - 1]!.commandId;
}

/** Reset the warn cache; tests use this. */
export function _resetWarnings(): void {
  warned = new Set();
}
