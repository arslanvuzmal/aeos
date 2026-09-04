#!/usr/bin/env tsx
/**
 * AEOS Resident Daemon (aeosd)
 * Supervises Dual-Brain Autonomous Cycles, watches workspace triggers,
 * and maintains continuous IPC synchronization.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DualBrainOrchestrator } from './dual_brain_orchestrator.js';

const PID_FILE = path.join(process.cwd(), '.aeos', 'aeosd.pid');
const QUEUE_FILE = path.join(process.cwd(), '.aeos', 'mission_queue.json');

export class AeosDaemon {
  private isRunning: boolean = false;
  private checkIntervalMs: number = 3000;
  private timer: NodeJS.Timeout | null = null;
  private orchestrator: DualBrainOrchestrator;

  constructor() {
    this.orchestrator = new DualBrainOrchestrator();
    fs.mkdirSync(path.join(process.cwd(), '.aeos'), { recursive: true });
  }

  public start(): void {
    if (fs.existsSync(PID_FILE)) {
      const pid = fs.readFileSync(PID_FILE, 'utf-8').trim();
      console.log(`[aeosd] Daemon already appears to be running (PID: ${pid}).`);
      return;
    }

    fs.writeFileSync(PID_FILE, String(process.pid), 'utf-8');
    this.isRunning = true;
    console.log(`[aeosd] AEOS Resident Daemon started on PID ${process.pid}`);
    console.log(`[aeosd] Monitoring queue at ${QUEUE_FILE}`);

    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());

    this.timer = setInterval(async () => {
      await this.pollQueue();
    }, this.checkIntervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (fs.existsSync(PID_FILE)) {
      try {
        fs.unlinkSync(PID_FILE);
      } catch {}
    }
    this.isRunning = false;
    console.log('[aeosd] Daemon stopped cleanly.');
    process.exit(0);
  }

  public status(): void {
    if (fs.existsSync(PID_FILE)) {
      const pid = fs.readFileSync(PID_FILE, 'utf-8').trim();
      console.log(`[aeosd] Daemon ACTIVE (PID: ${pid})`);
    } else {
      console.log('[aeosd] Daemon is NOT running.');
    }
  }

  private async pollQueue(): Promise<void> {
    if (!fs.existsSync(QUEUE_FILE)) return;

    try {
      const content = fs.readFileSync(QUEUE_FILE, 'utf-8').trim();
      if (!content) return;

      const queue = JSON.parse(content);
      if (Array.isArray(queue) && queue.length > 0) {
        const nextMission = queue.shift();
        fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2), 'utf-8');

        console.log(`\n[aeosd] Dequeued autonomous mission: "${nextMission.goal}"`);
        await this.orchestrator.executeMission({
          goal: nextMission.goal,
          maxSelfHealingRetries: nextMission.maxRetries || 5,
        });
      }
    } catch (err: any) {
      console.warn('[aeosd] Queue poll error:', err.message);
    }
  }
}

if (process.argv.includes('--daemon')) {
  const daemon = new AeosDaemon();
  daemon.start();
}
