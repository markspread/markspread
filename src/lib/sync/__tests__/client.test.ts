// ADR-0015 §3 Sync: client API 테스트. backend fetch 는 mock 주입.

import { describe, expect, it } from "vitest";
import {
  type CryptoBackend,
  type SyncBackendConfig,
  SyncClient,
  type SyncCredentials,
  makeEnvelope,
} from "../client";

const creds: SyncCredentials = {
  authToken: "tok_abc",
  passphrase: "pw",
  deviceId: "dev-1",
};

function mockFetch(handler: (url: string, init?: RequestInit) => unknown): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const out = await handler(url, init);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function cfg(handler: Parameters<typeof mockFetch>[0]): SyncBackendConfig {
  return { baseUrl: "https://sync.test", fetch: mockFetch(handler) };
}

const fakeCrypto: CryptoBackend = {
  async encrypt(plaintext, _passphrase) {
    return `enc:${plaintext}`;
  },
  async decrypt(ciphertext, _passphrase) {
    return ciphertext.replace(/^enc:/, "");
  },
  async hash(data) {
    return `h:${data.length}`;
  },
};

describe("SyncClient.push", () => {
  it("succeeds and returns server version", async () => {
    const client = new SyncClient(
      creds,
      cfg(() => ({ version: 2 })),
    );
    const r = await client.push({
      workspaceKey: "ws-1",
      kind: "settings",
      version: 1,
      ciphertext: "enc:{}",
      contentHash: "h:2",
    });
    expect(r.ok).toBe(true);
    expect(r.version).toBe(2);
  });

  it("reports conflict from server", async () => {
    const client = new SyncClient(
      creds,
      cfg(() => ({ conflict: true })),
    );
    const r = await client.push({
      workspaceKey: "ws-2",
      kind: "settings",
      version: 0,
      ciphertext: "x",
      contentHash: "x",
    });
    expect(r.ok).toBe(false);
    expect(r.conflict).toBe(true);
  });

  it("returns ok=false on http error", async () => {
    const client = new SyncClient(
      creds,
      cfg(() => new Response("bad", { status: 500 })),
    );
    const r = await client.push({
      workspaceKey: "x",
      kind: "settings",
      version: 0,
      ciphertext: "x",
      contentHash: "x",
    });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/500/);
  });

  it("sends bearer token and device header", async () => {
    let auth = "";
    let device = "";
    const client = new SyncClient(
      creds,
      cfg((_u, init) => {
        const h = (init?.headers ?? {}) as Record<string, string>;
        auth = h.authorization ?? "";
        device = h["x-device-id"] ?? "";
        return { version: 1 };
      }),
    );
    await client.push({
      workspaceKey: "x",
      kind: "settings",
      version: 0,
      ciphertext: "x",
      contentHash: "x",
    });
    expect(auth).toBe("Bearer tok_abc");
    expect(device).toBe("dev-1");
  });
});

describe("SyncClient.pull", () => {
  it("returns envelope on 200", async () => {
    const env = {
      workspaceKey: "ws-1",
      kind: "settings" as const,
      version: 5,
      ciphertext: "enc:foo",
      contentHash: "h:3",
    };
    const client = new SyncClient(
      creds,
      cfg(() => env),
    );
    const r = await client.pull("ws-1", "settings");
    expect(r?.version).toBe(5);
  });

  it("returns null on 404", async () => {
    const client = new SyncClient(
      creds,
      cfg(() => new Response("nf", { status: 404 })),
    );
    expect(await client.pull("ws-2", "settings")).toBeNull();
  });

  it("throws on other errors", async () => {
    const client = new SyncClient(
      creds,
      cfg(() => new Response("err", { status: 500 })),
    );
    await expect(client.pull("ws-3", "settings")).rejects.toThrow(/500/);
  });
});

describe("SyncClient.list", () => {
  it("returns version map", async () => {
    const client = new SyncClient(
      creds,
      cfg(() => [
        { kind: "settings", version: 3 },
        { kind: "plugin-config", version: 1 },
      ]),
    );
    const lst = await client.list("ws-1");
    expect(lst).toHaveLength(2);
    expect(lst[0]?.kind).toBe("settings");
  });

  it("throws on http error", async () => {
    const client = new SyncClient(
      creds,
      cfg(() => new Response("err", { status: 500 })),
    );
    await expect(client.list("ws-3")).rejects.toThrow(/500/);
  });
});

describe("makeEnvelope", () => {
  it("encrypts plaintext via crypto backend", async () => {
    const e = await makeEnvelope("ws-1", "settings", "plain", 1, fakeCrypto, "pw");
    expect(e.ciphertext).toBe("enc:plain");
    expect(e.contentHash).toBe("h:5");
    expect(e.version).toBe(1);
  });
});
