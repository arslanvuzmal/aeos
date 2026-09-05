#!/usr/bin/env node
/**
 * AEOS Deep Memory & RAG MCP Server
 * Model Context Protocol (MCP) server over stdio for Claude Code & Antigravity
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { Pool } from 'pg';
import { StateLedgerService } from './state_ledger_server.js';

const DB_CONN = 'postgresql://aeos_admin:aeos_secure_password_2026@localhost:5432/aeos_kernel';
const MEMORY_FILE = path.join(process.cwd(), 'storage', 'learning.json');

const stateLedger = new StateLedgerService();

const pool = new Pool({ connectionString: DB_CONN });
pool.on('error', (err) => {
  console.error('[RAG_MCP] PG Pool idle client warning:', err.message);
});

async function logTelemetry(toolName: string, input: any, output: any, durationMs: number): Promise<void> {
  try {
    const turnRes = await pool.query('SELECT id FROM agent_turns ORDER BY created_at DESC LIMIT 1;');
    if (turnRes.rows.length > 0) {
      const turnId = turnRes.rows[0].id;
      await pool.query(
        `INSERT INTO tool_executions (turn_id, tool_name, input_payload, output_payload, is_error, duration_ms)
         VALUES ($1, $2, $3, $4, $5, $6);`,
        [turnId, toolName, JSON.stringify(input), JSON.stringify(output), false, durationMs]
      );
    }
  } catch (err: any) {
    process.stderr.write(`[RAG_MCP] Telemetry log failed: ${err.message}\n`);
  }
}

async function executeHybridRAG(query: string, topK: number = 3): Promise<any> {
  const venvPython = path.join(process.cwd(), '.venv', 'Scripts', 'python.exe');
  const pythonBin = fs.existsSync(venvPython) ? venvPython : 'python';
  const ragScript = path.join(process.cwd(), 'src', 'rag_tool.py');

  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, [ragScript, query, '--top-k', String(topK)], {
      cwd: process.cwd(),
      env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' }
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`RAG search failed (code ${code}): ${stderr}`));
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        resolve(parsed);
      } catch (err) {
        resolve({ raw: stdout.trim(), stderr });
      }
    });
  });
}

function storeEpisodicMemory(category: string, title: string, content: string, tags: string[] = []): any {
  let memoryData: any[] = [];
  if (fs.existsSync(MEMORY_FILE)) {
    try {
      const fileContent = fs.readFileSync(MEMORY_FILE, 'utf-8');
      memoryData = JSON.parse(fileContent);
      if (!Array.isArray(memoryData)) {
        memoryData = [memoryData];
      }
    } catch {
      memoryData = [];
    }
  }

  const record = {
    id: `mem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString(),
    category,
    title,
    content,
    tags,
  };

  memoryData.push(record);
  fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memoryData, null, 2), 'utf-8');
  return record;
}

function searchEpisodicMemory(query: string, category?: string): any[] {
  if (!fs.existsSync(MEMORY_FILE)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(MEMORY_FILE, 'utf-8');
    const records = JSON.parse(raw);
    if (!Array.isArray(records)) return [];

    const lowerQuery = query.toLowerCase();
    return records.filter((rec: any) => {
      if (category && rec.category !== category) return false;
      const haystack = `${rec.title} ${rec.content} ${(rec.tags || []).join(' ')}`.toLowerCase();
      return haystack.includes(lowerQuery);
    });
  } catch {
    return [];
  }
}

// Instantiate MCP Server
const server = new Server(
  {
    name: 'aeos-memory-rag',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register Available Tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'query_knowledge_base',
        description: 'Performs hybrid semantic and lexical search across indexed engineering documentation and specs. Returns high-density snippets under 1,000 tokens.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The technical query or concept to search for.',
            },
            top_k: {
              type: 'number',
              description: 'Maximum number of snippets to retrieve (default: 3).',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'store_memory',
        description: 'Persists an architectural pattern, bug fix insight, design constraint, or verified solution into persistent long-term episodic memory.',
        inputSchema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description: 'Category (e.g. architecture, bugfix, constraint, benchmark).',
            },
            title: {
              type: 'string',
              description: 'Brief title or identifier for this memory.',
            },
            content: {
              type: 'string',
              description: 'Detailed explanation, code snippet, or rule to remember.',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Keywords or tags for retrieval.',
            },
          },
          required: ['category', 'title', 'content'],
        },
      },
      {
        name: 'retrieve_memory',
        description: 'Retrieves historical learnings, past bug solutions, and architectural decisions from persistent episodic memory.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query or keyword to look up.',
            },
            category: {
              type: 'string',
              description: 'Optional category filter.',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'retrieve_context',
        description: 'Returns active project execution constraints (e.g. Docker memory limits, sandbox isolation, database schema summary).',
        inputSchema: {
          type: 'object',
          properties: {
            scope: {
              type: 'string',
              description: 'Optional scope filter (e.g. "sandbox", "database", "all").',
            },
          },
        },
      },
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

// Handle Tool Calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const startTime = Date.now();

  try {
    if (name === 'query_knowledge_base') {
      const query = String(args?.query || '');
      const topK = Number(args?.top_k || 3);
      const results = await executeHybridRAG(query, topK);
      const durationMs = Date.now() - startTime;
      await logTelemetry(name, { query, topK }, results, durationMs);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    }

    if (name === 'store_memory') {
      const category = String(args?.category || 'general');
      const title = String(args?.title || '');
      const content = String(args?.content || '');
      const tags = Array.isArray(args?.tags) ? args.tags.map(String) : [];

      const record = storeEpisodicMemory(category, title, content, tags);
      const durationMs = Date.now() - startTime;
      await logTelemetry(name, { category, title, tags }, record, durationMs);

      return {
        content: [
          {
            type: 'text',
            text: `Successfully stored episodic memory: [${record.id}] "${title}"`,
          },
        ],
      };
    }

    if (name === 'retrieve_memory') {
      const query = String(args?.query || '');
      const category = args?.category ? String(args.category) : undefined;
      const records = searchEpisodicMemory(query, category);
      const durationMs = Date.now() - startTime;
      await logTelemetry(name, { query, category }, { count: records.length }, durationMs);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(records, null, 2),
          },
        ],
      };
    }

    if (name === 'retrieve_context') {
      const context = {
        execution_environment: {
          sandbox: 'Docker node:20-alpine',
          ram_limit_mb: 1024,
          cpu_limit: 1.0,
          network_mode: 'none',
          tmpfs: '/tmp (256MB)',
        },
        database_ledger: {
          engine: 'PostgreSQL 15',
          tables: ['tenants', 'projects', 'agents', 'tasks', 'agent_turns', 'tool_executions', 'plan_attestations', 'opik_traces'],
        },
        telemetry: {
          dashboard_url: 'http://127.0.0.1:4000',
          websocket_feed: 'ws://127.0.0.1:4000/ws',
        },
      };
      const durationMs = Date.now() - startTime;
      await logTelemetry(name, args, context, durationMs);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(context, null, 2),
          },
        ],
      };
    }

    if (name === 'write_state_ledger') {
      const filePath = String(args?.file_path || '');
      const content = String(args?.content || '');
      const isProblemSpace = Boolean(args?.is_problem_space);
      const taskId = args?.task_id ? String(args.task_id) : undefined;

      const result = await stateLedger.writeLedger(filePath, content, isProblemSpace, taskId);
      const durationMs = Date.now() - startTime;
      await logTelemetry(name, args, result, durationMs);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }

    throw new Error(`Unknown tool requested: ${name}`);
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Tool execution error: ${error.message}`,
        },
      ],
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[AEOS MEMORY RAG MCP] Server active on stdio\n');
}

main().catch((err) => {
  process.stderr.write(`[FATAL] MCP server error: ${err.message}\n`);
  process.exit(1);
});
