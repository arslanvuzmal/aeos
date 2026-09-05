/**
-- ============================================================================
-- AEOS Consensus Council Dual-Persistence Ledger Engine
-- File: src/consensus/ledger.ts
-- Subsystem: Primary PostgreSQL 15 Persistence with Seamless SQLite Fallback (R2, R3)
-- ============================================================================
 */

import pg from 'pg';
const { Pool } = pg;
import {
  Proposal,
  Critique,
  ConsensusCertificate,
  DeliberationRoundRecord,
} from './types.js';
import { CryptoSigner, createPlanAttestation } from './crypto_signer.js';
import { SQLiteAdapter, DeliberationHistory } from './sqlite_adapter.js';

export type { DeliberationHistory } from './sqlite_adapter.js';

/**
 * Standard interface contract for Consensus Council persistence layer.
 */
export interface ICouncilLedger {
  initialize(): Promise<void>;
  recordProposal(proposal: Proposal, status?: string): Promise<void>;
  recordRound(round: DeliberationRoundRecord): Promise<void>;
  recordCertificate(cert: ConsensusCertificate): Promise<void>;
  getProposalHistory(proposalId: string): Promise<DeliberationHistory | null>;
  close(): Promise<void>;
}

export interface CouncilLedgerOptions {
  connectionString?: string;
  sqliteDbPath?: string;
  connectionTimeoutMillis?: number;
  enablePostgres?: boolean;
}

export class CouncilLedger implements ICouncilLedger {
  private pool: pg.Pool | null = null;
  private isPostgresConnected: boolean = false;
  private sqliteAdapter: SQLiteAdapter | null = null;
  private isInitialized: boolean = false;
  private options: Required<CouncilLedgerOptions>;

  constructor(options: CouncilLedgerOptions = {}) {
    this.options = {
      connectionString:
        options.connectionString ||
        'postgresql://aeos_admin:aeos_secure_password_2026@localhost:5432/aeos_kernel',
      sqliteDbPath: options.sqliteDbPath || '.aeos/council_ledger.sqlite3',
      connectionTimeoutMillis: options.connectionTimeoutMillis ?? 1500,
      enablePostgres: options.enablePostgres ?? true,
    };
  }

  /**
   * Initializes the persistence engine.
   * Attempts primary connection to containerized PostgreSQL 15.
   * If PostgreSQL is unavailable (e.g. Docker offline, network severed),
   * seamlessly falls back to the embedded SQLite adapter without throwing.
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    if (this.options.enablePostgres) {
      try {
        this.pool = new Pool({
          connectionString: this.options.connectionString,
          connectionTimeoutMillis: this.options.connectionTimeoutMillis,
        });

        // Test connectivity with a fast query
        const client = await this.pool.connect();
        try {
          await client.query(`
            CREATE TABLE IF NOT EXISTS council_proposals (
              id VARCHAR(128) PRIMARY KEY,
              title VARCHAR(255) NOT NULL,
              proposal_type VARCHAR(50) NOT NULL,
              content TEXT NOT NULL,
              author VARCHAR(100) NOT NULL,
              metadata JSONB,
              proposal_hash CHAR(64) NOT NULL,
              status VARCHAR(50) NOT NULL DEFAULT 'pending',
              created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
              resolved_at TIMESTAMP WITH TIME ZONE
            );
          `);

          await client.query(`
            CREATE TABLE IF NOT EXISTS council_rounds (
              id VARCHAR(128) PRIMARY KEY,
              proposal_id VARCHAR(128) NOT NULL REFERENCES council_proposals(id) ON DELETE CASCADE,
              round_number INT NOT NULL DEFAULT 1,
              quorum_threshold NUMERIC(4, 2) NOT NULL DEFAULT 0.75,
              total_eligible_voters INT NOT NULL DEFAULT 4,
              votes_approve INT NOT NULL DEFAULT 0,
              votes_reject INT NOT NULL DEFAULT 0,
              votes_abstain INT NOT NULL DEFAULT 0,
              weighted_score NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
              quorum_achieved BOOLEAN NOT NULL DEFAULT FALSE,
              resolution_status VARCHAR(50) NOT NULL,
              transcript JSONB NOT NULL,
              created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
          `);

          await client.query(`
            CREATE TABLE IF NOT EXISTS council_critiques (
              id VARCHAR(128) PRIMARY KEY,
              round_id VARCHAR(128) NOT NULL REFERENCES council_rounds(id) ON DELETE CASCADE,
              agent_name VARCHAR(100) NOT NULL,
              perspective_role VARCHAR(100) NOT NULL,
              score NUMERIC(5, 2) NOT NULL,
              dimension_scores JSONB NOT NULL,
              approved BOOLEAN NOT NULL,
              critical_flaws JSONB,
              recommendations JSONB,
              signature CHAR(64) NOT NULL,
              created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
          `);

          await client.query(`
            CREATE TABLE IF NOT EXISTS consensus_certificates (
              certificate_id VARCHAR(128) PRIMARY KEY,
              proposal_id VARCHAR(128) NOT NULL REFERENCES council_proposals(id) ON DELETE CASCADE,
              round_id VARCHAR(128) REFERENCES council_rounds(id) ON DELETE CASCADE,
              decision VARCHAR(50) NOT NULL,
              composite_score NUMERIC(5, 2) NOT NULL,
              quorum_achieved BOOLEAN NOT NULL DEFAULT TRUE,
              quorum_ratio NUMERIC(4, 2) DEFAULT 1.00,
              dimension_averages JSONB,
              participating_agents JSONB,
              transcript_hash CHAR(64) NOT NULL,
              previous_certificate_hash CHAR(64),
              certificate_signature CHAR(64) NOT NULL,
              is_valid BOOLEAN NOT NULL DEFAULT TRUE,
              created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
          `);

          this.isPostgresConnected = true;
        } finally {
          client.release();
        }
      } catch (err: any) {
        this.isPostgresConnected = false;
        if (this.pool) {
          try {
            await this.pool.end();
          } catch {
            // ignore
          }
          this.pool = null;
        }
        console.warn(
          `[CouncilLedger] PostgreSQL unreachable (${err.message}). Seamlessly falling back to local SQLite ledger.`
        );
        await this.ensureSqliteFallback();
      }
    } else {
      await this.ensureSqliteFallback();
    }

    this.isInitialized = true;
  }

  /**
   * Persists a submitted proposal.
   */
  public async recordProposal(proposal: Proposal, status: string = 'pending'): Promise<void> {
    await this.ensureInitialized();
    const hash = proposal.proposalHash || CryptoSigner.hashProposal(proposal);
    const metadataVal = proposal.metadata ? JSON.stringify(proposal.metadata) : null;

    if (this.isPostgresConnected && this.pool) {
      try {
        await this.pool.query(
          `INSERT INTO council_proposals (id, title, proposal_type, content, author, metadata, proposal_hash, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO UPDATE SET
             title = EXCLUDED.title,
             proposal_type = EXCLUDED.proposal_type,
             content = EXCLUDED.content,
             author = EXCLUDED.author,
             metadata = EXCLUDED.metadata,
             proposal_hash = EXCLUDED.proposal_hash,
             status = EXCLUDED.status`,
          [
            proposal.id,
            proposal.title,
            proposal.type,
            proposal.content,
            proposal.author,
            metadataVal,
            hash,
            status,
          ]
        );
        return;
      } catch (err: any) {
        console.warn(`[CouncilLedger] PostgreSQL query failed (${err.message}). Falling back to SQLite.`);
        this.isPostgresConnected = false;
        await this.ensureSqliteFallback();
      }
    }

    await this.ensureSqliteFallback();
    await this.sqliteAdapter!.recordProposal(proposal, status);
  }

  /**
   * Persists a deliberation round and its debate transcript.
   */
  public async recordRound(round: DeliberationRoundRecord): Promise<void> {
    await this.ensureInitialized();
    const roundId = round.id || `round_${round.proposalId}_${round.roundNumber}`;
    const transcriptObj = round.transcript || {
      critiques: round.critiques,
      compositeScore: round.compositeScore,
      vetoReasons: round.vetoReasons,
      dissentingOpinions: round.dissentingOpinions,
    };
    const transcriptJson = JSON.stringify(transcriptObj);
    const weightedScore = round.weightedScore ?? round.compositeScore ?? 0.0;
    const resolutionStatus = round.resolutionStatus || round.status || 'pending';
    const totalEligible = round.critiques?.length || 4;
    const votesApprove = round.votesApprove ?? (round.critiques ? round.critiques.filter((c) => c.approved).length : 0);
    const votesReject = round.votesReject ?? (round.critiques ? round.critiques.filter((c) => !c.approved).length : 0);
    const votesAbstain = round.votesAbstain ?? 0;

    if (this.isPostgresConnected && this.pool) {
      try {
        await this.pool.query(
          `INSERT INTO council_rounds (
             id, proposal_id, round_number, quorum_threshold, total_eligible_voters,
             votes_approve, votes_reject, votes_abstain, weighted_score, quorum_achieved,
             resolution_status, transcript
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (id) DO UPDATE SET
             votes_approve = EXCLUDED.votes_approve,
             votes_reject = EXCLUDED.votes_reject,
             weighted_score = EXCLUDED.weighted_score,
             quorum_achieved = EXCLUDED.quorum_achieved,
             resolution_status = EXCLUDED.resolution_status,
             transcript = EXCLUDED.transcript`,
          [
            roundId,
            round.proposalId,
            round.roundNumber,
            round.quorumThreshold ?? 0.75,
            totalEligible,
            votesApprove,
            votesReject,
            votesAbstain,
            weightedScore,
            round.quorumAchieved,
            resolutionStatus,
            transcriptJson,
          ]
        );

        if (round.critiques && round.critiques.length > 0) {
          for (const c of round.critiques) {
            await this.recordCritique(roundId, c);
          }
        }
        return;
      } catch (err: any) {
        console.warn(`[CouncilLedger] PostgreSQL query failed (${err.message}). Falling back to SQLite.`);
        this.isPostgresConnected = false;
        await this.ensureSqliteFallback();
      }
    }

    await this.ensureSqliteFallback();
    await this.sqliteAdapter!.recordRound(round);
  }

  /**
   * Persists an individual critique.
   */
  public async recordCritique(roundId: string, critique: Critique): Promise<void> {
    await this.ensureInitialized();
    const critiqueId = `crit_${roundId}_${critique.role}`;

    if (this.isPostgresConnected && this.pool) {
      try {
        await this.pool.query(
          `INSERT INTO council_critiques (
             id, round_id, agent_name, perspective_role, score, dimension_scores,
             approved, critical_flaws, recommendations, signature
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (id) DO UPDATE SET
             score = EXCLUDED.score,
             dimension_scores = EXCLUDED.dimension_scores,
             approved = EXCLUDED.approved,
             critical_flaws = EXCLUDED.critical_flaws,
             recommendations = EXCLUDED.recommendations,
             signature = EXCLUDED.signature`,
          [
            critiqueId,
            roundId,
            critique.agentId,
            critique.role,
            critique.score,
            JSON.stringify(critique.dimensionScores || {}),
            critique.approved,
            JSON.stringify(critique.criticalFlaws || []),
            JSON.stringify(critique.recommendations || []),
            critique.signature,
          ]
        );
        return;
      } catch (err: any) {
        console.warn(`[CouncilLedger] PostgreSQL critique insert failed (${err.message}). Falling back.`);
        this.isPostgresConnected = false;
        await this.ensureSqliteFallback();
      }
    }

    await this.ensureSqliteFallback();
    await this.sqliteAdapter!.recordCritique(roundId, critique);
  }

  /**
   * Persists an issued ConsensusCertificate.
   */
  public async recordCertificate(cert: ConsensusCertificate): Promise<void> {
    await this.ensureInitialized();
    const roundId = cert.roundId || 'round_1';

    if (this.isPostgresConnected && this.pool) {
      try {
        await this.pool.query(
          `INSERT INTO consensus_certificates (
             certificate_id, proposal_id, round_id, decision, composite_score,
             quorum_achieved, quorum_ratio, dimension_averages, participating_agents,
             transcript_hash, previous_certificate_hash, certificate_signature, is_valid
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           ON CONFLICT (certificate_id) DO UPDATE SET
             decision = EXCLUDED.decision,
             composite_score = EXCLUDED.composite_score,
             certificate_signature = EXCLUDED.certificate_signature,
             is_valid = EXCLUDED.is_valid`,
          [
            cert.certificateId,
            cert.proposalId,
            roundId,
            cert.decision,
            cert.compositeScore,
            cert.quorumAchieved !== false,
            cert.quorumRatio ?? 1.0,
            cert.dimensionAverages ? JSON.stringify(cert.dimensionAverages) : null,
            cert.participatingAgents ? JSON.stringify(cert.participatingAgents) : null,
            cert.transcriptHash,
            cert.previousCertificateHash || null,
            cert.certificateSignature,
            true,
          ]
        );

        // Optional cross-attestation insert into plan_attestations for backwards compatibility
        try {
          const attestation = createPlanAttestation(cert);
          await this.pool.query(
            `INSERT INTO plan_attestations (id, sha256_hash, attested_by, is_valid)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT DO NOTHING`,
            [attestation.id, attestation.sha256Hash, attestation.attestedBy, attestation.isValid]
          );
        } catch {
          // plan_attestations may not exist or require project_id FK; silent ignore
        }

        return;
      } catch (err: any) {
        console.warn(`[CouncilLedger] PostgreSQL certificate insert failed (${err.message}). Falling back.`);
        this.isPostgresConnected = false;
        await this.ensureSqliteFallback();
      }
    }

    await this.ensureSqliteFallback();
    await this.sqliteAdapter!.recordCertificate(cert);
  }

  /**
   * Retrieves a proposal from the ledger.
   */
  public async getProposal(id: string): Promise<any> {
    await this.ensureInitialized();
    if (this.isPostgresConnected && this.pool) {
      try {
        const res = await this.pool.query('SELECT * FROM council_proposals WHERE id = $1', [id]);
        return res.rows[0] || null;
      } catch (err: any) {
        console.warn(`[CouncilLedger] PostgreSQL getProposal failed (${err.message}). Falling back.`);
        this.isPostgresConnected = false;
        await this.ensureSqliteFallback();
      }
    }

    await this.ensureSqliteFallback();
    return this.sqliteAdapter!.getProposal(id);
  }

  /**
   * Retrieves a consensus certificate from the ledger.
   */
  public async getCertificate(certId: string): Promise<any> {
    await this.ensureInitialized();
    if (this.isPostgresConnected && this.pool) {
      try {
        const res = await this.pool.query(
          'SELECT * FROM consensus_certificates WHERE certificate_id = $1',
          [certId]
        );
        return res.rows[0] || null;
      } catch (err: any) {
        console.warn(`[CouncilLedger] PostgreSQL getCertificate failed (${err.message}). Falling back.`);
        this.isPostgresConnected = false;
        await this.ensureSqliteFallback();
      }
    }

    await this.ensureSqliteFallback();
    return this.sqliteAdapter!.getCertificate(certId);
  }

  /**
   * Retrieves the full deliberation history for a proposal.
   */
  public async getProposalHistory(proposalId: string): Promise<DeliberationHistory | null> {
    await this.ensureInitialized();
    if (this.isPostgresConnected && this.pool) {
      try {
        const propRes = await this.pool.query('SELECT * FROM council_proposals WHERE id = $1', [proposalId]);
        if (!propRes.rows || propRes.rows.length === 0) {
          return null;
        }
        const pRow = propRes.rows[0];
        const proposal: Proposal = {
          id: pRow.id,
          title: pRow.title,
          type: pRow.proposal_type,
          content: pRow.content,
          author: pRow.author,
          proposalHash: pRow.proposal_hash,
          timestamp: pRow.created_at?.toISOString() || new Date().toISOString(),
          metadata: pRow.metadata,
        };

        const roundsRes = await this.pool.query(
          'SELECT * FROM council_rounds WHERE proposal_id = $1 ORDER BY round_number ASC',
          [proposalId]
        );

        const allCritiques: Critique[] = [];
        const rounds: DeliberationRoundRecord[] = [];

        for (const rRow of roundsRes.rows) {
          const critRes = await this.pool.query(
            'SELECT * FROM council_critiques WHERE round_id = $1 ORDER BY created_at ASC',
            [rRow.id]
          );

          const roundCritiques: Critique[] = critRes.rows.map((c: any) => ({
            agentId: c.agent_name,
            role: c.perspective_role,
            score: Number(c.score),
            dimensionScores: c.dimension_scores || {},
            approved: Boolean(c.approved),
            criticalFlaws: c.critical_flaws || [],
            recommendations: c.recommendations || [],
            signature: c.signature,
            timestamp: c.created_at?.toISOString() || new Date().toISOString(),
          }));

          allCritiques.push(...roundCritiques);

          rounds.push({
            id: rRow.id,
            proposalId: rRow.proposal_id,
            proposalHash: proposal.proposalHash || '',
            roundNumber: rRow.round_number,
            quorumThreshold: Number(rRow.quorum_threshold),
            votesApprove: rRow.votes_approve,
            votesReject: rRow.votes_reject,
            votesAbstain: rRow.votes_abstain,
            weightedScore: Number(rRow.weighted_score),
            compositeScore: Number(rRow.weighted_score),
            quorumAchieved: Boolean(rRow.quorum_achieved),
            status: rRow.resolution_status,
            resolutionStatus: rRow.resolution_status,
            transcript: rRow.transcript || {},
            critiques: roundCritiques,
            vetoTriggered: false,
            vetoReasons: [],
            dissentingOpinions: [],
            remediationFeedback: [],
            timestamp: rRow.created_at?.toISOString() || new Date().toISOString(),
            createdAt: rRow.created_at?.toISOString() || new Date().toISOString(),
          });
        }

        const certRes = await this.pool.query(
          'SELECT * FROM consensus_certificates WHERE proposal_id = $1 ORDER BY created_at DESC LIMIT 1',
          [proposalId]
        );

        let certificate: ConsensusCertificate | null = null;
        if (certRes.rows && certRes.rows.length > 0) {
          const cRow = certRes.rows[0];
          certificate = {
            certificateId: cRow.certificate_id,
            proposalId: cRow.proposal_id,
            roundId: cRow.round_id,
            decision: cRow.decision,
            compositeScore: Number(cRow.composite_score),
            quorumAchieved: Boolean(cRow.quorum_achieved),
            quorumRatio: Number(cRow.quorum_ratio),
            dimensionAverages: cRow.dimension_averages,
            participatingAgents: cRow.participating_agents,
            transcriptHash: cRow.transcript_hash,
            previousCertificateHash: cRow.previous_certificate_hash || undefined,
            certificateSignature: cRow.certificate_signature,
            timestamp: cRow.created_at?.toISOString() || new Date().toISOString(),
            issuedAt: cRow.created_at?.toISOString() || new Date().toISOString(),
            proposalHash: proposal.proposalHash || '',
          };
        }

        return {
          proposal,
          rounds,
          critiques: allCritiques,
          certificate,
        };
      } catch (err: any) {
        console.warn(`[CouncilLedger] PostgreSQL getProposalHistory failed (${err.message}). Falling back.`);
        this.isPostgresConnected = false;
        await this.ensureSqliteFallback();
      }
    }

    await this.ensureSqliteFallback();
    return this.sqliteAdapter!.getProposalHistory(proposalId);
  }

  /**
   * Closes connections to both PostgreSQL and SQLite.
   */
  public async close(): Promise<void> {
    if (this.pool) {
      try {
        await this.pool.end();
      } catch {
        // ignore
      }
      this.pool = null;
      this.isPostgresConnected = false;
    }
    if (this.sqliteAdapter) {
      await this.sqliteAdapter.close();
      this.sqliteAdapter = null;
    }
    this.isInitialized = false;
  }

  /**
   * Returns current active persistence mode.
   */
  public getStorageMode(): 'postgres' | 'sqlite' {
    return this.isPostgresConnected ? 'postgres' : 'sqlite';
  }

  /**
   * Returns whether SQLite fallback is currently active.
   */
  public isFallbackActive(): boolean {
    return !this.isPostgresConnected;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  private async ensureSqliteFallback(): Promise<void> {
    if (!this.sqliteAdapter) {
      this.sqliteAdapter = new SQLiteAdapter(this.options.sqliteDbPath);
      await this.sqliteAdapter.initialize();
    }
  }
}

// Alias for backwards compatibility
export const PostgresConsensusLedger = CouncilLedger;
