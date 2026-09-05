import * as crypto from 'crypto';
import {
  Critique,
  PerspectiveRole,
  Proposal,
  VotingWeights,
  QuorumThresholds,
  QuorumTallyResult,
  DeliberationStatus,
  ConsensusCertificate,
  SignatoryAgent,
} from './types.js';

export const DEFAULT_VOTING_WEIGHTS: VotingWeights = {
  security_verification: 0.35,
  software_architecture: 0.25,
  performance_audit: 0.20,
  strategic_planning: 0.20,
};

export const DEFAULT_QUORUM_THRESHOLDS: QuorumThresholds = {
  minCompositeScore: 75.0,
  minApprovalFraction: 0.75, // >= 3/4
  securityVetoMinScore: 70.0,
  architectureVetoMinScore: 60.0,
  deadlockScoreWindow: {
    min: 65.0,
    max: 74.99,
  },
  maxRefinementRounds: 3,
};

export class VotingEngine {
  private weights: VotingWeights;
  private thresholds: QuorumThresholds;

  constructor(options?: {
    weights?: Partial<VotingWeights>;
    thresholds?: Partial<QuorumThresholds>;
  }) {
    this.weights = { ...DEFAULT_VOTING_WEIGHTS, ...options?.weights };
    this.thresholds = { ...DEFAULT_QUORUM_THRESHOLDS, ...options?.thresholds };
  }

  /**
   * Tally votes from member critiques against proposal.
   */
  public tallyVotes(
    critiques: Critique[],
    proposal: Proposal,
    round: number = 1
  ): QuorumTallyResult {
    if (!critiques || critiques.length === 0) {
      throw new Error('[VOTING_ENGINE] Cannot tally empty critiques array.');
    }
    if (critiques.length < 3) {
      throw new Error(
        `[VOTING_ENGINE] Requirement R1 violated: Deliberation requires minimum 3 perspectives. Received: ${critiques.length}`
      );
    }

    // 1. Check for Strict Veto Conditions
    const vetoEvaluation = this.evaluateVetoes(critiques);

    // 2. Compute Weighted Composite Score
    const compositeScore = this.computeWeightedScore(critiques);

    // 3. Count Approvals and Rejections
    const approvedCount = critiques.filter((c) => c.approved).length;
    const rejectedCount = critiques.length - approvedCount;
    const approvalFraction = approvedCount / critiques.length;
    const quorumAchieved = approvalFraction >= this.thresholds.minApprovalFraction;
    const thresholdMet = compositeScore >= this.thresholds.minCompositeScore;

    // 4. Extract Dissents & Remediation Directives
    const dissentingRoles: PerspectiveRole[] = [];
    const dissentingOpinions: string[] = [];
    const remediationFeedback: string[] = [];

    for (const critique of critiques) {
      if (!critique.approved || critique.score < this.thresholds.minCompositeScore) {
        dissentingRoles.push(critique.role);
        dissentingOpinions.push(
          `[${critique.role.toUpperCase()}] (Score: ${critique.score.toFixed(
            1
          )}) ${
            critique.criticalFlaws.length > 0
              ? 'Critical Flaws: ' + critique.criticalFlaws.join('; ')
              : 'Recommendations: ' + critique.recommendations.join('; ')
          }`
        );
      }
      if (critique.recommendations && critique.recommendations.length > 0) {
        remediationFeedback.push(...critique.recommendations);
      }
      if (critique.criticalFlaws && critique.criticalFlaws.length > 0) {
        remediationFeedback.push(
          ...critique.criticalFlaws.map((f) => `Remediate flaw: ${f}`)
        );
      }
    }

    // 5. Determine Deliberation Outcome
    let roundOutcome: DeliberationStatus;

    if (vetoEvaluation.isVetoed) {
      // Veto takes absolute precedence -> REJECTED
      roundOutcome = 'REJECTED';
    } else if (quorumAchieved && thresholdMet) {
      // Both quorum and score threshold met -> APPROVED
      roundOutcome = 'APPROVED';
    } else {
      // Evaluate whether it constitutes a DEADLOCK vs outright REJECTION
      const isSplitTie = approvedCount === rejectedCount;
      const isBorderlineScore =
        compositeScore >= this.thresholds.deadlockScoreWindow.min &&
        compositeScore <= this.thresholds.deadlockScoreWindow.max;
      const isQuorumConflict =
        (quorumAchieved && !thresholdMet) || (!quorumAchieved && thresholdMet);

      if (isSplitTie || isBorderlineScore || isQuorumConflict) {
        roundOutcome = 'DEADLOCK';
      } else {
        roundOutcome = 'REJECTED';
      }
    }

    return {
      approvedCount,
      rejectedCount,
      totalEligible: critiques.length,
      quorumAchieved,
      compositeScore,
      thresholdMet,
      vetoTriggered: vetoEvaluation.isVetoed,
      vetoReasons: vetoEvaluation.reasons,
      dissentingRoles,
      dissentingOpinions,
      roundOutcome,
    };
  }

  /**
   * Compatibility alias matching CouncilOrchestrator specification.
   */
  public tallyQuorum(
    proposal: Proposal,
    critiques: Critique[],
    round: number = 1
  ): QuorumTallyResult {
    return this.tallyVotes(critiques, proposal, round);
  }

  /**
   * Checks for strict security vetoes and architectural invariant breaches.
   */
  public evaluateVetoes(critiques: Critique[]): {
    isVetoed: boolean;
    reasons: string[];
  } {
    const reasons: string[] = [];
    let isVetoed = false;

    for (const c of critiques) {
      // Security Verification Veto
      if (c.role === 'security_verification') {
        if (c.score < this.thresholds.securityVetoMinScore) {
          isVetoed = true;
          reasons.push(
            `SECURITY VETO: Security verification score (${c.score.toFixed(
              1
            )}) is below strict threshold (${this.thresholds.securityVetoMinScore}).`
          );
        }
        if (c.criticalFlaws && c.criticalFlaws.length > 0) {
          isVetoed = true;
          reasons.push(
            `SECURITY VETO: Critical vulnerabilities detected: ${c.criticalFlaws.join('; ')}`
          );
        }
      }

      // Architecture Invariant Veto
      if (c.role === 'software_architecture') {
        if (c.score < this.thresholds.architectureVetoMinScore) {
          isVetoed = true;
          reasons.push(
            `ARCHITECTURE VETO: Architecture score (${c.score.toFixed(
              1
            )}) is below critical floor (${this.thresholds.architectureVetoMinScore}).`
          );
        }
        const hasInvariantBreach = c.criticalFlaws.some((flaw) =>
          /invariant|illegal call|circular|isolation|bypass|pollution|workspace/i.test(flaw)
        );
        if (hasInvariantBreach) {
          isVetoed = true;
          reasons.push(
            `ARCHITECTURE VETO: System invariant violation detected: ${c.criticalFlaws.join('; ')}`
          );
        }
      }

      // Global Critical Flaws
      const criticalKeywords =
        /sql injection|command injection|remote code|path traversal|timing safe/i;
      const criticalFound = c.criticalFlaws.filter((f) =>
        criticalKeywords.test(f)
      );
      if (criticalFound.length > 0) {
        isVetoed = true;
        reasons.push(
          `CRITICAL VETO (${c.role}): Severe exploit vector detected: ${criticalFound.join('; ')}`
        );
      }
    }

    return { isVetoed, reasons };
  }

  /**
   * Computes normalized weighted composite score across participating critiques.
   */
  public computeWeightedScore(critiques: Critique[]): number {
    let totalActiveWeight = 0;
    for (const c of critiques) {
      totalActiveWeight += this.weights[c.role] || 0.25;
    }

    if (totalActiveWeight === 0) {
      const simpleAvg =
        critiques.reduce((sum, c) => sum + c.score, 0) / critiques.length;
      return Math.round(simpleAvg * 100) / 100;
    }

    let weightedSum = 0;
    for (const c of critiques) {
      const rawWeight = this.weights[c.role] || 0.25;
      const normalizedWeight = rawWeight / totalActiveWeight;
      weightedSum += c.score * normalizedWeight;
    }

    const finalScore = Math.max(0, Math.min(100, weightedSum));
    return Math.round(finalScore * 100) / 100;
  }

  /**
   * Constructs the deterministic data payload required for a ConsensusCertificate.
   */
  public generateCertificateData(
    proposal: Proposal,
    tally: QuorumTallyResult,
    critiques: Critique[],
    deliberationId: string,
    secretKey: string = 'aeos_consensus_internal_key_2026'
  ): ConsensusCertificate {
    if (tally.roundOutcome !== 'APPROVED') {
      throw new Error(
        `[VOTING_ENGINE] Cannot generate approval certificate for outcome: ${tally.roundOutcome}`
      );
    }

    const proposalHash =
      proposal.proposalHash ||
      crypto.createHash('sha256').update(proposal.content).digest('hex');

    const signatoryAgents: SignatoryAgent[] = critiques.map((c) => ({
      agentId: c.agentId,
      role: c.role,
      score: c.score,
      signature: c.signature,
    }));

    const participatingAgents = critiques.map((c) => c.agentId);

    const dimensionAverages: Record<string, number> = {};
    for (const c of critiques) {
      for (const [k, v] of Object.entries(c.dimensionScores)) {
        dimensionAverages[k] =
          (dimensionAverages[k] || 0) + v / critiques.length;
      }
    }
    for (const k of Object.keys(dimensionAverages)) {
      dimensionAverages[k] = Math.round(dimensionAverages[k] * 100) / 100;
    }

    // Serialize critiques deterministically for transcript hashing
    const transcriptPayload = JSON.stringify(
      critiques.map((c) => ({
        agentId: c.agentId,
        role: c.role,
        score: c.score,
        approved: c.approved,
        flaws: c.criticalFlaws,
        signature: c.signature,
      }))
    );
    const transcriptHash = crypto
      .createHash('sha256')
      .update(transcriptPayload)
      .digest('hex');

    const nonce = crypto.randomBytes(16).toString('hex');
    const nowIso = new Date().toISOString();

    const certPayload = `${proposal.id}:${proposalHash}:${deliberationId}:${tally.compositeScore}:${transcriptHash}:${nonce}:${nowIso}`;
    const certificateSignature = crypto
      .createHmac('sha256', secretKey)
      .update(certPayload)
      .digest('hex');

    return {
      certificateId: `cert_${proposal.id}_${Date.now()}_${nonce.substring(0, 8)}`,
      proposalId: proposal.id,
      proposalHash,
      deliberationId,
      roundId: `round_1`,
      decision: 'APPROVED',
      compositeScore: tally.compositeScore,
      quorumAchieved: true,
      quorumRatio: tally.approvedCount / tally.totalEligible,
      quorumVotes: {
        approved: tally.approvedCount,
        rejected: tally.rejectedCount,
        total: tally.totalEligible,
      },
      participatingAgents,
      dimensionAverages,
      signatoryAgents,
      transcriptHash,
      certificateSignature,
      issuedAt: nowIso,
      timestamp: nowIso,
      nonce,
    };
  }
}
