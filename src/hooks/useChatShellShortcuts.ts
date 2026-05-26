// ADR-0010 R3 (D-Keybindings): chat-shell scoped shortcuts.
//
//   Mod+Enter      — send the current draft (mirrors Enter).
//   Mod+K          — focus the chat input.
//   Mod+/          — toggle ContextPanel.
//   Mod+Shift+/    — toggle WorkspaceNav.
//
// Scope is enforced by reading `useWorkspace.preferredShell`. When the
// editor shell is active these bindings are silent so the editor's
// existing single-letter bindings (Mod+T/W/\\) keep their meaning.

import { useEffect } from "react";
import { useWorkspace } from "../store/workspace";

const isMac = () =>
  typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");

function hasMod(evt: KeyboardEvent): boolean {
  return isMac() ? evt.metaKey : evt.ctrlKey;
}

function isChatScopeActive(): boolean {
  const { current, preferredShell } = useWorkspace.getState();
  return Boolean(current) && preferredShell === "chat";
}

export interface ChatShellShortcutHandlers {
  onSend: () => void;
  onFocusInput: () => void;
  onToggleContext: () => void;
  onToggleNav: () => void;
}

export function useChatShellShortcuts(handlers: ChatShellShortcutHandlers): void {
  useEffect(() => {
    const handler = (evt: KeyboardEvent) => {
      if (!isChatScopeActive()) return;
      if (!hasMod(evt)) return;
      const key = evt.key.toLowerCase();
      if (!evt.shiftKey && !evt.altKey) {
        if (evt.key === "Enter") {
          evt.preventDefault();
          handlers.onSend();
          return;
        }
        if (key === "k") {
          evt.preventDefault();
          handlers.onFocusInput();
          return;
        }
        if (evt.key === "/") {
          evt.preventDefault();
          handlers.onToggleContext();
          return;
        }
      }
      if (evt.shiftKey && !evt.altKey && evt.key === "?") {
        // Shift+/ produces "?" on US layouts; treat Mod+Shift+/ as
        // toggle-nav. We also accept evt.key === "/" with shiftKey.
        evt.preventDefault();
        handlers.onToggleNav();
        return;
      }
      if (evt.shiftKey && !evt.altKey && evt.key === "/") {
        evt.preventDefault();
        handlers.onToggleNav();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handlers]);
}
