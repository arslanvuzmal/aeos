# TASK SPECIFICATION & PHASE BLUEPRINT (Brain 1: Strategic Planner)

## Core Objective
Autonomous synthesis, Docker sandbox verification, and attestation of:
**Construct and verify a sliding-window rate limiter with burst tolerance and memory tracking**

## Architectural Invariants & Boundary Constraints
1. **Thread Isolation & Memory Bound**: Must execute inside hardened 1,024 MB RAM Docker sandbox (`node:20-alpine`) with network completely severed.
2. **Deterministic State Transition**: Zero unhandled rejections, clean teardown, idempotent operations.
3. **Formal Verification Test Harness**: Strict multi-tenant assertions covering nominal throughput, breach rejection, concurrency, and telemetry state.

## Concrete Deliverable Matrix
- `src/dual_brain_modules/target_module.js`: Core component implementation.
- `src/dual_brain_modules/test_suite.js`: Adversarial verification benchmark.

## Cryptographic Validation Checklist
- [ ] Phase 1: Ingest memory and verify schema invariants
- [ ] Phase 2: Compute and lock SHA-256 plan hash in PostgreSQL
- [ ] Phase 3: Brain 2 SDE code generation
- [ ] Phase 4: Hardened Docker sandbox test execution (1024MB RAM, Net Severed)
- [ ] Phase 5: Adversarial QA code review and signed attestation
