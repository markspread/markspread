// S-AIO-001..013: Ollama helpers coverage.

import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invoke(cmd, args),
}));

import {
  NotAvailableOfflineError,
  OLLAMA_DEFAULT_BASE_URL,
  OLLAMA_NOT_RUNNING,
  describeConnectivity,
  effectiveContextWindow,
  listInstalledModels,
  normaliseOllamaBaseUrl,
  probeOllama,
  pullHint,
  recommendOnOom,
  shouldBlockOffline,
  sidecarSupported,
  suggestAlias,
} from "../ollama";

afterEach(() => {
  invoke.mockReset();
});

describe("probeOllama", () => {
  it("invokes ai_ollama_probe with the default base url", async () => {
    invoke.mockResolvedValueOnce({
      reachable: true,
      baseUrl: OLLAMA_DEFAULT_BASE_URL,
      version: "0.5.7",
      latencyMs: 3,
    });
    const r = await probeOllama();
    expect(r.reachable).toBe(true);
    expect(invoke).toHaveBeenCalledWith("ai_ollama_probe", {
      baseUrl: OLLAMA_DEFAULT_BASE_URL,
    });
  });

  it("forwards a custom base url", async () => {
    invoke.mockResolvedValueOnce({
      reachable: false,
      baseUrl: "http://x:1",
      version: null,
      latencyMs: 0,
    });
    await probeOllama("http://x:1");
    expect(invoke).toHaveBeenCalledWith("ai_ollama_probe", { baseUrl: "http://x:1" });
  });
});

describe("listInstalledModels", () => {
  it("invokes ai_ollama_models with the default base url", async () => {
    invoke.mockResolvedValueOnce([]);
    await listInstalledModels();
    expect(invoke).toHaveBeenCalledWith("ai_ollama_models", {
      baseUrl: OLLAMA_DEFAULT_BASE_URL,
    });
  });
});

describe("suggestAlias", () => {
  it("returns the local- prefixed candidate when free", () => {
    expect(suggestAlias("llama3.3:latest", new Set())).toBe("local-llama3.3-latest");
  });

  it("uses normalised characters from the model name", () => {
    expect(suggestAlias("Llama/3.3:8B", new Set())).toBe("local-llama-3.3-8b");
  });

  it("appends an incrementing suffix when the base alias collides", () => {
    const taken = new Set(["local-llama3", "local-llama3-2"]);
    expect(suggestAlias("llama3", taken)).toBe("local-llama3-3");
  });

  it("falls back to a timestamp suffix when 99 collisions exhaust the loop", () => {
    const taken = new Set(["local-x"]);
    for (let i = 2; i < 100; i += 1) taken.add(`local-x-${i}`);
    const now = vi.spyOn(Date, "now").mockReturnValue(123_456);
    expect(suggestAlias("x", taken)).toBe("local-x-123456");
    now.mockRestore();
  });
});

describe("OLLAMA_NOT_RUNNING", () => {
  it("exposes the install deep link", () => {
    expect(OLLAMA_NOT_RUNNING.installUrl).toBe("https://ollama.com/download");
    expect(OLLAMA_NOT_RUNNING.i18nKey).toBe("ai.ollama.not-running");
  });
});

describe("pullHint", () => {
  it("renders an `ollama pull` command for the given model", () => {
    expect(pullHint("llama3.3:8b")).toEqual({
      modelName: "llama3.3:8b",
      command: "ollama pull llama3.3:8b",
    });
  });
});

describe("describeConnectivity", () => {
  it("returns 'online' when the OS reports connectivity", () => {
    expect(describeConnectivity({ online: true, ollamaReachable: false })).toBe("online");
  });

  it("returns 'local-only' when offline but Ollama is up", () => {
    expect(describeConnectivity({ online: false, ollamaReachable: true })).toBe("local-only");
  });

  it("returns 'offline' when neither is available", () => {
    expect(describeConnectivity({ online: false, ollamaReachable: false })).toBe("offline");
  });
});

describe("NotAvailableOfflineError", () => {
  it("carries the alias and a descriptive message", () => {
    const err = new NotAvailableOfflineError("plug.openai");
    expect(err.alias).toBe("plug.openai");
    expect(err.name).toBe("NotAvailableOfflineError");
    expect(err.message).toContain("plug.openai");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("shouldBlockOffline", () => {
  it("never blocks while online", () => {
    expect(shouldBlockOffline({ online: true, ollamaReachable: false }, "openai")).toBe(false);
  });

  it("allows ollama-backed aliases when offline", () => {
    expect(shouldBlockOffline({ online: false, ollamaReachable: true }, "ollama")).toBe(false);
  });

  it("blocks non-ollama aliases when offline", () => {
    expect(shouldBlockOffline({ online: false, ollamaReachable: false }, "openai")).toBe(true);
  });

  it("blocks an unknown provider when offline", () => {
    expect(shouldBlockOffline({ online: false, ollamaReachable: false }, null)).toBe(true);
  });
});

describe("recommendOnOom", () => {
  it("steps Q4 quantisation down to Q3", () => {
    expect(recommendOnOom("llama3.3:70b-Q4_K_M")).toEqual({
      recommendedQuant: "Q3_K_M",
      fallbackVariant: "llama3.3:13b-Q4_K_M",
    });
  });

  it("steps Q3 quantisation down to Q2", () => {
    expect(recommendOnOom("llama3.3:13b-Q3_K_M").recommendedQuant).toBe("Q2_K");
  });

  it("defaults to Q4_K_M when the model name carries no quant tag", () => {
    const r = recommendOnOom("llama3.3:8b");
    expect(r.recommendedQuant).toBe("Q4_K_M");
    expect(r.fallbackVariant).toBe("llama3.3:3b");
  });

  it("returns a null fallback when no size token is present", () => {
    expect(recommendOnOom("foo").fallbackVariant).toBeNull();
  });

  it("returns a null fallback when the size has no ladder entry", () => {
    expect(recommendOnOom("foo:1000b").fallbackVariant).toBeNull();
  });

  it("keeps the default quant when the captured quant token is unrelated", () => {
    // Q5 is captured by the regex but neither Q4 nor Q3 — exercise the
    // "no branch taken" path through the quant logic.
    expect(recommendOnOom("foo:8b-Q5_K_M").recommendedQuant).toBe("Q4_K_M");
  });
});

describe("effectiveContextWindow", () => {
  it("returns the declared window when RAM headroom is plentiful", () => {
    expect(effectiveContextWindow(8_000, 64)).toBe(8_000);
  });

  it("clamps to the headroom budget when declared exceeds it", () => {
    expect(effectiveContextWindow(200_000, 8)).toBe(32_000);
  });

  it("never falls below the 8k floor on tiny systems", () => {
    expect(effectiveContextWindow(200_000, 4)).toBe(8_000);
  });
});

describe("normaliseOllamaBaseUrl", () => {
  it("accepts an http URL and strips a trailing slash", () => {
    const r = normaliseOllamaBaseUrl("http://localhost:11434/");
    expect(r).toEqual({ ok: true, url: "http://localhost:11434" });
  });

  it("strips userinfo, search and hash fragments", () => {
    const r = normaliseOllamaBaseUrl("https://user:pw@gw.example/path?q=1#frag");
    expect(r).toEqual({ ok: true, url: "https://gw.example/path" });
  });

  it("rejects non-URL inputs", () => {
    expect(normaliseOllamaBaseUrl("not a url")).toEqual({
      ok: false,
      reason: "not a valid URL",
    });
  });

  it("rejects unsupported protocols", () => {
    expect(normaliseOllamaBaseUrl("ftp://gw.example/")).toEqual({
      ok: false,
      reason: "must be http(s)",
    });
  });
});

describe("sidecarSupported", () => {
  it("currently returns false on every platform", () => {
    expect(sidecarSupported()).toBe(false);
  });
});
