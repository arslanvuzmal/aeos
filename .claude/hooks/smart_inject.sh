#!/usr/bin/env bash
# AEOS Smart Context Injector (PWF_INJECT=smart)
# Enforces pre-injection SHA-256 verification and minimal token envelope extraction

set -euo pipefail

WORKSPACE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLAN_FILE="${WORKSPACE_ROOT}/task_plan.md"
PROGRESS_FILE="${WORKSPACE_ROOT}/progress.md"

# 1. Enforce Hash Attestation Verification Gate
if ! "${WORKSPACE_ROOT}/aeos-attest" --verify >/dev/null 2>&1; then
    echo -e "\x1b[31m[AEOS CONTEXT INJECTION BLOCKED]\x1b[0m Plan validation failed. Resolve tamper alert." >&2
    exit 1
fi

# 2. Extract Core Objective
GOAL=$(awk '/^## Core Objective/{getline; while($0 ~ /^[[:space:]]*$/) getline; print $0}' "${PLAN_FILE}" || echo "Execute operational steps")

# 3. Extract Active Phase
ACTIVE_PHASE=$(grep -m 1 -E "^## Active Phase:" "${PLAN_FILE}" | sed 's/^## Active Phase:[[:space:]]*//' || echo "Phase undefined")

# 4. Extract Immediate Next Checkbox Task
NEXT_STEP=$(grep -m 1 -E "^- \[ \]" "${PLAN_FILE}" | sed 's/^- \[ \][[:space:]]*//' || echo "No remaining pending tasks")

# 5. Extract Last 3 Progress Entries
if [[ -f "${PROGRESS_FILE}" ]]; then
    RECENT_LOGS=$(tail -n 3 "${PROGRESS_FILE}")
else
    RECENT_LOGS="No execution history available."
fi

# 6. Format Envelope
cat << CONTEXT_BLOCK
=== BEGIN AEOS SMART INJECTION ===
[PROJECT GOAL]: ${GOAL}
[ACTIVE PHASE]: ${ACTIVE_PHASE}
[IMMEDIATE NEXT TASK]: ${NEXT_STEP}
[RECENT DIAGNOSTICS]:
${RECENT_LOGS}
=== END AEOS SMART INJECTION ===
CONTEXT_BLOCK