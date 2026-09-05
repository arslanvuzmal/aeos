import * as crypto from 'crypto';
import {
  Proposal,
  Critique,
  PerspectiveRole,
  DeliberationContext,
} from '../types.js';

export interface IEvaluator {
  readonly role: PerspectiveRole;
  readonly weight: number;
  readonly agentId: string;
  evaluate(proposal: Proposal, context?: DeliberationContext): Promise<Critique>;
}

export abstract class BaseEvaluator implements IEvaluator {
  public abstract readonly role: PerspectiveRole;
  public abstract readonly weight: number;
  public abstract readonly agentId: string;
  protected readonly hmacSecret: string;

  constructor(options?: {
    agentId?: string;
    weight?: number;
    hmacSecret?: string;
  }) {
    this.hmacSecret =
      options?.hmacSecret ||
      process.env.COUNCIL_SECRET ||
      'aeos_consensus_evaluator_secret_2026';
  }

  /**
   * Template method executing standard pre-checks, role-specific scoring,
   * post-normalization, and cryptographic signing.
   */
  public async evaluate(
    proposal: Proposal,
    context?: DeliberationContext
  ): Promise<Critique> {
    const startTime = Date.now();

    // 1. Proposal boundary validation
    this.validateProposal(proposal);

    // 2. Delegate to concrete subclass for analytical heuristic scoring
    const rawResult = await this.doEvaluate(proposal, context);

    // 3. Score normalization and bounds enforcement
    const normalizedScore = this.clampScore(rawResult.score);
    const normalizedDimensions: Record<string, number> = {};
    for (const [dim, val] of Object.entries(rawResult.dimensionScores || {})) {
      normalizedDimensions[dim] = this.clampScore(val);
    }

    // 4. Determine approval based on role threshold and critical flaws
    const criticalFlaws = rawResult.criticalFlaws || [];
    const hasCriticalFlaws = criticalFlaws.length > 0;
    const approvalThreshold = this.getApprovalThreshold();
    const approved = !hasCriticalFlaws && normalizedScore >= approvalThreshold;

    const timestamp = new Date().toISOString();

    // 5. Build critique payload for signing
    const critiqueData = {
      agentId: this.agentId,
      role: this.role,
      score: normalizedScore,
      dimensionScores: normalizedDimensions,
      approved,
      criticalFlaws,
      recommendations: rawResult.recommendations || [],
      timestamp,
      rationale:
        rawResult.rationale ||
        this.formatDefaultRationale(normalizedScore, approved, criticalFlaws),
    };

    // 6. Cryptographically sign the critique with HMAC-SHA256
    const signature = this.signCritique(proposal.id, critiqueData);

    return {
      ...critiqueData,
      signature,
      executionDurationMs: Date.now() - startTime,
    };
  }

  /**
   * Concrete subclass must implement role-specific analytical heuristics.
   */
  protected abstract doEvaluate(
    proposal: Proposal,
    context?: DeliberationContext
  ): Promise<{
    score: number;
    dimensionScores: Record<string, number>;
    criticalFlaws: string[];
    recommendations: string[];
    rationale?: string;
  }>;

  /**
   * Subclass can define role-specific approval threshold (default: 75.0).
   */
  protected getApprovalThreshold(): number {
    return 75.0;
  }

  /**
   * Clamps scores strictly into [0.00, 100.00] range with 2 decimal places.
   */
  protected clampScore(score: number): number {
    if (isNaN(score)) return 0.0;
    return Math.max(0.0, Math.min(100.0, Math.round(score * 100) / 100));
  }

  /**
   * Input boundary guard.
   */
  protected validateProposal(proposal: Proposal): void {
    if (!proposal) {
      throw new Error(`[${this.agentId || 'BaseEvaluator'}] Null or undefined proposal received.`);
    }
    if (!proposal.id || typeof proposal.id !== 'string') {
      throw new Error(`[${this.agentId || 'BaseEvaluator'}] Proposal missing valid id string.`);
    }
    if (
      !proposal.content ||
      typeof proposal.content !== 'string' ||
      proposal.content.trim().length === 0
    ) {
      throw new Error(`[${this.agentId || 'BaseEvaluator'}] Proposal content is empty.`);
    }
  }

  /**
   * Deterministically signs a critique using HMAC-SHA256 over its canonical representation.
   */
  protected signCritique(
    proposalId: string,
    critiqueData: Omit<Critique, 'signature' | 'executionDurationMs'>,
    secret: string = this.hmacSecret
  ): string {
    const sortedDimensions = Object.keys(critiqueData.dimensionScores)
      .sort()
      .reduce((acc, key) => {
        acc[key] = critiqueData.dimensionScores[key];
        return acc;
      }, {} as Record<string, number>);

    const canonical = [
      critiqueData.agentId,
      critiqueData.role,
      proposalId,
      critiqueData.score.toFixed(2),
      JSON.stringify(sortedDimensions),
      critiqueData.approved ? '1' : '0',
      [...critiqueData.criticalFlaws].sort().join('|'),
    ].join(':');

    return crypto.createHmac('sha256', secret).update(canonical).digest('hex');
  }

  /**
   * Canonical JSON HMAC-SHA256 signature generator utility.
   */
  protected signPayload(payload: Record<string, any>, secret: string = this.hmacSecret): string {
    const canonicalString = JSON.stringify(payload, Object.keys(payload).sort());
    return crypto.createHmac('sha256', secret).update(canonicalString).digest('hex');
  }

  private formatDefaultRationale(
    score: number,
    approved: boolean,
    flaws: string[]
  ): string {
    if (!approved) {
      return `Critique Rejected with score ${score.toFixed(
        2
      )}. Critical flaws identified: ${flaws.join('; ') || 'Threshold not met'}`;
    }
    return `Critique Approved with score ${score.toFixed(
      2
    )}. Evaluation dimensions satisfied.`;
  }
}
