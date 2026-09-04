/**
 * Dual-Brain Sandbox Verification Suite
 */
const { SlidingWindowRateLimiter } = require('./sliding_limiter.js');

async function runVerification() {
  console.log('[SANDBOX TEST] Starting Sliding-Window Rate Limiter Suite...');
  const limiter = new SlidingWindowRateLimiter({ windowMs: 1000, maxRequests: 5 });

  for (let i = 1; i <= 5; i++) {
    const res = limiter.isAllowed('tenant_alpha');
    if (!res.allowed) throw new Error('Test 1 Failed at request ' + i);
  }
  console.log('✓ TEST 1 PASSED: 5/5 requests permitted within window.');

  const breach = limiter.isAllowed('tenant_alpha');
  if (breach.allowed) throw new Error('Test 2 Failed: 6th request should be rejected');
  console.log('✓ TEST 2 PASSED: 6th request rejected with 0 remaining tokens.');

  const tenantBeta = limiter.isAllowed('tenant_beta');
  if (!tenantBeta.allowed) throw new Error('Test 3 Failed: tenant isolation broken');
  console.log('✓ TEST 3 PASSED: tenant_beta received independent budget.');

  await new Promise(r => setTimeout(r, 1100));
  const postExpire = limiter.isAllowed('tenant_alpha');
  if (!postExpire.allowed) throw new Error('Test 4 Failed: Expiration reset failed');
  console.log('✓ TEST 4 PASSED: Window reset allowed new burst.');

  const metrics = limiter.getMetrics();
  if (metrics.activeKeysCount !== 2) throw new Error('Test 5 Failed: Active keys count mismatch');
  console.log('✓ TEST 5 PASSED: Telemetry metrics accurate.');

  console.log('\n======================================================');
  console.log('SANDBOX VERIFICATION AUDIT: ALL 5 TEST SUITES PASSED');
  console.log('======================================================');
}

runVerification().catch(err => {
  console.error('[SANDBOX FAILURE]:', err.message);
  process.exit(1);
});
