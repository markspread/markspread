// S-PR-018 / S-PR-019 / S-PR-020: Spread Pane host plumbing.
//
// What lives here (data layer, no React):
//   • SpreadPaneState — visibility, split ratio, active tab, plug-
//     in registered extra tabs. Persisted via the host's settings
//     adapter (S-PR-019 acceptance: ratio survives reload).
//   • registerSpreadTab(...) — plug-ins (or core tabs) register
//     additional view tabs (S-PR-020). Built-in tabs `preview` /
//     `outline` / `ai` / `diff` are pre-registered by the consumer.
//   • toggle/setRatio actions emit through a small subscriber hook
//     so the React layer stays a thin renderer.

export type SpreadTabId = string;

export interface SpreadTab {
  id: SpreadTabId;
  /** i18n key used for the tab label. */
  labelKey: string;
  /** Render function the host's React layer wraps. */
  render: () => unknown;
}

export interface SpreadPaneState {
  visible: boolean;
  ratio: number; // 0–1, fraction of the splitter assigned to the right pane
  activeTab: SpreadTabId;
  tabs: SpreadTab[];
}

const DEFAULT_STATE: SpreadPaneState = {
  visible: true,
  ratio: 0.45,
  activeTab: "preview",
  tabs: [],
};

let state: SpreadPaneState = { ...DEFAULT_STATE };
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

export function getSpreadPaneState(): SpreadPaneState {
  return state;
}

export function setSpreadPaneVisible(v: boolean): void {
  if (state.visible === v) return;
  state = { ...state, visible: v };
  emit();
}

export function toggleSpreadPane(): void {
  setSpreadPaneVisible(!state.visible);
}

export function setSpreadPaneRatio(ratio: number): void {
  const clamped = Math.max(0.15, Math.min(0.85, ratio));
  state = { ...state, ratio: clamped };
  emit();
}

export function setActiveSpreadTab(id: SpreadTabId): void {
  if (state.activeTab === id) return;
  if (!state.tabs.some((t) => t.id === id)) return;
  state = { ...state, activeTab: id };
  emit();
}

export function registerSpreadTab(tab: SpreadTab): () => void {
  if (state.tabs.some((t) => t.id === tab.id)) return () => {};
  state = { ...state, tabs: [...state.tabs, tab] };
  emit();
  return () => {
    state = { ...state, tabs: state.tabs.filter((t) => t.id !== tab.id) };
    if (state.activeTab === tab.id) {
      state = { ...state, activeTab: state.tabs[0]?.id ?? "preview" };
    }
    emit();
  };
}

export function subscribeSpreadPane(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Settings persistence handles come through these two functions —
// the settings unit (ST) wires them up against its own storage
// adapter so SpreadPane stays storage-agnostic.
export function serializeSpreadPane(): { visible: boolean; ratio: number; activeTab: string } {
  return {
    visible: state.visible,
    ratio: state.ratio,
    activeTab: state.activeTab,
  };
}

export function restoreSpreadPane(snapshot: Partial<{ visible: boolean; ratio: number; activeTab: string }>): void {
  state = {
    ...state,
    visible: snapshot.visible ?? state.visible,
    ratio: snapshot.ratio ?? state.ratio,
    activeTab: snapshot.activeTab ?? state.activeTab,
  };
  emit();
}
