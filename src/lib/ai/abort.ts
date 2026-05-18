// S-AI-027: ESC instantly aborts the in-flight AI request.
//
// We track every active stream in a registry keyed by request id. The Esc
// handler walks the registry and aborts each one — the provider runner
// observes the AbortSignal and tears down the SSE connection on the next
// chunk boundary. Aborted requests still bill for tokens already streamed
// (provider rules), so the UI surfaces "aborted" + the partial response
// instead of silently discarding it.

interface ActiveRequest {
  id: string;
  controller: AbortController;
  startedAt: number;
}

class AiAbortRegistry {
  private active = new Map<string, ActiveRequest>();

  register(id: string, controller: AbortController): void {
    this.active.set(id, { id, controller, startedAt: Date.now() });
  }

  finish(id: string): void {
    this.active.delete(id);
  }

  /** Returns the number of streams that were actually aborted. */
  abortAll(): number {
    let count = 0;
    for (const req of this.active.values()) {
      if (!req.controller.signal.aborted) {
        req.controller.abort(new DOMException("user-aborted", "AbortError"));
        count += 1;
      }
    }
    this.active.clear();
    return count;
  }

  abortOne(id: string): boolean {
    const req = this.active.get(id);
    if (!req) return false;
    req.controller.abort(new DOMException("user-aborted", "AbortError"));
    this.active.delete(id);
    return true;
  }

  count(): number {
    return this.active.size;
  }
}

export const aiAbortRegistry = new AiAbortRegistry();

/**
 * Mount this once at the app level — it watches for global Esc presses and
 * aborts every active AI stream. Returns the unsubscribe function.
 *
 * We register at the document root with `capture: true` so editor key
 * handlers that swallow Esc still let us see it. The handler returns
 * without preventDefault, so other Esc-aware UIs (modals, palettes) keep
 * working as expected.
 */
export function mountAbortHotkey(): () => void {
  function onKey(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    if (aiAbortRegistry.count() === 0) return;
    aiAbortRegistry.abortAll();
  }
  document.addEventListener("keydown", onKey, true);
  return () => document.removeEventListener("keydown", onKey, true);
}
