import * as assert from 'assert';
import { Client } from 'pg';
import { KernelScheduler } from '../src/kernel_scheduler.js';

const DB_CONN = 'postgresql://aeos_admin:aeos_secure_password_2026@localhost:5432/aeos_kernel';

async function runPhase5TestSuite() {
  console.log('=== STARTING PHASE 5 VERIFICATION TEST SUITE ===\n');
  const scheduler = new KernelScheduler();

  // -------------------------------------------------------------
  // Test 1: Priority Queue & Context Switching
  // -------------------------------------------------------------
  console.log('[TEST 1] Testing Thread Spawning & Priority Round-Robin Scheduling...');
  const switchedOrder: string[] = [];

  scheduler.on('context_switch', (evt) => {
    switchedOrder.push(`${evt.role}(p:${evt.priority})`);
  });

  scheduler.spawnThread('agent_debug', 'debugger', 2, 2000);
  scheduler.spawnThread('agent_qa', 'qa_tester', 4, 3000);
  scheduler.spawnThread('agent_coder', 'coder', 7, 4000);
  scheduler.spawnThread('agent_planner', 'planner', 9, 5000);

  // Cycle through all 4 ready threads
  for (let i = 0; i < 4; i++) {
    await scheduler.scheduleNextCycle();
  }

  console.log('✓ Scheduled Thread Sequence:', switchedOrder.join(' -> '));
  assert.strictEqual(
    switchedOrder[0],
    'planner(p:9)',
    'Highest priority thread (Planner) was not scheduled first.'
  );
  assert.strictEqual(
    switchedOrder[1],
    'coder(p:7)',
    'Second priority thread (Coder) was not scheduled second.'
  );
  console.log('✓ Priority-based scheduling queue verified.\n');

  // -------------------------------------------------------------
  // Test 2: Token Quota Enforcement & WAITING Trap
  // -------------------------------------------------------------
  console.log('[TEST 2] Testing Token Quota Trapping & WAITING State Transition...');
  const testPid = scheduler.spawnThread('agent_coder_token_trap', 'coder', 5, 1000);
  let quotaAlertTriggered = false;

  scheduler.on('quota_exceeded', (evt) => {
    if (evt.pid === testPid) {
      quotaAlertTriggered = true;
      console.log(`✓ Caught quota_exceeded event for PID ${evt.pid} (Consumed: ${evt.consumed}/${evt.limit})`);
    }
  });

  // Turn consumption below limit
  const pass = scheduler.accountTokens(testPid, 600);
  assert.strictEqual(pass, true, 'Token accounting incorrectly failed under limit.');
  assert.strictEqual(scheduler.getProcess(testPid)?.state, 'READY');

  // Turn consumption breaches limit (600 + 500 = 1100 > 1000)
  const fail = scheduler.accountTokens(testPid, 500);
  assert.strictEqual(fail, false, 'Token accounting failed to trap quota breach.');
  assert.strictEqual(quotaAlertTriggered, true, 'quota_exceeded event was not broadcast.');
  assert.strictEqual(
    scheduler.getProcess(testPid)?.state,
    'WAITING',
    'Process was not moved to WAITING state upon exceeding budget.'
  );

  // Reset turn budget
  scheduler.resetTurnBudget(testPid);
  assert.strictEqual(
    scheduler.getProcess(testPid)?.state,
    'READY',
    'Process was not restored to READY after budget reset.'
  );
  console.log('✓ Token quota policing and state recovery verified.\n');

  // -------------------------------------------------------------
  // Test 3: Hardened Docker Sandbox Execution & Network Severance
  // -------------------------------------------------------------
  console.log('[TEST 3] Testing Docker Sandbox Container & Network Severance...');
  const sandboxPid = scheduler.spawnThread('sandbox_worker', 'coder', 8, 4000);

  // Verify basic stdout & environment
  const basicResult = await scheduler.executeInSandbox(
    sandboxPid,
    ['node', '-e', 'console.log("AEOS_SANDBOX_ONLINE"); console.log("MATH_CHECK:" + (40+2));']
  );

  console.log('✓ Container Output:\n ', basicResult.stdout.trim());
  assert.ok(basicResult.stdout.includes('AEOS_SANDBOX_ONLINE'));
  assert.ok(basicResult.stdout.includes('MATH_CHECK:42'));
  assert.strictEqual(basicResult.exitCode, 0);

  // Verify network is severed (NetworkMode: none)
  const netResult = await scheduler.executeInSandbox(
    sandboxPid,
    ['node', '-e', 'require("dns").lookup("google.com", (err) => { if (err) console.log("NET_SEVERED"); else console.log("NET_LEAK"); });']
  );
  console.log('✓ Network Isolation Output:\n ', netResult.stdout.trim());
  assert.ok(netResult.stdout.includes('NET_SEVERED'), 'Container was able to perform external network lookups!');
  console.log('✓ Sandboxed execution and network isolation verified.\n');

  // -------------------------------------------------------------
  // Test 4: Preemptive Execution Timeout Termination
  // -------------------------------------------------------------
  console.log('[TEST 4] Testing Preemptive Execution Quantum Timeout...');
  const runawayPid = scheduler.spawnThread('runaway_worker', 'coder', 5, 2000);
  let timeoutCaught = false;

  try {
    // Execute an infinite loop with a 1,200ms timeout
    await scheduler.executeInSandbox(
      runawayPid,
      ['node', '-e', 'while(true) {}'],
      { timeoutMs: 1200 }
    );
  } catch (err: any) {
    timeoutCaught = true;
    console.log(`✓ Caught expected execution termination: ${err.message}`);
    assert.ok(err.message.includes('[KERNEL TIMEOUT]'));
  }

  assert.strictEqual(timeoutCaught, true, 'Scheduler failed to preempt infinite loop execution.');
  assert.strictEqual(
    scheduler.getProcess(runawayPid)?.dockerContainerId,
    undefined,
    'Container was not cleaned up after timeout termination.'
  );
  console.log('✓ Preemptive execution timeout termination verified.\n');

  // -------------------------------------------------------------
  // Test 5: Hard Memory Cap & Out-of-Memory (OOM) Containment
  // -------------------------------------------------------------
  console.log('[TEST 5] Testing Hard Memory Cap (1024 MB) & OOM Killer Containment...');
  const oomPid = scheduler.spawnThread('oom_worker', 'qa_tester', 6, 4000);

  // Node script attempting to allocate 1.5 GB in chunks, breaching the 1,024 MB cgroup limit
  const oomScript = `
    const chunks = [];
    try {
      while (true) {
        const b = Buffer.alloc(50 * 1024 * 1024); // Allocate 50MB chunks
        b.fill(1);
        chunks.push(b);
      }
    } catch(e) {
      console.log("ALLOC_ERR");
    }
  `;

  const oomResult = await scheduler.executeInSandbox(
    oomPid,
    ['node', '--max-old-space-size=1536', '-e', oomScript],
    { timeoutMs: 8000 }
  );

  console.log(`✓ Container Exit Code: ${oomResult.exitCode} | OOM Killed Flag: ${oomResult.oomKilled}`);
  assert.ok(
    oomResult.oomKilled || oomResult.exitCode === 137,
    `Expected OOM killer termination (exit 137), got code ${oomResult.exitCode}`
  );
  console.log('✓ Hard cgroup memory containment verified (Host system unharmed).\n');

  // -------------------------------------------------------------
  // Test 6: PostgreSQL Execution Telemetry Audit
  // -------------------------------------------------------------
  console.log('[TEST 6] Validating PostgreSQL Kernel Telemetry Ledger...');
  const client = new Client({ connectionString: DB_CONN });

  try {
    await client.connect();
    const taskRes = await client.query('SELECT id, assigned_agent_id FROM tasks ORDER BY created_at ASC LIMIT 1;');
    assert.ok(taskRes.rows.length > 0, 'No task found in database.');
    const { id: taskId, assigned_agent_id: agentId } = taskRes.rows[0];

    // Log the turn with hardware metrics
    await client.query(
      `INSERT INTO agent_turns 
       (task_id, agent_id, turn_number, prompt_tokens, completion_tokens, cached_tokens, cost_usd, execution_duration_ms, cpu_usage_pct, memory_usage_bytes)
       VALUES ($1, $2, 3, 450, 180, 0, 0.001950, 620, 88.5, 1073741824);`,
      [taskId, agentId]
    );

    const checkRes = await client.query(
      'SELECT id, turn_number, cpu_usage_pct, memory_usage_bytes, execution_duration_ms FROM agent_turns WHERE turn_number = 3 ORDER BY created_at DESC LIMIT 1;'
    );
    console.log('✓ PostgreSQL Kernel Telemetry Record:');
    console.table(checkRes.rows[0]);

    assert.strictEqual(Number(checkRes.rows[0].turn_number), 3);
    assert.strictEqual(Number(checkRes.rows[0].memory_usage_bytes), 1073741824);
  } finally {
    await client.end();
  }

  console.log('========================================');
  console.log('PHASE 5 VERIFICATION COMPLETE: SUCCESS');
  console.log('========================================');
}

runPhase5TestSuite().catch((err) => {
  console.error('\n✗ Phase 5 Verification Failed:', err);
  process.exit(1);
});