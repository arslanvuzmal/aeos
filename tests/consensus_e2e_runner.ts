/**
 * AEOS Multi-Agent Consensus Council E2E Test Runner
 * 
 * Requirements: ORIGINAL_REQUEST.md (Acceptance Criteria), PROJECT.md, TEST_INFRA.md
 * 
 * Verifies all 4 tiers (Tiers 1, 2, 3, 4) and 11 features (F1 - F11):
 * - Minimum assertion threshold: >= 127 checks
 * - Full suite authored: 157 checks
 * - Exit semantics: Exit code 0 on 100% pass, non-zero on any failure.
 */

import { runConsensusCouncilTestSuite, TestScorecard } from './consensus_council_test';

async function main(): Promise<void> {
  console.log('======================================================================');
  console.log('       AEOS CONSENSUS COUNCIL SUBSYSTEM - E2E TEST RUNNER             ');
  console.log('======================================================================\n');

  try {
    const scorecard: TestScorecard = await runConsensusCouncilTestSuite();

    console.log('\n======================================================================');
    console.log('                       FINAL RUNNER VERDICT                            ');
    console.log('======================================================================');
    console.log(`Total Assertions Evaluated : ${scorecard.total} (Target: >= 127)`);
    console.log(`Total Assertions Passed    : ${scorecard.passed}`);
    console.log(`Total Assertions Failed    : ${scorecard.failed}`);
    console.log(`Overall Pass Rate          : ${((scorecard.passed / scorecard.total) * 100).toFixed(2)}%`);
    console.log(`Total Execution Time       : ${(scorecard.durationMs / 1000).toFixed(2)}s`);
    console.log('======================================================================');

    if (scorecard.failed > 0) {
      console.error(`\n[FAIL] Test suite failed with ${scorecard.failed} failing assertion(s).`);
      process.exit(1);
    }

    if (scorecard.passed < 127) {
      console.error(`\n[FAIL] Coverage threshold breach: passed ${scorecard.passed} checks, required >= 127 checks.`);
      process.exit(1);
    }

    console.log(`\n[PASS] All ${scorecard.passed} verification assertions passed cleanly. Exiting with code 0.`);
    process.exit(0);
  } catch (error: any) {
    console.error('\n[FATAL] Unhandled suite execution error:', error);
    process.exit(1);
  }
}

// Execute Runner
main();
