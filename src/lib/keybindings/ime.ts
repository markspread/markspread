// S-KB-008: IME composition guard. While the user is composing in
// Korean / Japanese / Chinese, every keydown the IME consumes is also
// dispatched at the DOM. If we resolve those into commands, ㅎ + ㅇ
// + ㄴ ("한") starts firing whatever Mod+H or H is bound to, which
// destroys the input.
//
// Two signals to consult, because the platforms disagree:
//
//   1. compositionstart / compositionend events — fired by every
//      browser, but timing can drag a tick after the keydown that
//      began composition.
//   2. KeyboardEvent.isComposing — set by Chrome/Safari for the
//      duration; absent on older Firefox builds.
//   3. KeyboardEvent.keyCode === 229 — the legacy "IME is processing"
//      sentinel. Still emitted by Safari for the very first key.
//
// We OR all three so a slow compositionstart doesn't leak the first
// keystroke as a shortcut.
//
// Esc and Enter are special: even mid-composition they belong to the
// IME (cancel / confirm). The dispatcher honours `isComposing()` and
// never reaches the binding lookup, so those keys naturally fall
// through to the IME handler.

let composing = false;

export function attachImeGuard(target: Window | Document = window): () => void {
  function onStart() {
    composing = true;
  }
  function onEnd() {
    // The composition can race the next keydown; we drop the flag on
    // the next microtask so a same-tick keydown after compositionend
    // is still treated as IME territory.
    queueMicrotask(() => {
      composing = false;
    });
  }
  target.addEventListener("compositionstart", onStart);
  target.addEventListener("compositionend", onEnd);
  return () => {
    target.removeEventListener("compositionstart", onStart);
    target.removeEventListener("compositionend", onEnd);
  };
}

/**
 * Returns true if the keystroke should be ignored by the keybinding
 * dispatcher because the IME is composing. Pass the event so we can
 * also check the per-event `isComposing` flag and the legacy 229 key
 * code — together they cover every browser the editor targets.
 */
export function isComposing(event?: KeyboardEvent): boolean {
  if (composing) return true;
  if (!event) return false;
  if (event.isComposing) return true;
  // `keyCode` is deprecated but Safari still emits 229 for the
  // composition-trigger key, before the per-event isComposing has
  // flipped. Defense in depth — wrong-positives here mean a single
  // ignored shortcut, far less bad than a corrupted IME input.
  if (event.keyCode === 229) return true;
  return false;
}

/** Force-set composing state. Tests use this to simulate an IME run. */
export function _setComposingForTest(value: boolean): void {
  composing = value;
}
