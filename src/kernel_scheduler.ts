import Docker from 'dockerode';
import { EventEmitter } from 'events';

export type AgentRole = 'planner' | 'coder' | 'qa_tester' | 'debugger';
export type ThreadState = 'READY' | 'RUNNING' | 'WAITING' | 'TERMINATED';

export interface ProcessControlBlock {
  pid: number;
  agentId: string;
  role: AgentRole;
  state: ThreadState;
  priority: number;
  timeSliceMs: number;
  turnTokenLimit: number;
  tokensConsumedThisTurn: number;
  totalTokensConsumed: number;
  dockerContainerId?: string;
  spawnedAt: Date;
}

export interface SandboxExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  executionDurationMs: number;
  oomKilled: boolean;
}

export interface SandboxOptions {
  timeoutMs?: number;
  env?: string[];
  tmpfsSizeMb?: number;
}

export class KernelScheduler extends EventEmitter {
  private docker: Docker;
  private processes: Map<number, ProcessControlBlock> = new Map();
  private readyQueue: number[] = [];
  private activePid: number | null = null;
  private pidSequence: number = 1000;
  private isScheduling: boolean = false;

  constructor(dockerOptions?: Docker.DockerOptions) {
    super();
    this.docker = new Docker(dockerOptions);
  }

  /**
   * Spawns an agent execution thread represented by a Process Control Block (PCB).
   */
  public spawnThread(
    agentId: string,
    role: AgentRole,
    priority: number = 5,
    turnTokenLimit: number = 4000
  ): number {
    const pid = ++this.pidSequence;
    const clampedPriority = Math.max(1, Math.min(10, priority));
    
    // Higher priority yields longer time slice quantum (e.g., Priority 10 = 1200ms, Priority 1 = 300ms)
    const timeSliceMs = 200 + clampedPriority * 100;

    const pcb: ProcessControlBlock = {
      pid,
      agentId,
      role,
      state: 'READY',
      priority: clampedPriority,
      timeSliceMs,
      turnTokenLimit,
      tokensConsumedThisTurn: 0,
      totalTokensConsumed: 0,
      spawnedAt: new Date()
    };

    this.processes.set(pid, pcb);
    this.readyQueue.push(pid);
    this._reorderReadyQueue();

    this.emit('thread_spawned', { pid, agentId, role, priority: clampedPriority });
    return pid;
  }

  private _reorderReadyQueue(): void {
    this.readyQueue.sort((a, b) => {
      const pcbA = this.processes.get(a)!;
      const pcbB = this.processes.get(b)!;
      return pcbB.priority - pcbA.priority;
    });
  }

  public getProcess(pid: number): ProcessControlBlock | undefined {
    return this.processes.get(pid);
  }

  public listProcesses(): ProcessControlBlock[] {
    return Array.from(this.processes.values());
  }

  /**
   * Tracks token usage against a process's per-turn limit.
   */
  public accountTokens(pid: number, tokens: number): boolean {
    const pcb = this.processes.get(pid);
    if (!pcb) {
      throw new Error(`[KERNEL] Cannot account tokens for non-existent PID: ${pid}`);
    }

    pcb.tokensConsumedThisTurn += tokens;
    pcb.totalTokensConsumed += tokens;

    if (pcb.tokensConsumedThisTurn > pcb.turnTokenLimit) {
      pcb.state = 'WAITING';
      this.emit('quota_exceeded', {
        pid,
        role: pcb.role,
        limit: pcb.turnTokenLimit,
        consumed: pcb.tokensConsumedThisTurn
      });
      return false;
    }

    return true;
  }

  /**
   * Resets the turn budget and restores WAITING processes to READY.
   */
  public resetTurnBudget(pid: number): void {
    const pcb = this.processes.get(pid);
    if (!pcb) return;

    pcb.tokensConsumedThisTurn = 0;
    if (pcb.state === 'WAITING') {
      pcb.state = 'READY';
      this.readyQueue.push(pid);
      this._reorderReadyQueue();
      this.emit('thread_resumed', { pid });
    }
  }

  /**
   * Terminates a process and removes it from scheduling queues.
   */
  public terminateThread(pid: number, reason: string = 'Normal completion'): void {
    const pcb = this.processes.get(pid);
    if (!pcb) return;

    pcb.state = 'TERMINATED';
    this.readyQueue = this.readyQueue.filter((p) => p !== pid);
    if (this.activePid === pid) {
      this.activePid = null;
    }

    this.emit('thread_terminated', { pid, reason });
  }

  /**
   * Executes code inside an isolated, resource-constrained Docker container.
   */
  public async executeInSandbox(
    pid: number,
    command: string[],
    options?: SandboxOptions
  ): Promise<SandboxExecutionResult> {
    const pcb = this.processes.get(pid);
    if (!pcb) {
      throw new Error(`[KERNEL] Execution rejected: PID ${pid} does not exist.`);
    }

    const timeoutLimit = options?.timeoutMs || Math.max(10000, pcb.timeSliceMs * 5);
    const tmpfsSize = options?.tmpfsSizeMb || 256;
    const startTime = Date.now();

    const container = await this.docker.createContainer({
      Image: 'node:20-alpine',
      Cmd: command,
      Tty: false,
      AttachStdout: true,
      AttachStderr: true,
      Env: options?.env || ['NODE_ENV=production'],
      HostConfig: {
        Memory: 1024 * 1024 * 1024,      // 1024 MB Hard Memory Cap
        MemorySwap: 1024 * 1024 * 1024,  // Swap completely disabled (Swap = Memory)
        NanoCpus: 1_000_000_000,         // Exactly 1.0 CPU Core Allocation
        NetworkMode: 'none',             // Zero external network connectivity
        ReadonlyRootfs: true,            // Immutable root filesystem
        Tmpfs: {
          '/tmp': `rw,noexec,nosuid,size=${tmpfsSize}m`
        }
      }
    });

    pcb.dockerContainerId = container.id;
    await container.start();

    const stream = await container.logs({
      stdout: true,
      stderr: true,
      follow: true
    });

    let stdout = '';
    let stderr = '';

    return new Promise((resolve, reject) => {
      let isSettled = false;

      // Demux Docker multiplexed stream
      container.modem.demuxStream(
        stream,
        {
          write: (chunk: Buffer) => {
            stdout += chunk.toString('utf-8');
          }
        },
        {
          write: (chunk: Buffer) => {
            stderr += chunk.toString('utf-8');
          }
        }
      );

      // Preemptive execution timeout timer
      const timeoutHandle = setTimeout(async () => {
        if (isSettled) return;
        isSettled = true;

        try {
          await container.kill();
        } catch {
          // Container may have exited naturally
        }

        await container.remove({ force: true }).catch(() => {});
        pcb.dockerContainerId = undefined;

        this.emit('quantum_expired', { pid, timeoutLimit });
        reject(new Error(`[KERNEL TIMEOUT] Execution exceeded ${timeoutLimit}ms quantum limit.`));
      }, timeoutLimit);

      // Wait for natural container exit or OOM kill
      container.wait(async (err, data) => {
        if (isSettled) return;
        isSettled = true;
        clearTimeout(timeoutHandle);

        const duration = Date.now() - startTime;
        let oomKilled = false;

        try {
          const inspectData = await container.inspect();
          oomKilled = inspectData.State.OOMKilled || false;
        } catch {
          // Fallback inspect handling
        }

        // Small delay to ensure stream buffer flush
        await new Promise((r) => setTimeout(r, 50));

        await container.remove({ force: true }).catch(() => {});
        pcb.dockerContainerId = undefined;

        if (err) {
          return reject(err);
        }

        resolve({
          stdout,
          stderr,
          exitCode: data.StatusCode,
          executionDurationMs: duration,
          oomKilled
        });
      });
    });
  }

  /**
   * Advances the scheduling cycle by selecting the highest-priority READY thread.
   */
  public async scheduleNextCycle(): Promise<ProcessControlBlock | null> {
    if (this.isScheduling || this.readyQueue.length === 0) {
      return null;
    }

    this.isScheduling = true;
    const pid = this.readyQueue.shift()!;
    const pcb = this.processes.get(pid);

    if (!pcb || pcb.state === 'TERMINATED') {
      this.isScheduling = false;
      return null;
    }

    this.activePid = pid;
    pcb.state = 'RUNNING';
    pcb.tokensConsumedThisTurn = 0;

    this.emit('context_switch', {
      pid,
      agentId: pcb.agentId,
      role: pcb.role,
      priority: pcb.priority,
      quantumMs: pcb.timeSliceMs
    });

    // Cooperative yielding interval
    await new Promise((resolve) => setTimeout(resolve, 10));

    if (pcb.state === 'RUNNING') {
      pcb.state = 'READY';
      this.readyQueue.push(pid);
    }

    this.activePid = null;
    this.isScheduling = false;
    return pcb;
  }
}