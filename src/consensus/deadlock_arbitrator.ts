import {
  Critique,
  PerspectiveRole,
  Proposal,
  QuorumTallyResult,
  QuorumThresholds,
  DeliberationRoundRecord,
  DeliberationContext,
  ArbitrationAction,
  ArbitrationDecision,
} from './types.js';

export interface DeadlockDiagnosis {
  category:
    | 'SPLIT_TIE_VOTE'
    | 'BORDERLINE_SCORE'
    | 'ASYMMETRIC_QUORUM'
    | 'HIGH_POLARIZATION';
  description: string;
  contributingRoles: PerspectiveRole[];
  scoreGap: number;
}

export class DeadlockArbitrator {
  private maxRefinementRounds: number;
  private thresholds?: Partial<QuorumThresholds>;

  constructor(options?: {
    thresholds?: Partial<QuorumThresholds>;
    maxRefinementRounds?: number;
  }) {
    this.maxRefinementRounds =
      options?.maxRefinementRounds ??
      options?.thresholds?.maxRefinementRounds ??
      3;
    this.thresholds = options?.thresholds;
  }

  /**
   * Arbitrates split decisions and deadlocks with polymorphic argument support.
   * Supports:
   *  - arbitrate(proposal, critiques, tally, context)
   *  - arbitrate(proposal, tally, critiques, roundHistory)
   */
  public arbitrate(
    proposal: Proposal,
    arg2: Critique[] | QuorumTallyResult,
    arg3: QuorumTallyResult | Critique[],
    arg4?: DeliberationContext | DeliberationRoundRecord[]
  ): ArbitrationDecision {
    let critiques: Critique[];
    let tally: QuorumTallyResult;
    let roundHistory: DeliberationRoundRecord[] = [];
    let currentRound = 1;

    if (Array.isArray(arg2)) {
      critiques = arg2;
      tally = arg3 as QuorumTallyResult;
      if (arg4) {
        if ('round' in arg4) {
          currentRound = arg4.round;
          roundHistory = arg4.previousRounds || [];
        } else if (Array.isArray(arg4)) {
          roundHistory = arg4;
          currentRound = roundHistory.length + 1;
        }
      }
    } else {
      tally = arg2 as QuorumTallyResult;
      critiques = arg3 as Critique[];
      if (Array.isArray(arg4)) {
        roundHistory = arg4;
        currentRound = roundHistory.length + 1;
      } else if (arg4 && 'round' in arg4) {
        currentRound = arg4.round;
        roundHistory = arg4.previousRounds || [];
      }
    }

    // 1. Diagnose root cause of deadlock
    const diagnosis = this.diagnoseDeadlock(tally, critiques);

    // 2. Synthesize actionable guidance
    const synthesizedRemediation = this.synthesizeRemediation(critiques);
    const targetedGuidance = this.generateTargetedGuidance(critiques);

    // 3. Check for stagnation
    const isStagnating = this.checkStagnation(roundHistory, tally.compositeScore);

    // 4. Decision logic:
    // If under max refinement rounds and not hopelessly stagnating -> Refine
    if (currentRound < this.maxRefinementRounds && !isStagnating) {
      return {
        action: 'REQUEST_REFINEMENT',
        synthesizedRemediation,
        targetedGuidance,
        shouldProceedToNextRound: true,
      };
    }

    // Secondary fallback arbitration if max rounds reached or stagnating
    return this.evaluateSecondaryArbitration(tally, critiques, diagnosis);
  }

  /**
   * Categorizes the deadlock into a concrete diagnostic structure.
   */
  public diagnoseDeadlock(
    tally: QuorumTallyResult,
    critiques: Critique[]
  ): DeadlockDiagnosis {
    const contributingRoles: PerspectiveRole[] = critiques
      .filter((c) => !c.approved || c.score < 75.0)
      .map((c) => c.role);

    const scoreGap = Math.max(0, 75.0 - tally.compositeScore);

    // 2-2 Tie Vote
    if (tally.approvedCount === tally.rejectedCount) {
      return {
        category: 'SPLIT_TIE_VOTE',
        description: `Deliberation reached an even split (${tally.approvedCount} approved vs ${tally.rejectedCount} rejected).`,
        contributingRoles,
        scoreGap,
      };
    }

    // Borderline Score (e.g. 3 approvals but score in [65, 74.99])
    if (tally.quorumAchieved && !tally.thresholdMet) {
      return {
        category: 'BORDERLINE_SCORE',
        description: `Quorum approved (${tally.approvedCount}/${tally.totalEligible}), but composite score (${tally.compositeScore.toFixed(
          1
        )}) is below 75 threshold.`,
        contributingRoles,
        scoreGap,
      };
    }

    // Asymmetric Quorum (Score >= 75 but approvals < 3/4)
    if (!tally.quorumAchieved && tally.thresholdMet) {
      return {
        category: 'ASYMMETRIC_QUORUM',
        description: `Composite score is acceptable (${tally.compositeScore.toFixed(
          1
        )}), but approvals (${tally.approvedCount}/${tally.totalEligible}) fell short of 75% quorum.`,
        contributingRoles,
        scoreGap,
      };
    }

    // Score Polarization
    const scores = critiques.map((c) => c.score);
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);

    return {
      category: 'HIGH_POLARIZATION',
      description: `Severe score divergence (${minScore.toFixed(1)} to ${maxScore.toFixed(
        1
      )}, delta: ${(maxScore - minScore).toFixed(1)}) without clear consensus.`,
      contributingRoles,
      scoreGap,
    };
  }

  /**
   * Synthesizes actionable, deduplicated remediation points across dissenting critiques.
   */
  public synthesizeRemediation(critiques: Critique[]): string[] {
    const feedback: string[] = [];

    for (const c of critiques) {
      if (!c.approved || c.score < 75.0) {
        if (c.criticalFlaws && c.criticalFlaws.length > 0) {
          for (const flaw of c.criticalFlaws) {
            feedback.push(`[${c.role.toUpperCase()}] Resolve critical flaw: ${flaw}`);
          }
        }
        if (c.recommendations && c.recommendations.length > 0) {
          for (const rec of c.recommendations) {
            feedback.push(`[${c.role.toUpperCase()}] ${rec}`);
          }
        }
      }
    }

    return Array.from(new Set(feedback));
  }

  /**
   * Organizes feedback by role to guide targeted refinements.
   */
  public generateTargetedGuidance(
    critiques: Critique[]
  ): Partial<Record<PerspectiveRole, string[]>> {
    const guidance: Partial<Record<PerspectiveRole, string[]>> = {};

    for (const c of critiques) {
      const items: string[] = [];
      if (c.criticalFlaws) items.push(...c.criticalFlaws);
      if (c.recommendations) items.push(...c.recommendations);
      if (items.length > 0) {
        guidance[c.role] = items;
      }
    }

    return guidance;
  }

  /**
   * Detects whether score improvement has flattened or regressed across rounds.
   */
  public checkStagnation(
    roundHistory: DeliberationRoundRecord[],
    currentScore: number
  ): boolean {
    if (roundHistory.length < 2) return false;

    const prevScore = roundHistory[roundHistory.length - 1].compositeScore;
    const prevPrevScore = roundHistory[roundHistory.length - 2].compositeScore;

    const delta1 = prevScore - prevPrevScore;
    const delta2 = currentScore - prevScore;

    // Stagnant if delta is zero or negative across two successive rounds
    return delta1 <= 0 && delta2 <= 0;
  }

  /**
   * Evaluates deterministic secondary arbitration when maximum refinement rounds are exhausted.
   */
  public evaluateSecondaryArbitration(
    tally: QuorumTallyResult,
    critiques: Critique[],
    diagnosis?: DeadlockDiagnosis
  ): ArbitrationDecision {
    const secCritique = critiques.find(
      (c) => c.role === 'security_verification'
    );
    const archCritique = critiques.find(
      (c) => c.role === 'software_architecture'
    );
    const stratCritique = critiques.find(
      (c) => c.role === 'strategic_planning'
    );

    const secScore = secCritique ? secCritique.score : 0;
    const archScore = archCritique ? archCritique.score : 0;
    const stratApproved = stratCritique ? stratCritique.approved : false;

    // Primacy Rule: Security >= 72, Architecture >= 75, Composite >= 72, Strategic Approved
    const canConditionallyApprove =
      secScore >= 72.0 &&
      archScore >= 75.0 &&
      tally.compositeScore >= 72.0 &&
      stratApproved &&
      (!secCritique || secCritique.criticalFlaws.length === 0) &&
      (!archCritique || archCritique.criticalFlaws.length === 0);

    if (canConditionallyApprove) {
      return {
        action: 'SPLIT_DECISION_ARBITRATE',
        synthesizedRemediation: [
          'CONDITIONAL APPROVAL GRANTED VIA SECONDARY ARBITRATION.',
          'Mandatory pre-execution requirement: enforce strict sandbox isolation and audit logging.',
        ],
        targetedGuidance: {
          security_verification: [
            'Runtime security assertion monitoring mandated during execution.',
          ],
        },
        tieBreakerVote: {
          role: 'software_architecture',
          overrideScore: 76.0,
          rationale: `Secondary arbitration passed: Architecture (${archScore.toFixed(
            1
          )}) and Security (${secScore.toFixed(
            1
          )}) meet minimum safety threshold; composite score (${tally.compositeScore.toFixed(
            1
          )}) within margin.`,
        },
        shouldProceedToNextRound: false,
      };
    }

    // Fail-closed Safety Rejection
    return {
      action: 'UNRESOLVABLE_DEADLOCK',
      synthesizedRemediation: [
        'UNRESOLVABLE DEADLOCK: Maximum refinement rounds exhausted.',
        `Security (${secScore.toFixed(1)}) or Architecture (${archScore.toFixed(
          1
        )}) insufficient for secondary tie-break.`,
        ...this.synthesizeRemediation(critiques),
      ],
      targetedGuidance: this.generateTargetedGuidance(critiques),
      shouldProceedToNextRound: false,
    };
  }
}
