import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
// S-I18-001: bootstrap i18next *before* React mounts so `t()` calls inside
// any component see initialized resources without suspending.
import "./lib/i18n-init";
import { bootstrapSidebarPaletteItems } from "./lib/palette/bootstrap";
import { restoreSessionOrFallback } from "./lib/session";
import { markFirstPaint } from "./lib/startup";
import { getWindowInfo } from "./lib/window-id";
import { useLocale } from "./store/locale";
import { useTheme } from "./store/theme";
// S-TY-001: bundle Inter Variable so the UI font is identical offline. The
// fontsource package ships a single woff2 + matching @font-face — no runtime
// network fetch, and Vite hashes the asset for cache busting.
import "@fontsource-variable/inter";
// S-TY-002: editor monospace ships from the same fontsource family for
// consistency. Loaded eagerly so first-paint code blocks render in the
// intended face, not the system fallback.
import "@fontsource-variable/jetbrains-mono";
// S-TY-008: Inter ships only Latin glyphs. Pretendard covers Hangul + Latin
// with a Inter-compatible x-height so mixed runs share a baseline. Loaded
// after Inter so the browser uses Inter glyphs first and only falls through
// for codepoints Inter is missing.
import "@fontsource/pretendard";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      retry: 1,
    },
  },
});

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Root element #root not found");
}

document.documentElement.lang = useLocale.getState().locale;
useTheme.getState().syncFromSystem();
bootstrapSidebarPaletteItems();

// Dev escape hatch: when running outside Tauri (e.g., `vite dev` for
// browser-driven Playwright checks), expose the zustand stores so a
// test harness can drive the app without the native shell. No-op in
// the packaged desktop build because `__TAURI_INTERNALS__` is present.
if (!(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
  void Promise.all([
    import("./store/workspace"),
    import("./store/tabs"),
    import("./store/single-file"),
    import("./store/editor-layout"),
    import("./store/doc-cache"),
  ]).then(([ws, tabs, sf, editorLayout, docCache]) => {
    (globalThis as { __ms_dev__?: unknown }).__ms_dev__ = {
      workspace: ws.useWorkspace,
      tabs: tabs.useTabs,
      singleFile: sf.useSingleFile,
      // S-ESP-014: split-pane e2e drives layout + buffer share through
      // these store handles. Same shape as the others so the harness
      // pattern (getState/setState) keeps working.
      editorLayout: editorLayout.useEditorLayout,
      docCache: docCache.useDocCache,
    };
  });
}

// S-WS-015: resolve the window label *before* mount so per-window persist
// keys (workspace, tabs, …) are stable from the first render. Stores still
// import lazily, so this also gates their first read.
void getWindowInfo().finally(async () => {
  // T-U34-001: apply any pending schema migrations before React mounts so
  // stores never read a stale on-disk layout.
  await import("./lib/migration/run").then((m) => m.runMigration());
  createRoot(rootEl).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );

  void restoreSessionOrFallback();
  markFirstPaint();
  void import("./lib/plugins/boot").then((m) => m.bootInstalledPlugins());
  void import("./lib/updater/scheduler").then((m) => m.startUpdaterScheduler());
  void import("./lib/ai/auth-refresh-boot").then((m) => m.startAuthRefreshScheduler());
});
