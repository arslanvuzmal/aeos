#!/usr/bin/env tsx
import { Client } from 'pg';
import { KernelScheduler } from './kernel_scheduler.js';

const DB_CONN = 'postgresql://aeos_admin:aeos_secure_password_2026@localhost:5432/aeos_kernel';

async function logTurnToDatabase(
  role: string,
  tokens: number,
  durationMs: number,
  cpuUsage: number,
  memoryBytes: number
): Promise<void> {
  const client = new Client({ connectionString: DB_CONN });
  try {
    await client.connect();
    const taskRes = await client.query('SELECT id, assigned_agent_id FROM tasks ORDER BY created_at ASC LIMIT 1;');
    if (taskRes.rows.length > 0) {
      const { id: taskId, assigned_agent_id: agentId } = taskRes.rows[0];
      const costUsd = Number(((tokens * 0.000003) + 0.0001).toFixed(6));

      await client.query(
        `INSERT INTO agent_turns 
         (task_id, agent_id, turn_number, prompt_tokens, completion_tokens, cached_tokens, cost_usd, execution_duration_ms, cpu_usage_pct, memory_usage_bytes)
         VALUES ($1, $2, 3, $3, 100, 0, $4, $5, $6, $7)`,
        [taskId, agentId, tokens, costUsd, durationMs, cpuUsage, memoryBytes]
      );
    }
  } catch (err) {
    console.error('[WARN] Failed to write kernel metrics to PostgreSQL:', err);
  } finally {
    await client.end();
  }
}

async function runCli() {
  const args = process.argv.slice(2);
  const scheduler = new KernelScheduler();

  if (args.includes('--run-node') && args[1]) {
    const codeToRun = args[1];
    const pid = scheduler.spawnThread('sde_coder_antigravity', 'coder', 8, 5000);
    console.log(`[KERNEL] Dispatched task to Sandbox under PID ${pid}...`);

    try {
      const result = await scheduler.executeInSandbox(pid, ['node', '-e', codeToRun]);
      console.log('--- Sandbox Output ---');
      console.log(result.stdout || result.stderr);
      console.log(`Duration: ${result.executionDurationMs}ms | Exit: ${result.exitCode} | OOM: ${result.oomKilled}`);

      await logTurnToDatabase('coder', 450, result.executionDurationMs, 25.0, 48000000);
    } catch (err: any) {
      console.error('[KERNEL ERROR]', err.message);
      process.exit(1);
    }
  } else {
    console.log('Usage: tsx src/kernel_cli.ts --run-node "<javascript-code>"');
  }
}

runCli();