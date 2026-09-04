description: Initiates the AEOS Dual-Brain Autonomous Coordination Protocol with Antigravity
allowed-tools: Bash(*)

# AEOS DUAL-BRAIN AUTONOMOUS PROTOCOL

As Brain 1 (Strategic Planner, Deep Research Synthesizer & Code Reviewer), your mission is:
1. Conduct research using `query_knowledge_base` and `stealth_search` to understand requirements and architecture.
2. Formulate and update `task_plan.md` with explicit phase checkboxes and verification criteria.
3. Attest the plan hash into the PostgreSQL state ledger:
   `!./aeos-attest --lock planner_claude`
4. Handoff to Brain 2 (Antigravity SDE Executor) to implement the code in the hardened Docker sandbox.
5. Review the execution diagnostics in `findings.md` and verify all tests pass.
6. Record final verification and sign off in `progress.md`.
