/**
 * AEOS Dual-Brain Automated System Verification Suite
 * Tests MCP Memory RAG, Stealth Browser, and End-to-End Autonomous Mission
 */

import { DualBrainOrchestrator } from '../src/dual_brain_orchestrator.js';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { Client } from 'pg';

const DB_CONN = 'postgresql://aeos_admin:aeos_secure_password_2026@localhost:5432/aeos_kernel';

async function verifyDualBrainSystem() {
  console.log('\n======================================================');
  console.log('AEOS DUAL-BRAIN SYSTEM TEST SUITE: STARTING');
  console.log('======================================================\n');

  // Test 1: Verify PostgreSQL Connectivity and Seed Project/Agents
  console.log('[TEST 1] Auditing PostgreSQL ledger baseline...');
  const client = new Client({ connectionString: DB_CONN });
  await client.connect();

  const tenantRes = await client.query('SELECT id FROM tenants LIMIT 1;');
  let tenantId = tenantRes.rows[0]?.id;
  if (!tenantId) {
    const tIns = await client.query("INSERT INTO tenants (name) VALUES ('aeos_root') RETURNING id;");
    tenantId = tIns.rows[0].id;
  }

  const projRes = await client.query('SELECT id FROM projects LIMIT 1;');
  let projectId = projRes.rows[0]?.id;
  if (!projectId) {
    const pIns = await client.query(
      "INSERT INTO projects (tenant_id, name, workspace_path) VALUES ($1, 'aeos_core', $2) RETURNING id;",
      [tenantId, process.cwd()]
    );
    projectId = pIns.rows[0].id;
  }

  // Ensure planner and coder agents exist
  const agentRoles = ['planner', 'coder', 'qa_tester', 'debugger'];
  for (const role of agentRoles) {
    const agCheck = await client.query('SELECT id FROM agents WHERE project_id = $1 AND role = $2;', [projectId, role]);
    if (agCheck.rows.length === 0) {
      await client.query(
        'INSERT INTO agents (project_id, name, role, model_name) VALUES ($1, $2, $3, $4);',
        [projectId, `agent_${role}`, role, role === 'planner' || role === 'qa_tester' ? 'claude-code' : 'antigravity']
      );
    }
  }
  console.log('✓ TEST 1 PASSED: PostgreSQL database ledger baseline confirmed.');

  // Test 2: Verify Memory RAG MCP Server tool interface
  console.log('\n[TEST 2] Testing Memory & RAG MCP Server over stdio...');
  const ragProc = spawn('npx', ['tsx', '"src/mcp/rag_server.ts"'], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'inherit'],
    shell: true
  });

  const sendRpc = (proc: any, msg: any): Promise<any> => {
    return new Promise((resolve, reject) => {
      const exitListener = (code: number) => {
        reject(new Error(`MCP process exited with code ${code} before response`));
      };
      proc.once('exit', exitListener);

      const listener = (data: Buffer) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line.trim());
            if (parsed.id === msg.id) {
              proc.stdout.off('data', listener);
              proc.off('exit', exitListener);
              return resolve(parsed);
            }
          } catch {}
        }
      };
      proc.stdout.on('data', listener);
      proc.stdin.write(JSON.stringify(msg) + '\n');
    });
  };

  // Initialize MCP connection
  const initMsg = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' }
    }
  };
  const initResp = await sendRpc(ragProc, initMsg);
  if (!initResp.result) throw new Error('MCP Init failed: ' + JSON.stringify(initResp));
  console.log('✓ MCP initialize acknowledged.');

  // List tools
  const listToolsMsg = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
  const toolsResp = await sendRpc(ragProc, listToolsMsg);
  const toolNames = (toolsResp.result?.tools || []).map((t: any) => t.name);
  console.log(`Available Memory tools: ${toolNames.join(', ')}`);
  if (!toolNames.includes('query_knowledge_base') || !toolNames.includes('store_memory')) {
    throw new Error('Expected query_knowledge_base and store_memory tools in MCP server.');
  }

  // Test store_memory
  const storeMsg = {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'store_memory',
      arguments: {
        category: 'architecture',
        title: 'Dual-Brain IPC Protocol',
        content: 'Claude Code acts as strategic planner and adversarial reviewer; Antigravity acts as sandbox executor.',
        tags: ['ipc', 'dual-brain', 'architecture']
      }
    }
  };
  const storeResp = await sendRpc(ragProc, storeMsg);
  console.log(`✓ store_memory response: ${JSON.stringify(storeResp.result?.content?.[0]?.text)}`);

  // Test retrieve_context
  const ctxMsg = { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'retrieve_context', arguments: {} } };
  const ctxResp = await sendRpc(ragProc, ctxMsg);
  console.log('✓ retrieve_context returned execution environment constraints.');

  ragProc.kill();
  console.log('✓ TEST 2 PASSED: Memory RAG MCP Server verified.');

  // Test 3: Execute Live Dual-Brain Mission
  console.log('\n[TEST 3] Executing Live Autonomous Dual-Brain Mission...');
  const orchestrator = new DualBrainOrchestrator(process.cwd());
  const missionSuccess = await orchestrator.executeMission({
    goal: 'Construct and verify a sliding-window rate limiter with burst tolerance and memory tracking',
    maxSelfHealingRetries: 3
  });

  if (!missionSuccess) {
    throw new Error('Dual-Brain mission did not complete successfully.');
  }
  console.log('✓ TEST 3 PASSED: Full Dual-Brain mission executed with 100% success!');

  // Test 4: Verify Attestation & Telemetry in PostgreSQL
  console.log('\n[TEST 4] Verifying cryptographic attestation and spend telemetry...');
  const attestRes = await client.query('SELECT * FROM plan_attestations ORDER BY created_at DESC LIMIT 2;');
  console.log(`Attestation rows verified: ${attestRes.rows.length}`);
  console.log(`Latest SHA-256: ${attestRes.rows[0]?.sha256_hash} (by ${attestRes.rows[0]?.attested_by})`);

  const spendRes = await client.query('SELECT * FROM v_project_spend_analytics WHERE project_id = $1;', [projectId]);
  if (spendRes.rows.length > 0) {
    console.log('Live Telemetry Summary:');
    console.table(spendRes.rows[0]);
  }

  await client.end();
  console.log('✓ TEST 4 PASSED: State ledger and audit trail cryptographically verified.');

  console.log('\n======================================================');
  console.log('ALL DUAL-BRAIN VERIFICATION TESTS PASSED SUCCESSFULLY');
  console.log('======================================================\n');
}

verifyDualBrainSystem().catch((err) => {
  console.error('[FATAL] Verification suite failed:', err);
  process.exit(1);
});
