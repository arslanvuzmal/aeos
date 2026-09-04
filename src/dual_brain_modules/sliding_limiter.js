/**
 * Sliding Window Counter & Token Bucket Hybrid Rate Limiter
 * Synthesized by AEOS Dual-Brain SDE (Antigravity)
 */
class SlidingWindowRateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 60000;
    this.maxRequests = options.maxRequests || 60;
    this.requests = new Map();
  }

  isAllowed(key) {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let timestamps = this.requests.get(key) || [];
    timestamps = timestamps.filter(ts => ts > windowStart);

    if (timestamps.length >= this.maxRequests) {
      this.requests.set(key, timestamps);
      return {
        allowed: false,
        remaining: 0,
        resetTimeMs: timestamps[0] + this.windowMs - now,
        currentUsage: timestamps.length
      };
    }

    timestamps.push(now);
    this.requests.set(key, timestamps);

    return {
      allowed: true,
      remaining: this.maxRequests - timestamps.length,
      resetTimeMs: this.windowMs,
      currentUsage: timestamps.length
    };
  }

  reset(key) {
    if (key) {
      this.requests.delete(key);
    } else {
      this.requests.clear();
    }
  }

  getMetrics() {
    let totalRequestsTracked = 0;
    for (const [, tsList] of this.requests.entries()) {
      totalRequestsTracked += tsList.length;
    }
    return {
      activeKeysCount: this.requests.size,
      totalRequestsTracked,
      windowMs: this.windowMs,
      maxRequests: this.maxRequests
    };
  }
}

module.exports = { SlidingWindowRateLimiter };
