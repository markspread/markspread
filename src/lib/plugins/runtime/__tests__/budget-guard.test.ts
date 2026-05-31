// ADR-0016 (T5.D): BudgetGuard 단위 테스트.

import { afterEach, describe, expect, it, vi } from "vitest";
import { BUDGETS, describeOutcome, measureAsync, measureSync } from "../budget-guard";

describe("BUDGETS", () => {
  it("local default = 100ms time cap", () => {
    expect(BUDGETS.local.timeCapMs).toBe(100);
  });

  it("publishStrict default = 50ms time cap (tighter than local)", () => {
    expect(BUDGETS.publishStrict.timeCapMs).toBe(50);
    expect(BUDGETS.publishStrict.timeCapMs).toBeLessThan(BUDGETS.local.timeCapMs);
  });

  it("default memory cap = 25MB", () => {
    expect(BUDGETS.local.memoryCapBytes).toBe(25 * 1024 * 1024);
  });
});

describe("measureSync — happy path", () => {
  it("returns ok and result for fast function", () => {
    const { result, outcome } = measureSync(BUDGETS.local, () => 42);
    expect(result).toBe(42);
    expect(outcome.code).toBe("ok");
    expect(outcome.shouldSuspend).toBe(false);
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("ok when memory check passes", () => {
    const { outcome } = measureSync(BUDGETS.local, () => 1, { readMemory: () => 10 * 1024 * 1024 });
    expect(outcome.code).toBe("ok");
  });
});

describe("measureSync — time over", () => {
  it("reports time_over and shouldSuspend=true", () => {
    const tight = { timeCapMs: 0, memoryCapBytes: 1e9 };
    const { outcome } = measureSync(tight, () => {
      // even a no-op now() ≥ t0, so positive elapsed
      let x = 0;
      for (let i = 0; i < 1000; i++) x += i;
      return x;
    });
    expect(outcome.code).toBe("time_over");
    expect(outcome.shouldSuspend).toBe(true);
    expect(outcome.durationMs).toBeGreaterThan(0);
  });
});

describe("measureSync — memory over", () => {
  it("reports memory_over when readMemory exceeds cap", () => {
    const { outcome } = measureSync(BUDGETS.local, () => 1, {
      readMemory: () => 100 * 1024 * 1024, // 100MB > 25MB cap
    });
    expect(outcome.code).toBe("memory_over");
    expect(outcome.shouldSuspend).toBe(true);
    expect(outcome.memoryBytes).toBe(100 * 1024 * 1024);
  });
});

describe("measureSync — error thrown", () => {
  it("captures error and does NOT auto-suspend", () => {
    const { result, outcome } = measureSync(BUDGETS.local, () => {
      throw new Error("boom");
    });
    expect(result).toBeNull();
    expect(outcome.code).toBe("error_thrown");
    expect(outcome.message).toBe("boom");
    expect(outcome.shouldSuspend).toBe(false);
  });
});

describe("now() fallback when performance.now is unavailable", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to Date.now when performance is undefined", () => {
    vi.stubGlobal("performance", undefined);
    const { result, outcome } = measureSync(BUDGETS.local, () => 7);
    expect(result).toBe(7);
    expect(outcome.code).toBe("ok");
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("falls back to Date.now when performance.now is not a function", () => {
    vi.stubGlobal("performance", {});
    const { outcome } = measureSync(BUDGETS.local, () => 1);
    expect(outcome.code).toBe("ok");
  });
});

describe("measureAsync — memory check", () => {
  it("ok when async memory reading passes the cap", async () => {
    const { result, outcome } = await measureAsync(BUDGETS.local, async () => "fast", {
      readMemory: () => 5 * 1024 * 1024,
    });
    expect(result).toBe("fast");
    expect(outcome.code).toBe("ok");
  });

  it("reports memory_over when async memory reading exceeds cap", async () => {
    const { result, outcome } = await measureAsync(BUDGETS.local, async () => "fast", {
      readMemory: () => 200 * 1024 * 1024,
    });
    expect(result).toBe("fast");
    expect(outcome.code).toBe("memory_over");
    expect(outcome.shouldSuspend).toBe(true);
    expect(outcome.memoryBytes).toBe(200 * 1024 * 1024);
  });
});

describe("measureAsync — happy path", () => {
  it("returns ok for fast async fn", async () => {
    const { result, outcome } = await measureAsync(BUDGETS.local, async () => "done");
    expect(result).toBe("done");
    expect(outcome.code).toBe("ok");
  });
});

describe("measureAsync — time over via promise race", () => {
  it("reports time_over when async fn exceeds cap", async () => {
    const tight = { timeCapMs: 5, memoryCapBytes: 1e9 };
    const { result, outcome } = await measureAsync(
      tight,
      () => new Promise<string>((resolve) => setTimeout(() => resolve("slow"), 50)),
    );
    expect(result).toBeNull();
    expect(outcome.code).toBe("time_over");
    expect(outcome.shouldSuspend).toBe(true);
  });
});

describe("measureAsync — abort signal", () => {
  it("aborts via signal short-circuits to time_over", async () => {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 5);
    const { outcome } = await measureAsync(
      BUDGETS.local,
      () => new Promise<string>((resolve) => setTimeout(() => resolve("slow"), 50)),
      { signal: ctrl.signal },
    );
    expect(outcome.code).toBe("time_over");
  });
});

describe("measureAsync — async error", () => {
  it("captures rejection and does NOT auto-suspend", async () => {
    const { result, outcome } = await measureAsync(BUDGETS.local, async () => {
      throw new Error("async-boom");
    });
    expect(result).toBeNull();
    expect(outcome.code).toBe("error_thrown");
    expect(outcome.message).toBe("async-boom");
    expect(outcome.shouldSuspend).toBe(false);
  });
});

describe("describeOutcome — user-facing strings", () => {
  it("ok message includes plugin name and duration", () => {
    expect(
      describeOutcome({ code: "ok", durationMs: 42, shouldSuspend: false }, "mermaid"),
    ).toContain("mermaid");
  });

  it("time_over message mentions suspend", () => {
    const msg = describeOutcome(
      { code: "time_over", durationMs: 150, shouldSuspend: true },
      "wireweave",
    );
    expect(msg).toContain("wireweave");
    expect(msg).toMatch(/시간 초과|suspend/);
  });

  it("memory_over formats MB", () => {
    const msg = describeOutcome(
      { code: "memory_over", memoryBytes: 50 * 1024 * 1024, shouldSuspend: true },
      "p",
    );
    expect(msg).toContain("50.0MB");
  });

  it("memory_over shows '?' when memoryBytes is absent", () => {
    const msg = describeOutcome({ code: "memory_over", shouldSuspend: true }, "p");
    expect(msg).toContain("?MB");
  });

  it("error_thrown shows message", () => {
    const msg = describeOutcome(
      { code: "error_thrown", message: "bad input", shouldSuspend: false },
      "p",
    );
    expect(msg).toContain("bad input");
  });

  it("error_thrown falls back to 'unknown' when message is absent", () => {
    const msg = describeOutcome({ code: "error_thrown", shouldSuspend: false }, "p");
    expect(msg).toContain("unknown");
  });
});
