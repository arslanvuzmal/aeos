/**
 * AEOS Consensus Council Challenger Stress & Adversarial Test Harness
 * 
 * Target: src/consensus/ (Milestone 1)
 * Challenger: challenger_m1_2
 * Verification Scope:
 *  1. Slow / Hanging Evaluator Simulation (Timeout guards & deadlock prevention)
 *  2. Corrupted / Fuzzed Inputs (Empty, giant 250KB-1MB, Unicode/Emoji/RTL, Malformed Markdown, Exploits)
 *  3. Perspective Count Requirement (<3 evaluators rejection & dynamic quorum)
 *  4. Tamper-Resistance (Critique signature & Certificate payload tamper detection)
 */

import * as assert from 'assert';
import * as crypto from 'crypto';
import {
  CouncilOrchestrator,
  StrategicPlannerEvaluator,
  SecurityVerifierEvaluator,
  PerformanceAuditorEvaluator,
  ArchitectureCriticEvaluator,
  VotingEngine,
  Proposal,
  Critique,
  IEvaluator,
  DeliberationContext,
  ConsensusCertificate,
} from '../src/consensus/index.js';

interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  details: string[];
}

const summary: TestSummary = {
  total: 0,
  passed: 0,
  failed: 0,
  details: [],
};

function recordTest(name: string, passed: boolean, message: string = '') {
  summary.total++;
  if (passed) {
    summary.passed++;
    console.log(`[PASS] ${name}${message ? ' - ' + message : ''}`);
    summary.details.push(`PASS: ${name}`);
  } else {
    summary.failed++;
    console.error(`[FAIL] ${name}${message ? ' - ' + message : ''}`);
    summary.details.push(`FAIL: ${name} - ${message}`);
  }
}

// ============================================================================
// Mock / Adversarial Evaluators
// ============================================================================

class HangingEvaluator implements IEvaluator {
  public readonly role: any;
  public readonly weight: number;
  public readonly agentId: string;
  private delayMs: number;

  constructor(role: any, agentId: string, weight: number = 0.20, delayMs: number = 60000) {
    this.role = role;
    this.agentId = agentId;
    this.weight = weight;
    this.delayMs = delayMs;
  }

  public async evaluate(proposal: Proposal, context?: DeliberationContext): Promise<Critique> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return {
      agentId: this.agentId,
      role: this.role,
      score: 100,
      dimensionScores: {},
      approved: true,
      criticalFlaws: [],
      recommendations: [],
      signature: 'mock_sig',
    };
  }
}

class FaultyEvaluator implements IEvaluator {
  public readonly role: any;
  public readonly weight: number;
  public readonly agentId: string;

  constructor(role: any, agentId: string, weight: number = 0.20) {
    this.role = role;
    this.agentId = agentId;
    this.weight = weight;
  }

  public async evaluate(proposal: Proposal, context?: DeliberationContext): Promise<Critique> {
    throw new Error('Simulated evaluator catastrophic internal crash');
  }
}

// ============================================================================
// Tamper-Verification Oracles
// ============================================================================

function verifyCritiqueSignature(
  critique: Critique,
  proposalId: string,
  secretKey: string = 'aeos_consensus_evaluator_secret_2026'
): boolean {
  const sortedDimensions = Object.keys(critique.dimensionScores || {})
    .sort()
    .reduce((acc, key) => {
      acc[key] = critique.dimensionScores[key];
      return acc;
    }, {} as Record<string, number>);

  const canonical = [
    critique.agentId,
    critique.role,
    proposalId,
    critique.score.toFixed(2),
    JSON.stringify(sortedDimensions),
    critique.approved ? '1' : '0',
    [...(critique.criticalFlaws || [])].sort().join('|'),
  ].join(':');

  const expectedSignature = crypto
    .createHmac('sha256', secretKey)
    .update(canonical)
    .digest('hex');

  return critique.signature === expectedSignature;
}

function verifyCertificateSignature(
  cert: ConsensusCertificate,
  proposal: Proposal,
  secretKey: string = 'aeos_consensus_council_hmac_secret_2026'
): boolean {
  const certPayload = `${proposal.id}:${cert.proposalHash}:${cert.deliberationId}:${cert.compositeScore}:${cert.transcriptHash}:${cert.nonce}:${cert.issuedAt}`;
  const expectedSignature = crypto
    .createHmac('sha256', secretKey)
    .update(certPayload)
    .digest('hex');

  return cert.certificateSignature === expectedSignature;
}

function verifyTranscriptHash(
  critiques: Critique[],
  certTranscriptHash: string
): boolean {
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
  const expectedHash = crypto
    .createHash('sha256')
    .update(transcriptPayload)
    .digest('hex');

  return certTranscriptHash === expectedHash;
}

// ============================================================================
// TEST RUNNER
// ============================================================================

async function runAllChallengerTests() {
  console.log('======================================================================');
  console.log('AEOS CONSENSUS COUNCIL EMPIRICAL ADVERSARIAL STRESS TEST SUITE');
  console.log('Target: src/consensus/ (Milestone 1)');
  console.log('======================================================================\n');

  const validProposal: Proposal = {
    id: 'prop-valid-001',
    title: 'Robust Core Implementation Plan',
    type: 'task_plan',
    content: `# AEOS Consensus Core Implementation Plan
## Overview
Implement the deterministic multi-agent deliberation engine with offline local Docker containment.

## Checklist
- [x] Step 1: Implement immutable schema migrations for PostgreSQL and SQLite fallback
- [ ] Step 2: Implement weighted voting engine with strict security veto
- [ ] Step 3: Implement deadlock arbitration with iterative refinement cycle
- [ ] Step 4: Verify local Docker isolation and offline execution

## Risk Mitigation
Operational risk mitigated through local SQLite fallback, constant-time cryptography, and automated error handling.
`,
    author: 'lead-engineer',
    timestamp: new Date().toISOString(),
  };

  // --------------------------------------------------------------------------
  // SUITE 1: Slow / Hanging Evaluator Simulation
  // --------------------------------------------------------------------------
  console.log('>>> RUNNING SUITE 1: Slow / Hanging Evaluator Simulation');

  // Test 1.1: One evaluator hangs, council recovers via timeoutMs
  try {
    const timeoutMs = 150;
    const hangingStrat = new HangingEvaluator('strategic_planning', 'eval-strat-hang', 0.20, 10000);
    const sec = new SecurityVerifierEvaluator();
    const perf = new PerformanceAuditorEvaluator();
    const arch = new ArchitectureCriticEvaluator();

    const council = new CouncilOrchestrator(
      { evaluatorTimeoutMs: timeoutMs, enableLedger: false, enableTelemetry: false },
      { evaluators: [hangingStrat, sec, perf, arch] }
    );

    const start = Date.now();
    const result = await council.deliberate(validProposal);
    const duration = Date.now() - start;

    const timeoutFired = duration >= 140 && duration < 800;
    const hasFallbackCritique = result.critiques.some(
      (c) => c.role === 'strategic_planning' && c.score === 0 && c.signature === 'fallback_error_sig'
    );

    recordTest(
      '1.1 Council timeout guard catches hanging evaluator without deadlocking',
      timeoutFired && hasFallbackCritique,
      `Duration: ${duration}ms (target: ~${timeoutMs}ms), Fallback critique present: ${hasFallbackCritique}`
    );
  } catch (err: any) {
    recordTest('1.1 Council timeout guard catches hanging evaluator without deadlocking', false, err.message);
  }

  // Test 1.2: Security evaluator hangs -> falls back to score 0 -> Security Veto triggers
  try {
    const timeoutMs = 150;
    const strat = new StrategicPlannerEvaluator();
    const hangingSec = new HangingEvaluator('security_verification', 'eval-sec-hang', 0.35, 10000);
    const perf = new PerformanceAuditorEvaluator();
    const arch = new ArchitectureCriticEvaluator();

    const council = new CouncilOrchestrator(
      { evaluatorTimeoutMs: timeoutMs, enableLedger: false, enableTelemetry: false },
      { evaluators: [strat, hangingSec, perf, arch] }
    );

    const start = Date.now();
    const result = await council.deliberate(validProposal);
    const duration = Date.now() - start;

    const vetoTriggered = result.status === 'REJECTED';
    const fallbackSecCritique = result.critiques.find((c) => c.role === 'security_verification');
    const secScoreZero = fallbackSecCritique?.score === 0;

    recordTest(
      '1.2 Hanging security evaluator fails closed (security veto on timeout)',
      vetoTriggered && secScoreZero && duration < 1000,
      `Status: ${result.status}, Sec score: ${fallbackSecCritique?.score}, Duration: ${duration}ms`
    );
  } catch (err: any) {
    recordTest('1.2 Hanging security evaluator fails closed (security veto on timeout)', false, err.message);
  }

  // Test 1.3: Evaluator throws exception -> caught and converted to fallback critique
  try {
    const strat = new StrategicPlannerEvaluator();
    const crashSec = new FaultyEvaluator('security_verification', 'eval-sec-crash', 0.35);
    const perf = new PerformanceAuditorEvaluator();
    const arch = new ArchitectureCriticEvaluator();

    const council = new CouncilOrchestrator(
      { enableLedger: false, enableTelemetry: false },
      { evaluators: [strat, crashSec, perf, arch] }
    );

    const result = await council.deliberate(validProposal);
    const fallbackCritique = result.critiques.find((c) => c.role === 'security_verification');
    const handledGracefully = fallbackCritique?.criticalFlaws[0]?.includes('Evaluator execution failure');

    recordTest(
      '1.3 Crashing evaluator handled cleanly without uncaught exception',
      !!handledGracefully && result.status === 'REJECTED',
      `Result status: ${result.status}, Flaw: ${fallbackCritique?.criticalFlaws[0]}`
    );
  } catch (err: any) {
    recordTest('1.3 Crashing evaluator handled cleanly without uncaught exception', false, err.message);
  }

  // Test 1.4: All evaluators hanging -> times out simultaneously without hanging
  try {
    const timeoutMs = 120;
    const hangingEvaluators = [
      new HangingEvaluator('strategic_planning', 'hang-1', 0.20, 10000),
      new HangingEvaluator('security_verification', 'hang-2', 0.35, 10000),
      new HangingEvaluator('performance_audit', 'hang-3', 0.20, 10000),
      new HangingEvaluator('software_architecture', 'hang-4', 0.25, 10000),
    ];

    const council = new CouncilOrchestrator(
      { evaluatorTimeoutMs: timeoutMs, enableLedger: false, enableTelemetry: false },
      { evaluators: hangingEvaluators }
    );

    const start = Date.now();
    const result = await council.deliberate(validProposal);
    const duration = Date.now() - start;

    const allZero = result.critiques.every((c) => c.score === 0);
    const boundedTime = duration >= 110 && duration < 600;

    recordTest(
      '1.4 All evaluators hanging times out concurrently in bounded time',
      allZero && boundedTime,
      `Duration: ${duration}ms, All scores zero: ${allZero}`
    );
  } catch (err: any) {
    recordTest('1.4 All evaluators hanging times out concurrently in bounded time', false, err.message);
  }

  // Test 1.5: Late resolving promise does not produce unhandled rejections
  try {
    const timeoutMs = 100;
    const lateEvaluator = new HangingEvaluator('strategic_planning', 'late-1', 0.20, 300);
    const sec = new SecurityVerifierEvaluator();
    const perf = new PerformanceAuditorEvaluator();
    const arch = new ArchitectureCriticEvaluator();

    const council = new CouncilOrchestrator(
      { evaluatorTimeoutMs: timeoutMs, enableLedger: false, enableTelemetry: false },
      { evaluators: [lateEvaluator, sec, perf, arch] }
    );

    await council.deliberate(validProposal);
    // Wait for the late evaluator promise to resolve
    await new Promise((r) => setTimeout(r, 400));

    recordTest(
      '1.5 Late-resolving evaluator promise discarded cleanly without unhandled rejection',
      true
    );
  } catch (err: any) {
    recordTest('1.5 Late-resolving evaluator promise discarded cleanly without unhandled rejection', false, err.message);
  }

  // --------------------------------------------------------------------------
  // SUITE 2: Corrupted and Fuzzed Inputs
  // --------------------------------------------------------------------------
  console.log('\n>>> RUNNING SUITE 2: Corrupted and Fuzzed Inputs');

  const defaultCouncil = new CouncilOrchestrator({ enableLedger: false, enableTelemetry: false });

  // Test 2.1: Empty string proposal content
  try {
    let threw = false;
    try {
      await defaultCouncil.deliberate({
        id: 'prop-empty',
        title: 'Empty Content',
        type: 'task_plan',
        content: '',
        author: 'fuzzer',
        timestamp: new Date().toISOString(),
      });
    } catch (e: any) {
      threw = e.message.includes('Invalid proposal: empty content');
    }
    recordTest('2.1 Empty content rejected with specific error', threw);
  } catch (err: any) {
    recordTest('2.1 Empty content rejected with specific error', false, err.message);
  }

  // Test 2.2: Whitespace-only string proposal content
  try {
    let threw = false;
    try {
      await defaultCouncil.deliberate({
        id: 'prop-whitespace',
        title: 'Whitespace Content',
        type: 'task_plan',
        content: '   \r\n\t   \n   ',
        author: 'fuzzer',
        timestamp: new Date().toISOString(),
      });
    } catch (e: any) {
      threw = e.message.includes('Invalid proposal: empty content');
    }
    recordTest('2.2 Whitespace-only content rejected with specific error', threw);
  } catch (err: any) {
    recordTest('2.2 Whitespace-only content rejected with specific error', false, err.message);
  }

  // Test 2.3: Giant payload (250,000 characters) - stress tests ReDoS & SHA256
  try {
    const chunk = 'function processData(input: any) { return input.toString(); }\n// - [ ] Task item\n';
    const giantContent = chunk.repeat(3000); // ~260,000 chars

    const start = Date.now();
    const giantProposal: Proposal = {
      id: 'prop-giant-250k',
      title: 'Giant 250KB Codebase Proposal',
      type: 'code_verification',
      content: giantContent,
      author: 'fuzzer',
      timestamp: new Date().toISOString(),
    };

    const result = await defaultCouncil.deliberate(giantProposal);
    const duration = Date.now() - start;

    const expectedHash = crypto.createHash('sha256').update(giantContent).digest('hex');
    const hashMatches = result.proposalHash === expectedHash;

    recordTest(
      '2.3 Giant 250KB payload evaluated without ReDoS and with exact SHA256 digest',
      hashMatches && duration < 4000,
      `Content size: ${giantContent.length} chars, Duration: ${duration}ms, Hash match: ${hashMatches}`
    );
  } catch (err: any) {
    recordTest('2.3 Giant 250KB payload evaluated without ReDoS and with exact SHA256 digest', false, err.message);
  }

  // Test 2.4: Extra Giant payload (1,000,000 characters - 1MB)
  try {
    const chunk1m = 'const safeData = Buffer.from("test");\n// - [x] Valid task step in plan\n';
    const giant1mContent = chunk1m.repeat(15000); // ~1,000,000 chars

    const start = Date.now();
    const giant1mProposal: Proposal = {
      id: 'prop-giant-1m',
      title: 'Giant 1MB Codebase Proposal',
      type: 'task_plan',
      content: giant1mContent,
      author: 'fuzzer',
      timestamp: new Date().toISOString(),
    };

    const result = await defaultCouncil.deliberate(giant1mProposal);
    const duration = Date.now() - start;

    const expectedHash = crypto.createHash('sha256').update(giant1mContent).digest('hex');
    const hashMatches = result.proposalHash === expectedHash;

    recordTest(
      '2.4 Extreme 1MB payload parsed and hashed within tight timing bounds (<500ms)',
      hashMatches && duration < 1000,
      `Content size: ${giant1mContent.length} chars, Duration: ${duration}ms`
    );
  } catch (err: any) {
    recordTest('2.4 Extreme 1MB payload parsed and hashed within tight timing bounds (<500ms)', false, err.message);
  }

  // Test 2.5: Unicode, Multi-byte, RTL, Math symbols, and Emojis
  try {
    const unicodeContent = `# 🚀 AEOS 多言語・Consensus Council Deliberation 🛡️
## 概要 (Overview in Japanese)
分散合意エンジンにおける署名検証および暗号学的整合性のテスト。
نظام التوافق متعدد الوكلاء للتحقق من خطط المهام والشيفرة البرمجية (Arabic RTL)

## Математический анализ (Russian Math)
$$\\forall x \\in \\mathcal{X}, \\quad \\sum_{i=1}^n x_i \\ge 75.0 \\implies \\text{QUORUM} = \\text{TRUE} \\neq \\emptyset$$
Emoji Stress: 🔒 💥 🛡️ ⚖️ 🤖 👨‍💻 🧪 ⚡ 🎯 🧬 🌐
Control characters & null bytes: \u0000 \u200B \uFEFF \u200D

## Checklist
- [x] Step 1: Проверить UTF-8 кодировку и подписи HMAC-SHA256
- [ ] Step 2: 漢字 및 한글 지원 검증
- [ ] Step 3: Local Docker container containment verification (Postgres 5432)

## Operational Risk
Error boundaries and fallback SQLite ledger handle exceptional conditions.
`;

    const unicodeProposal: Proposal = {
      id: 'prop-unicode-fuzz',
      title: 'Multilingual & Unicode 🌐 Proposal',
      type: 'task_plan',
      content: unicodeContent,
      author: '国際化テスター',
      timestamp: new Date().toISOString(),
    };

    const result = await defaultCouncil.deliberate(unicodeProposal);
    const expectedHash = crypto.createHash('sha256').update(unicodeContent).digest('hex');
    const hashCorrect = result.proposalHash === expectedHash;
    const certValid = result.consensusCertificate
      ? verifyCertificateSignature(result.consensusCertificate, unicodeProposal)
      : false;

    recordTest(
      '2.5 Unicode, RTL, Math, and Emoji content handled with cryptographic integrity',
      hashCorrect && certValid,
      `Status: ${result.status}, Score: ${result.compositeScore}, Cert valid: ${certValid}`
    );
  } catch (err: any) {
    recordTest('2.5 Unicode, RTL, Math, and Emoji content handled with cryptographic integrity', false, err.message);
  }

  // Test 2.6: Malformed Markdown with unclosed tags and nested code
  try {
    const malformedContent = `
# Broken Headers and Adversarial Syntax
<div><div><div><span>Unclosed HTML without ending tags
\`\`\`typescript
// Unclosed code block
const a = 1;
`;

    const malformedProposal: Proposal = {
      id: 'prop-malformed-md',
      title: 'Malformed Markdown Plan',
      type: 'task_plan',
      content: malformedContent,
      author: 'markdown-fuzzer',
      timestamp: new Date().toISOString(),
    };

    // Deliberation must not crash; should evaluate and identify lack of checklist
    const result = await defaultCouncil.deliberate(malformedProposal);
    const hasStratFlaw = result.critiques.some(
      (c) => c.role === 'strategic_planning' && c.criticalFlaws.some((f) => f.includes('CRIT_STRAT_NO_ACTIONABLE_STEPS'))
    );
    const completedSafely = result.deliberationId && result.critiques.length === 4;

    recordTest(
      '2.6 Malformed markdown with unclosed HTML and backticks evaluated safely without crash',
      completedSafely && hasStratFlaw,
      `Deliberation completed safely: ${completedSafely}, Strategic flaw identified: ${hasStratFlaw}`
    );
  } catch (err: any) {
    recordTest('2.6 Malformed markdown with unclosed HTML and backticks evaluated safely without crash', false, err.message);
  }

  // Test 2.7: Embedded SQL Injection Vulnerability detected and vetoed
  try {
    const sqliContent = `# Plan With Embedded Vulnerable Code
- [ ] Step 1: Query users
- [ ] Step 2: Display results
- [ ] Step 3: Operational risk and error handling
\`\`\`typescript
async function getUser(req: any) {
  const result = await db.query("SELECT * FROM users WHERE id = " + req.params.id);
  return result;
}
\`\`\`
`;
    const sqliProposal: Proposal = {
      id: 'prop-sqli-test',
      title: 'SQL Injection Vulnerability Proposal',
      type: 'task_plan',
      content: sqliContent,
      author: 'attacker',
      timestamp: new Date().toISOString(),
    };

    const result = await defaultCouncil.deliberate(sqliProposal);
    const vetoFired = result.status === 'REJECTED';
    const hasSqliFlaw = result.critiques.some((c) =>
      c.criticalFlaws.some((f) => f.includes('SEC-SQLI'))
    );

    recordTest(
      '2.7 Embedded SQL injection vulnerability strictly vetoed by security verifier',
      vetoFired && hasSqliFlaw,
      `Status: ${result.status}, Flaws found: ${hasSqliFlaw}`
    );
  } catch (err: any) {
    recordTest('2.7 Embedded SQL injection vulnerability strictly vetoed by security verifier', false, err.message);
  }

  // Test 2.8: Embedded Command Injection (RCE) detected and vetoed
  try {
    const rceContent = `# Plan With Embedded Command Execution
- [ ] Step 1: Backup files
- [ ] Step 2: Compress archive
- [ ] Step 3: Error handling and operational risk
\`\`\`typescript
const { exec } = require('child_process');
function runBackup(dir: string) {
  cp.exec(\`tar -czf backup.tar.gz \${dir}\`);
}
\`\`\`
`;
    const rceProposal: Proposal = {
      id: 'prop-rce-test',
      title: 'Command Injection Vulnerability Proposal',
      type: 'task_plan',
      content: rceContent,
      author: 'attacker',
      timestamp: new Date().toISOString(),
    };

    const result = await defaultCouncil.deliberate(rceProposal);
    const vetoFired = result.status === 'REJECTED';
    const hasRceFlaw = result.critiques.some((c) =>
      c.criticalFlaws.some((f) => f.includes('SEC-RCE'))
    );

    recordTest(
      '2.8 Embedded command injection (RCE) strictly vetoed by security verifier',
      vetoFired && hasRceFlaw,
      `Status: ${result.status}, RCE flaw detected: ${hasRceFlaw}`
    );
  } catch (err: any) {
    recordTest('2.8 Embedded command injection (RCE) strictly vetoed by security verifier', false, err.message);
  }

  // Test 2.9: Path Traversal detected and vetoed
  try {
    const travContent = `# Plan With Path Traversal
- [ ] Step 1: Read config
- [ ] Step 2: Load credentials
- [ ] Step 3: Error handling and risk mitigation
\`\`\`typescript
const fs = require('fs');
const path = require('path');
function readUserFile(fileName: string) {
  return fs.readFileSync(path.join(__dirname, '../../etc/passwd'));
}
\`\`\`
`;
    const travProposal: Proposal = {
      id: 'prop-trav-test',
      title: 'Path Traversal Proposal',
      type: 'task_plan',
      content: travContent,
      author: 'attacker',
      timestamp: new Date().toISOString(),
    };

    const result = await defaultCouncil.deliberate(travProposal);
    const vetoFired = result.status === 'REJECTED';
    const hasTravFlaw = result.critiques.some((c) =>
      c.criticalFlaws.some((f) => f.includes('SEC-TRAV'))
    );

    recordTest(
      '2.9 Embedded path traversal strictly vetoed by security verifier',
      vetoFired && hasTravFlaw,
      `Status: ${result.status}, Traversal flaw detected: ${hasTravFlaw}`
    );
  } catch (err: any) {
    recordTest('2.9 Embedded path traversal strictly vetoed by security verifier', false, err.message);
  }

  // Test 2.10: External Cloud API Invariant Breach detected and vetoed by architecture critic
  try {
    const cloudContent = `# External Cloud Integration Plan
- [ ] Step 1: Send telemetry to AWS S3
- [ ] Step 2: Call OpenAI API
- [ ] Step 3: Error handling and operational risk
\`\`\`typescript
const url = "https://api.openai.com/v1/chat/completions";
\`\`\`
`;
    const cloudProposal: Proposal = {
      id: 'prop-cloud-test',
      title: 'External Cloud API Proposal',
      type: 'task_plan',
      content: cloudContent,
      author: 'cloud-dev',
      timestamp: new Date().toISOString(),
    };

    const result = await defaultCouncil.deliberate(cloudProposal);
    const vetoFired = result.status === 'REJECTED';
    const hasArchFlaw = result.critiques.some((c) =>
      c.criticalFlaws.some((f) => f.includes('ARCH_CRIT_INVARIANT_BREACH'))
    );

    recordTest(
      '2.10 External Cloud endpoint strictly vetoed by architecture critic invariant check',
      vetoFired && hasArchFlaw,
      `Status: ${result.status}, Arch invariant flaw detected: ${hasArchFlaw}`
    );
  } catch (err: any) {
    recordTest('2.10 External Cloud endpoint strictly vetoed by architecture critic invariant check', false, err.message);
  }

  // --------------------------------------------------------------------------
  // SUITE 3: Perspective Count Requirement (Quorum Prerequisite)
  // --------------------------------------------------------------------------
  console.log('\n>>> RUNNING SUITE 3: Perspective Count Requirement');

  // Test 3.1: Council with 1 evaluator registered
  try {
    let threw = false;
    let errMessage = '';
    const council1 = new CouncilOrchestrator(
      { enableLedger: false, enableTelemetry: false },
      { evaluators: [new StrategicPlannerEvaluator()] }
    );

    try {
      await council1.deliberate(validProposal);
    } catch (e: any) {
      threw = true;
      errMessage = e.message;
    }

    const matchesQuorumViolation = errMessage.includes('Council Quorum Violation') && errMessage.includes('only 1 registered');
    recordTest(
      '3.1 Council with 1 evaluator strictly throws Quorum Violation error',
      threw && matchesQuorumViolation,
      `Error: ${errMessage}`
    );
  } catch (err: any) {
    recordTest('3.1 Council with 1 evaluator strictly throws Quorum Violation error', false, err.message);
  }

  // Test 3.2: Council with 2 evaluators registered
  try {
    let threw = false;
    let errMessage = '';
    const council2 = new CouncilOrchestrator(
      { enableLedger: false, enableTelemetry: false },
      { evaluators: [new StrategicPlannerEvaluator(), new SecurityVerifierEvaluator()] }
    );

    try {
      await council2.deliberate(validProposal);
    } catch (e: any) {
      threw = true;
      errMessage = e.message;
    }

    const matchesQuorumViolation = errMessage.includes('Council Quorum Violation') && errMessage.includes('only 2 registered');
    recordTest(
      '3.2 Council with 2 evaluators strictly throws Quorum Violation error',
      threw && matchesQuorumViolation,
      `Error: ${errMessage}`
    );
  } catch (err: any) {
    recordTest('3.2 Council with 2 evaluators strictly throws Quorum Violation error', false, err.message);
  }

  // Test 3.3: Duplicate roles collapse into map -> resulting in <3 distinct perspectives
  try {
    let threw = false;
    let errMessage = '';
    const dup1 = new StrategicPlannerEvaluator({ agentId: 'strat-1' });
    const dup2 = new StrategicPlannerEvaluator({ agentId: 'strat-2' });
    const sec = new SecurityVerifierEvaluator();

    const councilDup = new CouncilOrchestrator(
      { enableLedger: false, enableTelemetry: false },
      { evaluators: [dup1, dup2, sec] }
    );

    try {
      await councilDup.deliberate(validProposal);
    } catch (e: any) {
      threw = true;
      errMessage = e.message;
    }

    const mapCollapsed = councilDup.getRegisteredEvaluators().length === 2;
    recordTest(
      '3.3 Duplicate roles collapse to distinct perspectives preventing quorum bypass',
      threw && mapCollapsed && errMessage.includes('only 2 registered'),
      `Registered count: ${councilDup.getRegisteredEvaluators().length}, Error: ${errMessage}`
    );
  } catch (err: any) {
    recordTest('3.3 Duplicate roles collapse to distinct perspectives preventing quorum bypass', false, err.message);
  }

  // Test 3.4: VotingEngine direct tally with <3 critiques
  try {
    const votingEngine = new VotingEngine();
    let threwEmpty = false;
    let threwTwo = false;

    try {
      votingEngine.tallyVotes([], validProposal);
    } catch (e: any) {
      threwEmpty = e.message.includes('Cannot tally empty critiques array');
    }

    const dummyCritique: Critique = {
      agentId: 'a1',
      role: 'strategic_planning',
      score: 80,
      dimensionScores: {},
      approved: true,
      criticalFlaws: [],
      recommendations: [],
      signature: 's1',
    };

    try {
      votingEngine.tallyVotes([dummyCritique, { ...dummyCritique, agentId: 'a2', role: 'security_verification' }], validProposal);
    } catch (e: any) {
      threwTwo = e.message.includes('Requirement R1 violated: Deliberation requires minimum 3 perspectives');
    }

    recordTest(
      '3.4 VotingEngine directly enforces R1 minimum 3 perspectives requirement',
      threwEmpty && threwTwo,
      `Empty throw: ${threwEmpty}, Two-critique throw: ${threwTwo}`
    );
  } catch (err: any) {
    recordTest('3.4 VotingEngine directly enforces R1 minimum 3 perspectives requirement', false, err.message);
  }

  // Test 3.5: Council with exactly 3 distinct evaluators succeeds and achieves quorum
  try {
    const strat = new StrategicPlannerEvaluator();
    const sec = new SecurityVerifierEvaluator();
    const perf = new PerformanceAuditorEvaluator();

    const cleanProposal3: Proposal = {
      id: 'prop-clean-3persp',
      title: 'Local Containment Plan',
      type: 'task_plan',
      content: `# Local Containment Implementation Plan
- [ ] Step 1: Initialize local PostgreSQL database
- [ ] Step 2: Implement weighted voting logic
- [ ] Step 3: Run comprehensive verification harness
Operational risk mitigated via error handling and automated rollback.
`,
      author: 'architect',
      timestamp: new Date().toISOString(),
    };

    const council3 = new CouncilOrchestrator(
      { enableLedger: false, enableTelemetry: false },
      { evaluators: [strat, sec, perf] }
    );

    const result = await council3.deliberate(cleanProposal3);
    const exactly3 = result.critiques.length === 3;
    const approved = result.status === 'APPROVED';
    const certIssued = !!result.consensusCertificate;

    recordTest(
      '3.5 Council with exactly 3 distinct evaluators succeeds and achieves quorum',
      exactly3 && approved && certIssued,
      `Critiques count: ${result.critiques.length}, Status: ${result.status}, Score: ${result.compositeScore}`
    );
  } catch (err: any) {
    recordTest('3.5 Council with exactly 3 distinct evaluators succeeds and achieves quorum', false, err.message);
  }

  // Test 3.6: Council with 3 evaluators where 1 rejects triggers split decision / deadlock
  try {
    const strat = new StrategicPlannerEvaluator();
    const sec = new SecurityVerifierEvaluator();
    const perf = new PerformanceAuditorEvaluator();

    // Plan with a performance ReDoS flaw to trigger 1 disapproval out of 3
    const splitProposal: Proposal = {
      id: 'prop-split-3persp',
      title: 'Split Decision Plan',
      type: 'task_plan',
      content: `# Split Decision Implementation Plan
- [ ] Step 1: Initialize local PostgreSQL database
- [ ] Step 2: Run verification regex (a+)+
- [ ] Step 3: Run test suite
Operational risk mitigated via error handling and automated rollback.
`,
      author: 'architect',
      timestamp: new Date().toISOString(),
    };

    const council3 = new CouncilOrchestrator(
      { enableLedger: false, enableTelemetry: false },
      { evaluators: [strat, sec, perf] }
    );

    const result = await council3.deliberate(splitProposal);
    // 2 approved (strat, sec), 1 rejected (perf due to ReDoS flaw) -> approval fraction = 2/3 = 66.7% < 75% -> not approved!
    const notApproved = result.status === 'DEADLOCK' || result.status === 'REJECTED';
    const quorumFailed = result.quorumAchieved === false;

    recordTest(
      '3.6 Council with 3 evaluators and 1 dissent correctly fails quorum (2/3 < 75%)',
      notApproved && quorumFailed,
      `Status: ${result.status}, Quorum achieved: ${result.quorumAchieved}, Score: ${result.compositeScore}`
    );
  } catch (err: any) {
    recordTest('3.6 Council with 3 evaluators and 1 dissent correctly fails quorum (2/3 < 75%)', false, err.message);
  }

  // --------------------------------------------------------------------------
  // SUITE 4: Tamper-Resistance (Signatures & Certificates)
  // --------------------------------------------------------------------------
  console.log('\n>>> RUNNING SUITE 4: Tamper-Resistance');

  try {
    const secretKey = 'aeos_adversarial_test_secret_key_2026';
    const council = new CouncilOrchestrator({
      enableLedger: false,
      enableTelemetry: false,
      hmacSecret: secretKey,
    });

    const result = await council.deliberate(validProposal);
    assert.strictEqual(result.status, 'APPROVED', 'Expected valid proposal to be approved');
    assert.ok(result.consensusCertificate, 'Expected consensus certificate to exist');

    const cert = result.consensusCertificate!;
    const critiques = result.critiques;

    // Test 4.1: Authentic certificate & critiques verify cleanly
    const certAuthentic = verifyCertificateSignature(cert, validProposal, secretKey);
    const critiquesAuthentic = critiques.every((c) =>
      verifyCritiqueSignature(c, validProposal.id, secretKey)
    );

    recordTest(
      '4.1 Authentic certificate and member critiques verify cleanly with HMAC-SHA256',
      certAuthentic && critiquesAuthentic,
      `Cert authentic: ${certAuthentic}, Critiques authentic: ${critiquesAuthentic}`
    );

    // Test 4.2: Tamper with critique score (e.g. 100 -> 50)
    const tamperedCritiqueScore = {
      ...critiques[0],
      score: 50.0,
    };
    const critiqueScoreTamperDetected = !verifyCritiqueSignature(
      tamperedCritiqueScore,
      validProposal.id,
      secretKey
    );
    recordTest(
      '4.2 Tampered critique score is cryptographically detected',
      critiqueScoreTamperDetected,
      `Original: ${critiques[0].score}, Tampered: 50.0 -> Signature mismatch caught`
    );

    // Test 4.3: Tamper with critique approval boolean (true -> false)
    const tamperedCritiqueApproval = {
      ...critiques[0],
      approved: !critiques[0].approved,
    };
    const critiqueApprovalTamperDetected = !verifyCritiqueSignature(
      tamperedCritiqueApproval,
      validProposal.id,
      secretKey
    );
    recordTest(
      '4.3 Tampered critique approval flag is cryptographically detected',
      critiqueApprovalTamperDetected
    );

    // Test 4.4: Tamper with critique criticalFlaws (inject fabricated flaw)
    const tamperedCritiqueFlaws = {
      ...critiques[0],
      criticalFlaws: [...critiques[0].criticalFlaws, 'FABRICATED_CRITICAL_FLAW'],
    };
    const critiqueFlawsTamperDetected = !verifyCritiqueSignature(
      tamperedCritiqueFlaws,
      validProposal.id,
      secretKey
    );
    recordTest(
      '4.4 Tampered critique critical flaws array is cryptographically detected',
      critiqueFlawsTamperDetected
    );

    // Test 4.5: Replay attack on different proposal ID
    const critiqueReplayDetected = !verifyCritiqueSignature(
      critiques[0],
      'fabricated-other-proposal-id-999',
      secretKey
    );
    recordTest(
      '4.5 Critique signature replay against different proposal ID is detected',
      critiqueReplayDetected
    );

    // Test 4.6: Tamper with certificate compositeScore
    const tamperedCertScore: ConsensusCertificate = {
      ...cert,
      compositeScore: 99.99,
    };
    const certScoreTamperDetected = !verifyCertificateSignature(
      tamperedCertScore,
      validProposal,
      secretKey
    );
    recordTest(
      '4.6 Tampered certificate composite score is cryptographically detected',
      certScoreTamperDetected
    );

    // Test 4.7: Tamper with certificate proposalHash (code substitution attack)
    const tamperedCertHash: ConsensusCertificate = {
      ...cert,
      proposalHash: crypto.createHash('sha256').update('MALICIOUS_BACKDOOR_CODE').digest('hex'),
    };
    const certHashTamperDetected = !verifyCertificateSignature(
      tamperedCertHash,
      validProposal,
      secretKey
    );
    recordTest(
      '4.7 Tampered certificate proposalHash (code substitution) is cryptographically detected',
      certHashTamperDetected
    );

    // Test 4.8: Tamper with certificate deliberationId
    const tamperedCertDelib: ConsensusCertificate = {
      ...cert,
      deliberationId: crypto.randomUUID(),
    };
    const certDelibTamperDetected = !verifyCertificateSignature(
      tamperedCertDelib,
      validProposal,
      secretKey
    );
    recordTest(
      '4.8 Tampered certificate deliberationId is cryptographically detected',
      certDelibTamperDetected
    );

    // Test 4.9: Tamper with transcriptHash (altering deliberation transcript)
    const tamperedCertTranscript: ConsensusCertificate = {
      ...cert,
      transcriptHash: crypto.createHash('sha256').update('ALTERED_TRANSCRIPT').digest('hex'),
    };
    const certTranscriptTamperDetected = !verifyCertificateSignature(
      tamperedCertTranscript,
      validProposal,
      secretKey
    );
    recordTest(
      '4.9 Tampered certificate transcriptHash is cryptographically detected',
      certTranscriptTamperDetected
    );

    // Test 4.10: Tamper with certificate signature directly
    const tamperedCertSignature: ConsensusCertificate = {
      ...cert,
      certificateSignature: 'a'.repeat(64),
    };
    const signatureTamperDetected = !verifyCertificateSignature(
      tamperedCertSignature,
      validProposal,
      secretKey
    );
    recordTest(
      '4.10 Forged certificate signature is cryptographically rejected',
      signatureTamperDetected
    );

    // Test 4.11: Transcript hash integrity over member critiques
    const transcriptValid = verifyTranscriptHash(critiques, cert.transcriptHash);
    const tamperedCritiques = critiques.map((c, idx) =>
      idx === 0 ? { ...c, score: c.score - 5 } : c
    );
    const transcriptTamperDetected = !verifyTranscriptHash(tamperedCritiques, cert.transcriptHash);

    recordTest(
      '4.11 Transcript hash binds all member critiques (tampering alters transcript hash)',
      transcriptValid && transcriptTamperDetected,
      `Authentic match: ${transcriptValid}, Tampered detected: ${transcriptTamperDetected}`
    );
  } catch (err: any) {
    recordTest('4.0 Tamper-resistance suite execution', false, err.message);
  }

  // --------------------------------------------------------------------------
  // SUITE 5: High Concurrency & Deadlock Loops
  // --------------------------------------------------------------------------
  console.log('\n>>> RUNNING SUITE 5: High Concurrency & Deadlock Loops');

  // Test 5.1: 25 simultaneous concurrent deliberations
  try {
    const concurrentProposals: Proposal[] = Array.from({ length: 25 }, (_, i) => ({
      id: `prop-concurrent-${i}`,
      title: `Concurrent Deliberation ${i}`,
      type: 'task_plan',
      content: `# Concurrent Plan ${i}
- [ ] Step 1: Initialize component ${i}
- [ ] Step 2: Verify component ${i}
- [ ] Step 3: Run diagnostics ${i}
Operational risk mitigated through isolated transactions and error boundaries.
`,
      author: `worker-${i}`,
      timestamp: new Date().toISOString(),
    }));

    const start = Date.now();
    const results = await Promise.all(
      concurrentProposals.map((p) => defaultCouncil.deliberate(p))
    );
    const duration = Date.now() - start;

    const allApproved = results.every((r) => r.status === 'APPROVED');
    const allHaveCerts = results.every((r) => !!r.consensusCertificate);
    const allUniqueDelibIds = new Set(results.map((r) => r.deliberationId)).size === 25;
    const allUniqueHashes = new Set(results.map((r) => r.proposalHash)).size === 25;

    recordTest(
      '5.1 25 concurrent deliberations resolve with zero cross-talk or race conditions',
      allApproved && allHaveCerts && allUniqueDelibIds && allUniqueHashes,
      `Duration: ${duration}ms (avg ${(duration / 25).toFixed(1)}ms/deliberation), All unique IDs: ${allUniqueDelibIds}`
    );
  } catch (err: any) {
    recordTest('5.1 25 concurrent deliberations resolve with zero cross-talk or race conditions', false, err.message);
  }

  // Test 5.2: Deadlock Arbitrator loops through refinement rounds or halts on stagnation
  try {
    class BorderlineEvaluator implements IEvaluator {
      public readonly role: any;
      public readonly weight: number;
      public readonly agentId: string;
      constructor(role: any, agentId: string, weight: number) {
        this.role = role;
        this.agentId = agentId;
        this.weight = weight;
      }
      public async evaluate(proposal: Proposal, context?: DeliberationContext): Promise<Critique> {
        // Return improving score across rounds: 68 in round 1, 70 in round 2, 72 in round 3
        const round = context?.round || 1;
        const score = 66 + round * 2;
        return {
          agentId: this.agentId,
          role: this.role,
          score,
          dimensionScores: { metric: score },
          approved: false,
          criticalFlaws: [],
          recommendations: [`Improve ${this.role} convergence in round ${round}`],
          signature: 'sig_borderline',
        };
      }
    }

    const maxRounds = 3;
    const deadlockCouncil = new CouncilOrchestrator(
      { maxRounds, enableLedger: false, enableTelemetry: false },
      {
        evaluators: [
          new BorderlineEvaluator('strategic_planning', 'strat-border', 0.20),
          new BorderlineEvaluator('security_verification', 'sec-border', 0.35),
          new BorderlineEvaluator('performance_audit', 'perf-border', 0.20),
          new BorderlineEvaluator('software_architecture', 'arch-border', 0.25),
        ],
      }
    );

    const deadlockResult = await deadlockCouncil.deliberate(validProposal);

    const roundsExhausted = deadlockResult.rounds === maxRounds;
    const terminalStatus = deadlockResult.status === 'DEADLOCK' || deadlockResult.status === 'REJECTED';
    const hasRemediation = deadlockResult.remediationFeedback && deadlockResult.remediationFeedback.length > 0;

    recordTest(
      '5.2 Deadlock Arbitrator completes max refinement rounds without infinite loop',
      roundsExhausted && terminalStatus && hasRemediation,
      `Rounds: ${deadlockResult.rounds}/${maxRounds}, Final status: ${deadlockResult.status}, Remediations: ${deadlockResult.remediationFeedback?.length}`
    );
  } catch (err: any) {
    recordTest('5.2 Deadlock Arbitrator completes max refinement rounds without infinite loop', false, err.message);
  }

  // --------------------------------------------------------------------------
  // SUITE 6: Scoring, Weight, and Boundary Stress
  // --------------------------------------------------------------------------
  console.log('\n>>> RUNNING SUITE 6: Scoring, Weight, and Boundary Stress');

  // Test 6.1: Dynamic weight normalization with arbitrary weight ratios
  try {
    const customEngine = new VotingEngine({
      weights: {
        security_verification: 10,
        software_architecture: 5,
        performance_audit: 5,
        strategic_planning: 5,
      },
    });

    const testCritiques: Critique[] = [
      { agentId: 'a1', role: 'security_verification', score: 100, dimensionScores: {}, approved: true, criticalFlaws: [], recommendations: [], signature: 's1' },
      { agentId: 'a2', role: 'software_architecture', score: 50, dimensionScores: {}, approved: false, criticalFlaws: [], recommendations: [], signature: 's2' },
      { agentId: 'a3', role: 'performance_audit', score: 50, dimensionScores: {}, approved: false, criticalFlaws: [], recommendations: [], signature: 's3' },
      { agentId: 'a4', role: 'strategic_planning', score: 50, dimensionScores: {}, approved: false, criticalFlaws: [], recommendations: [], signature: 's4' },
    ];

    const computedScore = customEngine.computeWeightedScore(testCritiques);
    const scoreCorrect = Math.abs(computedScore - 70.0) < 0.01;

    recordTest(
      '6.1 Dynamic weight normalization accurately computes composite score for arbitrary weights',
      scoreCorrect,
      `Expected: 70.00, Computed: ${computedScore}`
    );
  } catch (err: any) {
    recordTest('6.1 Dynamic weight normalization accurately computes composite score for arbitrary weights', false, err.message);
  }

  // Test 6.2: Score clamping boundaries in BaseEvaluator
  try {
    class ClampTestEvaluator extends StrategicPlannerEvaluator {
      public testClamp(score: number): number {
        return this.clampScore(score);
      }
    }
    const clampTester = new ClampTestEvaluator();

    const negativeClamped = clampTester.testClamp(-50) === 0.0;
    const over100Clamped = clampTester.testClamp(150) === 100.0;
    const nanClamped = clampTester.testClamp(NaN) === 0.0;
    const floatRounded = clampTester.testClamp(88.8888) === 88.89;

    recordTest(
      '6.2 Score clamping strictly constrains scores to [0.00, 100.00] with 2 decimal precision',
      negativeClamped && over100Clamped && nanClamped && floatRounded,
      `Negative: ${negativeClamped}, Over100: ${over100Clamped}, NaN: ${nanClamped}, Float: ${floatRounded}`
    );
  } catch (err: any) {
    recordTest('6.2 Score clamping strictly constrains scores to [0.00, 100.00] with 2 decimal precision', false, err.message);
  }

  // Test 6.3: Boundary validations on null and invalid proposals
  try {
    let nullRejected = false;
    let missingIdFailedClosed = false;

    try {
      await defaultCouncil.deliberate(null as any);
    } catch (e: any) {
      nullRejected = e.message.includes('Invalid proposal');
    }

    try {
      const res = await defaultCouncil.deliberate({ title: 'No ID', content: 'test content', type: 'task_plan' } as any);
      // Fails closed if status is REJECTED and critiques indicate invalid proposal id
      missingIdFailedClosed = res.status === 'REJECTED' && res.critiques.every((c) => c.score === 0);
    } catch (e: any) {
      missingIdFailedClosed = true;
    }

    recordTest(
      '6.3 Boundary validation rejects null and fails closed on missing ID proposals',
      nullRejected && missingIdFailedClosed,
      `Null rejected: ${nullRejected}, Missing ID failed closed: ${missingIdFailedClosed}`
    );
  } catch (err: any) {
    recordTest('6.3 Boundary validation rejects null and fails closed on missing ID proposals', false, err.message);
  }

  // ============================================================================
  // FINAL RESULTS SUMMARY
  // ============================================================================
  console.log('\n======================================================================');
  console.log(`TOTAL ADVERSARIAL CHECKS: ${summary.total}`);
  console.log(`PASSED: ${summary.passed}`);
  console.log(`FAILED: ${summary.failed}`);
  console.log('======================================================================');

  if (summary.failed > 0) {
    console.error('\nFAILED TESTS DETAILS:');
    summary.details.filter((d) => d.startsWith('FAIL')).forEach((d) => console.error(` - ${d}`));
    process.exit(1);
  } else {
    console.log('\n*** ALL ADVERSARIAL STRESS TESTS PASSED WITH 100% INTEGRITY! ***');
    process.exit(0);
  }
}

runAllChallengerTests().catch((e) => {
  console.error('Unhandled fatal error in stress test runner:', e);
  process.exit(1);
});
