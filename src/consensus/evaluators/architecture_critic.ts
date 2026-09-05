import { BaseEvaluator } from './base_evaluator.js';
import { Proposal, PerspectiveRole, DeliberationContext } from '../types.js';

export class ArchitectureCriticEvaluator extends BaseEvaluator {
  public readonly role: PerspectiveRole = 'software_architecture';
  public readonly weight: number = 0.25;
  public readonly agentId: string;

  constructor(options?: {
    agentId?: string;
    weight?: number;
    hmacSecret?: string;
  }) {
    super(options);
    this.agentId = options?.agentId || 'evaluator-architecture-01';
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
      modularity_and_cohesion: 100,
      coupling_and_dependencies: 100,
      interface_consistency: 100,
      invariant_preservation: 100,
    };
    const criticalFlaws: string[] = [];
    const recommendations: string[] = [];

    const content = proposal.content || '';

    // 1. Invariant: Zero Cloud API Dependencies (Local-First Docker)
    if (
      /https?:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i.test(
        content
      )
    ) {
      dimensionScores.invariant_preservation -= 60;
      criticalFlaws.push(
        'ARCH_CRIT_INVARIANT_BREACH: Proposal references external cloud endpoints, violating local-first Docker invariant.'
      );
      recommendations.push(
        'Remove all external HTTP endpoints. Connect solely to local Docker services (5432, 6333, 4000).'
      );
    }

    // 2. Invariant: Agent Metadata Isolation (.agents/ directory restriction)
    if (/\.agents\/[a-zA-Z0-9_-]+\/(?:src|lib|dist|tests)/i.test(content)) {
      dimensionScores.invariant_preservation -= 50;
      criticalFlaws.push(
        'ARCH_CRIT_WORKSPACE_POLLUTION: Attempted to place source or test code inside .agents/ directory.'
      );
      recommendations.push(
        '.agents/ is strictly reserved for agent metadata. Place source code in src/ and tests in tests/.'
      );
    }

    // 3. Circular Dependency / Layer Inversion Check
    if (
      proposal.type === 'code_verification' &&
      /src\/consensus\/evaluators/i.test(
        proposal.title + ' ' + (proposal.metadata?.filePath || '')
      )
    ) {
      if (/from\s+['"][^'"]*council_orchestrator(?:\.[a-zA-Z]+)?['"]/i.test(content)) {
        dimensionScores.coupling_and_dependencies -= 50;
        criticalFlaws.push(
          'ARCH_CRIT_CIRCULAR_DEPENDENCY: Evaluator directly imports council_orchestrator, introducing a circular cycle.'
        );
        recommendations.push(
          'Decouple evaluator from orchestrator using base interfaces from types.ts and base_evaluator.ts.'
        );
      }
    }

    // 4. Modularity & Cohesion (Bloat Check)
    const lineCount = content.split('\n').length;
    if (lineCount > 800) {
      dimensionScores.modularity_and_cohesion -= 25;
      recommendations.push(
        `File exceeds 800 lines (${lineCount} lines). Decompose into focused single-responsibility submodules.`
      );
    }

    // 5. Interface Consistency (Excessive untyped 'any' check)
    const anyMatches = (content.match(/:\s*any\b/g) || []).length;
    if (anyMatches > 5) {
      dimensionScores.interface_consistency -= 20;
      recommendations.push(
        `Excessive untyped 'any' detected (${anyMatches} occurrences). Specify explicit domain interfaces.`
      );
    }

    // Clamp dimension scores
    for (const key of Object.keys(dimensionScores)) {
      dimensionScores[key] = this.clampScore(dimensionScores[key]);
    }

    let score = this.clampScore(
      dimensionScores.modularity_and_cohesion * 0.30 +
        dimensionScores.coupling_and_dependencies * 0.25 +
        dimensionScores.interface_consistency * 0.25 +
        dimensionScores.invariant_preservation * 0.20
    );

    // INVARIANT VETO: Invariant flaws cap score to at most 50.0
    if (criticalFlaws.length > 0) {
      score = Math.min(score, 50.0);
    }

    return {
      score,
      dimensionScores,
      criticalFlaws,
      recommendations,
      rationale:
        criticalFlaws.length > 0
          ? `Architectural invariant veto triggered: ${criticalFlaws.join('; ')}`
          : `Software architecture evaluated at ${score.toFixed(2)}/100 across modularity, coupling, interfaces, and invariants.`,
    };
  }
}
