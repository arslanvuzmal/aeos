import * as assert from 'assert';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { WebSocket } from 'ws';
import { DashboardServer } from '../src/dashboard/server.js';

async function runDashboardTestSuite() {
  console.log('=== STARTING AEOS OBSERVABILITY DASHBOARD TEST SUITE ===\n');

  const testPort = 4001;
  const dashboard = new DashboardServer({ port: testPort });

  try {
    const actualPort = await dashboard.start();
    console.log(`✓ Dashboard server started on port ${actualPort}`);

    function getHttp(pathStr: string): Promise<{ status: number; data: string }> {
      return new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${actualPort}${pathStr}`, (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ status: res.statusCode || 0, data }));
        }).on('error', reject);
      });
    }

    // ------------------------------------------------------------------
    // Test 1: REST Endpoints (/api/spend, /api/turns, /api/attestations)
    // ------------------------------------------------------------------
    console.log('[TEST 1] Testing HTTP REST API Endpoints...');

    const rootRes = await getHttp('/');
    assert.strictEqual(rootRes.status, 200, 'Expected 200 from root /');
    assert.ok(rootRes.data.includes('AEOS Mission Control'), 'Root HTML missing brand title');
    console.log('✓ UI index.html served with HTTP 200.');

    const spendRes = await getHttp('/api/spend');
    assert.strictEqual(spendRes.status, 200, 'Expected 200 from /api/spend');
    const spendJson = JSON.parse(spendRes.data);
    assert.ok(spendJson.project_name, 'Spend payload missing project_name');
    console.log(`✓ /api/spend returned HTTP 200: Project=${spendJson.project_name}, Cost=$${spendJson.total_cost_usd}`);

    const turnsRes = await getHttp('/api/turns');
    assert.strictEqual(turnsRes.status, 200, 'Expected 200 from /api/turns');
    const turnsJson = JSON.parse(turnsRes.data);
    assert.ok(Array.isArray(turnsJson), 'Turns response must be an array');
    console.log(`✓ /api/turns returned HTTP 200: ${turnsJson.length} execution turns retrieved.`);

    const attestRes = await getHttp('/api/attestations');
    assert.strictEqual(attestRes.status, 200, 'Expected 200 from /api/attestations');
    const attestJson = JSON.parse(attestRes.data);
    assert.ok(Array.isArray(attestJson) && attestJson.length > 0, 'Attestations must return historical records');
    assert.ok(attestJson[0].sha256_hash, 'Attestation missing sha256_hash');
    console.log(`✓ /api/attestations returned HTTP 200: Latest SHA-256=${attestJson[0].sha256_hash.slice(0, 16)}...`);

    // ------------------------------------------------------------------
    // Test 2: WebSocket Real-Time Broadcaster
    // ------------------------------------------------------------------
    console.log('\n[TEST 2] Testing Real-Time WebSocket Telemetry Broadcaster...');

    const wsReceived = await new Promise<any>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${actualPort}/ws`);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket did not receive telemetry packet within 2,000ms'));
      }, 2000);

      ws.on('message', (data) => {
        clearTimeout(timer);
        try {
          const parsed = JSON.parse(data.toString());
          ws.close();
          resolve(parsed);
        } catch (e) {
          ws.close();
          reject(e);
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    assert.strictEqual(wsReceived.type, 'telemetry_snapshot', 'Expected telemetry_snapshot envelope type');
    assert.ok(wsReceived.spend, 'WebSocket envelope missing spend data');
    assert.ok(Array.isArray(wsReceived.turns), 'WebSocket envelope missing turns array');
    assert.ok(Array.isArray(wsReceived.attestations), 'WebSocket envelope missing attestations array');
    console.log(`✓ WebSocket live stream received valid telemetry packet in < 2,000ms.`);
    console.log(`  Envelope Timestamp: ${wsReceived.timestamp}`);
    console.log(`  Stashed Keys Count: ${wsReceived.stashKeys.length}`);

    // ------------------------------------------------------------------
    // Test 3: Stash Endpoint Payload Reconstitution
    // ------------------------------------------------------------------
    console.log('\n[TEST 3] Testing Reversible Stash Reconstitution Endpoint...');

    const stashDir = path.join(process.cwd(), '.aeos', 'stash');
    let sampleHash = '';
    let expectedContent = '';

    if (fs.existsSync(stashDir)) {
      const files = fs.readdirSync(stashDir).filter((f) => f.endsWith('.bin'));
      if (files.length > 0) {
        sampleHash = files[0].replace('.bin', '');
        expectedContent = fs.readFileSync(path.join(stashDir, files[0]), 'utf-8');
      }
    }

    if (!sampleHash) {
      // Create temporary test stash file
      sampleHash = 'deadbeefcafe0123';
      expectedContent = 'AEOS_STASH_TEST_PAYLOAD_DIAGNOSTICS_OK';
      fs.writeFileSync(path.join(stashDir, `${sampleHash}.bin`), expectedContent, 'utf-8');
    }

    const stashRes = await getHttp(`/api/stash/${sampleHash}`);
    assert.strictEqual(stashRes.status, 200, `Expected 200 for stash key ${sampleHash}`);
    assert.strictEqual(stashRes.data, expectedContent, 'Stashed payload does not match original file content');
    console.log(`✓ /api/stash/${sampleHash} resolved and reconstituted exact payload (${stashRes.data.length} bytes).`);

    console.log('\n========================================');
    console.log('AEOS DASHBOARD VERIFICATION COMPLETE: SUCCESS');
    console.log('========================================');
  } finally {
    await dashboard.stop();
  }
}

runDashboardTestSuite().catch((err) => {
  console.error('\n✗ Dashboard Test Suite Failed:', err);
  process.exit(1);
});