#!/usr/bin/env node
/**
 * AEOS Deep Stealth Browsing & Autonomous Research MCP Server
 * Model Context Protocol (MCP) server over stdio for Claude Code & Antigravity
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { StealthBrowser } from '../stealth_browser.js';
import * as path from 'path';
import * as fs from 'fs';
import { Pool } from 'pg';

const DB_CONN = 'postgresql://aeos_admin:aeos_secure_password_2026@localhost:5432/aeos_kernel';
const MEMORY_FILE = path.join(process.cwd(), 'storage', 'learning.json');

const pool = new Pool({ connectionString: DB_CONN });
pool.on('error', (err) => {
  console.error('[BROWSER_MCP] PG Pool idle client warning:', err.message);
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
    process.stderr.write(`[BROWSER_MCP] Telemetry log failed: ${err.message}\n`);
  }
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Evasion-hardened search using DuckDuckGo HTML endpoint
 */
async function executeStealthSearch(query: string, maxResults: number = 5): Promise<SearchResult[]> {
  const browser = new StealthBrowser({ headless: true });
  const page = await browser.initialize();

  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

    const isChallenge = await browser.detectSecurityChallenge();
    if (isChallenge) {
      await browser.triggerHumanVncFallback();
    }

    const results = await page.evaluate((max) => {
      const items: { title: string; url: string; snippet: string }[] = [];
      const links = document.querySelectorAll('.result__body');

      for (let i = 0; i < links.length && items.length < max; i++) {
        const body = links[i];
        const titleEl = body.querySelector('.result__title a');
        const snippetEl = body.querySelector('.result__snippet');

        if (titleEl && snippetEl) {
          const rawHref = titleEl.getAttribute('href') || '';
          let actualUrl = rawHref;
          // Decode DuckDuckGo redirect if present
          if (rawHref.includes('uddg=')) {
            const match = rawHref.match(/uddg=([^&]+)/);
            if (match) {
              actualUrl = decodeURIComponent(match[1]);
            }
          }
          items.push({
            title: (titleEl.textContent || '').trim(),
            url: actualUrl,
            snippet: (snippetEl.textContent || '').trim(),
          });
        }
      }
      return items;
    }, maxResults);

    await browser.close();
    return results;
  } catch (err) {
    await browser.close();
    throw err;
  }
}

/**
 * Deep extraction of article / doc content with ANOLISA-style pruning
 */
async function executeStealthBrowse(url: string, waitForSelector?: string): Promise<{
  title: string;
  url: string;
  markdown: string;
  tokensEstimate: number;
}> {
  const browser = new StealthBrowser({ headless: true });
  const page = await browser.initialize();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });

    if (waitForSelector) {
      await page.waitForSelector(waitForSelector, { timeout: 10000 }).catch(() => {});
    }

    // Natural human cursor movement simulation
    await browser.humanLikeMove(500, 400).catch(() => {});

    const isChallenge = await browser.detectSecurityChallenge();
    if (isChallenge) {
      await browser.triggerHumanVncFallback();
    }

    const pageData = await page.evaluate(() => {
      // Remove noisy DOM elements
      const elementsToRemove = document.querySelectorAll(
        'script, style, svg, nav, footer, header, noscript, iframe, .ad, .ads, [class*="advertisement"]'
      );
      elementsToRemove.forEach((el) => el.remove());

      const title = document.title || '';
      const bodyText = document.body ? document.body.innerText : '';

      // Normalize multiple whitespaces
      const cleaned = bodyText
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .join('\n');

      return {
        title,
        text: cleaned.substring(0, 8000), // Cap extraction to prevent context explosion
      };
    });

    await browser.close();

    const markdown = `# ${pageData.title}\n\n**Source**: ${url}\n\n${pageData.text}`;
    const tokensEstimate = Math.ceil(markdown.length / 4);

    return {
      title: pageData.title,
      url,
      markdown,
      tokensEstimate,
    };
  } catch (err) {
    await browser.close();
    throw err;
  }
}

/**
 * Deep multi-hop research pipeline
 */
async function executeDeepResearch(topic: string, maxSources: number = 3): Promise<{
  topic: string;
  sources: SearchResult[];
  extractedDocs: Array<{ title: string; url: string; summary: string }>;
  synthesizedBrief: string;
}> {
  const searchResults = await executeStealthSearch(topic, maxSources + 2);
  const selectedSources = searchResults.slice(0, maxSources);

  const extractedDocs: Array<{ title: string; url: string; summary: string }> = [];

  for (const src of selectedSources) {
    try {
      const doc = await executeStealthBrowse(src.url);
      extractedDocs.push({
        title: doc.title,
        url: src.url,
        summary: doc.markdown.substring(0, 1500),
      });
    } catch (e: any) {
      extractedDocs.push({
        title: src.title,
        url: src.url,
        summary: `[Fetch note: ${src.snippet}]`,
      });
    }
  }

  // Synthesize research briefing
  let brief = `# AEOS DEEP RESEARCH BRIEFING: ${topic.toUpperCase()}\n\n`;
  brief += `Generated: ${new Date().toISOString()}\n\n`;
  brief += `## Primary Sources Analyzed\n`;
  selectedSources.forEach((s, idx) => {
    brief += `${idx + 1}. [${s.title}](${s.url}) - ${s.snippet}\n`;
  });

  brief += `\n## Core Technical Insights\n\n`;
  extractedDocs.forEach((doc) => {
    brief += `### ${doc.title}\nSource: ${doc.url}\n\n${doc.summary}\n\n---\n`;
  });

  // Auto-record insight to episodic memory
  try {
    let memoryData: any[] = [];
    if (fs.existsSync(MEMORY_FILE)) {
      memoryData = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf-8'));
      if (!Array.isArray(memoryData)) memoryData = [memoryData];
    }
    memoryData.push({
      id: `mem_research_${Date.now()}`,
      timestamp: new Date().toISOString(),
      category: 'deep_research',
      title: `Research: ${topic}`,
      content: brief.substring(0, 2500),
      tags: ['research', 'web', ...topic.toLowerCase().split(' ')],
    });
    fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memoryData, null, 2), 'utf-8');
  } catch {}

  return {
    topic,
    sources: selectedSources,
    extractedDocs,
    synthesizedBrief: brief,
  };
}

// Instantiate MCP Server
const server = new Server(
  {
    name: 'aeos-stealth-browser',
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
        name: 'stealth_search',
        description: 'Performs an evasion-hardened, anonymous web search without API keys. Returns top ranked links, titles, and snippets.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query.',
            },
            max_results: {
              type: 'number',
              description: 'Maximum search results to return (default: 5).',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'stealth_browse',
        description: 'Navigates to a webpage using anti-bot fingerprint masking (webdriver removal, WebGL spoofing, canvas bit jitter, human Bézier cursor curves, and port 8765 screencast fallback). Returns cleaned markdown content.',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'Target URL to visit.',
            },
            wait_for_selector: {
              type: 'string',
              description: 'Optional CSS selector to wait for before extracting content.',
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'deep_research',
        description: 'Runs an autonomous multi-hop research pipeline: searches web, visits top technical sources with stealth browser, extracts code and docs, and generates a structured research briefing.',
        inputSchema: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              description: 'Technical topic or problem to research.',
            },
            max_sources: {
              type: 'number',
              description: 'Number of sources to deep-browse (default: 3).',
            },
          },
          required: ['topic'],
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
    if (name === 'stealth_search') {
      const query = String(args?.query || '');
      const maxResults = Number(args?.max_results || 5);
      const results = await executeStealthSearch(query, maxResults);
      const durationMs = Date.now() - startTime;
      await logTelemetry(name, { query, maxResults }, { count: results.length }, durationMs);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    }

    if (name === 'stealth_browse') {
      const url = String(args?.url || '');
      const waitForSelector = args?.wait_for_selector ? String(args.wait_for_selector) : undefined;
      const result = await executeStealthBrowse(url, waitForSelector);
      const durationMs = Date.now() - startTime;
      await logTelemetry(name, { url, waitForSelector }, { title: result.title, tokens: result.tokensEstimate }, durationMs);

      return {
        content: [
          {
            type: 'text',
            text: result.markdown,
          },
        ],
      };
    }

    if (name === 'deep_research') {
      const topic = String(args?.topic || '');
      const maxSources = Number(args?.max_sources || 3);
      const research = await executeDeepResearch(topic, maxSources);
      const durationMs = Date.now() - startTime;
      await logTelemetry(name, { topic, maxSources }, { sourcesCount: research.sources.length }, durationMs);

      return {
        content: [
          {
            type: 'text',
            text: research.synthesizedBrief,
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
          text: `Stealth Browser tool error: ${error.message}`,
        },
      ],
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('[AEOS STEALTH BROWSER MCP] Server active on stdio\n');
}

main().catch((err) => {
  process.stderr.write(`[FATAL] Browser MCP server error: ${err.message}\n`);
  process.exit(1);
});
