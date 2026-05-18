// T-U10-002: per-parser SandboxTransport registry.
//
// When a plugin parser registers, the plugin loader spawns a worker /
// iframe via `createWorkerTransport` (or the iframe equivalent) and
// stashes it here keyed by parser id. The preview pipeline looks the
// transport up at render time and hands it to `renderInSandbox`.
//
// Today no third-party parsers ship, so the map starts empty and the
// builtin markdown pipeline handles every document. Plugin boot
// (S-PL-005..009) will populate it as parser plugins activate.

import type { SandboxTransport } from "./renderer-host";

const transports = new Map<string, SandboxTransport>();

export function registerParserTransport(parserId: string, transport: SandboxTransport): void {
  const existing = transports.get(parserId);
  if (existing) existing.dispose();
  transports.set(parserId, transport);
}

export function getParserTransport(parserId: string): SandboxTransport | null {
  return transports.get(parserId) ?? null;
}

export function unregisterParserTransport(parserId: string): void {
  const existing = transports.get(parserId);
  if (existing) existing.dispose();
  transports.delete(parserId);
}

export function __resetParserTransportsForTests(): void {
  for (const t of transports.values()) t.dispose();
  transports.clear();
}
