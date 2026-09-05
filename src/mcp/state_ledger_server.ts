#!/usr/bin/env node
/**
 * AEOS State Ledger MCP Server
 * Provides `write_state_ledger` tool conforming to Dan Olsen's PMF Problem Space vs Solution Space architecture.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import pg from 'pg';
const { Pool } = pg;
import sqlite3 from 'sqlite3';

const DB_CONN = 'postgresql://aeos_admin:aeos_secure_password_2026@localhost:5432/aeos_kernel';
const SQLITE_FALLBACK_PATH = path.join(process.cwd(), '.aeos', 'state_ledger_fallback.sqlite3');

export class StateLedgerService {
  private pool: pg.Pool | null = null;
  private isPostgresConnected: boolean = false;
  private sqliteDb: sqlite3.Database | null = null;

  constructor() {
    this.initPostgres();
  }

  private initPostgres(): void {
    try {
      this.pool = new Pool({
        connectionString: DB_CONN,
        connectionTimeoutMillis: 1500,
      });
      this.pool.query('SELECT 1').then(() => {
        this.isPostgresConnected = true;
      }).catch(() => {
        this.isPostgresConnected = false;
        this.initSqliteFallback();
      });
    } catch {
      this.isPostgresConnected = false;
      this.initSqliteFallback();
    }
  }

  private initSqliteFallback(): void {
    const dir = path.dirname(SQLITE_FALLBACK_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.sqliteDb = new sqlite3.Database(SQLITE_FALLBACK_PATH);
    this.sqliteDb.run(`
      CREATE TABLE IF NOT EXISTS execution_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT,
        state_hash TEXT NOT NULL,
        problem_space_notes TEXT,
        solution_space_logs TEXT,
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  public async recordExecutionLedger(
    taskId: string | null,
    stateHash: string,
    problemSpaceNotes: string | null,
    solutionSpaceLogs: any
  ): Promise<void> {
    if (this.isPostgresConnected && this.pool) {
      try {
        await this.pool.query(
          `INSERT INTO execution_ledger (task_id, state_hash, problem_space_notes, solution_space_logs)
           VALUES ($1, $2, $3, $4);`,
          [taskId, stateHash, problemSpaceNotes, solutionSpaceLogs ? JSON.stringify(solutionSpaceLogs) : null]
        );
        return;
      } catch (err: any) {
        this.isPostgresConnected = false;
        this.initSqliteFallback();
      }
    }

    if (!this.sqliteDb) {
      this.initSqliteFallback();
    }

    return new Promise((resolve) => {
      this.sqliteDb?.run(
        `INSERT INTO execution_ledger (task_id, state_hash, problem_space_notes, solution_space_logs)
         VALUES (?, ?, ?, ?)`,
        [taskId, stateHash, problemSpaceNotes, solutionSpaceLogs ? JSON.stringify(solutionSpaceLogs) : null],
        () => resolve()
      );
    });
  }

  public async writeLedger(
    filePath: string,
    content: string,
    isProblemSpace: boolean = false,
    taskId?: string
  ): Promise<{ success: boolean; filePath: string; stateHash: string; bytesWritten: number; message: string }> {
    // Sanitize and anchor inside workspace root
    const resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(process.cwd(), filePath.replace(/^\.?\//, ''));

    const normalizedPath = path.normalize(resolvedPath);
    const planningDir = path.join(process.cwd(), '.planning');

    // Ensure target path is safely under workspace root
    if (!normalizedPath.startsWith(process.cwd())) {
      throw new Error(`Security Violation: Path traversal outside workspace root detected: ${filePath}`);
    }

    // Ensure directory exists
    fs.mkdirSync(path.dirname(normalizedPath), { recursive: true });

    // Write contents
    fs.writeFileSync(normalizedPath, content, 'utf-8');

    // Compute SHA-256 Plan Attestation Hash
    const stateHash = crypto.createHash('sha256').update(Buffer.from(content, 'utf-8')).digest('hex');

    // If writing task_plan.md, lock state hash
    if (normalizedPath.endsWith('task_plan.md')) {
      fs.mkdirSync(planningDir, { recursive: true });
      fs.writeFileSync(path.join(planningDir, 'plan.sha256'), stateHash, 'utf-8');
    }

    // Record to persistent execution_ledger
    const problemSpaceNotes = isProblemSpace
      ? `Problem Space ("What"): ${content.slice(0, 300)}...`
      : null;

    const solutionSpaceLogs = !isProblemSpace
      ? {
          file: path.relative(process.cwd(), normalizedPath),
          bytes: Buffer.byteLength(content, 'utf-8'),
          type: 'solution_space_exec',
          timestamp: new Date().toISOString(),
        }
      : null;

    await this.recordExecutionLedger(taskId || null, stateHash, problemSpaceNotes, solutionSpaceLogs);

    return {
      success: true,
      filePath: path.relative(process.cwd(), normalizedPath),
      stateHash,
      bytesWritten: Buffer.byteLength(content, 'utf-8'),
      message: `State ledger successfully updated. Problem Space Attestation: ${stateHash.slice(0, 16)}...`,
    };
  }

  public async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end().catch(() => {});
    }
    if (this.sqliteDb) {
      await new Promise<void>((resolve) => this.sqliteDb?.close(() => resolve()));
    }
  }
}

// Instantiate MCP Server
export const server = new Server(
  {
    name: 'aeos-state-ledger',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const ledgerService = new StateLedgerService();

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'write_state_ledger',
        description: 'Writes to the state ledger files (task_plan, findings, progress) to prevent Goal Drift and define the Problem Space.',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'Path in .planning/ directory',
            },
            content: {
              type: 'string',
              description: 'The ledger markdown or text content.',
            },
            is_problem_space: {
              type: 'boolean',
              description: 'Does this define a customer need (What) or a solution (How)?',
            },
            task_id: {
              type: 'string',
              description: 'Optional UUID of the feature chunk agent task.',
            },
          },
          required: ['file_path', 'content'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'write_state_ledger') {
    try {
      const filePath = String(args?.file_path || '');
      const content = String(args?.content || '');
      const isProblemSpace = Boolean(args?.is_problem_space);
      const taskId = args?.task_id ? String(args.task_id) : undefined;

      const result = await ledgerService.writeLedger(filePath, content, isProblemSpace, taskId);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `[STATE LEDGER ERROR] ${err.message}`,
          },
        ],
      };
    }
  }

  throw new Error(`Tool not found: ${name}`);
});

// Run via stdio if executed directly
if (process.argv[1]?.endsWith('state_ledger_server.ts') || process.argv[1]?.endsWith('state_ledger_server.js')) {
  const transport = new StdioServerTransport();
  server.connect(transport).catch((err) => {
    process.stderr.write(`[STATE LEDGER MCP] Fatal error: ${err.message}\n`);
    process.exit(1);
  });
}
