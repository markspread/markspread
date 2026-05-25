// S-TST-001: vitest infrastructure for the renderer.
//
// jsdom for the React/DOM bits; node for the pure-logic libs (we run
// both projects so Worker / iframe / postMessage code paths can opt
// into jsdom without infecting cheap unit tests). Coverage uses v8 so
// it works against the Vite-transformed TS without instrumentation
// overhead, and emits both `text` (CI summary) and `lcov` (Codecov +
// editor gutter integration).

import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
    environmentMatchGlobs: [
      ["src/components/**", "jsdom"],
      ["src/lib/security/markdown-sanitize.test.ts", "jsdom"],
      // threat-model exercises sanitiseMarkdownHtml (DOMParser) and the
      // path-canonical IPC seam — both need a DOM/window environment.
      ["src/lib/security/threat-model.test.ts", "jsdom"],
      // a11y suites mount real React components via testing-library.
      ["src/__tests__/a11y-*.test.tsx", "jsdom"],
      ["**/*.dom.test.ts", "jsdom"],
    ],
    environment: "node",
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      // S-PSDK-001: workspace packages live alongside src and share the
      // same vitest run so CI catches SDK regressions in one pass.
      "packages/*/src/**/*.{test,spec}.{ts,tsx}",
    ],
    exclude: ["e2e/**", "node_modules/**", "src-tauri/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx}", "packages/*/src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.{test,spec}.{ts,tsx}",
        "src/**/*.d.ts",
        "src/main.tsx",
        "src/vite-env.d.ts",
        // Type-only modules: declarations / interfaces / enums-as-types.
        "src/**/types.ts",
        // Barrel re-export modules: no runtime branches to cover.
        "src/lib/plugins/runtime/index.ts",
        // E2E harness fixtures — exercised by playwright, not vitest.
        "src/lib/harness.ts",
        "src/screens/Harness*.tsx",
        "packages/*/src/**/*.{test,spec}.{ts,tsx}",
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
    reporters: process.env.CI ? ["default", "junit"] : ["default"],
    outputFile: { junit: "test-results/vitest-junit.xml" },
  },
});
