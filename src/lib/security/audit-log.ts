// S-SE-019..021: permission audit log — 7-day rolling, Privacy panel,
// CSV export.
//
// Every host-API permission decision (allow / deny / one-shot prompt
// outcome) is appended to a SQLite-backed audit log. The user can view
// it in Settings → Privacy and export it for review. We cap retention
// at 7 days by default to keep the file small and avoid the privacy
// drift of "endless capture of every action you took".

import { invoke } from "@tauri-apps/api/core";

export type AuditDecision = "allow" | "deny" | "allow-once" | "deny-once";

export interface AuditEntry {
  id: string;
  ts: number;
  pluginId: string;
  apiKind: string;
  /** Compact JSON of the call's distinguishing inputs (path, host, alias). */
  apiSummary: string;
  decision: AuditDecision;
  /** Why — useful for "manifest does not grant" vs "user clicked deny". */
  reason: string;
}

export interface AuditQuery {
  /** Inclusive lower bound, epoch ms. Default = 7 days ago. */
  fromTs?: number;
  /** Exclusive upper bound, epoch ms. Default = now. */
  toTs?: number;
  pluginId?: string;
  decision?: AuditDecision;
}

export const AUDIT_RETENTION_DAYS = 7;

export async function recordAudit(entry: Omit<AuditEntry, "id">): Promise<void> {
  await invoke("plugin_permission_audit", { entry });
}

export async function listAudit(query: AuditQuery = {}): Promise<AuditEntry[]> {
  const fromTs = query.fromTs ?? Date.now() - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const toTs = query.toTs ?? Date.now();
  return invoke<AuditEntry[]>("plugin_permission_audit_list", {
    fromTs,
    toTs,
    pluginId: query.pluginId ?? null,
    decision: query.decision ?? null,
  });
}

// S-SE-021: CSV export. Same conventions as the AI usage CSV — UTF-8
// BOM, CRLF lines, escaped fields. Stored in the user-chosen path.
export function formatAuditCsv(entries: AuditEntry[]): string {
  const header = "ts,plugin_id,api_kind,api_summary,decision,reason";
  const rows = entries.map((e) =>
    [new Date(e.ts).toISOString(), e.pluginId, e.apiKind, e.apiSummary, e.decision, e.reason]
      .map(csvEscape)
      .join(","),
  );
  return `﻿${header}\r\n${rows.join("\r\n")}\r\n`;
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
