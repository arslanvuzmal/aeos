#!/usr/bin/env node
/**
 * AEOS MCP Bridge Tool Server (aeos-mcp-bridge.js)
 * Exposes /aeos and linkage controls to Claude Code via Model Context Protocol (MCP)
 */
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { exec, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const workspaceDir = process.env.AEOS_WORKSPACE_DIR || process.cwd();
const aeosPath = process.env.AEOS_PATH || path.join(workspaceDir, 'bin', 'aeos');

const server = new Server(
  {
    name: 'aeos-core',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'activate_aeos',
        description: 'Executes AEOS linkage (/aeos), launching sandbox container, local Qdrant database, stealth browsing runtime, and bi-directional state synchronization with Antigravity.',
        inputSchema: {
          type: 'object',
          properties: {
            mode: {
              type: 'string',
              description: 'Linkage activation mode (default: "start").',
            },
          },
        },
      },
      {
        name: 'stop_aeos',
        description: 'Breaks agent linkages and safely stops background AEOS services.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_aeos_status',
        description: 'Inspects active linkage state, Qdrant database, sandbox container, and state ledger.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;

  if (name === 'activate_aeos') {
    try {
      const isWin = process.platform === 'win32';
      const cmd = isWin
        ? `node "${path.join(workspaceDir, 'bin', 'aeos-orchestrator.js')}" --claim-pending`
        : `bash "${aeosPath}" start`;

      const output = execSync(cmd, { cwd: workspaceDir, encoding: 'utf8' });
      return {
        content: [
          {
            type: 'text',
            text: `[AEOS Linkage Activated]\n${output}\nClaude Code and Antigravity are hardwired over SHA-256 state ledger.`,
          },
        ],
      };
    } catch (e) {
      return {
        content: [
          {
            type: 'text',
            text: `[AEOS Activation Output]: ${e.message}`,
          },
        ],
      };
    }
  }

  if (name === 'stop_aeos') {
    try {
      const isWin = process.platform === 'win32';
      const cmd = isWin ? `docker stop aeos-sandbox` : `bash "${aeosPath}" stop`;
      execSync(cmd, { encoding: 'utf8' });
      return {
        content: [{ type: 'text', text: 'AEOS Linkage safely offline.' }],
      };
    } catch (e) {
      return {
        content: [{ type: 'text', text: `Stop result: ${e.message}` }],
      };
    }
  }

  if (name === 'get_aeos_status') {
    const pidPath = path.join(workspaceDir, '.planning', 'aeosd.pid');
    const hasPid = fs.existsSync(pidPath);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              linkage: hasPid ? 'ACTIVE' : 'READY',
              workspace: workspaceDir,
              ledger: path.join(workspaceDir, '.planning', 'task_plan.md'),
              qdrant: 'http://localhost:6333',
              dashboard: 'http://localhost:4000',
            },
            null,
            2
          ),
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[AEOS MCP BRIDGE] Active on stdio\n');
}

main().catch((err) => {
  process.stderr.write(`[FATAL] ${err.message}\n`);
  process.exit(1);
});
