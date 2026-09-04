# AEOS Master Task Plan: Dual-Brain Kernel & Swarm Architecture

## Root Objective
Hardwire Claude Code and Antigravity into a unified, resource-scheduled, crash-proof, stealth-browsing multi-agent operating engine.

### Phase 1: Host Directory Matrix & Global Runtime Filesystem
- [x] Scaffold `/usr/local/bin/aeos` and `C:\usr\local\bin\aeos` global CLI binaries
- [x] Provision `/etc/aeosd/config.json` with API keys, residential proxy, and path registers
- [x] Document `/etc/aeosd/experience.md` 35-year multi-domain systems engineering matrix
- [x] Initialize `/var/log/aeosd/system.log` append-only kernel execution log
- [x] Scaffold `/opt/aeosd/` runtime distribution tree (package.json, bin/, src/)

### Phase 2: Database Schema & Multi-Tenant Telemetry Ledger
- [x] Deploy core relational ledger in `database/schema.sql` (projects, tasks, turns, tools)
- [x] Apply multi-tenant institutional extensions (`institutions`, `agent_tasks`, `agent_telemetry`)
- [x] Verify PostgreSQL 16 `aeos_kernel` tables and view `v_project_spend_analytics`

### Phase 3: Stealth Zero-Detection Browsing Engine
- [x] Implement `src/mcp-stealth.js` and `/opt/aeosd/src/mcp-stealth.js` with `playwright-extra`
- [x] Inject Bézier spline cubic curve generation for human-mimetic cursor trajectories
- [x] Implement automated CAPTCHA detection and VNC human-in-the-loop fallback on display `:99`
- [x] Expose Stdio JSON-RPC MCP server for `stealth_browse`

### Phase 4: Local Token-Zero Knowledge Base Ingestion
- [x] Implement `src/local-rag.py` and `/opt/aeosd/src/local-rag.py`
- [x] Configure PyMuPDF chunking (800 chars, 150 char overlap) and sentence-transformers
- [x] Connect to local Qdrant collection `technical_library` with Cosine distance vectors
- [x] Verify offline semantic query retrieval without external API token costs

### Phase 5: LLM Kernel Scheduler & 1GB Docker Sandbox Execution
- [x] Implement `src/aeosd-core.js` and `/opt/aeosd/src/aeosd-core.js`
- [x] Enforce fail-closed sandbox (`--network=none`, `--memory="1g"`, `--cpus="1.0"`) on `node:20-alpine`
- [x] Verify Docker execution against active `aeos-sandbox` container
- [x] Implement ANOLISA context compression stripping `stack`, `metadata`, `trace`, `debug_dump`

### Phase 6: Dual-Brain IPC Orchestration & CLI Hooks
- [x] Implement `bin/install-aeosd.sh` and `/opt/aeosd/bin/install-aeosd.sh`
- [x] Install global `/aeos` slash command in Claude Code and Antigravity profiles
- [x] Configure `PWF_INJECT=smart` turn-by-turn dynamic prompt injection
- [x] Verify SHA-256 plan integrity locking and lockdown exception handling

### Phase 7: End-to-End System Audit & Verification
- [x] Execute unit tests on plan locking, ANOLISA compression, and sandbox isolation
- [x] Verify offline RAG query against Qdrant `technical_library`
- [x] Verify stealth browser module and MCP JSON-RPC protocol
- [x] Generate comprehensive walkthrough report

- [x] Implement High-Performance Token Bucket Rate Limiter with 100 req/sec quota
