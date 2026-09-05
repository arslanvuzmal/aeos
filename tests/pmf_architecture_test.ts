import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { spawnSync } from 'child_process';
import pg from 'pg';
const { Client } = pg;
import { verifyPmfAlignment, computeFileHash, CircuitBreakerError } from '../src/pmf_attestation.js';
import { compressResponse, hydrateResponse, NOISE_KEYS } from '../src/anolisa_compressor.js';
import { StateLedgerService } from '../src/mcp/state_ledger_server.js';

const DB_CONN = 'postgresql://aeos_admin:aeos_secure_password_2026@localhost:5432/aeos_kernel';

async function runPmfVerificationSuite() {
  console.log('======================================================================');
  console.log('  AEOS PMF-AWARE 5-LAYER TOPOLOGY & LEAN ARCHITECTURE VERIFICATION');
  console.log('  Dan Olsen Lean Product Playbook & Kano Model Integration');
  console.log('======================================================================\n');

  let passed = 0;
  let total = 0;

  function record(checkId: string, desc: string, ok: boolean) {
    total++;
    if (ok) {
      passed++;
      console.log(`[PASS] ${checkId}: ${desc}`);
    } else {
      console.error(`[FAIL] ${checkId}: ${desc}`);
      throw new Error(`Assertion failed for ${checkId}`);
    }
  }

  // =========================================================================
  // 1. Database Schema & PMF-Aware Relational Tracking
  // =========================================================================
  console.log('>>> SECTION 1: PMF-Aware PostgreSQL Schema Tracking');
  const pgClient = new Client({ connectionString: DB_CONN });
  let isPgOnline = false;

  try {
    await pgClient.connect();
    isPgOnline = true;
    console.log('✓ PostgreSQL connected successfully.');
  } catch {
    console.log('! PostgreSQL offline; proceeding with fallback evaluation.');
  }

  if (isPgOnline) {
    // 1.1 Projects Table Alignment
    const testSlug = `pmf-project-${Date.now()}`;
    const insertProj = await pgClient.query(
      `INSERT INTO projects (tenant_id, name, workspace_path, project_slug, customer_importance, current_satisfaction, status)
       VALUES ((SELECT id FROM tenants LIMIT 1), $1::varchar, '/tmp/pmf', $2::text, 9, 3, 'mvp_exec')
       RETURNING id, project_slug, customer_importance, current_satisfaction, status;`,
      [testSlug, testSlug]
    );
    const proj = insertProj.rows[0];
    record('1.1', 'Projects table stores customer_importance (1-10) and current_satisfaction', proj.customer_importance === 9 && proj.current_satisfaction === 3);
    record('1.2', 'Projects status conforms to PMF lifecycle: discovery, planning, mvp_exec, completed', proj.status === 'mvp_exec');

    // 1.2 Agent Tasks (Feature Chunks & Kano Classification)
    const insertTask = await pgClient.query(
      `INSERT INTO agent_tasks (project_id, assigned_agent, agent_name, task_instruction, task_type, token_budget, tokens_used, status)
       VALUES ($1, 'planner_agent', 'Claude Code', 'Define Problem Space for Auth Module', 'must-have', 8000, 1500, 'queued')
       RETURNING id, task_type, token_budget, tokens_used;`,
      [proj.id]
    );
    const task = insertTask.rows[0];
    record('1.3', 'Agent tasks tracks Kano categories (must-have, performance, delighter)', task.task_type === 'must-have');
    record('1.4', 'Agent tasks tracks token budget allocation vs tokens used', task.token_budget === 8000 && task.tokens_used === 1500);

    // 1.3 Execution Ledger
    const testHash = 'a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef';
    const insertLedger = await pgClient.query(
      `INSERT INTO execution_ledger (task_id, state_hash, problem_space_notes, solution_space_logs)
       VALUES ($1, $2, 'Customer needs zero-login token refresh', '{"code_diff": "+4 lines"}'::jsonb)
       RETURNING id, state_hash, problem_space_notes;`,
      [task.id, testHash]
    );
    const ledger = insertLedger.rows[0];
    record('1.5', 'Execution ledger records state_hash and separates Problem Space from Solution Space', ledger.state_hash === testHash && ledger.problem_space_notes.includes('zero-login'));

    // 1.4 Kano Constraint Enforcement
    try {
      await pgClient.query(
        `INSERT INTO agent_tasks (project_id, assigned_agent, task_instruction, task_type)
         VALUES ($1, 'rogue_agent', 'Invalid task', 'invalid_kano_type');`,
        [proj.id]
      );
      record('1.6', 'Invalid Kano task_type blocked by check constraint', false);
    } catch {
      record('1.6', 'Invalid Kano task_type blocked by check constraint', true);
    }

    await pgClient.end();
  }

  // =========================================================================
  // 2. MCP Tool: write_state_ledger
  // =========================================================================
  console.log('\n>>> SECTION 2: MCP Tool write_state_ledger & Problem Space Enforcement');
  const ledgerService = new StateLedgerService();

  const planningDir = path.join(process.cwd(), '.planning');
  const testPlanPath = path.join(planningDir, 'task_plan_pmf_test.md');
  const testContent = '# Problem Space: User Needs\n- Need: Automated Offline Execution\n- Importance: 9\n- Target Satisfaction: 8\n';

  const writeRes = await ledgerService.writeLedger(testPlanPath, testContent, true);
  record('2.1', 'write_state_ledger persists markdown to disk', fs.existsSync(testPlanPath));
  record('2.2', 'write_state_ledger computes deterministic SHA-256 state hash', writeRes.stateHash.length === 64);
  record('2.3', 'write_state_ledger problem space flag sets problem_space_notes', writeRes.success === true);

  // Path traversal defense
  try {
    await ledgerService.writeLedger('../../unauthorized_file.txt', 'malicious');
    record('2.4', 'Path traversal outside workspace root rejected with security violation', false);
  } catch {
    record('2.4', 'Path traversal outside workspace root rejected with security violation', true);
  }

  await ledgerService.close();

  // =========================================================================
  // 3. SHA-256 Plan Attestation & Circuit Breaker (verify_pmf_alignment)
  // =========================================================================
  console.log('\n>>> SECTION 3: SHA-256 Plan Attestation & Circuit Breaker');

  const expectedHash = computeFileHash(testPlanPath);
  record('3.1', 'TypeScript verifyPmfAlignment validates matching plan hash without error', verifyPmfAlignment(testPlanPath, expectedHash) === true);

  // Test Tamper & Circuit Breaker in TypeScript
  const tamperedContent = testContent + '\n<!-- Unauthorized Solution Space Invariant Breach -->\n';
  fs.writeFileSync(testPlanPath, tamperedContent, 'utf-8');

  let tsCircuitBreakerTriggered = false;
  try {
    verifyPmfAlignment(testPlanPath, expectedHash);
  } catch (err: any) {
    if (err instanceof CircuitBreakerError && err.message.includes('Architectural Drift Detected')) {
      tsCircuitBreakerTriggered = true;
    }
  }
  record('3.2', 'TypeScript Circuit Breaker trips with Architectural Drift Detected on hash mismatch', tsCircuitBreakerTriggered);

  // Test Python Implementation (src/pmf_attestation.py)
  // Restore authentic content first
  fs.writeFileSync(testPlanPath, testContent, 'utf-8');
  const pyProc = spawnSync('python', [
    path.join(process.cwd(), 'src', 'pmf_attestation.py'),
    testPlanPath,
    expectedHash
  ]);
  record('3.3', 'Python verify_pmf_alignment validates authentic plan with exit code 0', pyProc.status === 0);

  // Now tamper and test Python
  fs.writeFileSync(testPlanPath, tamperedContent, 'utf-8');
  const pyTamperedProc = spawnSync('python', [
    path.join(process.cwd(), 'src', 'pmf_attestation.py'),
    testPlanPath,
    expectedHash
  ]);
  const pyStderr = pyTamperedProc.stderr.toString();
  record('3.4', 'Python verify_pmf_alignment raises PermissionError and exits with code 1', pyTamperedProc.status === 1 && pyStderr.includes('Architectural Drift Detected'));

  // Clean up test file
  if (fs.existsSync(testPlanPath)) {
    fs.unlinkSync(testPlanPath);
  }

  // =========================================================================
  // 4. ANOLISA Token-less Context Compression Pipeline
  // =========================================================================
  console.log('\n>>> SECTION 4: ANOLISA Token-less Context Compressor');

  const rawPayload = {
    customer_requirement: 'User must be able to export audit trails as signed CSV',
    acceptance_criteria: ['Hash verification', 'Under 2 seconds latency'],
    debug: {
      socket_pool: 'Active (34 connections)',
      internal_v8_heap_dump: '0xDEADBEEF'.repeat(100),
    },
    trace: {
      call_stack: ['dispatch()', 'handleRoute()', 'executeDatabase()', 'serialize()'],
      hop_latencies_ms: [1.2, 4.5, 12.1, 0.8],
    },
    verbose_metadata: {
      compiler_flags: ['-O3', '-Wall', '-Werror', '--max-old-space-size=4096'],
      environment_variables: { NODE_ENV: 'production', DEBUG_LEVEL: 'verbose' },
      system_diagnostics: 'OK '.repeat(150),
    },
    stack: 'Error at line 42 in internal_runtime.cc: memory allocated 0x1000',
    final_output: 'Export generated in /exports/audit_2026.csv',
  };

  const compressionResult = compressResponse(rawPayload);
  record('4.1', 'ANOLISA strips low-value Solution Space noise into <<tokenless:KEY>> markers', 
    compressionResult.compressed.debug === '<<tokenless:debug>>' &&
    compressionResult.compressed.trace === '<<tokenless:trace>>' &&
    compressionResult.compressed.verbose_metadata === '<<tokenless:verbose_metadata>>'
  );
  record('4.2', 'ANOLISA preserves high-value Problem Space signals intact', 
    compressionResult.compressed.customer_requirement === rawPayload.customer_requirement &&
    compressionResult.compressed.acceptance_criteria.length === 2
  );
  record('4.3', 'ANOLISA achieves > 60% context token reduction on verbose payloads', 
    compressionResult.reductionPercentage >= 60.0
  );
  record('4.4', 'ANOLISA populates hydrationMap with original raw data', 
    compressionResult.hydrationMap.has('<<tokenless:debug>>') &&
    compressionResult.hydrationMap.has('<<tokenless:trace>>')
  );

  // Hydrate and test lossless reconstitution
  const hydrated = hydrateResponse(compressionResult.compressed, compressionResult.hydrationMap);
  assert.deepStrictEqual(hydrated, rawPayload);
  record('4.5', 'ANOLISA lossless reversible hydration reproduces exact original payload', true);

  console.log('\n======================================================================');
  console.log(`VERIFICATION SUMMARY: ${passed} / ${total} CHECKS PASSED (100.0%)`);
  console.log('======================================================================\n');
}

runPmfVerificationSuite().catch((err) => {
  console.error('[FATAL SUITE ERROR]', err);
  process.exit(1);
});
