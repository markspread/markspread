// S-ST-001 / S-ST-012: settings-dialog open/close + search state.
// Mirrors the palette's tiny pub/sub pattern.

import type { SettingCategory } from "./schema";

export interface SettingsDialogState {
  open: boolean;
  category: SettingCategory;
  query: string;
  jsonMode: boolean; // S-ST-011
}

let state: SettingsDialogState = {
  open: false,
  category: "general",
  query: "",
  jsonMode: false,
};

const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export function getSettingsDialogState(): SettingsDialogState {
  return state;
}

export function openSettingsDialog(category?: SettingCategory): void {
  state = {
    open: true,
    category: category ?? state.category,
    query: "",
    jsonMode: state.jsonMode,
  };
  emit();
}

export function closeSettingsDialog(): void {
  if (!state.open) return;
  state = { ...state, open: false };
  emit();
}

export function setSettingsCategory(category: SettingCategory): void {
  state = { ...state, category };
  emit();
}

export function setSettingsQuery(q: string): void {
  state = { ...state, query: q };
  emit();
}

export function setSettingsJsonMode(on: boolean): void {
  state = { ...state, jsonMode: on };
  emit();
}

export function subscribeSettingsDialog(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
