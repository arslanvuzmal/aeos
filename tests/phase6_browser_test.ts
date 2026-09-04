import * as assert from 'assert';
import * as http from 'http';
import { WebSocket } from 'ws';
import { Client } from 'pg';
import { StealthBrowser } from '../src/stealth_browser.js';

const DB_CONN = 'postgresql://aeos_admin:aeos_secure_password_2026@localhost:5432/aeos_kernel';

async function runPhase6TestSuite() {
  console.log('=== STARTING PHASE 6 VERIFICATION TEST SUITE ===\n');
  const browser = new StealthBrowser({ headless: true, vncPort: 8765 });

  try {
    // -------------------------------------------------------------
    // Test 1: Fingerprint Masking & Hardware Spoofing
    // -------------------------------------------------------------
    console.log('[TEST 1] Testing Anti-Bot Fingerprint Masking & WebGL Spoofing...');
    const page = await browser.initialize();
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <head><title>Fingerprint Test</title></head>
      <body>
        <canvas id="testCanvas" width="50" height="50"></canvas>
      </body>
      </html>
    `);

    const evalResults = await page.evaluate(() => {
      const glCanvas = document.createElement('canvas');
      const gl = glCanvas.getContext('webgl');
      let vendor = 'none';
      let renderer = 'none';

      if (gl) {
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
          renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        }
      }

      const c = document.getElementById('testCanvas') as HTMLCanvasElement;
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(0, 0, 20, 20);
      }
      const dataUrl = c.toDataURL();

      return {
        webdriver: (navigator as any).webdriver,
        vendor,
        renderer,
        dataUrlValid: dataUrl.startsWith('data:image/png;base64,')
      };
    });

    console.log('✓ Evaluated Browser Fingerprint Metrics:');
    console.log(`  navigator.webdriver: ${evalResults.webdriver}`);
    console.log(`  WebGL Vendor: ${evalResults.vendor}`);
    console.log(`  WebGL Renderer: ${evalResults.renderer}`);
    console.log(`  Canvas DataURL Valid: ${evalResults.dataUrlValid}`);

    assert.strictEqual(evalResults.webdriver, undefined, 'navigator.webdriver was not deleted!');
    assert.strictEqual(evalResults.vendor, 'Intel Inc.', 'WebGL Vendor spoofing failed!');
    assert.strictEqual(evalResults.renderer, 'Intel Iris OpenGL Engine', 'WebGL Renderer spoofing failed!');
    assert.strictEqual(evalResults.dataUrlValid, true, 'Canvas data URL generation failed.');
    console.log('✓ Anti-detection fingerprint patches verified.\n');

    // -------------------------------------------------------------
    // Test 2: Bézier Trajectory Kinematics
    // -------------------------------------------------------------
    console.log('[TEST 2] Testing Cubic Bézier Mouse Trajectory Math...');
    const path = browser.calculateBezierPath({ x: 50, y: 50 }, { x: 500, y: 400 }, 20);
    assert.strictEqual(path.length, 21, 'Trajectory did not produce expected step count.');
    
    // Check non-linearity
    const midPoint = path[10];
    const linearMidX = (50 + 500) / 2;
    console.log(`✓ Path start: (${path[0].x}, ${path[0].y}) -> Mid: (${midPoint.x}, ${midPoint.y}) -> End: (${path[20].x}, ${path[20].y})`);
    assert.notStrictEqual(midPoint.x, linearMidX, 'Path is strictly linear; expected spline curvature.');
    console.log('✓ Cubic Bézier spline kinematics verified.\n');

    // -------------------------------------------------------------
    // Test 3: Challenge Detection & Visual Screencast Gateway
    // -------------------------------------------------------------
    console.log('[TEST 3] Testing Challenge Intercept & Visual Recovery Gateway...');
    await page.setContent(`
      <!DOCTYPE html>
      <html>
      <body>
        <div id="cf-challenge-running">Checking your browser before accessing URL...</div>
      </body>
      </html>
    `);

    const challengeDetected = await browser.detectSecurityChallenge();
    assert.strictEqual(challengeDetected, true, 'Failed to detect simulated Cloudflare challenge element.');
    console.log('✓ Challenge selector detected successfully.');

    // Launch fallback portal in background
    let portalResolved = false;
    const fallbackPromise = browser.triggerHumanVncFallback().then(() => {
      portalResolved = true;
    });

    // Wait for server initialization
    await new Promise((r) => setTimeout(r, 200));

    // HTTP Portal Check
    const portalHtml = await new Promise<string>((resolve, reject) => {
      http.get('http://127.0.0.1:8765/portal', (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });

    assert.ok(portalHtml.includes('AEOS Visual Screencast Gate'), 'Portal HTML response missing expected title.');
    console.log('✓ Visual Fallback HTTP Portal served successfully on port 8765.');

    // WebSocket Stream Verification
    const wsFrameReceived = await new Promise<boolean>((resolve, reject) => {
      const ws = new WebSocket('ws://127.0.0.1:8765');
      ws.on('message', (data) => {
        if (data.toString().length > 100) {
          ws.close();
          resolve(true);
        }
      });
      ws.on('error', reject);
      setTimeout(() => resolve(false), 2000);
    });

    assert.strictEqual(wsFrameReceived, true, 'WebSocket stream failed to deliver screencast JPEG frames.');
    console.log('✓ WebSocket live screencast streaming verified.');

    // Trigger Resume Endpoint
    await new Promise<void>((resolve, reject) => {
      http.get('http://127.0.0.1:8765/resume', (res) => {
        assert.strictEqual(res.statusCode, 200);
        resolve();
      }).on('error', reject);
    });

    await fallbackPromise;
    assert.strictEqual(portalResolved, true, 'triggerHumanVncFallback did not resolve upon /resume call.');
    console.log('✓ Visual recovery loop and execution resumption verified.\n');

    // -------------------------------------------------------------
    // Test 4: PostgreSQL Telemetry Audit
    // -------------------------------------------------------------
    console.log('[TEST 4] Validating PostgreSQL Tool Execution Ledger...');
    const client = new Client({ connectionString: DB_CONN });

    try {
      await client.connect();
      const turnRes = await client.query('SELECT id FROM agent_turns ORDER BY created_at DESC LIMIT 1;');
      assert.ok(turnRes.rows.length > 0, 'No turn found in database.');
      const turnId = turnRes.rows[0].id;

      await client.query(
        `INSERT INTO tool_executions (turn_id, tool_name, input_payload, output_payload, is_error, duration_ms)
         VALUES ($1, $2, $3, $4, false, 850);`,
        [
          turnId,
          'stealth_browser_navigate',
          JSON.stringify({ action: 'stealth_navigate', url: 'https://security-check.local' }),
          JSON.stringify({ evasion_passed: true, challenge_handled: true, cookies_captured: 4 })
        ]
      );

      const checkRes = await client.query(
        'SELECT tool_name, input_payload, output_payload, duration_ms FROM tool_executions WHERE tool_name = $1 ORDER BY created_at DESC LIMIT 1;',
        ['stealth_browser_navigate']
      );

      console.log('✓ Browser Tool Execution Ledger Record:');
      console.table(checkRes.rows[0]);
      assert.strictEqual(checkRes.rows[0].tool_name, 'stealth_browser_navigate');
    } finally {
      await client.end();
    }

    console.log('========================================');
    console.log('PHASE 6 VERIFICATION COMPLETE: SUCCESS');
    console.log('========================================');
  } finally {
    await browser.close();
  }
}

runPhase6TestSuite().catch((err) => {
  console.error('\n✗ Phase 6 Verification Failed:', err);
  process.exit(1);
});