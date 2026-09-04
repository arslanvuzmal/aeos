import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import { TokenCompressor } from '../src/token_compressor.js';

async function runPhase3TestSuite() {
  console.log('=== STARTING PHASE 3 VERIFICATION TEST SUITE ===\n');
  const compressor = new TokenCompressor({
    stashThresholdBytes: 512,
    maxDescriptionLength: 100
  });

  // -------------------------------------------------------------
  // Test 1: Schema Compression
  // -------------------------------------------------------------
  console.log('[TEST 1] Testing MCP JSON Schema Minification...');
  const verboseMcpSchema = {
    type: 'object',
    title: 'ComprehensiveCompilerAndBuildToolSchema',
    description: 'This is an excessively detailed schema description designed for executing automated build sequences `npm run compile` and checking intermediate binary status.',
    examples: [{ target: 'x86_64', flags: ['--release', '--debug'] }],
    properties: {
      targetArch: {
        type: 'string',
        title: 'TargetArchitectureIdentifier',
        default: 'x86_64',
        description: 'Specifies the compile architecture for the final binary output format. Must follow standard LLVM triplet naming conventions.'
      },
      verboseFlags: {
        type: 'array',
        title: 'CompilerFlagsCollection',
        examples: [['-Wall', '-Wextra']],
        items: {
          type: 'string',
          description: 'Individual flag argument passed directly to the low-level toolchain executor.'
        }
      }
    },
    required: ['targetArch']
  };

  const rawSchemaBytes = Buffer.byteLength(JSON.stringify(verboseMcpSchema), 'utf-8');
  const compressedSchema = compressor.compressSchema(verboseMcpSchema);
  const compressedSchemaBytes = Buffer.byteLength(JSON.stringify(compressedSchema), 'utf-8');
  const schemaReduction = (((rawSchemaBytes - compressedSchemaBytes) / rawSchemaBytes) * 100).toFixed(2);

  console.log(`✓ Original Schema: ${rawSchemaBytes} bytes`);
  console.log(`✓ Compressed Schema: ${compressedSchemaBytes} bytes (${schemaReduction}% reduction)`);

  assert.strictEqual((compressedSchema as any).title, undefined, 'Schema title was not stripped.');
  assert.strictEqual((compressedSchema as any).examples, undefined, 'Schema examples were not stripped.');
  assert.strictEqual((compressedSchema.properties.targetArch as any).default, undefined, 'Property default was not stripped.');
  assert.ok(compressedSchema.description.endsWith('...'), 'Long description was not truncated.');
  assert.ok(Number(schemaReduction) > 35, `Schema reduction was lower than expected: ${schemaReduction}%`);
  console.log('✓ Schema minification verified.\n');

  // -------------------------------------------------------------
  // Test 2: Blacklist Pruning & Null Sanitization
  // -------------------------------------------------------------
  console.log('[TEST 2] Testing Blacklist Field Pruning & Structural Sanitization...');
  const dirtyToolResponse = {
    status: 'success',
    exit_code: 0,
    trace_id: 'tr-99824-alpha-delta',
    span_id: 'sp-77610-zeta',
    telemetry: {
      agent_ip: '192.168.1.100',
      kernel_version: 'Linux 6.8.0-generic',
      uptime_seconds: 142099
    },
    debug_stack: 'at Object.executeTool (/src/executor.ts:120:14)\nat async Engine.run (/src/engine.ts:45:9)',
    empty_object: {},
    empty_array: [],
    null_value: null,
    valid_payload: {
      compilation_status: 'ok',
      diagnostics: []
    }
  };

  const { compressed: cleanedResponse } = compressor.compressResponse(dirtyToolResponse);

  assert.strictEqual(cleanedResponse.trace_id, undefined, 'trace_id was not pruned.');
  assert.strictEqual(cleanedResponse.span_id, undefined, 'span_id was not pruned.');
  assert.strictEqual(cleanedResponse.telemetry, undefined, 'telemetry block was not pruned.');
  assert.strictEqual(cleanedResponse.debug_stack, undefined, 'debug_stack was not pruned.');
  assert.strictEqual(cleanedResponse.empty_object, undefined, 'empty_object was not pruned.');
  assert.strictEqual(cleanedResponse.empty_array, undefined, 'empty_array was not pruned.');
  assert.strictEqual(cleanedResponse.null_value, undefined, 'null_value was not pruned.');
  assert.strictEqual(cleanedResponse.valid_payload.compilation_status, 'ok', 'Legitimate payload was corrupted.');
  console.log('✓ Blacklisted fields and dead structures successfully pruned.\n');

  // -------------------------------------------------------------
  // Test 3: Large String Content-Addressed Stashing
  // -------------------------------------------------------------
  console.log('[TEST 3] Testing Threshold-Based Content-Addressed Stashing...');
  const largeCompilerDump = 'LOG_LINE_ALPHA: Compilation started for module aeos_kernel_core.\n' +
    'INFO: Resolving internal dependencies and mapping symbols...\n'.repeat(30) +
    'LOG_LINE_OMEGA: Build completed successfully with 0 errors and 2 warnings.';

  const largePayload = {
    module: 'aeos_kernel_core',
    duration_ms: 450,
    compiler_output: largeCompilerDump
  };

  const { compressed: stashedPayload, metrics } = compressor.compressResponse(largePayload);

  console.log(`✓ Original Bytes: ${metrics.originalBytes}`);
  console.log(`✓ Compressed Bytes: ${metrics.compressedBytes}`);
  console.log(`✓ Context Reduction: ${metrics.reductionPercentage}%`);
  console.log(`✓ Stashed Keys: ${metrics.stashedKeys.join(', ')}`);

  assert.strictEqual(metrics.stashedCount, 1, 'Expected exactly 1 stashed string.');
  const stashedHash = metrics.stashedKeys[0];
  assert.strictEqual(
    stashedPayload.compiler_output,
    `<<tokenless:${stashedHash}>>`,
    'Stash tag does not match expected format.'
  );

  const stashFilePath = path.join(compressor.getStashDirectory(), `${stashedHash}.bin`);
  assert.ok(fs.existsSync(stashFilePath), `Stash file not found on disk at: ${stashFilePath}`);
  const storedContent = fs.readFileSync(stashFilePath, 'utf-8');
  assert.strictEqual(storedContent, largeCompilerDump, 'Stashed file content does not match original bytes.');
  assert.ok(metrics.reductionPercentage > 75, `Expected >75% reduction, got: ${metrics.reductionPercentage}%`);
  console.log('✓ Content-addressed stashing to disk verified.\n');

  // -------------------------------------------------------------
  // Test 4: Lossless Reconstitution
  // -------------------------------------------------------------
  console.log('[TEST 4] Testing Lossless Reconstitution...');
  const serializedCompressed = JSON.stringify(stashedPayload);
  const reconstitutedJson = compressor.reconstitute(serializedCompressed);
  const parsedReconstituted = JSON.parse(reconstitutedJson);

  assert.strictEqual(
    parsedReconstituted.compiler_output,
    largeCompilerDump,
    'Reconstituted string does not match original uncompressed bytes!'
  );
  console.log('✓ Exact byte-for-byte lossless roundtrip reconstitution confirmed.\n');

  // -------------------------------------------------------------
  // Test 5: PostgreSQL Telemetry Ledger Synchronization
  // -------------------------------------------------------------
  console.log('[TEST 5] Synchronizing Compressed Token Metrics with PostgreSQL Ledger...');
  const client = new Client({
    connectionString: 'postgresql://aeos_admin:aeos_secure_password_2026@localhost:5432/aeos_kernel'
  });

  try {
    await client.connect();

    // Query active task and agent
    const taskRes = await client.query('SELECT id, assigned_agent_id FROM tasks ORDER BY created_at ASC LIMIT 1');
    if (taskRes.rows.length === 0) {
      throw new Error('No task found in database to link turn metrics.');
    }
    const { id: taskId, assigned_agent_id: agentId } = taskRes.rows[0];

    // Compute token estimates (approx 4 chars/token)
    const rawTokens = Math.ceil(metrics.originalBytes / 4);
    const compressedTokens = Math.ceil(metrics.compressedBytes / 4);
    const cachedTokens = rawTokens - compressedTokens;
    const costUsd = Number(((compressedTokens * 0.000003) + (rawTokens * 0.0000005)).toFixed(6));

    const turnRes = await client.query(
      `INSERT INTO agent_turns 
       (task_id, agent_id, turn_number, prompt_tokens, completion_tokens, cached_tokens, cost_usd, execution_duration_ms, cpu_usage_pct, memory_usage_bytes)
       VALUES ($1, $2, 2, $3, 120, $4, $5, 115, 3.2, 28311552)
       RETURNING id, prompt_tokens, cached_tokens, cost_usd`,
      [taskId, agentId, compressedTokens, cachedTokens, costUsd]
    );

    console.log('✓ Token optimization turn registered in PostgreSQL:');
    console.table(turnRes.rows[0]);

    // Validate updated aggregated view
    const viewRes = await client.query('SELECT * FROM v_project_spend_analytics');
    console.log('✓ Aggregate spend analytics view:');
    console.table(viewRes.rows[0]);
  } finally {
    await client.end();
  }

  console.log('========================================');
  console.log('PHASE 3 VERIFICATION COMPLETE: SUCCESS');
  console.log('========================================');
}

runPhase3TestSuite().catch((err) => {
  console.error('\n✗ Phase 3 Verification Failed:', err);
  process.exit(1);
});