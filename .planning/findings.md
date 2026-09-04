# AEOS Findings & Inter-Agent Knowledge Cache

This file serves as the living, shared inter-agent cache where researchers, architects, and coders register syntax discoveries, configuration parameters, authentication registers, and runtime diagnostics.

---

## 1. System Coordinates & Runtime Paths
- **Global Daemon Configuration**: `C:\etc\aeosd\config.json` (`/etc/aeosd/config.json`)
- **Engineering Philosophy**: `C:\etc\aeosd\experience.md` (`/etc/aeosd/experience.md`)
- **System Execution Logs**: `C:\var\log\aeosd\system.log` (`/var/log/aeosd/system.log`)
- **Distribution Root**: `C:\opt\aeosd\` (`/opt/aeosd/`)
  - Package: `C:\opt\aeosd\package.json`
  - Installer: `C:\opt\aeosd\bin\install-aeosd.sh`
  - Core Daemon: `C:\opt\aeosd\src\aeosd-core.js`
  - Stealth MCP: `C:\opt\aeosd\src\mcp-stealth.js`
  - Local RAG: `C:\opt\aeosd\src\local-rag.py`
- **Global Binaries**:
  - `C:\usr\local\bin\aeos` & `C:\usr\local\bin\aeos.cmd`
  - `/usr/local/bin/aeos`

---

## 2. PostgreSQL 16 `aeos_kernel` Topology
- **Connection URI**: `postgresql://aeos_admin:aeos_secure_password_2026@localhost:5432/aeos_kernel`
- **Container**: `aeos-postgres` (Image: `postgres:15-alpine`, Port 5432)
- **Primary Schema Tables**:
  - `tenants`: Multi-tenant organization boundaries.
  - `projects`: Workspace references and Git repositories.
  - `agents`: Swarm agent identities (`planner`, `coder`, `qa_tester`, `debugger`).
  - `tasks`: Hierarchical task DAG with dependency tracking.
  - `agent_turns`: Execution turns with prompt/completion/cached token metrics and USD costs.
  - `tool_executions`: Granular tool invocations with input/output payloads and error flags.
  - `plan_attestations`: SHA-256 plan integrity records.
  - `opik_traces`: Distributed trace IDs.
  - `institutions`: Multi-tenant enterprise accounts.
  - `agent_tasks`: Multi-agent swarm task instructions and step statuses.
  - `agent_telemetry`: Granular thought-stream, tool-call, and cost metrics.
- **Analytics Views**:
  - `v_project_spend_analytics`: Aggregates tasks, turns, tokens, USD spend, and average turn latency.

---

## 3. Local Qdrant Vector Engine & Ingestion
- **HTTP Endpoint**: `http://localhost:6333`
- **Container**: `aeos-qdrant` (Image: `qdrant/qdrant:latest`, Ports 6333, 6334)
- **Collection**: `technical_library`
  - Dimensions: 384 (Cosine distance)
  - Embedding Engine: `all-MiniLM-L6-v2` / `BAAI/bge-large-en-v1.5`
  - Chunk Size: 800 characters with 150 character overlap
  - Offline Ingestion: Local PyMuPDF text extraction; 0 external API tokens consumed.

---

## 4. Docker Sandbox Isolation
- **Container**: `aeos-sandbox` (Image: `node:20-alpine`)
- **Resource Constraints**:
  - Memory: `--memory="1g"` (1,024 MB strict limit)
  - CPU: `--cpus="1.0"` (1 core cap)
  - Network: `--network=none` (Fail-closed isolation)
  - Mount: `-v "<workspace>:/app"`

---

## 5. Stealth Automation Invariants
- **Browser**: Playwright Extra with `puppeteer-extra-plugin-stealth`
- **Evasions**:
  - Automation flags disabled (`--disable-blink-features=AutomationControlled`).
  - `navigator.webdriver` set to `undefined`.
  - Overridden canvas, WebGL, and language headers.
  - Bézier spline cubic curve interpolation for human-mimetic mouse movement.
- **CAPTCHA Bypass Fallback**:
  - Virtual Xvfb frame on display `:99` with `x11vnc` on port 5900.
  - Screencast URL: `vnc://localhost:5900` for human-in-the-loop solver resolution.

---

## 6. Context Compression Pipeline (ANOLISA)
- **Blacklist Keys**: `stack`, `metadata`, `trace`, `config`, `debug_dump`, `raw_html`, `verbose_logs`
- **Replacement Marker**: `<<tokenless:COMPRESSED>>`
- **Average Compression Ratio**: 65% to 87.7% reduction in context window footprint.
- **Restoration**: Keyed lossless cache allows dynamic re-expansion upon agent request.

### [CLAUDE_PLANNER] Architectural Invariant Inscribed: Token Bucket Algorithm
- Target module: src/rate_limiter.ts
- Concurrency model: In-memory atomic token decrement.

### [CLAUDE_PLANNER] Architectural Invariant Inscribed: Token Bucket Algorithm
- Target module: src/rate_limiter.ts
- Concurrency model: In-memory atomic token decrement.
