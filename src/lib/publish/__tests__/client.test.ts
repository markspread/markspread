// ADR-0015 §3 Publish: client API 테스트. backend + sanitizer mock 주입.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetSanitizer, setSanitizer } from "../../preview/sanitizer";
import {
  type PublishBackendConfig,
  PublishClient,
  type PublishCredentials,
  type PublishedDocument,
} from "../client";

const creds: PublishCredentials = { authToken: "tok", customerId: "cus_1" };

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

function cfg(handler: Parameters<typeof mockFetch>[0]): PublishBackendConfig {
  return { baseUrl: "https://publish.test", fetch: mockFetch(handler) };
}

const doc: PublishedDocument = {
  sourcePath: "/ws/note.md",
  htmlBody: "<p>hi</p><script>bad()</script>",
  aiHistory: [{ timestamp: "2026-06-01T00:00:00Z", kind: "edit", prompt: "x", result: "y" }],
};

beforeEach(() => {
  setSanitizer({
    sanitize(input) {
      return input.replace(/<script[^>]*>.*?<\/script>/gi, "");
    },
    removed: [],
  });
});
afterEach(() => resetSanitizer());

describe("PublishClient.publish", () => {
  it("strips script via sanitizer before sending", async () => {
    let sentHtml = "";
    const client = new PublishClient(
      creds,
      cfg((_url, init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        sentHtml = body.htmlBody;
        return { url: "https://test.markspread.app" };
      }),
    );
    const r = await client.publish(doc, { sitename: "test" });
    expect(r.ok).toBe(true);
    expect(r.url).toBe("https://test.markspread.app");
    expect(sentHtml).not.toContain("<script>");
    expect(sentHtml).toContain("<p>hi</p>");
  });

  it("includes ai history by default", async () => {
    let sent: { aiHistory?: unknown[] } = {};
    const client = new PublishClient(
      creds,
      cfg((_url, init) => {
        sent = JSON.parse((init?.body as string) ?? "{}");
        return { url: "https://x" };
      }),
    );
    await client.publish(doc, { sitename: "test" });
    expect(sent.aiHistory).toHaveLength(1);
  });

  it("can omit ai history via includeAiHistory=false", async () => {
    let sent: { aiHistory?: unknown[] } = {};
    const client = new PublishClient(
      creds,
      cfg((_url, init) => {
        sent = JSON.parse((init?.body as string) ?? "{}");
        return { url: "https://x" };
      }),
    );
    await client.publish(doc, { sitename: "test", includeAiHistory: false });
    expect(sent.aiHistory).toEqual([]);
  });

  it("returns errors on http failure", async () => {
    const client = new PublishClient(
      creds,
      cfg(() => new Response("err", { status: 500 })),
    );
    const r = await client.publish(doc, { sitename: "test" });
    expect(r.ok).toBe(false);
    expect(r.errors?.[0]).toMatch(/500/);
  });

  it("sends bearer + customer id", async () => {
    const captured: Record<string, string | undefined> = {};
    const client = new PublishClient(
      creds,
      cfg((_url, init) => {
        const h = (init?.headers ?? {}) as Record<string, string>;
        captured.auth = h.authorization;
        captured.cust = h["x-customer-id"];
        return { url: "https://x" };
      }),
    );
    await client.publish(doc, { sitename: "test" });
    expect(captured.auth).toBe("Bearer tok");
    expect(captured.cust).toBe("cus_1");
  });
});

describe("PublishClient.getSite", () => {
  it("returns site info on 200", async () => {
    const client = new PublishClient(
      creds,
      cfg(() => ({ url: "https://test.markspread.app", views: 42 })),
    );
    const s = await client.getSite("test");
    expect(s?.url).toBe("https://test.markspread.app");
    expect(s?.views).toBe(42);
  });

  it("returns null on 404", async () => {
    const client = new PublishClient(
      creds,
      cfg(() => new Response("nf", { status: 404 })),
    );
    expect(await client.getSite("missing")).toBeNull();
  });
});
