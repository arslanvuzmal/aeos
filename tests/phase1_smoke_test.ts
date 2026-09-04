import { Client } from 'pg';

async function verifyPhase1() {
  const client = new Client({
    connectionString: 'postgresql://aeos_admin:aeos_secure_password_2026@localhost:5432/aeos_kernel'
  });

  try {
    await client.connect();
    console.log('✓ Connected to PostgreSQL');

    // 1. Clean verification workspace
    await client.query('DELETE FROM tenants WHERE name = $1', ['test_tenant_alpha']);

    // 2. Insert tenant & project
    const tenantRes = await client.query(
      'INSERT INTO tenants (name) VALUES ($1) RETURNING id',
      ['test_tenant_alpha']
    );
    const tenantId = tenantRes.rows[0].id;
    console.log(`✓ Tenant created: ${tenantId}`);

    const projectRes = await client.query(
      'INSERT INTO projects (tenant_id, name, workspace_path) VALUES ($1, $2, $3) RETURNING id',
      [tenantId, 'aeos_core_engine', '/var/aeos/workspace']
    );
    const projectId = projectRes.rows[0].id;
    console.log(`✓ Project created: ${projectId}`);

    // 3. Insert agent & task
    const agentRes = await client.query(
      'INSERT INTO agents (project_id, name, role, model_name) VALUES ($1, $2, $3, $4) RETURNING id',
      [projectId, 'planner_prime', 'planner', 'claude-3-7-sonnet']
    );
    const agentId = agentRes.rows[0].id;
    console.log(`✓ Agent registered: ${agentId}`);

    const taskRes = await client.query(
      'INSERT INTO tasks (project_id, assigned_agent_id, title, status) VALUES ($1, $2, $3, $4) RETURNING id',
      [projectId, agentId, 'Build Core Engine', 'in_progress']
    );
    const taskId = taskRes.rows[0].id;
    console.log(`✓ Task created: ${taskId}`);

    // 4. Record execution turn & cost
    const turnRes = await client.query(
      `INSERT INTO agent_turns 
       (task_id, agent_id, turn_number, prompt_tokens, completion_tokens, cost_usd, execution_duration_ms, cpu_usage_pct, memory_usage_bytes)
       VALUES ($1, $2, 1, 1200, 450, 0.009450, 840, 14.5, 52428800)
       RETURNING id`,
      [taskId, agentId]
    );
    const turnId = turnRes.rows[0].id;
    console.log(`✓ Turn recorded: ${turnId}`);

    // 5. Test tool execution insert
    await client.query(
      `INSERT INTO tool_executions (turn_id, tool_name, input_payload, output_payload, duration_ms)
       VALUES ($1, $2, $3, $4, 120)`,
      [turnId, 'fs_read', JSON.stringify({ path: 'task_plan.md' }), JSON.stringify({ status: 'ok' })]
    );
    console.log('✓ Tool execution recorded');

    // 6. Test SHA-256 plan attestation insert
    await client.query(
      `INSERT INTO plan_attestations (project_id, sha256_hash, attested_by)
       VALUES ($1, $2, $3)`,
      [projectId, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'admin_operator']
    );
    console.log('✓ Plan attestation recorded');

    // 7. Test Opik trace cross-reference
    await client.query(
      `INSERT INTO opik_traces (turn_id, opik_trace_id, opik_span_id, project_name)
       VALUES ($1, $2, $3, $4)`,
      [turnId, 'tr-998242', 'sp-110293', 'aeos_core_engine']
    );
    console.log('✓ Opik trace recorded');

    // 8. Validate view computation
    const viewRes = await client.query(
      'SELECT * FROM v_project_spend_analytics WHERE project_id = $1',
      [projectId]
    );
    const metrics = viewRes.rows[0];
    console.log('✓ Aggregate view queried successfully:');
    console.table(metrics);

    if (Number(metrics.aggregate_prompt_tokens) !== 1200 || Number(metrics.total_cost_usd) <= 0) {
      throw new Error('Analytics view did not calculate token or cost aggregates correctly.');
    }

    console.log('\n========================================');
    console.log('PHASE 1 VERIFICATION COMPLETE: SUCCESS');
    console.log('========================================');
  } catch (error) {
    console.error('✗ Phase 1 Verification Failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

verifyPhase1();
