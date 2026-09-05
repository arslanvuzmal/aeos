/**
-- ============================================================================
-- AEOS Consensus Council Cryptographic Signer & Attestation Utilities
-- File: src/consensus/crypto_signer.ts
-- Subsystem: Cryptographic Ledger & Multi-Agent Attestation Chains
-- ============================================================================
 */

import * as crypto from 'crypto';
import { Proposal, Critique, ConsensusCertificate } from './types.js';

/**
 * Deterministically canonicalizes any JavaScript object or primitive into
 * an RFC 8785 compliant canonical JSON string representation.
 * Keys in objects are recursively sorted alphabetically.
 */
export function canonicalizeJson(obj: any): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  if (obj instanceof Date) {
    return JSON.stringify(obj.toISOString());
  }

  if (Array.isArray(obj)) {
    return '[' + obj.map((item) => canonicalizeJson(item)).join(',') + ']';
  }

  const keys = Object.keys(obj).sort();
  const keyVals: string[] = [];
  for (const k of keys) {
    const val = obj[k];
    if (val !== undefined) {
      keyVals.push(`${JSON.stringify(k)}:${canonicalizeJson(val)}`);
    }
  }
  return '{' + keyVals.join(',') + '}';
}

// Alias for backwards compatibility
export const canonicalJson = canonicalizeJson;

/**
 * Computes a standard hex-encoded SHA-256 digest of input data.
 */
export function sha256(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Computes a standard hex-encoded HMAC-SHA256 signature for given data using a secret key.
 */
export function hmacSha256(secret: string, data: string): string {
  if (!secret) {
    throw new Error('[CryptoSigner] Secret key cannot be empty for HMAC-SHA256 signing.');
  }
  return crypto.createHmac('sha256', secret).update(data, 'utf8').digest('hex');
}

/**
 * Performs constant-time comparison of two hex-encoded signatures to protect
 * against side-channel timing analysis.
 */
export function verifyConstantTime(sig1: string, sig2: string): boolean {
  if (!sig1 || !sig2 || typeof sig1 !== 'string' || typeof sig2 !== 'string') {
    return false;
  }
  if (sig1.length !== sig2.length) {
    return false;
  }
  try {
    const buf1 = Buffer.from(sig1, 'hex');
    const buf2 = Buffer.from(sig2, 'hex');
    if (buf1.length !== buf2.length || buf1.length === 0) {
      // Fallback for non-hex strings of equal length
      return crypto.timingSafeEqual(Buffer.from(sig1, 'utf8'), Buffer.from(sig2, 'utf8'));
    }
    return crypto.timingSafeEqual(buf1, buf2);
  } catch {
    return false;
  }
}

/**
 * Verifies an HMAC-SHA256 signature in constant time.
 */
export function verifyHmacSha256(secret: string, data: string, expectedSignature: string): boolean {
  if (!secret || !expectedSignature) {
    return false;
  }
  try {
    const actual = hmacSha256(secret, data);
    return verifyConstantTime(actual, expectedSignature);
  } catch {
    return false;
  }
}

/**
 * Computes the canonical SHA-256 hash of a submitted Proposal.
 */
export function hashProposal(proposal: Proposal): string {
  if (!proposal) {
    throw new Error('[CryptoSigner] Cannot hash null or undefined proposal.');
  }
  const payload = {
    id: proposal.id,
    title: proposal.title,
    type: proposal.type,
    content: proposal.content,
    author: proposal.author,
    timestamp: proposal.timestamp,
  };
  return sha256(canonicalizeJson(payload));
}

/**
 * Computes the canonical SHA-256 hash of a deliberation transcript.
 */
export function computeTranscriptHash(transcript: any): string {
  return sha256(canonicalizeJson(transcript));
}

// Alias for transcript hashing
export const hashTranscript = computeTranscriptHash;

/**
 * Computes a cryptographic signature over an individual member's critique and vote.
 */
export function signCritique(
  secret: string,
  critique: Omit<Critique, 'signature'> | Critique,
  proposalHash: string
): string {
  const payload = `${critique.agentId}:${critique.role}:${critique.score}:${critique.approved}:${proposalHash}`;
  return hmacSha256(secret, payload);
}

/**
 * Generates an immutable HMAC-SHA256 signature sealing a consensus certificate.
 * Links to previous certificate hash if part of an attestation chain.
 */
export function signCertificate(
  secret: string,
  proposalHash: string,
  transcriptHash: string,
  decision: string,
  timestamp: string,
  prevCertHash?: string
): string {
  const payload = `${prevCertHash || 'GENESIS'}:${proposalHash}:${transcriptHash}:${decision}:${timestamp}`;
  return hmacSha256(secret, payload);
}

/**
 * Verifies that a ConsensusCertificate has not been tampered with.
 */
export function verifyCertificate(
  cert: ConsensusCertificate,
  secret: string,
  prevCertHash?: string
): boolean {
  if (!cert || !cert.certificateSignature) {
    return false;
  }
  const timestamp = cert.timestamp || cert.issuedAt || '';
  const expected = signCertificate(
    secret,
    cert.proposalHash,
    cert.transcriptHash,
    cert.decision,
    timestamp,
    cert.previousCertificateHash || prevCertHash
  );
  return verifyConstantTime(cert.certificateSignature, expected);
}

/**
 * Attestation record format matching PostgreSQL `plan_attestations` table:
 * (id UUID, project_id UUID, sha256_hash CHAR(64), attested_by VARCHAR(100), is_valid BOOLEAN, created_at TIMESTAMP)
 */
export interface PlanAttestationRecord {
  id: string;
  projectId: string;
  sha256Hash: string;
  attestedBy: string;
  isValid: boolean;
  createdAt: string;
}

/**
 * Formats a ConsensusCertificate into a plan_attestations compatible record.
 * This bridges the Consensus Council with existing AEOS plan integrity tooling
 * (e.g. `aeos-attest --verify`, `smart_inject.sh`, `tests/phase2_ledger_test.ts`).
 */
export function createPlanAttestation(
  certificate: ConsensusCertificate,
  projectId: string = '00000000-0000-0000-0000-000000000000'
): PlanAttestationRecord {
  const isValid =
    certificate.decision === 'APPROVED' ||
    certificate.decision === 'CONSENSUS_APPROVED';

  return {
    id: crypto.randomUUID(),
    projectId,
    sha256Hash: certificate.certificateSignature,
    attestedBy: 'consensus_council',
    isValid,
    createdAt: certificate.timestamp || certificate.issuedAt || new Date().toISOString(),
  };
}

/**
 * Comprehensive Cryptographic Signer Class
 */
export class CryptoSigner {
  private secretKey: string;

  constructor(secretKey: string = 'aeos_consensus_council_hmac_secret_2026') {
    this.secretKey = secretKey;
  }

  public canonicalizeJson(obj: any): string {
    return canonicalizeJson(obj);
  }

  public sha256(data: string | Buffer): string {
    return sha256(data);
  }

  public hmacSha256(data: string): string {
    return hmacSha256(this.secretKey, data);
  }

  public verifyConstantTime(sig1: string, sig2: string): boolean {
    return verifyConstantTime(sig1, sig2);
  }

  public verifyHmacSha256(data: string, expectedSignature: string): boolean {
    return verifyHmacSha256(this.secretKey, data, expectedSignature);
  }

  public hashProposal(proposal: Proposal): string {
    return hashProposal(proposal);
  }

  public hashTranscript(transcript: any): string {
    return computeTranscriptHash(transcript);
  }

  public signCritique(critique: Omit<Critique, 'signature'> | Critique, proposalHash: string): string {
    return signCritique(this.secretKey, critique, proposalHash);
  }

  public signCertificate(
    proposalHash: string,
    transcriptHash: string,
    decision: string,
    timestamp: string,
    prevCertHash?: string
  ): string {
    return signCertificate(
      this.secretKey,
      proposalHash,
      transcriptHash,
      decision,
      timestamp,
      prevCertHash
    );
  }

  public verifyCertificate(cert: ConsensusCertificate, prevCertHash?: string): boolean {
    return verifyCertificate(cert, this.secretKey, prevCertHash);
  }

  public createPlanAttestation(
    certificate: ConsensusCertificate,
    projectId?: string
  ): PlanAttestationRecord {
    return createPlanAttestation(certificate, projectId);
  }

  // Static mirror for convenient static invocations
  public static canonicalJson = canonicalizeJson;
  public static canonicalizeJson = canonicalizeJson;
  public static sha256 = sha256;
  public static hmacSha256 = hmacSha256;
  public static verifyConstantTime = verifyConstantTime;
  public static verifyHmacSha256 = verifyHmacSha256;
  public static hashProposal = hashProposal;
  public static hashTranscript = computeTranscriptHash;
  public static computeTranscriptHash = computeTranscriptHash;
  public static signCritique = signCritique;
  public static signCertificate = signCertificate;
  public static verifyCertificate = verifyCertificate;
  public static createPlanAttestation = createPlanAttestation;
}

// Export ConsensusCrypto as alias for compatibility
export const ConsensusCrypto = CryptoSigner;
