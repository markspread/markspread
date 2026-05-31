// ADR-0013 + ADR-0016: PluginHost orchestrator — 모든 safety/budget/trust 모듈을 합성.
//
// 기존 host.ts (PluginHost) 는 *기본 lifecycle + RPC dispatcher* 만 가짐.
// 본 orchestrator 는 그 위에 다음을 wire:
//   - TrustRegistry (T5.G) — plugin 등록 시 trust level 결정
//   - Validator (T5.B) — 등록 시 AST 정적 분석
//   - Consent (T5.F) — 활성 시 다이얼로그 결정
//   - BudgetGuard (T5.D) — hook 호출 시 시간 cap
//   - Sanitizer (T5.C) — 출력 HTML/SVG sanitize
//
// 호출자 (renderer wiring) 는 본 orchestrator 만 import. PluginHost 직접 사용 금지.

import { sanitize } from "../../preview/sanitizer";
import { BUDGETS, type BudgetSpec, measureAsync } from "./budget-guard";
import {
  type ConsentDecision,
  type ConsentEvaluation,
  applyConsentDecision,
  evaluateConsent,
} from "./consent";
import type {
  InstallInput as HostInstallInput,
  PluginHost,
  WorkerFactory as _WorkerFactory,
} from "./host";
import { type PluginTrustLevel, TrustRegistry } from "./trust-registry";
import type { HookContext, PluginHandle, RenderResult } from "./types";
import { type Violation, analyse } from "./validator";

export interface OrchestratedInstallInput extends HostInstallInput {
  trustLevel: PluginTrustLevel;
  source: string;
  /** AI 생성 한 줄 요약 (consent dialog 표시용) */
  oneLinerSummary?: string;
  /** authoredBy/origin metadata for trust registry */
  authoredBy?: string;
  origin?: string;
}

export interface OrchestratedInstallResult {
  handle: PluginHandle;
  /** 등록 시 발견된 Validator 위반 (사용자에게 표시할 수 있음) */
  violations: readonly Violation[];
  /** 다이얼로그 노출 필요 여부 + 정보 */
  consent: ConsentEvaluation;
}

export interface RenderRequest {
  pluginName: string;
  /** "codeblock" | "fence" */
  kind: "codeblock" | "fence";
  key: string;
  source: string;
  context: Omit<HookContext, "hookKey" | "pluginName">;
  /** publish 사이트 = true → strict 모드 (sanitizer + 더 짧은 budget) */
  publishStrict?: boolean;
  /** caller-provided memory reading (worker-side measurement). */
  readMemory?: () => number;
}

export interface OrchestratedRenderResult {
  html: string | null;
  /** sanitized 결과에서 제거된 tag 들 (디버그·텔레메트리) */
  removedByOnSanitize: readonly string[];
  /** BudgetGuard outcome */
  budget: { code: string; durationMs?: number; suspended: boolean };
  /** plugin 이 반환한 raw 결과 (디버그) */
  raw?: RenderResult | null;
  /** caller 가 user-facing 에러 표시 — null 이면 정상 */
  errorMessage: string | null;
}

export class PluginOrchestrator {
  readonly trust = new TrustRegistry();
  constructor(private readonly host: PluginHost) {}

  /**
   * 통합 install:
   *   1. Validator → 위반 enumerate
   *   2. TrustRegistry 등록 (저장)
   *   3. Consent 평가 (caller 가 UI 띄움)
   *   4. PluginHost.install — 단 consent.action !== 'show' 인 경우만 즉시 spawn
   *      (show 라면 caller 가 동의 받은 후 별도 acceptConsent() 호출)
   */
  async install(input: OrchestratedInstallInput, now: number): Promise<OrchestratedInstallResult> {
    const violations = analyse(input.source);

    const registerOpts: { authoredBy?: string; origin?: string; now: number } = {
      now,
    };
    if (input.authoredBy !== undefined) registerOpts.authoredBy = input.authoredBy;
    if (input.origin !== undefined) registerOpts.origin = input.origin;
    this.trust.register(input.manifest.name, input.trustLevel, registerOpts);

    const consent = evaluateConsent(input.manifest.name, this.trust, {
      fullSource: input.source,
      oneLinerSummary: input.oneLinerSummary ?? "(요약 없음)",
      violations,
    });

    let handle: PluginHandle;
    if (consent.action === "show") {
      // 다이얼로그 대기 — 아직 spawn 안 함. caller 가 acceptConsent() 호출 시 spawn.
      handle = {
        manifest: input.manifest,
        pluginDir: input.pluginDir,
        scope: input.scope,
        workerId: null,
        registered: [],
        state: "loading",
      };
    } else {
      // local 또는 already-consented → 즉시 install
      handle = await this.host.install({
        manifest: input.manifest,
        pluginDir: input.pluginDir,
        scope: input.scope,
      });
    }
    return { handle, violations, consent };
  }

  /**
   * 사용자 동의 다이얼로그 결과 처리. accept 면 PluginHost spawn.
   */
  async resolveConsent(
    input: OrchestratedInstallInput,
    decision: ConsentDecision,
    now: number,
  ): Promise<{ activated: boolean; handle?: PluginHandle }> {
    const { activated } = applyConsentDecision(input.manifest.name, decision, this.trust, now);
    if (!activated) return { activated: false };
    const handle = await this.host.install({
      manifest: input.manifest,
      pluginDir: input.pluginDir,
      scope: input.scope,
    });
    return { activated: true, handle };
  }

  /**
   * hook 호출 + BudgetGuard + Sanitizer + Trust 기반 strict 결정.
   */
  async render(req: RenderRequest): Promise<OrchestratedRenderResult> {
    const policy = this.trust.policy(req.pluginName);
    const budget: BudgetSpec = req.publishStrict ? BUDGETS.publishStrict : BUDGETS.local;

    const dispatch = async (): Promise<RenderResult | null> => {
      if (req.kind === "codeblock") {
        return await this.host.renderCodeblock(req.key, req.source, req.context);
      }
      return await this.host.renderFence(req.key, req.source, req.context);
    };

    const measureOpts: { readMemory?: () => number } = {};
    if (req.readMemory !== undefined) measureOpts.readMemory = req.readMemory;
    const { result, outcome } = await measureAsync(budget, dispatch, measureOpts);

    if (outcome.shouldSuspend) {
      // 호출자가 별도 host.disable() 으로 worker 종료 — 본 함수는 노티만.
      return {
        html: null,
        removedByOnSanitize: [],
        budget: {
          code: outcome.code,
          ...(outcome.durationMs !== undefined ? { durationMs: outcome.durationMs } : {}),
          suspended: true,
        },
        raw: result,
        errorMessage: `${req.pluginName}: ${outcome.code} (${outcome.durationMs?.toFixed(1) ?? "?"}ms)`,
      };
    }

    if (!result || result.kind !== "html") {
      return {
        html: null,
        removedByOnSanitize: [],
        budget: {
          code: outcome.code,
          ...(outcome.durationMs !== undefined ? { durationMs: outcome.durationMs } : {}),
          suspended: false,
        },
        raw: result,
        errorMessage: result?.kind === "error" ? result.message : "no result",
      };
    }

    // HTML 결과 → sanitize
    const strict = req.publishStrict === true || policy.sanitizerStrict;
    const sanitised = await sanitize(result.html, { strict });

    return {
      html: sanitised.html,
      removedByOnSanitize: sanitised.removed,
      budget: {
        code: outcome.code,
        ...(outcome.durationMs !== undefined ? { durationMs: outcome.durationMs } : {}),
        suspended: false,
      },
      raw: result,
      errorMessage: null,
    };
  }
}
