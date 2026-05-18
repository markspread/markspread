// S-KB-002: keyboard layout label resolution. The resolver in
// index.ts is already physical-position based (event.code), so an
// AZERTY user pressing the key labelled "Q" — which sits at the
// QWERTY-A position — fires the same command as a QWERTY user
// pressing "A". That's the *behaviour* part of S-KB-002.
//
// The *display* part (acceptance bullet 3) needs to show the user
// the label that's actually printed on their key. We use the
// Keyboard Map API where available (Chromium-based webviews and
// macOS WebKit ≥ 17). Where it isn't, we fall back to the
// code-derived character — that's still better than showing the
// raw "KeyA".

type KeyboardLayoutMap = ReadonlyMap<string, string>;

interface KeyboardWithLayout extends Navigator {
  keyboard?: {
    getLayoutMap?: () => Promise<KeyboardLayoutMap>;
    addEventListener?: (
      type: "layoutchange",
      listener: () => void,
    ) => void;
    removeEventListener?: (
      type: "layoutchange",
      listener: () => void,
    ) => void;
  };
}

let cachedLayout: KeyboardLayoutMap | null = null;
let inflight: Promise<void> | null = null;

/**
 * Pre-warm the layout cache. Call once at app start so the
 * keybinding sheet (S-KB-003) can render synchronously when first
 * shown.
 */
export async function loadLayoutMap(): Promise<void> {
  if (cachedLayout) return;
  if (inflight) return inflight;
  inflight = (async () => {
    const nav = navigator as KeyboardWithLayout;
    if (nav.keyboard?.getLayoutMap) {
      try {
        cachedLayout = await nav.keyboard.getLayoutMap();
      } catch {
        cachedLayout = null;
      }
    }
    inflight = null;
  })();
  return inflight;
}

/**
 * Subscribe to layout-change events. The keybinding sheet should
 * call this once on mount and re-render when fired.
 */
export function onLayoutChange(handler: () => void): () => void {
  const nav = navigator as KeyboardWithLayout;
  const fire = () => {
    cachedLayout = null;
    void loadLayoutMap().then(handler);
  };
  if (nav.keyboard?.addEventListener) {
    nav.keyboard.addEventListener("layoutchange", fire);
    return () => nav.keyboard?.removeEventListener?.("layoutchange", fire);
  }
  return () => {};
}

/**
 * Translate a KeyboardEvent.code into the printed label for the
 * user's current layout. Falls back to the QWERTY-derived character
 * when the Keyboard Map API isn't available.
 *
 * Examples (AZERTY user):
 *   labelForCode("KeyA") → "Q"   // physical position of KeyA on AZERTY
 *   labelForCode("KeyW") → "Z"
 *   labelForCode("Slash") → "!"  // depends on keyboard
 *
 * Examples (QWERTY user):
 *   labelForCode("KeyA") → "A"
 */
export function labelForCode(code: string): string {
  if (!code) return "";
  if (cachedLayout) {
    const v = cachedLayout.get(code);
    if (v) return v.toUpperCase();
  }
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  switch (code) {
    case "Slash": return "/";
    case "Backslash": return "\\";
    case "Backquote": return "`";
    case "Minus": return "-";
    case "Equal": return "=";
    case "Comma": return ",";
    case "Period": return ".";
    case "Semicolon": return ";";
    case "Quote": return "'";
    case "BracketLeft": return "[";
    case "BracketRight": return "]";
    default: return code;
  }
}

/**
 * Convert a binding key segment (e.g. "S" or "Slash") back to a
 * code so it can be re-labelled for the user's layout. The reverse
 * of `codeToBinding` in index.ts.
 */
export function codeFromKeySegment(segment: string): string {
  if (segment.length === 1 && /[A-Z]/.test(segment)) return `Key${segment}`;
  if (segment.length === 1 && /[0-9]/.test(segment)) return `Digit${segment}`;
  switch (segment) {
    case "/": return "Slash";
    case "\\": return "Backslash";
    case "`": return "Backquote";
    case "-": return "Minus";
    case "=": return "Equal";
    case ",": return "Comma";
    case ".": return "Period";
    case ";": return "Semicolon";
    case "'": return "Quote";
    case "[": return "BracketLeft";
    case "]": return "BracketRight";
    default: return segment;
  }
}
