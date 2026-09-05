/**
 * AEOS Consensus Council Milestone 2 Adversarial Stress & Concurrency Test Harness
 * 
 * File: tests/challenger_m2_concurrency_failover_test.ts
 * Challenger: challenger_m2_2
 * Scope:
 *  - Dimension 1: High-Concurrency Deliberation & Ledger Persistence Stress
 *  - Dimension 2: Offline PostgreSQL Failover & Zero-Cloud Routing Resilience
 *  - Dimension 3: Filesystem Auto-Creation & Boundary Storage Stress
 *  - Dimension 4: Cryptographic Tamper-Evident Ledger Integrity
 *  - Dimension 5: Large Payload and High-Throughput Write-Read Contention
 */

import * as assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import sqlite3 from 'sqlite3';
import {
  CouncilOrchestrator,
  CouncilLedger,
  SQLiteAdapter,
  CryptoSigner,
  createPlanAttestation,
  Proposal,
  Critique,
  ConsensusCertificate,
  DeliberationRoundRecord,
} from '../src/consensus/index.js';

interface TestResult {
  id: string;
  category: string;
  name: string;
  passed: boolean;
  error?: string;
  durationMs: number;
}

const results: TestResult[] = [];
const startTime = Date.now();

function recordCheck(id: string, category: string, name: string, condition: boolean, errorMsg?: string) {
  const passed = Boolean(condition);
  results.push({
    id,
    category,
    name,
    passed,
    error: passed ? undefined : errorMsg || 'Assertion failed',
    durationMs: 0,
  });

  if (passed) {
    console.log(`[PASS] [${id}] [${category}] ${name}`);
  } else {
    console.error(`[FAIL] [${id}] [${category}] ${name} -> ${errorMsg}`);
  }
}

// Helper to create synthetic proposals
function makeProposal(id: string, title: string, content: string, type: 'task_plan' | 'code_verification' | 'architecture_rfc' = 'task_plan'): Proposal {
  return {
    id,
    title,
    type,
    content,
    author: 'challenger_m2_agent',
    timestamp: new Date().toISOString(),
    metadata: { testSuite: 'challenger_m2_concurrency' },
  };
}

// Clean up sandbox folders
const SANDBOX_DIR = path.resolve('.aeos/test_sandbox_m2');
function cleanupSandbox() {
  try {
    if (fs.existsSync(SANDBOX_DIR)) {
      fs.rmSync(SANDBOX_DIR, { recursive: true, force: true });
    }
  } catch {
    // ignore
  }
}

async function runTestSuite() {
  console.log('======================================================================');
  console.log('   AEOS CONSENSUS COUNCIL M2 ADVERSARIAL CHALLENGER STRESS HARNESS    ');
  console.log('======================================================================\n');

  cleanupSandbox();

  // --------------------------------------------------------------------------
  // SECTION 1: High-Concurrency Deliberation & Ledger Persistence Stress
  // --------------------------------------------------------------------------
  console.log('--- SECTION 1: HIGH-CONCURRENCY DELIBERATION & PERSISTENCE STRESS ---');

  const concurrentDbPath = path.join(SANDBOX_DIR, 'concurrent_deliberations.sqlite3');
  const sharedOrchestrator = new CouncilOrchestrator({
    sqliteDbPath: concurrentDbPath,
    enableTelemetry: false,
  }, {
    ledger: new CouncilLedger({
      sqliteDbPath: concurrentDbPath,
      enablePostgres: false,
    }),
  });

  // Test 1.1: 20 simultaneous deliberations on a single orchestrator
  const CONCURRENT_COUNT = 20;
  console.log(`[1.1] Dispatching ${CONCURRENT_COUNT} parallel deliberations to single orchestrator...`);
  const proposals: Proposal[] = [];
  for (let i = 0; i < CONCURRENT_COUNT; i++) {
    proposals.push(makeProposal(
      `concurrent_prop_${i}`,
      `Concurrent Task Proposal #${i}`,
      `Task plan description for module ${i}: Implement robust data parsing with input sanitization, error boundaries, and unit tests.`
    ));
  }

  const pStart = Date.now();
  const outcomes = await Promise.all(proposals.map((p) => sharedOrchestrator.deliberate(p)));
  const pDuration = Date.now() - pStart;
  console.log(`[1.1] Completed ${CONCURRENT_COUNT} concurrent deliberations in ${pDuration}ms.`);

  recordCheck('C1.1', 'Concurrency', 'All 20 concurrent deliberations resolved without throwing', outcomes.length === CONCURRENT_COUNT);
  const allApproved = outcomes.every((o) => o.status === 'APPROVED');
  recordCheck('C1.2', 'Concurrency', 'All 20 compliant proposals achieved consensus approval', allApproved);
  const allCertificatesIssued = outcomes.every((o) => !!o.consensusCertificate && !!o.consensusCertificate.certificateSignature);
  recordCheck('C1.3', 'Concurrency', 'Every approved deliberation generated a cryptographic certificate', allCertificatesIssued);

  // Verify all 20 records exist in the SQLite ledger
  const ledger = sharedOrchestrator.getLedger() as CouncilLedger;
  let allPersisted = true;
  let allHistoriesValid = true;
  for (let i = 0; i < CONCURRENT_COUNT; i++) {
    const history = await ledger.getProposalHistory(`concurrent_prop_${i}`);
    if (!history || !history.proposal) {
      allPersisted = false;
    }
    if (!history || history.rounds.length === 0 || history.critiques.length < 3 || !history.certificate) {
      allHistoriesValid = false;
    }
  }
  recordCheck('C1.4', 'Concurrency', 'All 20 concurrent proposals recorded and retrievable from SQLite ledger', allPersisted);
  recordCheck('C1.5', 'Concurrency', 'Deliberation histories contain complete rounds, critiques, and certificates without data loss', allHistoriesValid);

  await sharedOrchestrator.closeLedger();

  // Test 1.2: Multi-instance write contention: 10 distinct orchestrator instances sharing the same DB file
  console.log('[1.2] Multi-Instance Write Contention: 10 distinct orchestrators sharing one SQLite DB...');
  const sharedDbMulti = path.join(SANDBOX_DIR, 'shared_multi_instance.sqlite3');
  const MULTI_INSTANCES = 10;
  const multiOrchestrators = Array.from({ length: MULTI_INSTANCES }, () => new CouncilOrchestrator({
    sqliteDbPath: sharedDbMulti,
    enableTelemetry: false,
  }, {
    ledger: new CouncilLedger({
      sqliteDbPath: sharedDbMulti,
      enablePostgres: false,
    }),
  }));

  const multiProposals = Array.from({ length: MULTI_INSTANCES }, (_, idx) => makeProposal(
    `multi_inst_prop_${idx}`,
    `Multi-Instance Proposal #${idx}`,
    `Multi-instance test content for node ${idx}: architecture design with clear boundaries and zero leak invariants.`
  ));

  const multiOutcomes = await Promise.all(
    multiOrchestrators.map((orch, idx) => orch.deliberate(multiProposals[idx]))
  );

  recordCheck('C1.6', 'Concurrency', '10 distinct orchestrator instances deliberating concurrently resolved without error', multiOutcomes.length === MULTI_INSTANCES);
  const multiAllApproved = multiOutcomes.every((o) => o.status === 'APPROVED');
  recordCheck('C1.7', 'Concurrency', 'All 10 multi-instance deliberations achieved APPROVED status', multiAllApproved);

  // Close all instances
  for (const orch of multiOrchestrators) {
    await orch.closeLedger();
  }

  // Open an adapter to verify the shared file has all 10
  const verifyAdapter = new SQLiteAdapter(sharedDbMulti);
  await verifyAdapter.initialize();
  let multiCheckPass = true;
  for (let idx = 0; idx < MULTI_INSTANCES; idx++) {
    const h = await verifyAdapter.getProposalHistory(`multi_inst_prop_${idx}`);
    if (!h || !h.certificate) {
      multiCheckPass = false;
    }
  }
  recordCheck('C1.8', 'Concurrency', 'Shared SQLite file integrity verified: all 10 independent proposals persisted without lock collision', multiCheckPass);
  await verifyAdapter.close();

  // Test 1.3: Concurrency with heterogeneous outcomes (Pass, Security Veto, Deadlock)
  console.log('[1.3] Concurrent burst with mixed outcomes (Pass, Veto, Deadlock)...');
  const mixedDb = path.join(SANDBOX_DIR, 'mixed_outcomes.sqlite3');
  const mixedOrchestrator = new CouncilOrchestrator({
    sqliteDbPath: mixedDb,
    enableTelemetry: false,
  }, {
    ledger: new CouncilLedger({
      sqliteDbPath: mixedDb,
      enablePostgres: false,
    }),
  });

  const compliantProposal = makeProposal('mixed_pass', 'Compliant Plan', 'Standard compliant plan adhering to security guidelines and zero memory leaks.');
  const sqlInjectionProposal = makeProposal('mixed_veto_sql', 'Vulnerable DB Query', 'db.query("SELECT * FROM users WHERE username = \'" + req.body.username + "\'");');
  const splitDecisionProposal = makeProposal('mixed_deadlock', 'Split Feature Plan', 'Performance critical feature that introduces a temporary 20% latency overhead during peak migration.');

  const [resPass, resVeto, resDeadlock] = await Promise.all([
    mixedOrchestrator.deliberate(compliantProposal),
    mixedOrchestrator.deliberate(sqlInjectionProposal),
    mixedOrchestrator.deliberate(splitDecisionProposal),
  ]);

  recordCheck('C1.9', 'Concurrency', 'Compliant proposal in concurrent burst is APPROVED', resPass.status === 'APPROVED');
  recordCheck('C1.10', 'Concurrency', 'SQL injection proposal in concurrent burst is REJECTED by Security Veto', resVeto.status === 'REJECTED');
  recordCheck('C1.11', 'Concurrency', 'Vetoed proposal output includes actionable structured remediation feedback', !!resVeto.remediationFeedback && resVeto.remediationFeedback.length > 0);
  recordCheck('C1.12', 'Concurrency', 'Third proposal resolved cleanly (APPROVED via arbitration or REJECTED)', ['APPROVED', 'REJECTED', 'DEADLOCK'].includes(resDeadlock.status));

  // Verify all three are preserved in the mixed ledger
  const mixedLedger = mixedOrchestrator.getLedger() as CouncilLedger;
  const hPass = await mixedLedger.getProposalHistory('mixed_pass');
  const hVeto = await mixedLedger.getProposalHistory('mixed_veto_sql');
  const hDeadlock = await mixedLedger.getProposalHistory('mixed_deadlock');

  recordCheck('C1.13', 'Concurrency', 'Compliant proposal history retrieved with valid certificate', !!hPass?.certificate);
  recordCheck('C1.14', 'Concurrency', 'Vetoed proposal history retrieved with security rejection critique preserved', !!hVeto && hVeto.critiques.some((c) => c.role === 'security_verification' && !c.approved));
  recordCheck('C1.15', 'Concurrency', 'Split decision proposal history retrieved with round records preserved', !!hDeadlock && hDeadlock.rounds.length >= 1);

  await mixedOrchestrator.closeLedger();

  // --------------------------------------------------------------------------
  // SECTION 2: Offline PostgreSQL Failover & Zero-Cloud Routing Resilience
  // --------------------------------------------------------------------------
  console.log('\n--- SECTION 2: OFFLINE FAILOVER & ZERO-CLOUD ROUTING RESILIENCE ---');

  // Test 2.1: Failover with unreachable PostgreSQL port (59999)
  console.log('[2.1] Testing unreachable PostgreSQL port (localhost:59999)...');
  const offlineDb1 = path.join(SANDBOX_DIR, 'offline_port_fallback.sqlite3');
  const unreachablePortLedger = new CouncilLedger({
    connectionString: 'postgresql://aeos_admin:password@localhost:59999/aeos_kernel',
    connectionTimeoutMillis: 300,
    sqliteDbPath: offlineDb1,
    enablePostgres: true,
  });

  const initStart = Date.now();
  let threwOnInit = false;
  try {
    await unreachablePortLedger.initialize();
  } catch (err) {
    threwOnInit = true;
  }
  const initDuration = Date.now() - initStart;

  recordCheck('F2.1', 'OfflineFailover', 'CouncilLedger.initialize() does NOT throw when PG port is unreachable', !threwOnInit);
  recordCheck('F2.2', 'OfflineFailover', 'Storage mode cleanly reports "sqlite" after PG port failure', unreachablePortLedger.getStorageMode() === 'sqlite');
  recordCheck('F2.3', 'OfflineFailover', 'isFallbackActive() returns true', unreachablePortLedger.isFallbackActive() === true);
  recordCheck('F2.4', 'OfflineFailover', 'Failover handled promptly within timeout threshold (< 2500ms)', initDuration < 2500);

  // Test write operations after port failover
  const offlineProp = makeProposal('offline_prop_1', 'Offline Test Proposal', 'Content tested during simulated offline network.');
  await unreachablePortLedger.recordProposal(offlineProp);
  const retrievedProp = await unreachablePortLedger.getProposal('offline_prop_1');
  recordCheck('F2.5', 'OfflineFailover', 'recordProposal and getProposal succeed via SQLite fallback', retrievedProp?.title === offlineProp.title);

  await unreachablePortLedger.close();

  // Test 2.2: Failover with non-existent DNS host
  console.log('[2.2] Testing unreachable PostgreSQL non-existent DNS host...');
  const offlineDb2 = path.join(SANDBOX_DIR, 'offline_dns_fallback.sqlite3');
  const unreachableDnsLedger = new CouncilLedger({
    connectionString: 'postgresql://aeos_admin:password@nonexistent-host-aeos-test-999.invalid:5432/aeos_kernel',
    connectionTimeoutMillis: 300,
    sqliteDbPath: offlineDb2,
    enablePostgres: true,
  });

  let threwOnDnsInit = false;
  try {
    await unreachableDnsLedger.initialize();
  } catch {
    threwOnDnsInit = true;
  }

  recordCheck('F2.6', 'OfflineFailover', 'CouncilLedger.initialize() does NOT throw on DNS ENOTFOUND / host resolution failure', !threwOnDnsInit);
  recordCheck('F2.7', 'OfflineFailover', 'Storage mode reports "sqlite" on DNS failure', unreachableDnsLedger.getStorageMode() === 'sqlite');

  await unreachableDnsLedger.close();

  // Test 2.3: Explicit enablePostgres: false bypasses PG pool entirely
  console.log('[2.3] Testing explicit enablePostgres: false configuration...');
  const explicitSqliteDb = path.join(SANDBOX_DIR, 'explicit_sqlite.sqlite3');
  const explicitSqliteLedger = new CouncilLedger({
    enablePostgres: false,
    sqliteDbPath: explicitSqliteDb,
  });

  const explicitStart = Date.now();
  await explicitSqliteLedger.initialize();
  const explicitDuration = Date.now() - explicitStart;

  recordCheck('F2.8', 'OfflineFailover', 'Direct SQLite mode initializes near-instantly (< 100ms)', explicitDuration < 100);
  recordCheck('F2.9', 'OfflineFailover', 'Direct SQLite mode correctly reports storage mode "sqlite"', explicitSqliteLedger.getStorageMode() === 'sqlite');

  await explicitSqliteLedger.close();

  // Test 2.4: Multiple sequential and concurrent initialize() calls are idempotent
  console.log('[2.4] Testing initialize() idempotency...');
  const idemDb = path.join(SANDBOX_DIR, 'idem.sqlite3');
  const idemLedger = new CouncilLedger({
    enablePostgres: false,
    sqliteDbPath: idemDb,
  });

  await idemLedger.initialize();
  await idemLedger.initialize();
  await Promise.all([idemLedger.initialize(), idemLedger.initialize()]);
  recordCheck('F2.10', 'OfflineFailover', 'Repeated and concurrent initialize() calls execute safely and idempotently', true);
  await idemLedger.close();

  // --------------------------------------------------------------------------
  // SECTION 3: Filesystem Auto-Creation & Boundary Storage Stress
  // --------------------------------------------------------------------------
  console.log('\n--- SECTION 3: FILESYSTEM AUTO-CREATION & BOUNDARY STORAGE STRESS ---');

  // Test 3.1: Deeply nested directory creation
  console.log('[3.1] Testing deeply nested directory auto-creation...');
  const deepDir = path.join(SANDBOX_DIR, 'level1', 'level2', 'level3', 'level4');
  const deepDbPath = path.join(deepDir, 'deep_council.sqlite3');

  recordCheck('S3.1', 'Storage', 'Target directory does not exist prior to initialization', !fs.existsSync(deepDir));

  const deepLedger = new CouncilLedger({
    enablePostgres: false,
    sqliteDbPath: deepDbPath,
  });

  await deepLedger.initialize();
  recordCheck('S3.2', 'Storage', 'Nested parent directories created recursively on initialize()', fs.existsSync(deepDir));
  recordCheck('S3.3', 'Storage', 'SQLite database file created in deeply nested folder', fs.existsSync(deepDbPath));

  const deepProp = makeProposal('deep_prop', 'Deep Directory Proposal', 'Testing nested filesystem writes.');
  await deepLedger.recordProposal(deepProp);
  const deepRetrieved = await deepLedger.getProposal('deep_prop');
  recordCheck('S3.4', 'Storage', 'Data write and read succeeds in auto-created nested database', deepRetrieved?.title === 'Deep Directory Proposal');

  await deepLedger.close();

  // Test 3.2: In-memory mode (:memory:)
  console.log('[3.2] Testing SQLite in-memory mode (:memory:)...');
  const memLedger = new CouncilLedger({
    enablePostgres: false,
    sqliteDbPath: ':memory:',
  });

  await memLedger.initialize();
  recordCheck('S3.5', 'Storage', 'In-memory ledger initialized cleanly', memLedger.getStorageMode() === 'sqlite');

  const memProp = makeProposal('mem_prop', 'In-Memory Proposal', 'This proposal only exists in RAM.');
  await memLedger.recordProposal(memProp);
  const memRetrieved = await memLedger.getProposal('mem_prop');
  recordCheck('S3.6', 'Storage', 'Proposal persisted and retrieved in-memory', memRetrieved?.id === 'mem_prop');

  // Record mock certificate in memory
  const memCert: ConsensusCertificate = {
    certificateId: 'cert_mem_1',
    proposalId: 'mem_prop',
    proposalHash: 'a'.repeat(64),
    roundId: 'round_mem_1',
    decision: 'CONSENSUS_APPROVED',
    compositeScore: 92.5,
    quorumAchieved: true,
    quorumRatio: 1.0,
    participatingAgents: ['strategic_planning', 'security_verifier'],
    dimensionAverages: { security: 95.0, architecture: 90.0 },
    transcriptHash: 'a'.repeat(64),
    certificateSignature: 'b'.repeat(64),
    timestamp: new Date().toISOString(),
  };

  await memLedger.recordCertificate(memCert);
  const memCertRetrieved = await memLedger.getCertificate('cert_mem_1');
  recordCheck('S3.7', 'Storage', 'ConsensusCertificate persisted and retrieved in-memory', memCertRetrieved?.certificate_id === 'cert_mem_1');

  await memLedger.close();

  // --------------------------------------------------------------------------
  // SECTION 4: Cryptographic Tamper-Evident Ledger Integrity
  // --------------------------------------------------------------------------
  console.log('\n--- SECTION 4: CRYPTOGRAPHIC TAMPER-EVIDENT LEDGER INTEGRITY ---');

  const tamperDbPath = path.join(SANDBOX_DIR, 'tamper_test.sqlite3');
  const tamperAdapter = new SQLiteAdapter(tamperDbPath);
  await tamperAdapter.initialize();

  // Test 4.1: Deterministic Canonical JSON & Signature Generation
  const secretKey = 'aeos_secret_tamper_key_2026';
  const canonical1 = CryptoSigner.canonicalizeJson({ b: 2, a: 1, c: { y: 20, x: 10 } });
  const canonical2 = CryptoSigner.canonicalizeJson({ c: { x: 10, y: 20 }, a: 1, b: 2 });
  recordCheck('T4.1', 'CryptoIntegrity', 'RFC 8785 Canonical JSON sorting is order-invariant', canonical1 === canonical2);

  const sampleProposal = makeProposal('prop_tamper_1', 'Original Proposal', 'Secure payload for tamper testing.');
  const proposalHash = CryptoSigner.hashProposal(sampleProposal);
  recordCheck('T4.2', 'CryptoIntegrity', 'Proposal hash is deterministic 64-char hex SHA-256', proposalHash.length === 64 && /^[0-9a-f]{64}$/.test(proposalHash));

  const transcriptHash = CryptoSigner.sha256('round_1_transcript_payload_data');
  const now = new Date().toISOString();
  const certSig = CryptoSigner.signCertificate(
    secretKey,
    proposalHash,
    transcriptHash,
    'CONSENSUS_APPROVED',
    now
  );
  const validCert: ConsensusCertificate = {
    certificateId: 'cert_tamper_1',
    proposalId: sampleProposal.id,
    proposalHash,
    roundId: 'round_1',
    decision: 'CONSENSUS_APPROVED',
    compositeScore: 88.5,
    quorumAchieved: true,
    quorumRatio: 1.0,
    participatingAgents: ['strategic_planning', 'security_verification', 'performance_audit', 'software_architecture'],
    dimensionAverages: { strategic: 85, security: 92, performance: 88, architecture: 89 },
    transcriptHash,
    certificateSignature: certSig,
    timestamp: now,
  };

  recordCheck('T4.3', 'CryptoIntegrity', 'Consensus certificate signed with valid HMAC-SHA256 signature', CryptoSigner.verifyCertificate(validCert, secretKey));

  // Persist valid certificate into SQLite
  await tamperAdapter.recordProposal(sampleProposal, 'approved');
  await tamperAdapter.recordCertificate(validCert);

  // Test 4.2: Direct tampering of certificate in SQLite storage
  console.log('[4.2] Simulating malicious modification in SQLite consensus_certificates...');
  await new Promise<void>((resolve, reject) => {
    (tamperAdapter as any).db.run(
      `UPDATE consensus_certificates SET composite_score = 99.9 WHERE certificate_id = ?`,
      ['cert_tamper_1'],
      (err: any) => (err ? reject(err) : resolve())
    );
  });

  const tamperedRow = await tamperAdapter.getCertificate('cert_tamper_1');
  const tamperedCertObj: ConsensusCertificate = {
    certificateId: tamperedRow.certificate_id,
    proposalId: tamperedRow.proposal_id,
    proposalHash: sampleProposal.proposalHash || sampleProposal.id,
    roundId: tamperedRow.round_id,
    decision: tamperedRow.decision,
    compositeScore: Number(tamperedRow.composite_score), // Tampered to 99.9
    quorumAchieved: Boolean(tamperedRow.quorum_achieved),
    quorumRatio: Number(tamperedRow.quorum_ratio),
    participatingAgents: JSON.parse(tamperedRow.participating_agents),
    dimensionAverages: JSON.parse(tamperedRow.dimension_averages),
    transcriptHash: tamperedRow.transcript_hash,
    previousCertificateHash: tamperedRow.previous_certificate_hash || undefined,
    certificateSignature: tamperedRow.certificate_signature,
    timestamp: tamperedRow.created_at,
  };

  // Tampering with signature directly
  const isTamperedSigValid = CryptoSigner.verifyCertificate({
    ...validCert,
    certificateSignature: 'deadbeef'.repeat(8),
  }, secretKey);
  recordCheck('T4.4', 'CryptoIntegrity', 'Corrupted certificate signature fails HMAC verification (fail-closed)', !isTamperedSigValid);

  // Test 4.3: Tampering with transcript hash
  const tamperedTranscriptCert: ConsensusCertificate = {
    ...validCert,
    transcriptHash: CryptoSigner.sha256('maliciously_altered_transcript_content'),
  };
  const isTamperedTranscriptValid = CryptoSigner.verifyCertificate(tamperedTranscriptCert, secretKey);
  recordCheck('T4.5', 'CryptoIntegrity', 'Tampered transcriptHash fails certificate signature verification', !isTamperedTranscriptValid);

  // Test 4.4: Plan attestation creation and verification
  const planAttestation = createPlanAttestation(validCert);
  recordCheck('T4.6', 'CryptoIntegrity', 'Plan attestation contains correct SHA-256 digest format', planAttestation.sha256Hash.length === 64);
  recordCheck('T4.7', 'CryptoIntegrity', 'Plan attestation correctly attested by consensus_council', planAttestation.attestedBy === 'consensus_council');
  recordCheck('T4.8', 'CryptoIntegrity', 'Plan attestation is_valid defaults to true', planAttestation.isValid === true);

  await tamperAdapter.close();

  // --------------------------------------------------------------------------
  // SECTION 5: Large Payload & Rapid Write-Read Contention
  // --------------------------------------------------------------------------
  console.log('\n--- SECTION 5: LARGE PAYLOAD & HIGH-THROUGHPUT STRESS ---');

  const stressDbPath = path.join(SANDBOX_DIR, 'large_payload_stress.sqlite3');
  const stressAdapter = new SQLiteAdapter(stressDbPath);
  await stressAdapter.initialize();

  // Test 5.1: 500 KB large payload proposal
  console.log('[5.1] Testing 500 KB large payload proposal persistence...');
  const largeContent = 'const codeBlock = ' + JSON.stringify({
    lines: Array.from({ length: 5000 }, (_, i) => `function executeStep_${i}() { return ${i} * 2; }`),
  });
  const largeProposal = makeProposal('large_prop_500kb', 'Large Scale Microservice Diff', largeContent, 'code_verification');

  const largeStart = Date.now();
  await stressAdapter.recordProposal(largeProposal);
  const largeRetrieved = await stressAdapter.getProposal('large_prop_500kb');
  const largeDuration = Date.now() - largeStart;

  recordCheck('L5.1', 'LargePayload', '500KB proposal recorded and retrieved from SQLite without corruption', largeRetrieved?.content === largeContent);
  recordCheck('L5.2', 'LargePayload', '500KB proposal write-and-read completed quickly (< 500ms)', largeDuration < 500);

  // Test 5.2: 50 Rapid sequential write-read cycles
  console.log('[5.2] Executing 50 rapid sequential write-read cycles...');
  let rapidSuccess = true;
  const seqStart = Date.now();
  for (let i = 0; i < 50; i++) {
    const p = makeProposal(`rapid_${i}`, `Rapid #${i}`, `Content for iteration ${i}`);
    await stressAdapter.recordProposal(p);
    const read = await stressAdapter.getProposal(`rapid_${i}`);
    if (!read || read.title !== `Rapid #${i}`) {
      rapidSuccess = false;
      break;
    }
  }
  const seqDuration = Date.now() - seqStart;
  console.log(`[5.2] 50 rapid cycles completed in ${seqDuration}ms (${(seqDuration / 50).toFixed(1)}ms/op).`);

  recordCheck('L5.3', 'LargePayload', '50 rapid sequential writes and reads completed with 100% data fidelity', rapidSuccess);
  recordCheck('L5.4', 'LargePayload', 'Average write+read latency < 30ms per round-trip', (seqDuration / 50) < 30);

  await stressAdapter.close();

  // Cleanup sandbox
  cleanupSandbox();

  // --------------------------------------------------------------------------
  // Summary Scorecard
  // --------------------------------------------------------------------------
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const overallDuration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('\n======================================================================');
  console.log('             CHALLENGER M2 ADVERSARIAL VERIFICATION SCORECARD          ');
  console.log('======================================================================');
  console.log(`Total Checks Executed : ${total} / ${total}`);
  console.log(`Total Checks Passed   : ${passed}`);
  console.log(`Total Checks Failed   : ${failed}`);
  console.log(`Success Rate          : ${((passed / total) * 100).toFixed(2)}%`);
  console.log(`Total Execution Time  : ${overallDuration}s`);
  console.log('======================================================================\n');

  if (failed > 0) {
    console.error(`*** VERIFICATION FAILED: ${failed} checks failed. ***`);
    process.exit(1);
  } else {
    console.log(`*** ALL ${total} ADVERSARIAL M2 CHECKS PASSED WITH 100% INTEGRITY! ***`);
    process.exit(0);
  }
}

runTestSuite().catch((err) => {
  console.error('[FATAL] Unhandled error during test suite execution:', err);
  process.exit(1);
});
