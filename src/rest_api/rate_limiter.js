class RateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 1000;
    this.maxRequests = options.maxRequests || 5;
    this.clients = new Map();
  }
  check(ip) {
    const now = Date.now();
    const timestamps = this.clients.get(ip) || [];
    const validTimestamps = timestamps.filter(ts => now - ts < this.windowMs);
    if (validTimestamps.length >= this.maxRequests) {
      return { allowed: false, remaining: 0 };
    }
    validTimestamps.push(now);
    this.clients.set(ip, validTimestamps);
    return { allowed: true, remaining: this.maxRequests - validTimestamps.length };
  }
  reset() {
    this.clients.clear();
  }
}
module.exports = RateLimiter;
