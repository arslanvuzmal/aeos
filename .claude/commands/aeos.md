# /aeos — AEOS Autonomous Linkage Adapter

Activate native Inter-Process Communication (IPC) Linkage Daemon between Claude Code (Brain 1) and Antigravity (Brain 2).

## Instructions
1. Run the `activate_aeos` MCP tool or execute `aeos start` in bash/cmd.
2. Initialize local Qdrant Vector Store indexing (port 6333) and verify Docker sandbox container (`aeos-sandbox`).
3. Check and lock `.planning/task_plan.md` using SHA-256 cryptographic hash.
4. Establish autonomous state synchronization:
   - When you write tasks to `.planning/task_plan.md`, Antigravity automatically claims and tests them in the Docker sandbox.
   - If Antigravity logs errors into `findings.md`, analyze them, retrieve solutions from the Qdrant memory library, and feed the fix back.
