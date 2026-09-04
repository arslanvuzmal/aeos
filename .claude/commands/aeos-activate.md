description: Locks the task plan, verifies attestation, and activates the AEOS kernel context engine.
allowed-tools: Bash(*)
Initialize and attest AEOS execution state:
!./aeos-attest --lock operator_cli
!./.claude/hooks/smart_inject.sh

AEOS Kernel is activated. Proceed with the immediate next task as identified in the state ledger.