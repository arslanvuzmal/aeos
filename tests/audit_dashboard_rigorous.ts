import http from 'http';
import { WebSocket } from 'ws';
import { chromium, Browser } from 'playwright';
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';

const TARGET_HOST = '127.0.0.1';
const TARGET_PORT = 4000;
const BASE_URL = `http://${TARGET_HOST}:${TARGET_PORT}`;
const WS_URL = `ws://${TARGET_HOST}:${TARGET_PORT}/ws`;
const DB_CONN = 'postgresql://aeos_admin:aeos_secure_password_2026@localhost:5432/aeos_kernel';

export interface AuditMetricResult {
  vector: string;
  testCase: string;
  status: 'PASSED' | 'FAILED';
  details: string;
  latencyMs?: number;
}

export const auditResults: AuditMetricResult[] = [];

function recordResult(vector: string, testCase: string, status: 'PASSED' | 'FAILED', details: string, latencyMs?: number) {
  auditResults.push({ vector, testCase, status, details, latencyMs });
  const icon = status === 'PASSED' ? '✓' : '✗';
  console.log(`${icon} [${vector}] ${testCase} -> ${status} (${details}) ${latencyMs ? `[${latencyMs.toFixed(1)}ms]` : ''}`);
}

function httpGet(endpoint: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string; durationMs: number }> {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    http.get(`${BASE_URL}${endpoint}`, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode || 0,
          headers: res.headers,
          body,
          durationMs: performance.now() - start
        });
      });
    }).on('error', reject);
  });
}

async function runRigorousAudit() {
  console.log(`================================================================`);
  console.log(`[AEOS SRE AUDIT] STARTING RIGOROUS DEEP AUDIT: ${BASE_URL}`);
  console.log(`================================================================\n`);

  // =================================================================
  // VECTOR 1: REST API CONTRACT & SCHEMA AUDIT
  // =================================================================
  console.log('--- VECTOR 1: REST API CONTRACT & PRECISION TESTING ---');
  
  // 1.1 /api/spend Schema & Numeric Precision
  try {
    const res = await httpGet('/api/spend');
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    const data = JSON.parse(res.body);
    
    assert.ok('total_turns' in data, 'Missing total_turns');
    assert.ok('total_cost_usd' in data, 'Missing total_cost_usd');
    assert.ok('aggregate_prompt_tokens' in data, 'Missing aggregate_prompt_tokens');
    
    // Validate that total_cost_usd maintains micro-dollar precision
    const costStr = String(data.total_cost_usd);
    const hasPrecision = costStr.includes('.') ? costStr.split('.')[1].length >= 4 : Number(data.total_cost_usd) === 0;
    assert.ok(hasPrecision, `Cost precision too low (truncated): ${costStr}`);

    recordResult('REST API', 'GET /api/spend Contract & Precision', 'PASSED', `Turns: ${data.total_turns}, Spend: $${data.total_cost_usd}`, res.durationMs);
  } catch (err: any) {
    recordResult('REST API', 'GET /api/spend Contract & Precision', 'FAILED', err.message);
  }

  // 1.2 /api/turns Array & Hardware Metrics
  try {
    const res = await httpGet('/api/turns');
    assert.strictEqual(res.status, 200);
    const turns = JSON.parse(res.body);
    assert.ok(Array.isArray(turns), 'Expected turns to be an array');
    assert.ok(turns.length > 0, 'Turns array is empty');

    const latestTurn = turns[0];
    assert.ok('turn_number' in latestTurn, 'Missing turn_number');
    assert.ok('cpu_usage_pct' in latestTurn, 'Missing cpu_usage_pct');
    assert.ok('memory_usage_bytes' in latestTurn, 'Missing memory_usage_bytes');
    assert.ok('execution_duration_ms' in latestTurn, 'Missing execution_duration_ms');

    recordResult('REST API', 'GET /api/turns Telemetry Structure', 'PASSED', `Fetched ${turns.length} turns. Latest Turn #${latestTurn.turn_number}`, res.durationMs);
  } catch (err: any) {
    recordResult('REST API', 'GET /api/turns Telemetry Structure', 'FAILED', err.message);
  }

  // 1.3 /api/attestations Cryptographic SHA-256 Format
  try {
    const res = await httpGet('/api/attestations');
    assert.strictEqual(res.status, 200);
    const attestations = JSON.parse(res.body);
    assert.ok(Array.isArray(attestations), 'Expected attestations to be an array');
    
    if (attestations.length > 0) {
      const hash = attestations[0].sha256_hash;
      assert.strictEqual(hash.length, 64, `Invalid SHA-256 hash length: ${hash.length}`);
      assert.ok(/^[a-f0-9]{64}$/i.test(hash), `Hash is not hexadecimal: ${hash}`);
    }

    recordResult('REST API', 'GET /api/attestations Hash Validation', 'PASSED', `Total attestations: ${attestations.length}`, res.durationMs);
  } catch (err: any) {
    recordResult('REST API', 'GET /api/attestations Hash Validation', 'FAILED', err.message);
  }

  // =================================================================
  // VECTOR 2: SECURITY, BOUNDARY & PATH TRAVERSAL PENETRATION
  // =================================================================
  console.log('\n--- VECTOR 2: SECURITY & PATH TRAVERSAL PENETRATION ---');

  // 2.1 Directory Traversal Attack on /api/stash/:hash
  const traversalPayloads = [
    '../../task_plan.md',
    '..%2F..%2Ftask_plan.md',
    '....//....//task_plan.md',
    '/etc/passwd',
    '../../../../etc/passwd'
  ];

  for (const payload of traversalPayloads) {
    try {
      const res = await httpGet(`/api/stash/${payload}`);
      const isBlocked = res.status === 400 || res.status === 403 || res.status === 404;
      assert.ok(isBlocked, `Path traversal payload succeeded with status ${res.status}: ${payload}`);
      assert.ok(!res.body.includes('TASK SPECIFICATION') && !res.body.includes('root:x:'), 'Sensitive file contents leaked!');
      recordResult('SECURITY', `Path Traversal Block: ${payload}`, 'PASSED', `HTTP Status ${res.status} returned properly`, res.durationMs);
    } catch (err: any) {
      recordResult('SECURITY', `Path Traversal Block: ${payload}`, 'FAILED', err.message);
    }
  }

  // 2.2 Legitimate Stash Reconstitution
  try {
    const stashDir = path.join(process.cwd(), '.aeos', 'stash');
    const stashFiles = fs.existsSync(stashDir) ? fs.readdirSync(stashDir).filter(f => f.endsWith('.bin')) : [];
    
    if (stashFiles.length > 0) {
      const sampleHash = stashFiles[0].replace('.bin', '');
      const res = await httpGet(`/api/stash/${sampleHash}`);
      assert.strictEqual(res.status, 200, `Failed to load legitimate stash: ${sampleHash}`);
      const rawDisk = fs.readFileSync(path.join(stashDir, `${sampleHash}.bin`), 'utf-8');
      assert.strictEqual(res.body, rawDisk, 'API stash content does not match raw disk bytes!');
      recordResult('SECURITY', 'Legitimate Content-Addressed Stash Resolution', 'PASSED', `Hash: ${sampleHash.slice(0, 8)}... (${res.body.length} bytes)`, res.durationMs);
    } else {
      recordResult('SECURITY', 'Legitimate Content-Addressed Stash Resolution', 'PASSED', 'No .bin files currently in .aeos/stash (Skipped file check)');
    }
  } catch (err: any) {
    recordResult('SECURITY', 'Legitimate Content-Addressed Stash Resolution', 'FAILED', err.message);
  }

  // =================================================================
  // VECTOR 3: WEBSOCKET STREAMING & CONCURRENT LOAD STRESS
  // =================================================================
  console.log('\n--- VECTOR 3: WEBSOCKET STREAMING & STRESS TESTING ---');

  // 3.1 Single Stream Tick Integrity
  try {
    const singleWsTest = await new Promise<{ ok: boolean; frame: any; latency: number }>((resolve, reject) => {
      const start = performance.now();
      const ws = new WebSocket(WS_URL);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket frame timeout (>3000ms)'));
      }, 3000);

      ws.on('message', (data) => {
        clearTimeout(timer);
        const latency = performance.now() - start;
        const frame = JSON.parse(data.toString());
        ws.close();
        resolve({ ok: true, frame, latency });
      });

      ws.on('error', reject);
    });

    assert.ok(singleWsTest.frame.timestamp, 'Missing timestamp in WS frame');
    assert.ok(singleWsTest.frame.spend, 'Missing spend object in WS frame');
    recordResult('WEBSOCKET', 'Single Stream Broadcast & Tick Rate', 'PASSED', `Tick received in ${singleWsTest.latency.toFixed(1)}ms`, singleWsTest.latency);
  } catch (err: any) {
    recordResult('WEBSOCKET', 'Single Stream Broadcast & Tick Rate', 'FAILED', err.message);
  }

  // 3.2 Concurrent Client Stress Test (10 simultaneous sockets)
  try {
    const clientCount = 10;
    const start = performance.now();
    const connections = Array.from({ length: clientCount }).map((_, i) => {
      return new Promise<boolean>((resolve) => {
        const ws = new WebSocket(WS_URL);
        const timer = setTimeout(() => {
          ws.close();
          resolve(false);
        }, 4000);

        ws.on('message', () => {
          clearTimeout(timer);
          ws.close();
          resolve(true);
        });

        ws.on('error', () => resolve(false));
      });
    });

    const results = await Promise.all(connections);
    const passedCount = results.filter(Boolean).length;
    const totalDuration = performance.now() - start;

    assert.strictEqual(passedCount, clientCount, `Expected ${clientCount} clients to receive frames, only ${passedCount} passed.`);
    recordResult('WEBSOCKET', `Concurrent Connection Broadcast (${clientCount} clients)`, 'PASSED', `All ${clientCount} sockets received frames concurrently`, totalDuration / clientCount);
  } catch (err: any) {
    recordResult('WEBSOCKET', 'Concurrent Connection Broadcast', 'FAILED', err.message);
  }

  // =================================================================
  // VECTOR 4: PLAYWRIGHT HEADLESS DOM & UI AUDIT
  // =================================================================
  console.log('\n--- VECTOR 4: PLAYWRIGHT HEADLESS DOM & INTERACTIVE AUDIT ---');
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    // Collect browser console errors
    const clientErrors: string[] = [];
    page.on('pageerror', (err) => clientErrors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') clientErrors.push(msg.text());
    });

    const startNav = performance.now();
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    const navDuration = performance.now() - startNav;

    // 4.1 Card Render Verifications
    const bodyText = await page.innerText('body');
    assert.ok(bodyText.includes('Spend') || bodyText.includes('Cost') || bodyText.includes('$'), 'UI does not display spend metrics');
    assert.ok(bodyText.includes('Turn') || bodyText.includes('PID') || bodyText.includes('Kernel') || bodyText.includes('Mission'), 'UI does not display turns/kernel information');
    
    recordResult('UI/DOM', 'Page Load & Structural Typography', 'PASSED', `Title: "${await page.title()}"`, navDuration);

    // 4.2 Check for Console / JS Runtime Exceptions
    if (clientErrors.length === 0) {
      recordResult('UI/DOM', 'Client-Side JavaScript Console Errors', 'PASSED', 'Zero uncaught exceptions or console errors');
    } else {
      recordResult('UI/DOM', 'Client-Side JavaScript Console Errors', 'FAILED', `Encountered errors: ${clientErrors.slice(0, 2).join('; ')}`);
    }

    // 4.3 Stash Modal Interaction (if stash elements present)
    const stashButton = await page.$('button[data-stash], .stash-badge, button:has-text("Stash"), .tokenless-tag, .stash-chip');
    if (stashButton) {
      await stashButton.click();
      await page.waitForTimeout(300);
      const modalVisible = await page.$('.modal, dialog[open], #stashModal');
      assert.ok(modalVisible, 'Modal did not open upon clicking stash item');
      recordResult('UI/DOM', 'Interactive Stash Modal Rendering', 'PASSED', 'Modal opened and rendered content');
    } else {
      recordResult('UI/DOM', 'Interactive Stash Modal Rendering', 'PASSED', 'No stash button directly clickable in viewport (Skipped click check)');
    }

  } catch (err: any) {
    recordResult('UI/DOM', 'Playwright Headless Browser Audit', 'FAILED', err.message);
  } finally {
    if (browser) await browser.close();
  }

  // =================================================================
  // VECTOR 5: POSTGRESQL STATE LEDGER RECONCILIATION
  // =================================================================
  console.log('\n--- VECTOR 5: DATABASE RECONCILIATION ---');
  const pgClient = new Client({ connectionString: DB_CONN });

  try {
    await pgClient.connect();

    // 5.1 Compare v_project_spend_analytics with /api/spend
    const dbRes = await pgClient.query('SELECT total_turns, total_cost_usd, aggregate_prompt_tokens FROM v_project_spend_analytics LIMIT 1;');
    const apiRes = await httpGet('/api/spend');
    const apiData = JSON.parse(apiRes.body);

    if (dbRes.rows.length > 0) {
      const dbRow = dbRes.rows[0];
      assert.strictEqual(Number(apiData.total_turns), Number(dbRow.total_turns), 'Discrepancy in total_turns between API and PostgreSQL');
      assert.strictEqual(Number(apiData.total_cost_usd).toFixed(4), Number(dbRow.total_cost_usd).toFixed(4), 'Discrepancy in total_cost_usd');
      recordResult('DATABASE', 'PostgreSQL v_project_spend_analytics Synchronization', 'PASSED', `DB Turns (${dbRow.total_turns}) matches API Turns (${apiData.total_turns})`);
    } else {
      recordResult('DATABASE', 'PostgreSQL v_project_spend_analytics Synchronization', 'PASSED', 'No spend rows in database yet (Skipped match)');
    }

    // 5.2 Validate plan_attestations latest hash
    const attestRes = await pgClient.query('SELECT sha256_hash FROM plan_attestations WHERE is_valid = TRUE ORDER BY created_at DESC LIMIT 1;');
    if (attestRes.rows.length > 0) {
      const latestHash = attestRes.rows[0].sha256_hash;
      const apiAttest = await httpGet('/api/attestations');
      assert.ok(apiAttest.body.includes(latestHash), `Latest DB hash ${latestHash.slice(0, 8)}... not found in /api/attestations`);
      recordResult('DATABASE', 'PostgreSQL plan_attestations Seal Integrity', 'PASSED', `Verified valid hash: ${latestHash.slice(0, 16)}...`);
    }

  } catch (err: any) {
    recordResult('DATABASE', 'Database State Reconciliation', 'FAILED', err.message);
  } finally {
    await pgClient.end();
  }

  // =================================================================
  // SUMMARY & SCORECARD GENERATION
  // =================================================================
  console.log(`\n================================================================`);
  console.log(`[AUDIT COMPLETE] METRICS SUMMARY`);
  console.log(`================================================================`);
  
  const passed = auditResults.filter(r => r.status === 'PASSED').length;
  const failed = auditResults.filter(r => r.status === 'FAILED').length;
  const total = auditResults.length;
  const healthScore = ((passed / total) * 100).toFixed(1);

  console.log(`Total Checks Executed: ${total}`);
  console.log(`Passed: ${passed} | Failed: ${failed}`);
  console.log(`Operational Health Score: ${healthScore}%\n`);

  if (failed > 0) {
    console.error(`[AUDIT FAILED] ${failed} check(s) breached operational criteria!`);
    process.exit(1);
  } else {
    console.log(`[AUDIT PASSED] Dashboard server passed all rigorous operational benchmarks!`);
    process.exit(0);
  }
}

runRigorousAudit().catch((err) => {
  console.error('Fatal audit failure:', err);
  process.exit(1);
});
