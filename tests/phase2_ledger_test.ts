import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';

const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const PLAN_FILE = path.join(WORKSPACE_ROOT, 'task_plan.md');
const HASH_FILE = path.join(WORKSPACE_ROOT, '.aeos', 'task_plan.sha256');
const isWin = process.platform === 'win32';
const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
const ATTEST_BIN = isWin
  ? `"${gitBash}" "${path.join(WORKSPACE_ROOT, 'aeos-attest')}"`
  : path.join(WORKSPACE_ROOT, 'aeos-attest');
const INJECT_SCRIPT = isWin
  ? `"${gitBash}" "${path.join(WORKSPACE_ROOT, '.claude', 'hooks', 'smart_inject.sh')}"`
  : path.join(WORKSPACE_ROOT, '.claude', 'hooks', 'smart_inject.sh');

async function testPhase2Subsystem() {
  console.log('--- STARTING PHASE 2 AUTOMATED TEST SUITE ---');

  // Test 1: Lock Plan and Verify
  console.log('\n[TEST 1] Testing clean plan lock and verify cycle...');
  execSync(`${ATTEST_BIN} --lock test_operator_phase2`, { stdio: 'inherit' });
  
  if (!fs.existsSync(HASH_FILE)) {
    throw new Error('Hash file .aeos/task_plan.sha256 was not generated.');
  }

  const verifyOut = execSync(`${ATTEST_BIN} --verify`).toString();
  console.log('✓ Verify output:', verifyOut.trim());

  // Test 2: Context Injection Structure
  console.log('\n[TEST 2] Testing smart context re-injection parsing...');
  const injectOut = execSync(INJECT_SCRIPT).toString();
  console.log('--- Smart Injection Envelope ---');
  console.log(injectOut.trim());
  console.log('--------------------------------');

  if (!injectOut.includes('=== BEGIN AEOS SMART INJECTION ===') ||
      !injectOut.includes('[PROJECT GOAL]:') ||
      !injectOut.includes('[ACTIVE PHASE]:') ||
      !injectOut.includes('[IMMEDIATE NEXT TASK]:') ||
      !injectOut.includes('[RECENT DIAGNOSTICS]:')) {
    throw new Error('Smart injection output does not contain expected structural headers.');
  }
  console.log('✓ Context injection envelope verified.');

  // Test 3: Tamper Detection & Fail-Closed Behavior
  console.log('\n[TEST 3] Testing tamper-detection fail-closed mechanism...');
  const originalContent = fs.readFileSync(PLAN_FILE, 'utf-8');
  try {
    // Inject unauthorized mutation
    fs.appendFileSync(PLAN_FILE, '\n<!-- Tampered content by unauthorized subagent -->\n');

    let verifyFailed = false;
    try {
      execSync(`${ATTEST_BIN} --verify`, { stdio: 'pipe' });
    } catch (err: any) {
      verifyFailed = true;
      console.log('✓ Correctly caught tamper attempt. Non-zero exit code observed.');
      const stderr = err.stderr ? err.stderr.toString() : '';
      if (stderr.includes('[PLAN TAMPERED]')) {
        console.log('✓ Detected expected [PLAN TAMPERED] security alert.');
      } else {
        throw new Error('Tamper detection did not output [PLAN TAMPERED] header.');
      }
    }

    if (!verifyFailed) {
      throw new Error('CRITICAL VULNERABILITY: Tampered task_plan.md passed verification!');
    }

    // Verify smart_inject.sh is blocked when tampered
    let injectBlocked = false;
    try {
      execSync(INJECT_SCRIPT, { stdio: 'pipe' });
    } catch {
      injectBlocked = true;
      console.log('✓ Smart context injection was blocked during plan tamper state.');
    }

    if (!injectBlocked) {
      throw new Error('CRITICAL: smart_inject.sh executed despite tampered plan state!');
    }
  } finally {
    // Restore pristine plan content and re-lock
    fs.writeFileSync(PLAN_FILE, originalContent, 'utf-8');
    execSync(`${ATTEST_BIN} --lock recovery_restore`, { stdio: 'ignore' });
    console.log('✓ Workspace restored and re-locked.');
  }

  // Test 4: Database Attestation Synchronization
  console.log('\n[TEST 4] Validating database attestation synchronization...');
  const client = new Client({
    connectionString: 'postgresql://aeos_admin:aeos_secure_password_2026@localhost:5432/aeos_kernel'
  });

  try {
    await client.connect();
    const currentHash = fs.readFileSync(HASH_FILE, 'utf-8').trim();
    const res = await client.query(
      'SELECT * FROM plan_attestations WHERE sha256_hash = $1 ORDER BY created_at DESC LIMIT 1',
      [currentHash]
    );

    if (res.rows.length === 0) {
      throw new Error(`Hash ${currentHash} was not synced to plan_attestations table.`);
    }

    console.log('✓ PostgreSQL attestation record found:');
    console.table(res.rows[0]);
  } finally {
    await client.end();
  }

  console.log('\n========================================');
  console.log('PHASE 2 VERIFICATION COMPLETE: SUCCESS');
  console.log('========================================');
}

testPhase2Subsystem().catch((err) => {
  console.error('\n✗ Phase 2 Verification Failed:', err);
  process.exit(1);
});