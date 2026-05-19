// S-OP-004: diagnostics bundle coverage.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiagnosticsBundle } from "./diagnostics";

const invokeMock = vi.fn();
const saveMock = vi.fn();
const writeTextFileMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (...args: unknown[]) => saveMock(...args),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: (...args: unknown[]) => writeTextFileMock(...args),
}));

import { fetchDiagnostics, saveDiagnostics } from "./diagnostics";

const bundle: DiagnosticsBundle = {
  generatedAtMs: Date.UTC(2026, 0, 2, 3, 4, 5),
  appVersion: "1.0.0",
  os: "macos",
  osArch: "arm64",
  portable: false,
  dataDir: "/data",
  settings: {},
  recentLogLines: ["line"],
  notes: [],
};

beforeEach(() => {
  invokeMock.mockReset();
  saveMock.mockReset();
  writeTextFileMock.mockReset();
});

describe("fetchDiagnostics", () => {
  it("invokes the export command", async () => {
    invokeMock.mockResolvedValue(bundle);
    expect(await fetchDiagnostics()).toEqual(bundle);
    expect(invokeMock).toHaveBeenCalledWith("ops_export_diagnostics");
  });
});

describe("saveDiagnostics", () => {
  it("writes the bundle JSON to the chosen path", async () => {
    saveMock.mockResolvedValue("/out/diag.json");
    writeTextFileMock.mockResolvedValue(undefined);
    const path = await saveDiagnostics(bundle);
    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: expect.stringMatching(/^markspread-diagnostics-.*\.json$/),
      }),
    );
    expect(writeTextFileMock).toHaveBeenCalledWith(
      "/out/diag.json",
      JSON.stringify(bundle, null, 2),
    );
    expect(path).toBe("/out/diag.json");
  });

  it("returns null when the save dialog is cancelled", async () => {
    saveMock.mockResolvedValue(null);
    expect(await saveDiagnostics(bundle)).toBeNull();
    expect(writeTextFileMock).not.toHaveBeenCalled();
  });
});
