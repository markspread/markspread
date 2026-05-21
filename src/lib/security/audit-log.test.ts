import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invoke(cmd, args),
}));

import {
  AUDIT_RETENTION_DAYS,
  type AuditEntry,
  formatAuditCsv,
  listAudit,
  recordAudit,
} from "./audit-log";

afterEach(() => {
  invoke.mockReset();
});

describe("recordAudit", () => {
  it("forwards the entry to the plugin_permission_audit command", async () => {
    invoke.mockResolvedValueOnce(undefined);
    const entry: Omit<AuditEntry, "id"> = {
      ts: 1700000000000,
      pluginId: "plug.test",
      apiKind: "fs:read",
      apiSummary: "{}",
      decision: "allow",
      reason: "manifest grants",
    };
    await recordAudit(entry);
    expect(invoke).toHaveBeenCalledWith("plugin_permission_audit", { entry });
  });
});

describe("listAudit", () => {
  it("applies the 7-day default window when called with no query", async () => {
    const now = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const expected: AuditEntry[] = [];
    invoke.mockResolvedValueOnce(expected);

    const result = await listAudit();
    expect(result).toBe(expected);
    expect(invoke).toHaveBeenCalledWith("plugin_permission_audit_list", {
      fromTs: now - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      toTs: now,
      pluginId: null,
      decision: null,
    });
    vi.useRealTimers();
  });

  it("honours explicit fromTs / toTs / pluginId / decision overrides", async () => {
    invoke.mockResolvedValueOnce([]);
    await listAudit({
      fromTs: 100,
      toTs: 200,
      pluginId: "plug.x",
      decision: "deny",
    });
    expect(invoke).toHaveBeenCalledWith("plugin_permission_audit_list", {
      fromTs: 100,
      toTs: 200,
      pluginId: "plug.x",
      decision: "deny",
    });
  });
});

describe("formatAuditCsv", () => {
  const baseEntry: AuditEntry = {
    id: "abc",
    ts: Date.UTC(2026, 0, 1, 12, 0, 0),
    pluginId: "plug.x",
    apiKind: "fs:read",
    apiSummary: "{}",
    decision: "allow",
    reason: "ok",
  };

  it("emits a UTF-8 BOM, CRLF lines, and the header row", () => {
    const csv = formatAuditCsv([baseEntry]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("ts,plugin_id,api_kind,api_summary,decision,reason\r\n");
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv).toContain("2026-01-01T12:00:00.000Z");
  });

  it("escapes fields that contain commas, quotes, or newlines", () => {
    const csv = formatAuditCsv([
      {
        ...baseEntry,
        apiSummary: 'value with "quote", comma and\nnewline',
        reason: "no special chars",
      },
    ]);
    expect(csv).toContain('"value with ""quote"", comma and\nnewline"');
    expect(csv).toContain("no special chars");
  });

  it("emits an empty row block for an empty entry list", () => {
    const csv = formatAuditCsv([]);
    expect(csv).toBe("﻿ts,plugin_id,api_kind,api_summary,decision,reason\r\n\r\n");
  });
});
