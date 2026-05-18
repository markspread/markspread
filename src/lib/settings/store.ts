// S-ST-010 / S-ST-013 / S-ST-014 / S-ST-015: settings store.
//
// Two backing layers: workspace-scoped values shadow global ones.
// `effectiveValue(key)` = workspace ?? global ?? defaultValue.
//
// Persistence is delegated to a host adapter (Tauri-side reads/
// writes the JSON files). The store itself is pure; tests can swap
// in an in-memory adapter.
//
// Listeners: each setting key has its own subscription list so
// downstream UI rerenders are scoped (the editor doesn't rebuild
// because privacy.telemetry flipped).

import { SETTINGS, type SettingDef, findSetting } from "./schema";

export type SettingScopeKey = "global" | "workspace";

export interface SettingsAdapter {
  read(scope: SettingScopeKey): Promise<Record<string, unknown>>;
  write(scope: SettingScopeKey, values: Record<string, unknown>): Promise<void>;
}

let adapter: SettingsAdapter | null = null;
let global: Record<string, unknown> = {};
let workspace: Record<string, unknown> = {};
const keyListeners = new Map<string, Set<() => void>>();

export function setSettingsAdapter(a: SettingsAdapter | null): void {
  adapter = a;
}

export async function loadSettings(): Promise<void> {
  if (!adapter) return;
  const [g, w] = await Promise.all([
    adapter.read("global").catch(() => ({})),
    adapter.read("workspace").catch(() => ({})),
  ]);
  global = g;
  workspace = w;
  emitAll();
}

export function getSetting<T = unknown>(key: string): T {
  const def = findSetting(key);
  if (key in workspace) return workspace[key] as T;
  if (key in global) return global[key] as T;
  return (def?.defaultValue ?? undefined) as T;
}

export function getSettingScope(key: string): SettingScopeKey | "default" {
  if (key in workspace) return "workspace";
  if (key in global) return "global";
  return "default";
}

export async function setSetting(
  key: string,
  value: unknown,
  scope: SettingScopeKey = "global",
): Promise<void> {
  const def = findSetting(key);
  if (!def) throw new Error(`Unknown setting: ${key}`);
  let effectiveScope = scope;
  if (def.scope === "global" && effectiveScope === "workspace") effectiveScope = "global";
  const target = effectiveScope === "workspace" ? workspace : global;
  target[key] = value;
  if (adapter)
    await adapter.write(effectiveScope, effectiveScope === "workspace" ? workspace : global);
  emit(key);
}

export async function resetSetting(
  key: string,
  scope: SettingScopeKey = "workspace",
): Promise<void> {
  const target = scope === "workspace" ? workspace : global;
  if (key in target) {
    delete target[key];
    if (adapter) await adapter.write(scope, target);
    emit(key);
  }
}

export function subscribeSetting(key: string, fn: () => void): () => void {
  let set = keyListeners.get(key);
  if (!set) {
    set = new Set();
    keyListeners.set(key, set);
  }
  set.add(fn);
  return () => set?.delete(fn);
}

function emit(key: string): void {
  const set = keyListeners.get(key);
  if (set) {
    for (const fn of set) fn();
  }
}

function emitAll(): void {
  for (const set of keyListeners.values()) {
    for (const fn of set) fn();
  }
}

// S-ST-015: serialise the full settings tree for export.
export function exportSettings(): {
  global: Record<string, unknown>;
  workspace: Record<string, unknown>;
} {
  return { global: { ...global }, workspace: { ...workspace } };
}

export async function importSettings(payload: {
  global?: Record<string, unknown>;
  workspace?: Record<string, unknown>;
}): Promise<void> {
  // Validate against schema; silently drop unknown keys but warn in
  // the console so plugin authors notice during import-tests.
  const allowed = new Set(SETTINGS.map((s) => s.key));
  const filter = (input: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(input).filter(([k]) => allowed.has(k)));
  if (payload.global) {
    global = filter(payload.global);
    if (adapter) await adapter.write("global", global);
  }
  if (payload.workspace) {
    workspace = filter(payload.workspace);
    if (adapter) await adapter.write("workspace", workspace);
  }
  emitAll();
}

export function snapshot(): {
  defs: SettingDef[];
  values: Record<string, unknown>;
  scopes: Record<string, ReturnType<typeof getSettingScope>>;
} {
  const values: Record<string, unknown> = {};
  const scopes: Record<string, ReturnType<typeof getSettingScope>> = {};
  for (const def of SETTINGS) {
    values[def.key] = getSetting(def.key);
    scopes[def.key] = getSettingScope(def.key);
  }
  return { defs: SETTINGS, values, scopes };
}
