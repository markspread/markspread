import { create } from "zustand";

export type ToastKind = "info" | "warning" | "error" | "success";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  details?: string;
  ttlMs?: number;
  /** S-FT-008: optional inline action (e.g., Undo). Click dismisses the toast. */
  action?: ToastAction;
}

interface ToastsState {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => string;
  dismiss: (id: string) => void;
  /** S-FT-012: in-place update for long-running progress toasts. */
  update: (id: string, patch: Partial<Omit<Toast, "id">>) => void;
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `t-${Date.now()}-${counter}`;
}

export const useToasts = create<ToastsState>()((set, get) => ({
  toasts: [],
  push: (toast) => {
    const id = nextId();
    const ttl = toast.ttlMs ?? 5000;
    set({ toasts: [...get().toasts, { ...toast, id }] });
    if (ttl > 0) {
      setTimeout(() => {
        set({ toasts: get().toasts.filter((t) => t.id !== id) });
      }, ttl);
    }
    return id;
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  update: (id, patch) =>
    set({
      toasts: get().toasts.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }),
}));
