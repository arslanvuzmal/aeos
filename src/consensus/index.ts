/**
 * AEOS Consensus Council Subsystem
 * Public Module Barrel Export
 */

export type {
  PerspectiveRole,
  ProposalType,
  DeliberationStatus,
  Proposal,
  Critique,
  DeliberationContext,
  VotingWeights,
  QuorumThresholds,
  QuorumTallyResult,
  SignatoryAgent,
  ConsensusCertificate,
  DeliberationRoundRecord,
  DeliberationResult,
  ArbitrationAction,
  ArbitrationDecision,
  TelemetryEventType,
  BaseTelemetryEvent,
  ConsensusStartPayload,
  VoteCastPayload,
  QuorumTallyPayload,
  DeadlockPayload,
  ResolutionPayload,
  CouncilConfig,
} from './types.js';

export {
  IEvaluator,
  BaseEvaluator,
} from './evaluators/base_evaluator.js';

export {
  StrategicPlannerEvaluator,
} from './evaluators/strategic_planner.js';

export {
  SecurityVerifierEvaluator,
  SECURITY_RULES,
  SecurityRule,
} from './evaluators/security_verifier.js';

export {
  PerformanceAuditorEvaluator,
} from './evaluators/performance_auditor.js';

export {
  ArchitectureCriticEvaluator,
} from './evaluators/architecture_critic.js';

export {
  VotingEngine,
  DEFAULT_VOTING_WEIGHTS,
  DEFAULT_QUORUM_THRESHOLDS,
} from './voting_engine.js';

export {
  DeadlockArbitrator,
  DeadlockDiagnosis,
} from './deadlock_arbitrator.js';

export {
  CouncilOrchestrator,
  ICouncilLedgerFallback,
  ITelemetryBroadcasterFallback,
} from './council_orchestrator.js';

export {
  CryptoSigner,
  ConsensusCrypto,
  canonicalizeJson,
  canonicalJson,
  sha256,
  hmacSha256,
  verifyConstantTime,
  verifyHmacSha256,
  hashProposal,
  hashTranscript,
  computeTranscriptHash,
  signCritique,
  signCertificate,
  verifyCertificate,
  createPlanAttestation,
} from './crypto_signer.js';
export type { PlanAttestationRecord } from './crypto_signer.js';

export {
  SQLiteAdapter,
  SqliteConsensusLedger,
} from './sqlite_adapter.js';
export type { DeliberationHistory } from './sqlite_adapter.js';

export {
  CouncilLedger,
  PostgresConsensusLedger,
} from './ledger.js';
export type {
  ICouncilLedger,
  CouncilLedgerOptions,
} from './ledger.js';

export {
  ConsensusTelemetryStreamer,
} from './telemetry.js';
export type { TelemetryConfig } from './telemetry.js';

