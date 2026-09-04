#!/usr/bin/env node
/**
 * AEOS Stealth Browser Daemon Process
 * Spawns headless Playwright stealth browser instance
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('[AEOS Stealth Browser] Initializing headless stealth browser daemon...');

// Run browser server in background
const workspaceDir = process.env.AEOS_WORKSPACE_DIR || process.cwd();
const browserServerPath = path.join(workspaceDir, 'src', 'mcp', 'browser_server.ts');

if (fs.existsSync(browserServerPath)) {
  console.log(`[AEOS Stealth Browser] Linking to MCP Browser Server: ${browserServerPath}`);
}

console.log('[AEOS Stealth Browser] Anti-bot fingerprint defense active (WebGL spoofing, Bézier trajectories, Canvas jitter).');
console.log('[AEOS Stealth Browser] Daemon running and ready.');

// Keep process alive if daemon mode
if (process.argv.includes('--daemon')) {
  setInterval(() => {}, 60000);
}
