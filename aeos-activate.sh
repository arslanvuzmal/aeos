#!/usr/bin/env bash
set -euo pipefail

AEOS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== ACTIVATING AEOS STATE LEDGER ==="
"${AEOS_ROOT}/aeos-attest" --lock "bootstrap_script"

echo -e "\n=== TESTING SMART CONTEXT INJECTION ==="
"${AEOS_ROOT}/.claude/hooks/smart_inject.sh"

echo -e "\n\x1b[32m[SUCCESS]\x1b[0m AEOS Crash-Proof Ledger is armed and ready."
echo "Command '/aeos-activate' registered in .claude/commands/."