// S-PR-005 / S-PR-006: route preview-pane link clicks.
//
// External (`http(s)://…`, `mailto:`, `tel:`) → host opens via the
//   OS shell (Tauri's @tauri-apps/plugin-shell `open()` IPC); we
//   prevent the browser from navigating the webview itself.
// Internal — anything that resolves to a workspace path — → host
//   opens the file in a new editor tab.
//
// We use a single delegated listener at the preview root so it
// survives rerenders without leaking listeners.

export interface LinkClickHost {
  /** Open an external URL in the OS default browser. */
  openExternal(url: string): Promise<void>;
  /** Open a workspace file (relative path) in a new tab. */
  openInternal(path: string, anchor?: string): Promise<void>;
  /** Convert a click target to a workspace-relative path. */
  resolveInternal(href: string): { path: string; anchor?: string } | null;
}

export function attachLinkClickHandler(root: HTMLElement, host: LinkClickHost): () => void {
  const onClick = (e: MouseEvent) => {
    const target = (e.target as Element | null)?.closest("a");
    if (!target) return;
    const href = target.getAttribute("href");
    if (!href) return;
    if (href.startsWith("#")) return; // in-page anchor — leave it
    e.preventDefault();
    const internal = host.resolveInternal(href);
    if (internal) {
      void host.openInternal(internal.path, internal.anchor);
    } else {
      void host.openExternal(href);
    }
  };
  root.addEventListener("click", onClick);
  return () => root.removeEventListener("click", onClick);
}
