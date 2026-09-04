#!/usr/bin/env tsx
import { Client } from 'pg';
import { StealthBrowser } from './stealth_browser.js';

const DB_CONN = 'postgresql://aeos_admin:aeos_secure_password_2026@localhost:5432/aeos_kernel';

async function logBrowserToolExecution(
  targetUrl: string,
  evasionStatus: boolean,
  durationMs: number,
  cookieCount: number
): Promise<void> {
  const client = new Client({ connectionString: DB_CONN });
  try {
    await client.connect();
    const turnRes = await client.query('SELECT id FROM agent_turns ORDER BY created_at DESC LIMIT 1;');
    if (turnRes.rows.length > 0) {
      const turnId = turnRes.rows[0].id;
      const inputPayload = { action: 'stealth_navigate', url: targetUrl };
      const outputPayload = { evasion_passed: evasionStatus, cookies_captured: cookieCount };

      await client.query(
        `INSERT INTO tool_executions (turn_id, tool_name, input_payload, output_payload, is_error, duration_ms)
         VALUES ($1, $2, $3, $4, $5, $6);`,
        [turnId, 'stealth_browser_navigate', JSON.stringify(inputPayload), JSON.stringify(outputPayload), false, durationMs]
      );
    }
  } catch (err) {
    console.error('[WARN] Failed to write browser tool execution to PostgreSQL:', err);
  } finally {
    await client.end();
  }
}

async function runCli() {
  const args = process.argv.slice(2);
  const targetUrl = args[0] || 'https://example.com';
  const browser = new StealthBrowser({ headless: true });

  const start = Date.now();
  console.log(`[AEOS BROWSER] Initializing stealth session for: ${targetUrl}`);

  try {
    const page = await browser.initialize();
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

    const isChallenge = await browser.detectSecurityChallenge();
    console.log(`Security Challenge Detected: ${isChallenge}`);

    if (isChallenge) {
      await browser.triggerHumanVncFallback();
    }

    const cookies = await browser.getSessionCookies();
    const duration = Date.now() - start;

    console.log(`Session Navigation Succeeded. Cookies captured: ${cookies.length}`);
    await logBrowserToolExecution(targetUrl, !isChallenge, duration, cookies.length);
  } finally {
    await browser.close();
  }
}

runCli();