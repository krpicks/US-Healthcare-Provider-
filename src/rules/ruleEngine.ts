export interface RuleEvaluationContext {
  tenantId: string;
  effectiveDateIso: string;
}

export interface RuleEvaluationResult<TOutcome = unknown> {
  ruleId: string;
  version: string;
  matched: boolean;
  outcome: TOutcome;
  rationale: string;
}

export interface TenantRule<TInput = unknown, TOutcome = unknown> {
  id: string;
  name: string;
  version: string;
  tenantId: string;
  enabled: boolean;
  evaluate(
    input: TInput,
    ctx: RuleEvaluationContext,
  ): RuleEvaluationResult<TOutcome>;
}
