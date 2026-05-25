#!/usr/bin/env node
// S-AI-ACP-001 §8 (3): minimal stub ACP agent for the gated end-to-end
// test in `src-tauri/src/acp/client.rs::fake_agent_script_e2e`. Reads
// NDJSON JSON-RPC requests from stdin and answers a fixed scenario:
//
//   initialize   → returns protocolVersion=1 with empty agentInfo/caps
//   session/new  → returns a deterministic sessionId
//   session/prompt → streams two agent_message_chunk notifications then
//                    responds with stopReason=end_turn
//   anything else → -32601 method not found
//
// Run manually:  node scripts/test/fake-acp-agent.mjs
// Exercised by:  cargo test -p markspread -- --ignored fake_agent_script_e2e
//
// No dependencies — pure Node so contributors don't need npm install.

import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });

function send(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: {},
        agentInfo: { name: "fake-acp-agent", version: "0.0.0" },
        authMethods: [],
      },
    });
    return;
  }
  if (msg.method === "session/new") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: { sessionId: "fake-session-1" },
    });
    return;
  }
  if (msg.method === "session/prompt") {
    const sid = msg.params?.sessionId ?? "fake-session-1";
    for (const text of ["hello ", "world"]) {
      send({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: sid,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text },
          },
        },
      });
    }
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: { stopReason: "end_turn" },
    });
    return;
  }
  if (msg.method === "session/close") {
    send({ jsonrpc: "2.0", id: msg.id, result: {} });
    process.exit(0);
  }
  // session/cancel is a notification — no id, no reply.
  if (msg.method === "session/cancel") return;

  if (msg.id !== undefined) {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      error: { code: -32601, message: "method not found" },
    });
  }
});

rl.on("close", () => process.exit(0));
