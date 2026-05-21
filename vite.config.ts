import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

// Emit the bundle treemap only when explicitly asked (the perf CI sets
// MARKSPREAD_BUNDLE_REPORT=1) so a normal `vite build` stays lean.
const bundleReport = process.env.MARKSPREAD_BUNDLE_REPORT === "1";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  plugins: [
    react(),
    tailwindcss(),
    ...(bundleReport
      ? [
          visualizer({
            filename: "bundle-treemap.html",
            template: "treemap",
            gzipSize: true,
            brotliSize: true,
          }),
        ]
      : []),
  ],

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  // Tauri expects a fixed port, fail if that port is not available
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // Ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: process.env.TAURI_ENV_DEBUG ? false : ("esbuild" as const),
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
}));
