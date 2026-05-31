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

// vitest 3 removed `environmentMatchGlobs` (gone in 4) in favour of `projects`.
// We split the run into two inline projects so DOM suites get jsdom while the
// pure-logic units stay on cheap node. The two `include` sets are kept mutually
// exclusive (the node project excludes the jsdom globs) so no file runs twice.
// Files carrying a `// @vitest-environment jsdom` docblock (e.g. *.dom.test.tsx)
// override their project's environment regardless of which project owns them.
const JSDOM_GLOBS = [
  "src/components/**/*.{test,spec}.{ts,tsx}",
  "src/lib/security/markdown-sanitize.test.ts",
  // threat-model exercises sanitiseMarkdownHtml (DOMParser) and the
  // path-canonical IPC seam — both need a DOM/window environment.
  "src/lib/security/threat-model.test.ts",
  // a11y suites mount real React components via testing-library.
  "src/__tests__/a11y-*.test.tsx",
  "**/*.dom.test.ts",
];
const BASE_INCLUDE = [
  "src/**/*.{test,spec}.{ts,tsx}",
  // S-PSDK-001: workspace packages live alongside src and share the
  // same vitest run so CI catches SDK regressions in one pass.
  "packages/*/src/**/*.{test,spec}.{ts,tsx}",
  // MAR-1020: sample plugin manifests live outside `src/` but ship
  // with the runtime; their schema must stay aligned with ADR-0012.
  "examples/plugins/*/__tests__/*.{test,spec}.{ts,tsx}",
];
const BASE_EXCLUDE = ["e2e/**", "node_modules/**", "src-tauri/**"];

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    globals: false,
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          globals: false,
          setupFiles: ["./vitest.setup.ts"],
          include: BASE_INCLUDE,
          exclude: [...BASE_EXCLUDE, ...JSDOM_GLOBS],
        },
      },
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          globals: false,
          setupFiles: ["./vitest.setup.ts"],
          include: JSDOM_GLOBS,
          exclude: BASE_EXCLUDE,
        },
      },
    ],
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
        "packages/parser-sdk/src/index.ts",
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
