import { BaseEvaluator } from './base_evaluator.js';
import { Proposal, PerspectiveRole, DeliberationContext } from '../types.js';

export class StrategicPlannerEvaluator extends BaseEvaluator {
  public readonly role: PerspectiveRole = 'strategic_planning';
  public readonly weight: number = 0.20;
  public readonly agentId: string;

  constructor(options?: {
    agentId?: string;
    weight?: number;
    hmacSecret?: string;
  }) {
    super(options);
    this.agentId = options?.agentId || 'evaluator-strategic-01';
    if (options?.weight !== undefined) {
      this.weight = options.weight;
    }
  }

  protected override getApprovalThreshold(): number {
    return 75.0;
  }

  protected async doEvaluate(
    proposal: Proposal,
    context?: DeliberationContext
  ): Promise<{
    score: number;
    dimensionScores: Record<string, number>;
    criticalFlaws: string[];
    recommendations: string[];
    rationale?: string;
  }> {
    const dimensionScores: Record<string, number> = {
      goal_alignment: 100,
      scope_feasibility: 100,
      task_decomposition: 100,
      operational_risk: 100,
    };
    const criticalFlaws: string[] = [];
    const recommendations: string[] = [];

    const content = proposal.content || '';
    const isPlan = proposal.type === 'task_plan';

    if (isPlan) {
      // 1. Task Decomposition & Checklist Audit
      const checklistMatches =
        content.match(/^[\s]*-\s*\[([ xX])\]\s+(.+)$/gm) || [];
      if (checklistMatches.length === 0) {
        dimensionScores.task_decomposition -= 60;
        criticalFlaws.push(
          'CRIT_STRAT_NO_ACTIONABLE_STEPS: Task plan contains zero checkbox checklist items.'
        );
        recommendations.push(
          'Add an explicit checklist with at least 3 concrete steps: "- [ ] Step 1: ...".'
        );
      } else if (checklistMatches.length < 3) {
        dimensionScores.task_decomposition -= 30;
        recommendations.push(
          'Expand task decomposition to cover all necessary implementation phases.'
        );
      }

      // 2. Goal Alignment Audit
      const goal = (
        proposal.metadata?.goal ||
        proposal.title ||
        ''
      ).toLowerCase();
      const goalTokens = goal
        .split(/[^a-zA-Z0-9_-]+/)
        .filter((t) => t.length > 3);
      const lowerContent = content.toLowerCase();

      if (goalTokens.length > 0) {
        let matchedTokens = 0;
        for (const token of goalTokens) {
          if (lowerContent.includes(token)) matchedTokens++;
        }
        const tokenOverlap = matchedTokens / goalTokens.length;
        if (tokenOverlap < 0.3) {
          dimensionScores.goal_alignment -= 40;
          recommendations.push(
            `Improve alignment with declared goal "${proposal.title}". Missing key domain concepts.`
          );
        }
      }

      // 3. Scope Feasibility Audit (Offline local-first Docker invariant)
      if (
        /external cloud|aws\b|gcp\b|azure\b|openai\b|anthropic\b/i.test(content)
      ) {
        dimensionScores.scope_feasibility -= 40;
        criticalFlaws.push(
          'CRIT_STRAT_CLOUD_DEPENDENCY: Scope specifies external cloud services violating local Docker constraint.'
        );
        recommendations.push(
          'Refactor plan to operate entirely within local Docker services (Postgres 5432, Qdrant 6333).'
        );
      }

      const lines = content.split('\n').length;
      if (lines > 2000) {
        dimensionScores.scope_feasibility -= 20;
        recommendations.push(
          'Plan is excessively verbose (>2000 lines). Decompose into focused sub-phases.'
        );
      }

      // 4. Operational Risk Audit
      if (
        !/risk|fallback|rollback|contingency|error\s+handling|failure\s+mode/i.test(
          content
        )
      ) {
        dimensionScores.operational_risk -= 30;
        recommendations.push(
          'Document operational risks, error recovery mechanisms, and fallback plans.'
        );
      }
    } else {
      // Code verification evaluation
      if (content.length < 50) {
        dimensionScores.scope_feasibility -= 50;
        criticalFlaws.push(
          'CRIT_STRAT_EMPTY_DELIVERABLE: Code deliverable is empty or truncated.'
        );
        recommendations.push(
          'Provide a complete, functional code implementation.'
        );
      }

      if (!/module\.exports|export\s+|export\s+default/i.test(content)) {
        dimensionScores.goal_alignment -= 30;
        recommendations.push(
          'Ensure deliverable properly exports its interfaces.'
        );
      }

      if (!/try\s*\{|catch\s*\(|throw\s+new/i.test(content)) {
        dimensionScores.operational_risk -= 25;
        recommendations.push(
          'Implement explicit error handling and failure boundaries in critical execution paths.'
        );
      }
    }

    // Clamp each dimension score
    for (const key of Object.keys(dimensionScores)) {
      dimensionScores[key] = this.clampScore(dimensionScores[key]);
    }

    // Weighted aggregate score
    const score = this.clampScore(
      dimensionScores.goal_alignment * 0.30 +
        dimensionScores.scope_feasibility * 0.25 +
        dimensionScores.task_decomposition * 0.25 +
        dimensionScores.operational_risk * 0.20
    );

    return {
      score,
      dimensionScores,
      criticalFlaws,
      recommendations,
      rationale:
        criticalFlaws.length > 0
          ? `Strategic review failed with critical flaws: ${criticalFlaws.join('; ')}`
          : `Strategic alignment assessed at ${score.toFixed(2)}/100 across goals, scope, tasks, and risk.`,
    };
  }
}
