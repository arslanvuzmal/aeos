#!/usr/bin/env tsx
import { Command } from 'commander';
import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { AeosSwarmOrchestrator } from './orchestrator.js';
import { DualBrainOrchestrator } from './dual_brain_orchestrator.js';
import { AeosDaemon } from './aeosd.js';

const program = new Command();
const isWin = process.platform === 'win32';
const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
const bashShell = isWin && fs.existsSync(gitBash) ? gitBash : undefined;

program
  .name('aeos')
  .description('AI Engineering Operating System (AEOS) Unified Swarm & Dual-Brain CLI')
  .version('2.0.0');

program
  .command('init')
  .description('Initialize workspace state ledger, attest baseline, and check container health')
  .action(() => {
    console.log('[AEOS CLI] Arming Crash-Proof State Ledger...');
    execSync('./aeos-activate.sh', { stdio: 'inherit', shell: bashShell });
  });

program
  .command('run')
  .description('Execute an autonomous development mission through the multi-agent swarm')
  .argument('<mission>', 'Objective specification string')
  .action(async (mission: string) => {
    const orchestrator = new AeosSwarmOrchestrator(process.cwd());
    await orchestrator.runMission({ goal: mission });
  });

program
  .command('dual-brain')
  .description('Execute an autonomous development mission using the Claude Code + Antigravity Dual-Brain Engine')
  .argument('<goal>', 'Objective specification string')
  .option('-r, --retries <number>', 'Maximum self-healing retries in Docker sandbox', '5')
  .action(async (goal: string, options) => {
    const orchestrator = new DualBrainOrchestrator(process.cwd());
    const retries = parseInt(options.retries, 10) || 5;
    await orchestrator.executeMission({ goal, maxSelfHealingRetries: retries });
  });

program
  .command('daemon')
  .description('Manage the AEOS resident background daemon (aeosd)')
  .argument('<action>', 'start | stop | status')
  .action((action: string) => {
    const daemon = new AeosDaemon();
    if (action === 'start') {
      daemon.start();
    } else if (action === 'stop') {
      daemon.stop();
    } else if (action === 'status') {
      daemon.status();
    } else {
      console.error(`Unknown action: ${action}. Use start, stop, or status.`);
    }
  });

program
  .command('research')
  .description('Perform autonomous deep technical research via stealth browser & RAG memory')
  .argument('<topic>', 'Technical topic to investigate')
  .action(async (topic: string) => {
    console.log(`[AEOS RESEARCH] Launching evasion-hardened research for: "${topic}"...`);
    const browserMcpPath = path.join(process.cwd(), 'src', 'mcp', 'browser_server.ts');
    execSync(`npx tsx -e "import('${browserMcpPath.replace(/\\/g, '/')}');"`, { stdio: 'inherit' });
  });

program
  .command('resume')
  .description('Verify cryptographic attestation and resume execution from current task plan')
  .action(() => {
    console.log('[AEOS CLI] Verifying ledger attestation prior to resuming...');
    execSync('./aeos-attest --verify', { stdio: 'inherit', shell: bashShell });
    console.log('[AEOS CLI] Plan verified. Smart context injection output:');
    execSync('./.claude/hooks/smart_inject.sh', { stdio: 'inherit', shell: bashShell });
  });

program
  .command('add-book')
  .description('Index a technical manual, book, or PDF into the token-zero hybrid RAG index')
  .argument('<filePath>', 'Path to target PDF or Markdown document')
  .action((filePath: string) => {
    console.log(`[AEOS CLI] Ingesting document into local hybrid index: ${filePath}`);
    const pyBin = isWin ? 'python' : 'python3';
    execSync(`${pyBin} src/ingest_engine.py --index "${filePath}"`, { stdio: 'inherit', shell: bashShell });
  });

program
  .command('dashboard')
  .description('Launch the real-time AEOS telemetry and kernel observability web dashboard')
  .option('-p, --port <number>', 'Port to bind dashboard server', '4000')
  .action((options) => {
    console.log(`[AEOS CLI] Launching Observability Dashboard on port ${options.port}...`);
    execSync(`npx tsx src/dashboard/server.ts --port ${options.port}`, { stdio: 'inherit', shell: bashShell });
  });

program.parse(process.argv);