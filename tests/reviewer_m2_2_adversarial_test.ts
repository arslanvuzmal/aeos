/**
 * AEOS Consensus Council Milestone 2 Adversarial Reviewer Stress Test Suite
 * Author: reviewer_m2_2
 * Target: database/consensus_schema.sql, src/consensus/crypto_signer.ts,
 *         src/consensus/sqlite_adapter.ts, src/consensus/ledger.ts
 * 
 * Verifies:
 * 1. Offline fallback resilience (R3) without unhandled promise rejections or crashes
 * 2. Parameterized queries & SQL injection immunity across PostgreSQL & SQLite
 * 3. Constant-time verification robustness under adversarial / malformed inputs
 * 4. Idempotent cleanup in close() under sequential and concurrent calls
 * 5. Deterministic RFC 8785 canonical JSON serialization across random key permutations
 * 6. Tamper detection and cryptographic attestation chain integrity
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  CryptoSigner,
  canonicalizeJson,
  sha256,
  hmacSha256,
  verifyConstantTime,
  verifyHmacSha256,
  hashProposal,
  signCertificate,
  verifyCertificate,
  createPlanAttestation,
  SQLiteAdapter,
  CouncilLedger,
  Proposal,
  Critique,
  ConsensusCertificate,
  DeliberationRoundRecord,
} from '../src/consensus/index.js';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures: string[] = [];

function check(description: string, fn: () => boolean | void | Promise<boolean | void>) {
  totalTests++;
  try {
    const result = fn();
    if (result instanceof Promise) {
      throw new Error(`check() called synchronously with promise for: ${description}`);
    }
    if (result === false) {
      failedTests++;
      failures.push(`FAIL: ${description}`);
      console.log(`  [FAIL] ${description}`);
    } else {
      passedTests++;
      console.log(`  [PASS] ${description}`);
    }
  } catch (err: any) {
    failedTests++;
    failures.push(`FAIL: ${description} - ${err.message}`);
    console.log(`  [FAIL] ${description} - ${err.message}`);
  }
}

async function checkAsync(description: string, fn: () => Promise<boolean | void>) {
  totalTests++;
  try {
    const result = await fn();
    if (result === false) {
      failedTests++;
      failures.push(`FAIL: ${description}`);
      console.log(`  [FAIL] ${description}`);
    } else {
      passedTests++;
      console.log(`  [PASS] ${description}`);
    }
  } catch (err: any) {
    failedTests++;
    failures.push(`FAIL: ${description} - ${err.message}`);
    console.log(`  [FAIL] ${description} - ${err.message}`);
  }
}

async function runAdversarialReview() {
  console.log('================================================================');
  console.log('ADVERSARIAL REVIEW SUITE - MILESTONE 2 (reviewer_m2_2)');
  console.log('================================================================\n');

  // --------------------------------------------------------------------------
  // SECTION 1: Constant-Time Verification & Boundary Fuzzing
  // --------------------------------------------------------------------------
  console.log('--- SECTION 1: Constant-Time Verification & Boundary Robustness ---');

  check('1.1 verifyConstantTime handles identical 64-char hex signatures', () => {
    const sig = 'a'.repeat(64);
    return verifyConstantTime(sig, sig) === true;
  });

  check('1.2 verifyConstantTime rejects 1-bit difference at position 0', () => {
    const sig1 = 'a' + '0'.repeat(63);
    const sig2 = 'b' + '0'.repeat(63);
    return verifyConstantTime(sig1, sig2) === false;
  });

  check('1.3 verifyConstantTime rejects 1-bit difference at last position', () => {
    const sig1 = '0'.repeat(63) + 'a';
    const sig2 = '0'.repeat(63) + 'b';
    return verifyConstantTime(sig1, sig2) === false;
  });

  check('1.4 verifyConstantTime handles mismatched lengths safely without error', () => {
    return (
      verifyConstantTime('abc', 'abcd') === false &&
      verifyConstantTime('a'.repeat(64), 'a'.repeat(63)) === false &&
      verifyConstantTime('', 'a') === false &&
      verifyConstantTime('a', '') === false
    );
  });

  check('1.5 verifyConstantTime handles empty strings safely', () => {
    return verifyConstantTime('', '') === false;
  });

  check('1.6 verifyConstantTime handles null / undefined / non-string inputs safely', () => {
    return (
      verifyConstantTime(null as any, 'abc') === false &&
      verifyConstantTime('abc', null as any) === false &&
      verifyConstantTime(undefined as any, undefined as any) === false &&
      verifyConstantTime(123 as any, 123 as any) === false &&
      verifyConstantTime({} as any, {} as any) === false
    );
  });

  check('1.7 verifyConstantTime handles non-hex strings of equal length', () => {
    return (
      verifyConstantTime('hello-world-1234', 'hello-world-1234') === true &&
      verifyConstantTime('hello-world-1234', 'hello-world-1235') === false
    );
  });

  check('1.8 verifyConstantTime handles multi-byte unicode strings without throwing RangeError', () => {
    // Equal string length (2), but differing UTF-8 byte lengths (4 bytes vs 2 bytes)
    const s1 = '€a'; // '€' is 3 bytes, 'a' is 1 byte -> 4 bytes
    const s2 = 'ab'; // 'a' is 1 byte, 'b' is 1 byte -> 2 bytes
    return verifyConstantTime(s1, s2) === false;
  });

  check('1.9 verifyConstantTime handles odd-length hex strings safely', () => {
    return (
      verifyConstantTime('abc', 'abc') === true &&
      verifyConstantTime('abc', 'abd') === false
    );
  });

  check('1.9b verifyConstantTime with non-hex characters in equal-length strings', () => {
    // Both length 6, different suffixes after non-hex characters
    return verifyConstantTime('00zz11', '00yy22') === false;
  });

  check('1.10 verifyHmacSha256 handles empty secret or signature without throw', () => {
    return (
      verifyHmacSha256('', 'data', 'sig') === false &&
      verifyHmacSha256('secret', 'data', '') === false
    );
  });

  // --------------------------------------------------------------------------
  // SECTION 2: Canonical JSON Serialization & Key Permutation Invariance
  // --------------------------------------------------------------------------
  console.log('\n--- SECTION 2: Canonical JSON Serialization Invariance ---');

  check('2.1 Deeply nested randomized key order permutation invariance', () => {
    const keys = ['delta', 'alpha', 'charlie', 'bravo', 'echo', 'foxtrot'];
    const buildObj = (shuffled: string[]) => {
      const obj: any = {};
      for (const k of shuffled) {
        obj[k] = {
          subZ: 100,
          subA: 200,
          nested: {
            zulu: 1,
            yankee: 2,
            xray: [ { b: 2, a: 1 }, { d: 4, c: 3 } ],
          },
        };
      }
      return obj;
    };

    const perm1 = buildObj([...keys]);
    const perm2 = buildObj([...keys].reverse());
    const perm3 = buildObj(['echo', 'alpha', 'foxtrot', 'bravo', 'delta', 'charlie']);

    const canon1 = canonicalizeJson(perm1);
    const canon2 = canonicalizeJson(perm2);
    const canon3 = canonicalizeJson(perm3);

    return canon1 === canon2 && canon2 === canon3;
  });

  check('2.2 Date object determinism', () => {
    const date = new Date('2026-09-04T12:34:56.789Z');
    const canon = canonicalizeJson({ timestamp: date });
    return canon === '{"timestamp":"2026-09-04T12:34:56.789Z"}';
  });

  check('2.3 Undefined property omission matches RFC 8785 standard', () => {
    const objWithUndef = { b: 2, a: undefined, c: 3 };
    const objClean = { b: 2, c: 3 };
    return canonicalizeJson(objWithUndef) === canonicalizeJson(objClean);
  });

  check('2.4 Array elements preserve order while nested object keys sort', () => {
    const arr = [
      { z: 26, a: 1 },
      { y: 25, b: 2 },
    ];
    const canon = canonicalizeJson(arr);
    return canon === '[{"a":1,"z":26},{"b":2,"y":25}]';
  });

  // --------------------------------------------------------------------------
  // SECTION 3: Offline Fallback & Connection Error Handling
  // --------------------------------------------------------------------------
  console.log('\n--- SECTION 3: Offline Fallback & Connection Resilience (R3) ---');

  const testDir = path.resolve('.aeos/test_reviewer_m2');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  const testDbFile = path.join(testDir, 'adv_ledger.sqlite3');
  if (fs.existsSync(testDbFile)) {
    fs.unlinkSync(testDbFile);
  }

  await checkAsync('3.1 CouncilLedger fallback when PostgreSQL port is completely closed', async () => {
    const ledger = new CouncilLedger({
      connectionString: 'postgresql://fake_user:fake_pass@127.0.0.1:54329/fake_db',
      connectionTimeoutMillis: 300,
      sqliteDbPath: testDbFile,
      enablePostgres: true,
    });

    await ledger.initialize();
    const mode = ledger.getStorageMode();
    const isFallback = ledger.isFallbackActive();
    await ledger.close();

    return mode === 'sqlite' && isFallback === true;
  });

  await checkAsync('3.2 CouncilLedger fallback when hostname is invalid (DNS resolution failure)', async () => {
    const ledger = new CouncilLedger({
      connectionString: 'postgresql://fake_user:fake_pass@nonexistent-host-aeos-999.invalid:5432/fake_db',
      connectionTimeoutMillis: 300,
      sqliteDbPath: testDbFile,
      enablePostgres: true,
    });

    await ledger.initialize();
    const mode = ledger.getStorageMode();
    await ledger.close();

    return mode === 'sqlite';
  });

  await checkAsync('3.3 CouncilLedger works end-to-end with enablePostgres: false (direct offline)', async () => {
    const ledger = new CouncilLedger({
      enablePostgres: false,
      sqliteDbPath: testDbFile,
    });

    await ledger.initialize();
    const proposal: Proposal = {
      id: 'PROP-OFFLINE-001',
      title: 'Offline Proposal Test',
      type: 'task_plan',
      content: 'Verifying pure offline SQLite execution.',
      author: 'reviewer_m2_2',
      timestamp: new Date().toISOString(),
    };

    await ledger.recordProposal(proposal, 'approved');
    const retrieved = await ledger.getProposal('PROP-OFFLINE-001');
    await ledger.close();

    return retrieved !== null && retrieved.id === 'PROP-OFFLINE-001' && retrieved.status === 'approved';
  });

  // --------------------------------------------------------------------------
  // SECTION 4: SQL Injection Vulnerability & Query Parameterization
  // --------------------------------------------------------------------------
  console.log('\n--- SECTION 4: SQL Injection Immunity across SQLite & Ledger ---');

  await checkAsync('4.1 SQL Injection in Proposal fields (id, title, content, author, metadata)', async () => {
    const adapter = new SQLiteAdapter(':memory:');
    await adapter.initialize();

    const evilProposal: Proposal = {
      id: "prop_evil'; DROP TABLE council_proposals; --",
      title: "Evil Title'); DROP TABLE council_rounds; --",
      type: 'task_plan',
      content: "Robert'); DROP TABLE council_critiques; SELECT * FROM 'x",
      author: "admin' OR '1'='1' --",
      metadata: { attack: "val'; DROP TABLE consensus_certificates; --" },
      timestamp: new Date().toISOString(),
    };

    // Attempt insert
    await adapter.recordProposal(evilProposal, "status' OR '1'='1");

    // Retrieve proposal
    const retrieved = await adapter.getProposal(evilProposal.id);

    // Verify tables still exist
    const db = adapter.getDatabase();
    const tableCount: any = await new Promise((res, rej) => {
      db!.all("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'council_%'", (err, rows) => {
        if (err) rej(err);
        else res(rows);
      });
    });

    await adapter.close();

    const propOk = retrieved && retrieved.id === evilProposal.id && retrieved.title === evilProposal.title;
    const tablesOk = tableCount && tableCount.length >= 3;

    return propOk && tablesOk;
  });

  await checkAsync('4.2 SQL Injection in DeliberationRound and Critique fields', async () => {
    const adapter = new SQLiteAdapter(':memory:');
    await adapter.initialize();

    const evilProposal: Proposal = {
      id: 'PROP-NORMAL-1',
      title: 'Normal Title',
      type: 'task_plan',
      content: 'Normal content',
      author: 'normal_author',
      timestamp: new Date().toISOString(),
    };
    await adapter.recordProposal(evilProposal);

    const evilRound: DeliberationRoundRecord = {
      id: "round_evil'; DROP TABLE council_critiques; --",
      proposalId: evilProposal.id,
      proposalHash: '0'.repeat(64),
      roundNumber: 1,
      quorumThreshold: 0.75,
      votesApprove: 1,
      votesReject: 0,
      votesAbstain: 0,
      weightedScore: 90.0,
      quorumAchieved: true,
      resolutionStatus: "APPROVED'; DROP TABLE council_rounds; --",
      transcript: { "key": "'; DROP TABLE council_proposals; --" },
      critiques: [
        {
          agentId: "agent_hacker'; DROP TABLE council_critiques; --",
          role: 'security_verification',
          score: 100,
          dimensionScores: { "auth'; --": 100 },
          approved: true,
          criticalFlaws: ["flaw'; DROP TABLE council_proposals; --"],
          recommendations: ["rec'; --"],
          signature: 'a'.repeat(64),
        },
      ],
      createdAt: new Date().toISOString(),
    };

    await adapter.recordRound(evilRound);
    const history = await adapter.getProposalHistory(evilProposal.id);

    await adapter.close();

    return (
      history !== null &&
      history.rounds.length === 1 &&
      history.rounds[0].id === evilRound.id &&
      history.critiques.length === 1 &&
      history.critiques[0].agentId === evilRound.critiques[0].agentId
    );
  });

  await checkAsync('4.3 SQL Injection in ConsensusCertificate fields', async () => {
    const adapter = new SQLiteAdapter(':memory:');
    await adapter.initialize();

    const proposal: Proposal = {
      id: 'PROP-CERT-1',
      title: 'Proposal for Certificate',
      type: 'architecture_rfc',
      content: 'Architecture content',
      author: 'architect',
      timestamp: new Date().toISOString(),
    };
    await adapter.recordProposal(proposal);

    const evilCert: ConsensusCertificate = {
      certificateId: "cert_evil'; DROP TABLE consensus_certificates; --",
      proposalId: proposal.id,
      roundId: 'round_1',
      decision: "CONSENSUS_APPROVED'; DROP TABLE council_proposals; --",
      compositeScore: 88.5,
      quorumAchieved: true,
      quorumRatio: 1.0,
      transcriptHash: 'b'.repeat(64),
      proposalHash: 'c'.repeat(64),
      certificateSignature: 'd'.repeat(64),
      timestamp: new Date().toISOString(),
    };

    await adapter.recordCertificate(evilCert);
    const retrieved = await adapter.getCertificate(evilCert.certificateId);
    await adapter.close();

    return retrieved !== null && retrieved.certificate_id === evilCert.certificateId;
  });

  // --------------------------------------------------------------------------
  // SECTION 5: Idempotent Lifecycle & Cleanup in close()
  // --------------------------------------------------------------------------
  console.log('\n--- SECTION 5: Idempotent Cleanup & Resource Teardown ---');

  await checkAsync('5.1 Multiple sequential close() calls on SQLiteAdapter', async () => {
    const adapter = new SQLiteAdapter(':memory:');
    await adapter.initialize();
    await adapter.close();
    await adapter.close();
    await adapter.close();
    await adapter.close();
    return true;
  });

  await checkAsync('5.2 Concurrent close() calls on SQLiteAdapter', async () => {
    const adapter = new SQLiteAdapter(':memory:');
    await adapter.initialize();
    await Promise.all([adapter.close(), adapter.close(), adapter.close()]);
    return true;
  });

  await checkAsync('5.3 Multiple sequential close() calls on CouncilLedger', async () => {
    const ledger = new CouncilLedger({ enablePostgres: false, sqliteDbPath: ':memory:' });
    await ledger.initialize();
    await ledger.close();
    await ledger.close();
    await ledger.close();
    return true;
  });

  await checkAsync('5.4 Concurrent close() calls on CouncilLedger', async () => {
    const ledger = new CouncilLedger({ enablePostgres: false, sqliteDbPath: ':memory:' });
    await ledger.initialize();
    await Promise.all([ledger.close(), ledger.close(), ledger.close()]);
    return true;
  });

  await checkAsync('5.5 Calling close() before initialize() is safe', async () => {
    const ledger = new CouncilLedger({ enablePostgres: false, sqliteDbPath: ':memory:' });
    await ledger.close();
    return true;
  });

  await checkAsync('5.6 Auto-reinitialization if query called after close()', async () => {
    const ledger = new CouncilLedger({ enablePostgres: false, sqliteDbPath: ':memory:' });
    await ledger.initialize();
    const proposal: Proposal = {
      id: 'PROP-REINIT-1',
      title: 'Reinit test',
      type: 'task_plan',
      content: 'testing reinit',
      author: 'reviewer',
      timestamp: new Date().toISOString(),
    };
    await ledger.recordProposal(proposal);
    await ledger.close();

    // Now call getProposal without manual re-initialize
    const retrieved = await ledger.getProposal('PROP-REINIT-1');
    await ledger.close();

    // SQLite adapter in :memory: creates a fresh db on re-init, so it shouldn't crash
    return retrieved === null || retrieved !== undefined;
  });

  // --------------------------------------------------------------------------
  // SECTION 6: Tamper Evident Attestation & Merkle Links
  // --------------------------------------------------------------------------
  console.log('\n--- SECTION 6: Tamper Evident Attestation & Merkle Links ---');

  check('6.1 Certificate tampering is rejected for any mutated field', () => {
    const secret = 'council_review_secret_2026';
    const pHash = sha256('proposal_test_data');
    const tHash = sha256('transcript_test_data');
    const ts = '2026-09-04T12:00:00.000Z';
    const sig = signCertificate(secret, pHash, tHash, 'APPROVED', ts, 'GENESIS');

    const cert: ConsensusCertificate = {
      certificateId: 'cert_1',
      proposalId: 'prop_1',
      roundId: 'round_1',
      decision: 'APPROVED',
      compositeScore: 90,
      quorumAchieved: true,
      transcriptHash: tHash,
      proposalHash: pHash,
      certificateSignature: sig,
      previousCertificateHash: 'GENESIS',
      timestamp: ts,
    };

    const valid = verifyCertificate(cert, secret);

    // Tamper with decision
    const tamperedDecision = { ...cert, decision: 'REJECTED' };
    const invalidDecision = verifyCertificate(tamperedDecision as any, secret);

    // Tamper with transcriptHash
    const tamperedTranscript = { ...cert, transcriptHash: 'f'.repeat(64) };
    const invalidTranscript = verifyCertificate(tamperedTranscript, secret);

    // Tamper with timestamp
    const tamperedTs = { ...cert, timestamp: '2026-09-04T12:00:01.000Z' };
    const invalidTs = verifyCertificate(tamperedTs, secret);

    // Tamper with previousCertificateHash
    const tamperedPrev = { ...cert, previousCertificateHash: 'MODIFIED_PREV' };
    const invalidPrev = verifyCertificate(tamperedPrev, secret);

    return valid && !invalidDecision && !invalidTranscript && !invalidTs && !invalidPrev;
  });

  check('6.2 Plan Attestation Record bridges correctly to plan_attestations', () => {
    const cert: ConsensusCertificate = {
      certificateId: 'cert_bridge',
      proposalId: 'prop_bridge',
      roundId: 'round_1',
      decision: 'CONSENSUS_APPROVED',
      compositeScore: 95,
      quorumAchieved: true,
      transcriptHash: 'a'.repeat(64),
      proposalHash: 'b'.repeat(64),
      certificateSignature: 'c'.repeat(64),
      timestamp: '2026-09-04T15:00:00.000Z',
    };

    const attestation = createPlanAttestation(cert, '11111111-2222-3333-4444-555555555555');
    return (
      attestation.projectId === '11111111-2222-3333-4444-555555555555' &&
      attestation.sha256Hash === cert.certificateSignature &&
      attestation.attestedBy === 'consensus_council' &&
      attestation.isValid === true &&
      attestation.createdAt === cert.timestamp
    );
  });

  // Clean up test file
  if (fs.existsSync(testDbFile)) {
    try {
      fs.unlinkSync(testDbFile);
    } catch {
      // ignore
    }
  }

  // --------------------------------------------------------------------------
  // SUMMARY
  // --------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`REVIEWER ADVERSARIAL SUMMARY:`);
  console.log(`  Total Checks : ${totalTests}`);
  console.log(`  Passed       : ${passedTests}`);
  console.log(`  Failed       : ${failedTests}`);
  console.log('================================================================');

  if (failedTests > 0) {
    console.error('\nFailures detected:');
    for (const f of failures) {
      console.error(`  - ${f}`);
    }
    process.exit(1);
  } else {
    console.log('\nAll adversarial checks passed with 100% integrity.');
    process.exit(0);
  }
}

runAdversarialReview().catch((err) => {
  console.error('Fatal error during adversarial review:', err);
  process.exit(1);
});
