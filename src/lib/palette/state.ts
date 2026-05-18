// S-CP-001 / S-CP-002 / S-CP-014: palette open/close state machine.
//
// Two visual modes:
//   • mode="all"  — ⌘K opens the full palette; user types any prefix
//   • mode="file" — ⌘P opens the file-quick-open mode; query is
//                   prefixed with no operator and category is locked
//                   to "file".
//
// We expose imperative `openPalette(mode)` / `closePalette()` plus a
// subscribe hook so the React shell renders without owning state.

export type PaletteMode = "all" | "file";

export interface PaletteState {
  open: boolean;
  mode: PaletteMode;
}

let state: PaletteState = { open: false, mode: "all" };
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

export function getPaletteState(): PaletteState {
  return state;
}

export function openPalette(mode: PaletteMode = "all"): void {
  state = { open: true, mode };
  emit();
}

export function closePalette(): void {
  if (!state.open) return;
  state = { ...state, open: false };
  emit();
}

export function togglePalette(mode: PaletteMode = "all"): void {
  if (state.open && state.mode === mode) closePalette();
  else openPalette(mode);
}

export function subscribePalette(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
