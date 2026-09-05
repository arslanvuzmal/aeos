/**
 * AEOS Consensus Council Core Types & Interface Specifications
 * Strict NodeNext ESM module definitions
 */

/**
 * Analytical perspective roles participating in council deliberation.
 * Extensible for future specialized evaluators.
 */
export type PerspectiveRole =
  | 'strategic_planning'
  | 'security_verification'
  | 'performance_audit'
  | 'software_architecture';

/**
 * Types of artifacts subject to council review.
 */
export type ProposalType =
  | 'task_plan'
  | 'code_verification'
  | 'architecture_rfc'
  | 'security_audit';

/**
 * Deliberation resolution status.
 */
export type DeliberationStatus = 'APPROVED' | 'REJECTED' | 'DEADLOCK';

/**
 * Input proposal submitted to the consensus council.
 */
export interface Proposal {
  /** Unique proposal identifier */
  id: string;
  /** Human-readable title */
  title: string;
  /** Category of artifact */
  type: ProposalType;
  /** Full content text (markdown plan, code snippet, diff, JSON) */
  content: string;
  /** Authoring agent or system */
  author: string;
  /** Metadata including file paths, sandbox outputs, execution constraints */
  metadata?: {
    filePath?: string;
    sandboxOutput?: string;
    sandboxExitCode?: number;
    memoryCapMb?: number;
    cpuCap?: number;
    networkSevered?: boolean;
    durationMs?: number;
    goal?: string;
    [key: string]: any;
  };
  /** ISO 8601 creation timestamp */
  timestamp: string;
  /** Optional pre-computed SHA-256 hash of content */
  proposalHash?: string;
}

/**
 * Individual analytical assessment produced by a perspective evaluator.
 */
export interface Critique {
  /** Identifier of the evaluator agent */
  agentId: string;
  /** The perspective role evaluated */
  role: PerspectiveRole;
  /** Overall normalized score [0 - 100] */
  score: number;
  /** Granular scoring breakdown across defined evaluation dimensions */
  dimensionScores: Record<string, number>;
  /** Binary approval vote */
  approved: boolean;
  /** Severe vulnerabilities, invariant violations, or fatal defects */
  criticalFlaws: string[];
  /** Concrete, actionable remediation instructions */
  recommendations: string[];
  /** Cryptographic signature over critique content (HMAC-SHA256) */
  signature: string;
  /** ISO 8601 timestamp of critique completion */
  timestamp: string;
  /** Textual rationale summarizing the evaluation */
  rationale?: string;
  /** Evaluation execution duration in milliseconds */
  executionDurationMs?: number;
}

/**
 * Context passed to evaluators during a deliberation round.
 */
export interface DeliberationContext {
  /** Current round number (1-indexed) */
  round: number;
  /** Maximum allowable rounds before terminating */
  maxRounds: number;
  /** Proposal identifier under review */
  proposalId: string;
  /** SHA-256 hash of proposal */
  proposalHash: string;
  /** History of prior rounds in this deliberation session */
  previousRounds?: DeliberationRoundRecord[];
  /** Synthesized remediation guidance from previous rounds */
  accumulatedFeedback?: string[];
  /** Flag indicating this is an iterative refinement round */
  isRefinement?: boolean;
  /** Environment sandbox constraints and flags */
  environmentConstraints?: {
    maxMemoryMb?: number;
    cpuLimit?: number;
    networkSevered?: boolean;
    timeoutMs?: number;
    [key: string]: any;
  };
}

/**
 * Weighted distribution across analytical perspectives.
 */
export interface VotingWeights {
  security_verification: number; // Default: 0.35
  software_architecture: number; // Default: 0.25
  performance_audit: number;     // Default: 0.20
  strategic_planning: number;    // Default: 0.20
}

/**
 * Configurable thresholds for consensus, vetoes, and deadlocks.
 */
export interface QuorumThresholds {
  /** Minimum weighted composite score required for approval (default: 75.0) */
  minCompositeScore: number;
  /** Minimum fraction of members approving (default: 0.75) */
  minApprovalFraction: number;
  /** Security score threshold below which automatic veto is triggered (default: 70.0) */
  securityVetoMinScore: number;
  /** Architecture score threshold below which veto is triggered (default: 60.0) */
  architectureVetoMinScore: number;
  /** Score window [min, max] where borderline decision triggers deadlock (default: [65, 74.99]) */
  deadlockScoreWindow: {
    min: number;
    max: number;
  };
  /** Maximum refinement cycles before forcing resolution (default: 3) */
  maxRefinementRounds: number;
}

/**
 * Result of quorum tally computed by VotingEngine.
 */
export interface QuorumTallyResult {
  /** Number of members approving */
  approvedCount: number;
  /** Number of members rejecting */
  rejectedCount: number;
  /** Total active members voting */
  totalEligible: number;
  /** Whether the approval vote fraction met minApprovalFraction */
  quorumAchieved: boolean;
  /** Computed weighted composite score [0 - 100] */
  compositeScore: number;
  /** Whether composite score meets minCompositeScore */
  thresholdMet: boolean;
  /** Whether a veto was triggered by security or architecture */
  vetoTriggered: boolean;
  /** Explanations of why veto occurred */
  vetoReasons: string[];
  /** Roles that rejected or dissented */
  dissentingRoles: PerspectiveRole[];
  /** Dissenting rationales and critical flaws */
  dissentingOpinions: string[];
  /** Overall round outcome */
  roundOutcome: DeliberationStatus;
}

/**
 * Attesting signature record from an individual council member.
 */
export interface SignatoryAgent {
  agentId: string;
  role: PerspectiveRole;
  score: number;
  signature: string;
}

/**
 * Deterministic consensus certificate generated upon council approval.
 */
export interface ConsensusCertificate {
  /** Unique certificate ID */
  certificateId: string;
  /** Target proposal ID */
  proposalId: string;
  /** SHA-256 hash of the evaluated proposal content */
  proposalHash: string;
  /** Deliberation session ID */
  deliberationId?: string;
  /** Round identifier */
  roundId?: string;
  /** Final council decision */
  decision: 'APPROVED' | 'REJECTED' | 'CONSENSUS_APPROVED' | 'CONSENSUS_REJECTED';
  /** Final weighted composite score */
  compositeScore: number;
  /** Whether quorum was achieved */
  quorumAchieved?: boolean;
  /** Ratio of approvals */
  quorumRatio?: number;
  /** Quorum vote summary */
  quorumVotes?: {
    approved: number;
    rejected: number;
    total: number;
  };
  /** Participating agent identifiers */
  participatingAgents?: string[];
  /** Averages by dimension */
  dimensionAverages?: Record<string, number>;
  /** List of member signatures */
  signatoryAgents?: SignatoryAgent[];
  /** SHA-256 hash of all round transcripts and critiques */
  transcriptHash: string;
  /** HMAC-SHA256 signature sealing the certificate data */
  certificateSignature: string;
  /** ISO 8601 issuance timestamp */
  issuedAt?: string;
  /** ISO 8601 timestamp alias */
  timestamp?: string;
  /** Cryptographic nonce preventing replay attacks */
  nonce?: string;
  /** Hash linking to previous certificate in chain */
  previousCertificateHash?: string;
  /** Optional transaction hash or ID in PostgreSQL ledger */
  ledgerTransactionId?: string;
}

/**
 * Record of a single deliberation round.
 */
export interface DeliberationRoundRecord {
  id?: string;
  roundNumber: number;
  proposalId: string;
  proposalHash: string;
  critiques: Critique[];
  compositeScore: number;
  quorumAchieved: boolean;
  status: DeliberationStatus;
  vetoTriggered: boolean;
  vetoReasons: string[];
  dissentingOpinions: string[];
  remediationFeedback: string[];
  timestamp: string;
  durationMs?: number;
  quorumThreshold?: number;
  votesApprove?: number;
  votesReject?: number;
  votesAbstain?: number;
  weightedScore?: number;
  resolutionStatus?: string;
  transcript?: any;
  createdAt?: string;
}

/**
 * Complete deliberation outcome returned by CouncilOrchestrator.deliberate().
 */
export interface DeliberationResult {
  /** Deliberation session identifier */
  deliberationId: string;
  /** Target proposal ID */
  proposalId: string;
  /** SHA-256 hash of proposal content */
  proposalHash: string;
  /** Final council resolution */
  status: DeliberationStatus;
  /** Final weighted composite score */
  compositeScore: number;
  /** Whether quorum was achieved */
  quorumAchieved: boolean;
  /** Number of rounds executed */
  rounds: number;
  /** Final round member critiques */
  critiques: Critique[];
  /** Aggregated dissenting opinions */
  dissentingOpinions: string[];
  /** Structured remediation feedback for rejected/deadlocked proposals */
  remediationFeedback?: string[];
  /** Cryptographic consensus certificate (present on APPROVED) */
  consensusCertificate?: ConsensusCertificate;
  /** Complete round-by-round history */
  roundHistory?: DeliberationRoundRecord[];
  /** Whether records were successfully persisted to DB ledger */
  ledgerSaved?: boolean;
  /** Total elapsed time in milliseconds */
  totalDurationMs?: number;
}

/**
 * Action decided by the DeadlockArbitrator.
 */
export type ArbitrationAction =
  | 'REQUEST_REFINEMENT'
  | 'SPLIT_DECISION_ARBITRATE'
  | 'UNRESOLVABLE_DEADLOCK';

/**
 * Detailed arbitration decision.
 */
export interface ArbitrationDecision {
  action: ArbitrationAction;
  /** Synthesized remediation checklist for the proposal author */
  synthesizedRemediation: string[];
  /** Role-specific feedback directives */
  targetedGuidance: Partial<Record<PerspectiveRole, string[]>>;
  /** Optional tie-breaker evaluation */
  tieBreakerVote?: {
    role: PerspectiveRole;
    overrideScore: number;
    rationale: string;
  };
  /** Whether orchestrator should proceed to an iterative round */
  shouldProceedToNextRound: boolean;
}

/**
 * Telemetry event types emitted to dashboard.
 */
export type TelemetryEventType =
  | 'consensus_start'
  | 'council_vote_cast'
  | 'consensus_quorum_tally'
  | 'consensus_deadlock'
  | 'consensus_refinement_round'
  | 'consensus_resolution';

export interface BaseTelemetryEvent {
  event: TelemetryEventType;
  deliberationId: string;
  proposalId: string;
  timestamp: string;
}

export interface ConsensusStartPayload extends BaseTelemetryEvent {
  event: 'consensus_start';
  proposalTitle: string;
  proposalType: ProposalType;
  proposalHash: string;
  evaluatorsCount: number;
  evaluators: Array<{ role: PerspectiveRole; weight: number }>;
}

export interface VoteCastPayload extends BaseTelemetryEvent {
  event: 'council_vote_cast';
  roundNumber: number;
  agentId: string;
  role: PerspectiveRole;
  score: number;
  dimensionScores: Record<string, number>;
  approved: boolean;
  criticalFlawsCount: number;
  signature: string;
}

export interface QuorumTallyPayload extends BaseTelemetryEvent {
  event: 'consensus_quorum_tally';
  roundNumber: number;
  compositeScore: number;
  approvedCount: number;
  rejectedCount: number;
  quorumAchieved: boolean;
  vetoTriggered: boolean;
  roundOutcome: DeliberationStatus;
}

export interface DeadlockPayload extends BaseTelemetryEvent {
  event: 'consensus_deadlock';
  roundNumber: number;
  compositeScore: number;
  reasons: string[];
  remediationPrompt: string[];
  nextRound: number;
}

export interface ResolutionPayload extends BaseTelemetryEvent {
  event: 'consensus_resolution';
  proposalHash: string;
  status: DeliberationStatus;
  compositeScore: number;
  quorumAchieved: boolean;
  roundsTotal: number;
  certificateId?: string;
  certificateSignature?: string;
  remediationFeedback?: string[];
}

/**
 * Configuration options for CouncilOrchestrator.
 */
export interface CouncilConfig {
  /** Custom weights across perspectives */
  weights?: Partial<VotingWeights>;
  /** Custom thresholds */
  thresholds?: Partial<QuorumThresholds>;
  /** Enable PostgreSQL/SQLite ledger recording (default: true) */
  enableLedger?: boolean;
  /** Enable WebSocket telemetry broadcasting (default: true) */
  enableTelemetry?: boolean;
  /** WebSocket server endpoint (default: 'ws://127.0.0.1:4000/ws') */
  telemetryWsUrl?: string;
  /** PostgreSQL connection string */
  ledgerConnectionString?: string;
  /** Local SQLite fallback file path */
  sqliteDbPath?: string;
  /** HMAC secret key for attestation signing */
  hmacSecret?: string;
  /** Maximum deliberation rounds (default: 3) */
  maxRounds?: number;
  /** Per-evaluator timeout in ms (default: 10000ms) */
  evaluatorTimeoutMs?: number;
}
