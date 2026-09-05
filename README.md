# AEOS: AI Engineering Operating System

An unbreakable, resource-scheduled, multi-agent development environment wiring **Claude Code** and **Antigravity** together over a persistent, file-based state ledger, real-time telemetry dashboard, local hybrid RAG pipeline, and stealth browser automation.

---

## 🏛️ System Architecture

AEOS operates across 6 integrated engineering layers:

1. **State Ledger & Attestation Layer (`.planning/`, `database/`)**:
   - Cryptographically sealed SHA-256 task plans (`task_plan.md`, `progress.md`, `findings.md`).
   - SQLite / PostgreSQL shared transaction ledger for multi-tenant token spend, turns, and audit trails.

2. **Dual-Brain & Multi-Agent Consensus Council (`src/consensus/`, `src/dual_brain_orchestrator.ts`)**:
   - **Brain 1 (Claude Code)**: Strategic planning, invariant definition, and adversarial code review.
   - **Brain 2 (Antigravity)**: Production code synthesis, execution, and hardened sandbox testing.
   - **Consensus Council**: 4-role deliberation committee (`StrategicPlanner`, `SecurityVerifier` with strict veto, `PerformanceAuditor`, `ArchitectureCritic`) with weighted scoring, deadlock arbitration, dual Postgres/SQLite persistence, and HMAC-SHA256 signature chains.
   - High-density fallback synthesizers and automatic context compression (>87% token reduction).

3. **Hybrid RAG Knowledge Engine (`src/local-rag.py`, `src/rag_tool.py`, `src/ingest_engine.py`)**:
   - Dense embeddings (SentenceTransformers) + Sparse lexical matching (BM25) with reciprocal rank fusion (RRF).
   - Zero-API Google Drive local filesystem mount & real-time watcher (`bin/aeos-mount.sh`, `bin/aeos-watcher.sh`).
   - High-performance vector storage via Qdrant (`localhost:6333`).

4. **Stealth Browser Automation (`src/stealth_browser.ts`, `src/mcp-stealth.js`, `src/browser_tool.ts`)**:
   - Headless Chromium with evasion plugins (puppeteer-extra-plugin-stealth).
   - Canvas/WebGL fingerprint spoofing, dynamic user-agent rotation, and human typing cadence.

5. **Observability & Real-Time Dashboard (`src/dashboard/server.ts`)**:
   - Express + WebSocket streaming telemetry dashboard on `http://localhost:4000`.
   - Live dual-brain console, kernel logs, process status, and cryptographic attestation inspector.

6. **MCP Bridge & Universal Tool Interfaces (`src/mcp/`)**:
   - Model Context Protocol (MCP) server endpoints exposing RAG queries, browser scraping, and kernel IPC.

---

## 🚀 Quick Start

### 1. Infrastructure Setup
Start the local PostgreSQL and Qdrant backend containers:
```bash
docker compose up -d
```

### 2. Node.js Dependencies
Install all kernel and dashboard dependencies:
```bash
npm install
```

### 3. Python RAG Environment
Install RAG vector search and parsing requirements:
```bash
pip install -r requirements.txt
```

### 4. Global Daemon & CLI Installation
Install the unified CLI into system PATH:
```bash
# On Linux / macOS / WSL:
sh bin/install-aeosd.sh

# On Windows:
bin\aeos.cmd status
```

### 5. Launch Live Telemetry Dashboard
```bash
npm run dashboard
# Dashboard available at: http://localhost:4000
```

---

## 🧪 Comprehensive Test & Verification Suites

AEOS includes verification suites covering all architectural layers:

```bash
# Phase 1: Environment & Tooling Smoke Test
npm run test:phase1

# Phase 2: Transaction Ledger & Attestation Test
npm run test:phase2

# Phase 3: Token Compressor & Cache Verification
npm run test:phase3

# Phase 4: Local Hybrid RAG Search Test
python tests/phase4_rag_test.py

# Phase 5: Kernel Scheduler & Resource Limiter Test
npm run test:phase5

# Phase 6: Stealth Browser & Anti-Detection Test
npm run test:phase6

# Dual-Brain Autonomous Live Loop
npx tsx tests/dual_brain_test.ts

# Multi-Agent Consensus Council 4-Tier Test Suite (157 Checks)
npm run test:consensus

# Consensus Council Empirical Stress & Tamper Challenge (93 Checks)
npm run test:consensus:stress

# Production Rigorous SRE & Security Penetration Audit
npm run audit:dashboard
```

---

## 📦 Directory Structure

```text
aeos/
├── .aeos/               # BM25 corpora, cached state, and compressed stashes
├── .claude/             # Slash commands and smart injection hooks
├── .planning/           # Cryptographic state ledgers (task_plan, progress, findings)
├── artifacts/           # Phase audits, verification logs, and dual-brain traces
├── bin/                 # System execution binaries (aeos, mount, watcher, orchestrator)
├── database/            # SQL schemas and migration scripts
├── gdrive_books/        # Target mount point for zero-API cloud document ingest
├── knowledge/           # Pre-indexed engineering specifications and guides
├── scripts/             # Database initialization and maintenance utilities
├── src/                 # Kernel, dashboard, dual-brain, RAG, and stealth browser modules
├── tests/               # Phase 1-6 tests, dual-brain autonomous loop, SRE penetration audits
├── docker-compose.yml   # PostgreSQL (5432) & Qdrant (6333/6334)
├── package.json         # Node runtime configuration and scripts
├── requirements.txt     # Python AI/RAG dependencies
└── tsconfig.json        # TypeScript compiler configuration
```

