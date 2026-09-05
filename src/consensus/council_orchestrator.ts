import * as crypto from 'crypto';
import {
  Proposal,
  Critique,
  DeliberationResult,
  DeliberationRoundRecord,
  DeliberationContext,
  ConsensusCertificate,
  CouncilConfig,
  PerspectiveRole,
  DeliberationStatus,
  QuorumTallyResult,
} from './types.js';
import { IEvaluator } from './evaluators/base_evaluator.js';
import { StrategicPlannerEvaluator } from './evaluators/strategic_planner.js';
import { SecurityVerifierEvaluator } from './evaluators/security_verifier.js';
import { PerformanceAuditorEvaluator } from './evaluators/performance_auditor.js';
import { ArchitectureCriticEvaluator } from './evaluators/architecture_critic.js';
import { VotingEngine, DEFAULT_VOTING_WEIGHTS, DEFAULT_QUORUM_THRESHOLDS } from './voting_engine.js';
import { DeadlockArbitrator } from './deadlock_arbitrator.js';
import { CouncilLedger, ICouncilLedger } from './ledger.js';
import { CryptoSigner } from './crypto_signer.js';

export interface ICouncilLedgerFallback {
  recordProposal(proposal: Proposal): Promise<void>;
  recordRound(round: DeliberationRoundRecord): Promise<void>;
  recordCertificate(cert: ConsensusCertificate): Promise<void>;
}

export interface ITelemetryBroadcasterFallback {
  emitConsensusStart(payload: any): void;
  emitVoteCast(payload: any): void;
  emitQuorumTally(payload: any): void;
  emitDeadlock(payload: any): void;
  emitResolution(payload: any): void;
}

export class CouncilOrchestrator {
  private evaluators: Map<PerspectiveRole, IEvaluator> = new Map();
  private votingEngine: VotingEngine;
  private deadlockArbitrator: DeadlockArbitrator;
  private ledger: ICouncilLedger | ICouncilLedgerFallback | null = null;
  private telemetry: ITelemetryBroadcasterFallback | null = null;
  private config: Required<CouncilConfig>;

  constructor(
    config: CouncilConfig = {},
    dependencies?: {
      evaluators?: IEvaluator[];
      votingEngine?: VotingEngine;
      deadlockArbitrator?: DeadlockArbitrator;
      ledger?: ICouncilLedger | ICouncilLedgerFallback;
      telemetry?: ITelemetryBroadcasterFallback;
    }
  ) {
    // 1. Resolve configuration with rigorous defaults
    this.config = {
      weights: {
        ...DEFAULT_VOTING_WEIGHTS,
        ...config.weights,
      },
      thresholds: {
        ...DEFAULT_QUORUM_THRESHOLDS,
        ...config.thresholds,
      },
      enableLedger: config.enableLedger ?? true,
      enableTelemetry: config.enableTelemetry ?? true,
      telemetryWsUrl: config.telemetryWsUrl || 'ws://127.0.0.1:4000/ws',
      ledgerConnectionString:
        config.ledgerConnectionString ||
        'postgresql://aeos_admin:aeos_secure_password_2026@localhost:5432/aeos_kernel',
      sqliteDbPath: config.sqliteDbPath || '.aeos/council_ledger.sqlite3',
      hmacSecret:
        config.hmacSecret || 'aeos_consensus_council_hmac_secret_2026',
      maxRounds: config.maxRounds ?? 3,
      evaluatorTimeoutMs: config.evaluatorTimeoutMs ?? 10000,
    };

    // 2. Initialize or inject voting engine and deadlock arbitrator
    this.votingEngine =
      dependencies?.votingEngine ||
      new VotingEngine({
        weights: this.config.weights,
        thresholds: this.config.thresholds,
      });

    this.deadlockArbitrator =
      dependencies?.deadlockArbitrator ||
      new DeadlockArbitrator({
        thresholds: this.config.thresholds,
        maxRefinementRounds: this.config.maxRounds,
      });

    // 3. Inject optional ledger and telemetry
    if (dependencies?.ledger) {
      this.ledger = dependencies.ledger;
    } else if (this.config.enableLedger) {
      this.ledger = new CouncilLedger({
        connectionString: this.config.ledgerConnectionString,
        sqliteDbPath: this.config.sqliteDbPath,
      });
    }
    if (dependencies?.telemetry) this.telemetry = dependencies.telemetry;

    // 4. Register provided or default evaluators
    if (dependencies?.evaluators && dependencies.evaluators.length > 0) {
      for (const ev of dependencies.evaluators) {
        this.registerEvaluator(ev);
      }
    } else {
      // Default 4 analytical perspectives
      this.registerEvaluator(
        new StrategicPlannerEvaluator({ hmacSecret: this.config.hmacSecret })
      );
      this.registerEvaluator(
        new SecurityVerifierEvaluator({ hmacSecret: this.config.hmacSecret })
      );
      this.registerEvaluator(
        new PerformanceAuditorEvaluator({ hmacSecret: this.config.hmacSecret })
      );
      this.registerEvaluator(
        new ArchitectureCriticEvaluator({ hmacSecret: this.config.hmacSecret })
      );
    }
  }

  /**
   * Register or replace a perspective evaluator in the council.
   */
  public registerEvaluator(evaluator: IEvaluator): void {
    if (!evaluator || !evaluator.role) {
      throw new Error('[CouncilOrchestrator] Cannot register invalid evaluator.');
    }
    this.evaluators.set(evaluator.role, evaluator);
  }

  /**
   * Get all currently registered evaluators.
   */
  public getRegisteredEvaluators(): IEvaluator[] {
    return Array.from(this.evaluators.values());
  }

  /**
   * Get currently active ledger instance.
   */
  public getLedger(): ICouncilLedger | ICouncilLedgerFallback | null {
    return this.ledger;
  }

  /**
   * Closes the active ledger connection.
   */
  public async closeLedger(): Promise<void> {
    if (this.ledger && typeof (this.ledger as any).close === 'function') {
      await (this.ledger as any).close();
    }
  }

  /**
   * Primary entry point: Deliberates over a submitted proposal.
   */
  public async deliberate(proposal: Proposal): Promise<DeliberationResult> {
    const startTime = Date.now();
    const deliberationId = crypto.randomUUID();

    // Step 1: Validate proposal and compute deterministic SHA-256 hash
    this.validateProposal(proposal);
    const proposalHash =
      proposal.proposalHash || this.computeHash(proposal.content);
    proposal.proposalHash = proposalHash;

    // Step 2: Enforce quorum prerequisite - minimum 3 distinct perspectives
    if (this.evaluators.size < 3) {
      throw new Error(
        `[CouncilOrchestrator] Council Quorum Violation: Minimum 3 distinct analytical perspectives required, only ${this.evaluators.size} registered.`
      );
    }

    // Step 3: Broadcast telemetry consensus_start
    this.emitTelemetry('consensus_start', {
      deliberationId,
      proposalId: proposal.id,
      proposalTitle: proposal.title,
      proposalType: proposal.type,
      proposalHash,
      evaluatorsCount: this.evaluators.size,
      evaluators: Array.from(this.evaluators.values()).map((e) => ({
        role: e.role,
        weight: e.weight,
      })),
      timestamp: new Date().toISOString(),
    });

    // Step 4: Persist initial proposal record into ledger
    if (this.config.enableLedger && this.ledger && typeof (this.ledger as any).initialize === 'function') {
      try {
        await (this.ledger as any).initialize();
      } catch (e: any) {
        console.warn('[CouncilOrchestrator] Ledger initialize warning:', e.message);
      }
    }
    await this.recordLedgerProposal(proposal);

    const roundHistory: DeliberationRoundRecord[] = [];
    let currentFeedback: string[] = [];
    let finalResult: DeliberationResult | null = null;

    // Step 5: Iterative Deliberation Rounds Loop (up to maxRounds)
    for (let round = 1; round <= this.config.maxRounds; round++) {
      const roundStartTime = Date.now();

      const context: DeliberationContext = {
        round,
        maxRounds: this.config.maxRounds,
        proposalId: proposal.id,
        proposalHash,
        previousRounds: roundHistory,
        accumulatedFeedback: currentFeedback,
        isRefinement: round > 1,
        environmentConstraints: proposal.metadata,
      };

      // 5.1 Concurrent evaluation dispatch
      const critiques = await this.dispatchEvaluations(proposal, context);

      // 5.2 Emit telemetry for each vote cast
      for (const critique of critiques) {
        this.emitTelemetry('council_vote_cast', {
          deliberationId,
          proposalId: proposal.id,
          roundNumber: round,
          agentId: critique.agentId,
          role: critique.role,
          score: critique.score,
          dimensionScores: critique.dimensionScores,
          approved: critique.approved,
          criticalFlawsCount: critique.criticalFlaws.length,
          signature: critique.signature,
          timestamp: critique.timestamp,
        });
      }

      // 5.3 Tally Quorum via VotingEngine
      const tally = this.votingEngine.tallyVotes(critiques, proposal, round);

      this.emitTelemetry('consensus_quorum_tally', {
        deliberationId,
        proposalId: proposal.id,
        roundNumber: round,
        compositeScore: tally.compositeScore,
        approvedCount: tally.approvedCount,
        rejectedCount: tally.rejectedCount,
        quorumAchieved: tally.quorumAchieved,
        vetoTriggered: tally.vetoTriggered,
        roundOutcome: tally.roundOutcome,
        timestamp: new Date().toISOString(),
      });

      // 5.4 Extract feedback & dissenting opinions
      const dissentingOpinions = tally.dissentingOpinions;
      const criticalFlaws = critiques.flatMap((c) => c.criticalFlaws);
      const recommendations = critiques.flatMap((c) => c.recommendations);
      const remediationFeedback = Array.from(
        new Set([...criticalFlaws, ...recommendations])
      );

      const roundRecord: DeliberationRoundRecord = {
        roundNumber: round,
        proposalId: proposal.id,
        proposalHash,
        critiques,
        compositeScore: tally.compositeScore,
        quorumAchieved: tally.quorumAchieved,
        status: tally.roundOutcome,
        vetoTriggered: tally.vetoTriggered,
        vetoReasons: tally.vetoReasons,
        dissentingOpinions,
        remediationFeedback,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - roundStartTime,
      };
      roundHistory.push(roundRecord);

      // Record round into ledger
      await this.recordLedgerRound(roundRecord);

      // 5.5 Case A: Quorum APPROVED
      if (tally.roundOutcome === 'APPROVED') {
        const certificate = this.votingEngine.generateCertificateData(
          proposal,
          tally,
          critiques,
          deliberationId,
          this.config.hmacSecret
        );

        await this.recordLedgerCertificate(certificate);

        this.emitTelemetry('consensus_resolution', {
          deliberationId,
          proposalId: proposal.id,
          proposalHash,
          status: 'APPROVED',
          compositeScore: tally.compositeScore,
          quorumAchieved: true,
          roundsTotal: round,
          certificateId: certificate.certificateId,
          certificateSignature: certificate.certificateSignature,
          timestamp: new Date().toISOString(),
        });

        finalResult = {
          deliberationId,
          proposalId: proposal.id,
          proposalHash,
          status: 'APPROVED',
          compositeScore: tally.compositeScore,
          quorumAchieved: true,
          rounds: round,
          critiques,
          dissentingOpinions,
          consensusCertificate: certificate,
          roundHistory,
          ledgerSaved: true,
          totalDurationMs: Date.now() - startTime,
        };
        break;
      }

      // 5.6 Case B: Check Deadlock Arbitrator
      const arbitration = this.deadlockArbitrator.arbitrate(
        proposal,
        critiques,
        tally,
        context
      );

      // If deadlock arbitration recommends refinement and rounds remain
      if (
        arbitration.shouldProceedToNextRound &&
        round < this.config.maxRounds
      ) {
        currentFeedback = arbitration.synthesizedRemediation;

        this.emitTelemetry('consensus_deadlock', {
          deliberationId,
          proposalId: proposal.id,
          roundNumber: round,
          compositeScore: tally.compositeScore,
          reasons:
            tally.vetoReasons.length > 0
              ? tally.vetoReasons
              : ['Quorum not achieved; split decision'],
          remediationPrompt: arbitration.synthesizedRemediation,
          nextRound: round + 1,
          timestamp: new Date().toISOString(),
        });

        // Loop to next round
        continue;
      }

      // 5.7 Case C: Secondary Arbitration or Final Rejection
      if (arbitration.action === 'SPLIT_DECISION_ARBITRATE') {
        // Conditional approval granted via secondary fallback arbitration
        const conditionalTally: QuorumTallyResult = {
          ...tally,
          roundOutcome: 'APPROVED',
          quorumAchieved: true,
        };
        const certificate = this.votingEngine.generateCertificateData(
          proposal,
          conditionalTally,
          critiques,
          deliberationId,
          this.config.hmacSecret
        );

        await this.recordLedgerCertificate(certificate);

        this.emitTelemetry('consensus_resolution', {
          deliberationId,
          proposalId: proposal.id,
          proposalHash,
          status: 'APPROVED',
          compositeScore: tally.compositeScore,
          quorumAchieved: true,
          roundsTotal: round,
          certificateId: certificate.certificateId,
          certificateSignature: certificate.certificateSignature,
          timestamp: new Date().toISOString(),
        });

        finalResult = {
          deliberationId,
          proposalId: proposal.id,
          proposalHash,
          status: 'APPROVED',
          compositeScore: tally.compositeScore,
          quorumAchieved: true,
          rounds: round,
          critiques,
          dissentingOpinions,
          remediationFeedback: arbitration.synthesizedRemediation,
          consensusCertificate: certificate,
          roundHistory,
          ledgerSaved: true,
          totalDurationMs: Date.now() - startTime,
        };
        break;
      }

      // Definitive REJECTION or DEADLOCK after max rounds
      const finalStatus: DeliberationStatus = tally.vetoTriggered
        ? 'REJECTED'
        : round >= this.config.maxRounds && !tally.quorumAchieved
        ? 'DEADLOCK'
        : 'REJECTED';

      this.emitTelemetry('consensus_resolution', {
        deliberationId,
        proposalId: proposal.id,
        proposalHash,
        status: finalStatus,
        compositeScore: tally.compositeScore,
        quorumAchieved: false,
        roundsTotal: round,
        remediationFeedback: arbitration.synthesizedRemediation,
        timestamp: new Date().toISOString(),
      });

      finalResult = {
        deliberationId,
        proposalId: proposal.id,
        proposalHash,
        status: finalStatus,
        compositeScore: tally.compositeScore,
        quorumAchieved: false,
        rounds: round,
        critiques,
        dissentingOpinions,
        remediationFeedback: arbitration.synthesizedRemediation,
        roundHistory,
        ledgerSaved: true,
        totalDurationMs: Date.now() - startTime,
      };
      break;
    }

    if (!finalResult) {
      throw new Error(
        '[CouncilOrchestrator] Invariant breach: deliberation loop exited without result.'
      );
    }

    return finalResult;
  }

  /**
   * Dispatches evaluations concurrently with timeout protection.
   */
  private async dispatchEvaluations(
    proposal: Proposal,
    context: DeliberationContext
  ): Promise<Critique[]> {
    const evaluators = Array.from(this.evaluators.values());
    const timeoutMs = this.config.evaluatorTimeoutMs;

    const evaluationPromises = evaluators.map(async (evaluator) => {
      let timeoutHandle: NodeJS.Timeout;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(
            new Error(
              `Evaluator [${evaluator.agentId}] timed out after ${timeoutMs}ms`
            )
          );
        }, timeoutMs);
      });

      try {
        const critique = await Promise.race([
          evaluator.evaluate(proposal, context),
          timeoutPromise,
        ]);
        clearTimeout(timeoutHandle!);
        return critique;
      } catch (err: any) {
        clearTimeout(timeoutHandle!);
        console.warn(
          `[CouncilOrchestrator] Evaluator ${evaluator.role} execution warning:`,
          err.message
        );
        return this.createFallbackCritique(evaluator, err.message);
      }
    });

    return Promise.all(evaluationPromises);
  }

  private computeHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  private validateProposal(proposal: Proposal): void {
    if (!proposal || !proposal.content || proposal.content.trim().length === 0) {
      throw new Error('[CouncilOrchestrator] Invalid proposal: empty content.');
    }
  }

  private createFallbackCritique(
    evaluator: IEvaluator,
    reason: string
  ): Critique {
    return {
      agentId: evaluator.agentId,
      role: evaluator.role,
      score: 0,
      dimensionScores: {},
      approved: false,
      criticalFlaws: [`Evaluator execution failure: ${reason}`],
      recommendations: ['Rerun evaluation or check evaluator dependencies.'],
      signature: 'fallback_error_sig',
      timestamp: new Date().toISOString(),
      rationale: `Execution failed: ${reason}`,
    };
  }

  private emitTelemetry(event: string, payload: any): void {
    if (!this.config.enableTelemetry || !this.telemetry) return;
    try {
      switch (event) {
        case 'consensus_start':
          this.telemetry.emitConsensusStart(payload);
          break;
        case 'council_vote_cast':
          this.telemetry.emitVoteCast(payload);
          break;
        case 'consensus_quorum_tally':
          this.telemetry.emitQuorumTally(payload);
          break;
        case 'consensus_deadlock':
          this.telemetry.emitDeadlock(payload);
          break;
        case 'consensus_resolution':
          this.telemetry.emitResolution(payload);
          break;
      }
    } catch (e: any) {
      console.warn(
        '[CouncilOrchestrator] Telemetry broadcast warning:',
        e.message
      );
    }
  }

  private async recordLedgerProposal(proposal: Proposal): Promise<void> {
    if (!this.config.enableLedger || !this.ledger) return;
    try {
      await this.ledger.recordProposal(proposal);
    } catch (e: any) {
      console.warn(
        '[CouncilOrchestrator] Ledger recordProposal warning:',
        e.message
      );
    }
  }

  private async recordLedgerRound(
    round: DeliberationRoundRecord
  ): Promise<void> {
    if (!this.config.enableLedger || !this.ledger) return;
    try {
      await this.ledger.recordRound(round);
    } catch (e: any) {
      console.warn(
        '[CouncilOrchestrator] Ledger recordRound warning:',
        e.message
      );
    }
  }

  private async recordLedgerCertificate(
    cert: ConsensusCertificate
  ): Promise<void> {
    if (!this.config.enableLedger || !this.ledger) return;
    try {
      await this.ledger.recordCertificate(cert);
    } catch (e: any) {
      console.warn(
        '[CouncilOrchestrator] Ledger recordCertificate warning:',
        e.message
      );
    }
  }
}
