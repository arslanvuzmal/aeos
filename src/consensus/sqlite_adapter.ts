/**
-- ============================================================================
-- AEOS Consensus Council SQLite Local Ledger Adapter
-- File: src/consensus/sqlite_adapter.ts
-- Subsystem: Embedded Zero-Cloud Offline Transaction Ledger (R3)
-- ============================================================================
 */

import * as fs from 'fs';
import * as path from 'path';
import sqlite3 from 'sqlite3';
import {
  Proposal,
  Critique,
  ConsensusCertificate,
  DeliberationRoundRecord,
} from './types.js';
import { CryptoSigner } from './crypto_signer.js';

export interface DeliberationHistory {
  proposal: Proposal;
  rounds: DeliberationRoundRecord[];
  critiques: Critique[];
  certificate: ConsensusCertificate | null;
}

export class SQLiteAdapter {
  private dbPath: string;
  private db: sqlite3.Database | null = null;
  private isInitialized: boolean = false;

  constructor(dbPath: string = '.aeos/council_ledger.sqlite3') {
    this.dbPath = dbPath;
  }

  /**
   * Initializes the SQLite database file and auto-creates all schema tables if not present.
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized && this.db) {
      return;
    }

    if (this.dbPath !== ':memory:') {
      const dir = path.dirname(path.resolve(this.dbPath));
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          return reject(
            new Error(`[SQLiteAdapter] Failed to open SQLite database at ${this.dbPath}: ${err.message}`)
          );
        }

        this.db!.serialize(() => {
          this.db!.run(`
            CREATE TABLE IF NOT EXISTS council_proposals (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              proposal_type TEXT NOT NULL,
              content TEXT NOT NULL,
              author TEXT NOT NULL,
              metadata TEXT,
              proposal_hash TEXT NOT NULL,
              status TEXT NOT NULL,
              created_at TEXT NOT NULL,
              resolved_at TEXT
            );
          `);

          this.db!.run(`
            CREATE TABLE IF NOT EXISTS council_rounds (
              id TEXT PRIMARY KEY,
              proposal_id TEXT NOT NULL,
              round_number INTEGER NOT NULL,
              quorum_threshold REAL NOT NULL DEFAULT 0.75,
              total_eligible_voters INTEGER NOT NULL DEFAULT 4,
              votes_approve INTEGER NOT NULL DEFAULT 0,
              votes_reject INTEGER NOT NULL DEFAULT 0,
              votes_abstain INTEGER NOT NULL DEFAULT 0,
              weighted_score REAL NOT NULL,
              quorum_achieved INTEGER NOT NULL,
              resolution_status TEXT NOT NULL,
              transcript TEXT NOT NULL,
              created_at TEXT NOT NULL,
              FOREIGN KEY (proposal_id) REFERENCES council_proposals(id) ON DELETE CASCADE
            );
          `);

          this.db!.run(`
            CREATE TABLE IF NOT EXISTS council_critiques (
              id TEXT PRIMARY KEY,
              round_id TEXT NOT NULL,
              agent_name TEXT NOT NULL,
              perspective_role TEXT NOT NULL,
              score REAL NOT NULL,
              dimension_scores TEXT NOT NULL,
              approved INTEGER NOT NULL,
              critical_flaws TEXT NOT NULL,
              recommendations TEXT,
              signature TEXT NOT NULL,
              created_at TEXT NOT NULL,
              FOREIGN KEY (round_id) REFERENCES council_rounds(id) ON DELETE CASCADE
            );
          `);

          this.db!.run(`
            CREATE TABLE IF NOT EXISTS consensus_certificates (
              certificate_id TEXT PRIMARY KEY,
              proposal_id TEXT NOT NULL,
              round_id TEXT,
              decision TEXT NOT NULL,
              composite_score REAL NOT NULL,
              quorum_achieved INTEGER NOT NULL DEFAULT 1,
              quorum_ratio REAL NOT NULL DEFAULT 1.0,
              dimension_averages TEXT,
              participating_agents TEXT,
              transcript_hash TEXT NOT NULL,
              previous_certificate_hash TEXT,
              certificate_signature TEXT NOT NULL,
              created_at TEXT NOT NULL,
              FOREIGN KEY (proposal_id) REFERENCES council_proposals(id) ON DELETE CASCADE
            );
          `, (tableErr) => {
            if (tableErr) {
              reject(
                new Error(`[SQLiteAdapter] Schema initialization failed: ${tableErr.message}`)
              );
            } else {
              this.isInitialized = true;
              resolve();
            }
          });
        });
      });
    });
  }

  /**
   * Records or updates a submitted proposal into the local ledger.
   */
  public async recordProposal(proposal: Proposal, status: string = 'pending'): Promise<void> {
    await this.ensureInitialized();
    const hash = proposal.proposalHash || CryptoSigner.hashProposal(proposal);
    const metadataStr = proposal.metadata ? JSON.stringify(proposal.metadata) : null;
    const createdAt = proposal.timestamp || new Date().toISOString();

    return new Promise((resolve, reject) => {
      this.db!.run(
        `INSERT OR REPLACE INTO council_proposals (id, title, proposal_type, content, author, metadata, proposal_hash, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          proposal.id,
          proposal.title,
          proposal.type,
          proposal.content,
          proposal.author,
          metadataStr,
          hash,
          status,
          createdAt,
        ],
        (err) => {
          if (err) reject(new Error(`[SQLiteAdapter] recordProposal error: ${err.message}`));
          else resolve();
        }
      );
    });
  }

  /**
   * Records a completed deliberation round and its debate transcript into the ledger.
   */
  public async recordRound(round: DeliberationRoundRecord): Promise<void> {
    await this.ensureInitialized();
    const roundId = round.id || `round_${round.proposalId}_${round.roundNumber}`;
    const transcriptStr = round.transcript
      ? typeof round.transcript === 'string'
        ? round.transcript
        : JSON.stringify(round.transcript)
      : JSON.stringify({
          critiques: round.critiques,
          compositeScore: round.compositeScore,
          vetoReasons: round.vetoReasons,
        });

    const createdAt = round.createdAt || round.timestamp || new Date().toISOString();
    const weightedScore = round.weightedScore ?? round.compositeScore ?? 0.0;
    const resolutionStatus = round.resolutionStatus || round.status || 'pending';

    return new Promise((resolve, reject) => {
      this.db!.run(
        `INSERT OR REPLACE INTO council_rounds (
           id, proposal_id, round_number, quorum_threshold, total_eligible_voters,
           votes_approve, votes_reject, votes_abstain, weighted_score, quorum_achieved,
           resolution_status, transcript, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          roundId,
          round.proposalId,
          round.roundNumber,
          round.quorumThreshold ?? 0.75,
          round.critiques?.length ?? 4,
          round.votesApprove ?? (round.critiques ? round.critiques.filter((c) => c.approved).length : 0),
          round.votesReject ?? (round.critiques ? round.critiques.filter((c) => !c.approved).length : 0),
          round.votesAbstain ?? 0,
          weightedScore,
          round.quorumAchieved ? 1 : 0,
          resolutionStatus,
          transcriptStr,
          createdAt,
        ],
        async (err) => {
          if (err) {
            return reject(new Error(`[SQLiteAdapter] recordRound error: ${err.message}`));
          }
          // Also persist each critique in this round
          if (round.critiques && round.critiques.length > 0) {
            try {
              for (const critique of round.critiques) {
                await this.recordCritique(roundId, critique);
              }
            } catch (critErr) {
              return reject(critErr);
            }
          }
          resolve();
        }
      );
    });
  }

  /**
   * Records an individual perspective critique.
   */
  public async recordCritique(roundId: string, critique: Critique): Promise<void> {
    await this.ensureInitialized();
    const critiqueId = `crit_${roundId}_${critique.role}`;
    const dimensionStr = JSON.stringify(critique.dimensionScores || {});
    const flawsStr = JSON.stringify(critique.criticalFlaws || []);
    const recsStr = JSON.stringify(critique.recommendations || []);
    const createdAt = critique.timestamp || new Date().toISOString();

    return new Promise((resolve, reject) => {
      this.db!.run(
        `INSERT OR REPLACE INTO council_critiques (
           id, round_id, agent_name, perspective_role, score, dimension_scores,
           approved, critical_flaws, recommendations, signature, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          critiqueId,
          roundId,
          critique.agentId,
          critique.role,
          critique.score,
          dimensionStr,
          critique.approved ? 1 : 0,
          flawsStr,
          recsStr,
          critique.signature,
          createdAt,
        ],
        (err) => {
          if (err) reject(new Error(`[SQLiteAdapter] recordCritique error: ${err.message}`));
          else resolve();
        }
      );
    });
  }

  /**
   * Records an issued ConsensusCertificate into the local ledger.
   */
  public async recordCertificate(cert: ConsensusCertificate): Promise<void> {
    await this.ensureInitialized();
    const roundId = cert.roundId || 'round_1';
    const createdAt = cert.timestamp || cert.issuedAt || new Date().toISOString();
    const dimAveragesStr = cert.dimensionAverages ? JSON.stringify(cert.dimensionAverages) : null;
    const participatingStr = cert.participatingAgents ? JSON.stringify(cert.participatingAgents) : null;

    return new Promise((resolve, reject) => {
      this.db!.run(
        `INSERT OR REPLACE INTO consensus_certificates (
           certificate_id, proposal_id, round_id, decision, composite_score,
           quorum_achieved, quorum_ratio, dimension_averages, participating_agents,
           transcript_hash, previous_certificate_hash, certificate_signature, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          cert.certificateId,
          cert.proposalId,
          roundId,
          cert.decision,
          cert.compositeScore,
          cert.quorumAchieved === false ? 0 : 1,
          cert.quorumRatio ?? 1.0,
          dimAveragesStr,
          participatingStr,
          cert.transcriptHash,
          cert.previousCertificateHash || null,
          cert.certificateSignature,
          createdAt,
        ],
        (err) => {
          if (err) reject(new Error(`[SQLiteAdapter] recordCertificate error: ${err.message}`));
          else resolve();
        }
      );
    });
  }

  /**
   * Retrieves a proposal by its ID.
   */
  public async getProposal(id: string): Promise<any> {
    await this.ensureInitialized();
    return new Promise((resolve, reject) => {
      this.db!.get('SELECT * FROM council_proposals WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  }

  /**
   * Retrieves a consensus certificate by ID.
   */
  public async getCertificate(certId: string): Promise<any> {
    await this.ensureInitialized();
    return new Promise((resolve, reject) => {
      this.db!.get('SELECT * FROM consensus_certificates WHERE certificate_id = ?', [certId], (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  }

  /**
   * Retrieves the comprehensive deliberation history for a proposal.
   */
  public async getProposalHistory(proposalId: string): Promise<DeliberationHistory | null> {
    await this.ensureInitialized();

    const proposalRow: any = await this.getProposal(proposalId);
    if (!proposalRow) {
      return null;
    }

    const proposal: Proposal = {
      id: proposalRow.id,
      title: proposalRow.title,
      type: proposalRow.proposal_type,
      content: proposalRow.content,
      author: proposalRow.author,
      proposalHash: proposalRow.proposal_hash,
      timestamp: proposalRow.created_at,
      metadata: proposalRow.metadata ? JSON.parse(proposalRow.metadata) : undefined,
    };

    const roundRows: any[] = await new Promise((resolve, reject) => {
      this.db!.all(
        'SELECT * FROM council_rounds WHERE proposal_id = ? ORDER BY round_number ASC',
        [proposalId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    const allCritiques: Critique[] = [];
    const rounds: DeliberationRoundRecord[] = [];

    for (const r of roundRows) {
      const critiqueRows: any[] = await new Promise((resolve, reject) => {
        this.db!.all(
          'SELECT * FROM council_critiques WHERE round_id = ? ORDER BY created_at ASC',
          [r.id],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });

      const roundCritiques: Critique[] = critiqueRows.map((c) => ({
        agentId: c.agent_name,
        role: c.perspective_role,
        score: c.score,
        dimensionScores: c.dimension_scores ? JSON.parse(c.dimension_scores) : {},
        approved: Boolean(c.approved),
        criticalFlaws: c.critical_flaws ? JSON.parse(c.critical_flaws) : [],
        recommendations: c.recommendations ? JSON.parse(c.recommendations) : [],
        signature: c.signature,
        timestamp: c.created_at,
      }));

      allCritiques.push(...roundCritiques);

      rounds.push({
        id: r.id,
        proposalId: r.proposal_id,
        proposalHash: proposal.proposalHash || '',
        roundNumber: r.round_number,
        quorumThreshold: r.quorum_threshold,
        votesApprove: r.votes_approve,
        votesReject: r.votes_reject,
        votesAbstain: r.votes_abstain,
        weightedScore: r.weighted_score,
        compositeScore: r.weighted_score,
        quorumAchieved: Boolean(r.quorum_achieved),
        status: r.resolution_status as any,
        resolutionStatus: r.resolution_status,
        transcript: r.transcript ? JSON.parse(r.transcript) : {},
        critiques: roundCritiques,
        vetoTriggered: false,
        vetoReasons: [],
        dissentingOpinions: [],
        remediationFeedback: [],
        timestamp: r.created_at,
        createdAt: r.created_at,
      });
    }

    const certRow: any = await new Promise((resolve, reject) => {
      this.db!.get(
        'SELECT * FROM consensus_certificates WHERE proposal_id = ? ORDER BY created_at DESC LIMIT 1',
        [proposalId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        }
      );
    });

    let certificate: ConsensusCertificate | null = null;
    if (certRow) {
      certificate = {
        certificateId: certRow.certificate_id,
        proposalId: certRow.proposal_id,
        roundId: certRow.round_id,
        decision: certRow.decision,
        compositeScore: certRow.composite_score,
        quorumAchieved: Boolean(certRow.quorum_achieved),
        quorumRatio: certRow.quorum_ratio,
        dimensionAverages: certRow.dimension_averages ? JSON.parse(certRow.dimension_averages) : undefined,
        participatingAgents: certRow.participating_agents ? JSON.parse(certRow.participating_agents) : undefined,
        transcriptHash: certRow.transcript_hash,
        previousCertificateHash: certRow.previous_certificate_hash || undefined,
        certificateSignature: certRow.certificate_signature,
        timestamp: certRow.created_at,
        issuedAt: certRow.created_at,
        proposalHash: proposal.proposalHash || '',
      };
    }

    return {
      proposal,
      rounds,
      critiques: allCritiques,
      certificate,
    };
  }

  /**
   * Closes the database connection safely.
   */
  public async close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.db) {
        this.db.close(() => {
          this.db = null;
          this.isInitialized = false;
          resolve();
        });
      } else {
        this.isInitialized = false;
        resolve();
      }
    });
  }

  public getDatabase(): sqlite3.Database | null {
    return this.db;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized || !this.db) {
      await this.initialize();
    }
  }
}

// Export SqliteConsensusLedger alias for compatibility
export const SqliteConsensusLedger = SQLiteAdapter;
