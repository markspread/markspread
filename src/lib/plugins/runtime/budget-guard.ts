// ADR-0016 (T5.D): BudgetGuard — 파서 실행 시간·메모리 cap + 위반 시 자동 suspend.
//
// 다층 방어의 *런타임* 마지막 층. Validator (T5.B) + Sanitizer (T5.C) 가
// 통과해도 *실제 실행 비용* 이 초과되면 worker suspend + UI 에러 표시.
//
// 두 가지 budget:
//   - 시간 cap: parse/render 호출 한 번이 N ms 안에 끝나야 함
//     로컬 미리보기 100ms / publish strict 50ms
//   - 메모리 cap: T1 BudgetManager 의 total 100MB 안에서 worker 별 share
//
// 결과는 GuardOutcome — 호출자 (PluginHost) 가 suspend 결정 + UI 에러 emit.

export interface BudgetSpec {
  /** 단일 호출 cap (ms). 로컬 100, publish strict 50. */
  timeCapMs: number;
  /** 워커 별 메모리 cap (bytes). default 25MB (4 워커 × 25MB ≈ 100MB total). */
  memoryCapBytes: number;
}

export const BUDGETS = {
  /** 로컬 미리보기 default. */
  local: { timeCapMs: 100, memoryCapBytes: 25 * 1024 * 1024 } satisfies BudgetSpec,
  /** Publish 사이트 strict 모드. */
  publishStrict: { timeCapMs: 50, memoryCapBytes: 25 * 1024 * 1024 } satisfies BudgetSpec,
} as const;

export type GuardViolationCode = "time_over" | "memory_over" | "ok" | "error_thrown";

export interface GuardOutcome {
  code: GuardViolationCode;
  /** 실측 (가능한 만큼). */
  durationMs?: number;
  /** 메모리 위반의 경우 실측 byte. */
  memoryBytes?: number;
  /** error_thrown 일 때 메시지. */
  message?: string;
  /** caller 가 suspend 해야 하는가. ok/error_thrown 만 false, 나머지 true. */
  shouldSuspend: boolean;
}

/**
 * 시간 측정용 monotonic clock. 환경에 따라 fallback.
 */
function now(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

/**
 * 동기 함수 한 번을 시간 budget 안에서 측정.
 * timeout 자체는 동기 함수 *완료 후* 측정 — 실시간 강제 중단 X (worker 종료는 호출자 책임).
 * memory check 도 동기 — performance.memory 또는 외부 측정 함수로 주입.
 */
export function measureSync<T>(
  spec: BudgetSpec,
  fn: () => T,
  opts: { readMemory?: () => number } = {},
): { result: T | null; outcome: GuardOutcome } {
  const t0 = now();
  let result: T | null = null;
  try {
    result = fn();
  } catch (e) {
    const elapsed = now() - t0;
    return {
      result: null,
      outcome: {
        code: "error_thrown",
        durationMs: elapsed,
        message: (e as Error).message,
        shouldSuspend: false, // 에러는 호출자가 결정 (한번 에러로 suspend 아닐 수도)
      },
    };
  }
  const elapsed = now() - t0;

  if (elapsed > spec.timeCapMs) {
    return {
      result,
      outcome: {
        code: "time_over",
        durationMs: elapsed,
        shouldSuspend: true,
      },
    };
  }

  if (opts.readMemory) {
    const mem = opts.readMemory();
    if (mem > spec.memoryCapBytes) {
      return {
        result,
        outcome: {
          code: "memory_over",
          memoryBytes: mem,
          durationMs: elapsed,
          shouldSuspend: true,
        },
      };
    }
  }

  return {
    result,
    outcome: {
      code: "ok",
      durationMs: elapsed,
      shouldSuspend: false,
    },
  };
}

/**
 * 비동기 함수 측정. timeout 은 *promise race* 로 enforce — 실제 worker job
 * 은 별도 abort signal 로 호출자가 강제 종료.
 */
export async function measureAsync<T>(
  spec: BudgetSpec,
  fn: () => Promise<T>,
  opts: { readMemory?: () => number; signal?: AbortSignal } = {},
): Promise<{ result: T | null; outcome: GuardOutcome }> {
  const t0 = now();
  const timeoutPromise = new Promise<"__timeout__">((resolve) => {
    const timer = setTimeout(() => resolve("__timeout__"), spec.timeCapMs);
    if (opts.signal) {
      opts.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve("__timeout__");
        },
        { once: true },
      );
    }
  });
  let raceResult: T | "__timeout__";
  try {
    raceResult = await Promise.race([fn(), timeoutPromise]);
  } catch (e) {
    const elapsed = now() - t0;
    return {
      result: null,
      outcome: {
        code: "error_thrown",
        durationMs: elapsed,
        message: (e as Error).message,
        shouldSuspend: false,
      },
    };
  }
  const elapsed = now() - t0;

  if (raceResult === "__timeout__") {
    return {
      result: null,
      outcome: { code: "time_over", durationMs: elapsed, shouldSuspend: true },
    };
  }

  if (opts.readMemory) {
    const mem = opts.readMemory();
    if (mem > spec.memoryCapBytes) {
      return {
        result: raceResult,
        outcome: {
          code: "memory_over",
          memoryBytes: mem,
          durationMs: elapsed,
          shouldSuspend: true,
        },
      };
    }
  }

  return {
    result: raceResult,
    outcome: { code: "ok", durationMs: elapsed, shouldSuspend: false },
  };
}

/**
 * UI 표시용 사용자 메시지.
 */
export function describeOutcome(outcome: GuardOutcome, pluginName: string): string {
  switch (outcome.code) {
    case "ok":
      return `${pluginName}: ${outcome.durationMs?.toFixed(1)}ms`;
    case "time_over":
      return `${pluginName} 시간 초과 (${outcome.durationMs?.toFixed(1)}ms) — suspend`;
    case "memory_over": {
      const mb = outcome.memoryBytes != null ? (outcome.memoryBytes / 1024 / 1024).toFixed(1) : "?";
      return `${pluginName} 메모리 초과 (${mb}MB) — suspend`;
    }
    case "error_thrown":
      return `${pluginName} 에러: ${outcome.message ?? "unknown"}`;
  }
}
