
export class TokenBucketRateLimiter {
    private capacity: number;
    private tokens: number;
    private refillRatePerSec: number;
    private lastRefillTimestamp: number;

    constructor(capacity: number = 100, refillRatePerSec: number = 10) {
        this.capacity = capacity;
        this.tokens = capacity;
        this.refillRatePerSec = refillRatePerSec;
        this.lastRefillTimestamp = Date.now();
    }

    private refill(): void {
        const now = Date.now();
        const elapsedSec = (now - this.lastRefillTimestamp) / 1000;
        const tokensToAdd = elapsedSec * this.refillRatePerSec;
        if (tokensToAdd > 0) {
            this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
            this.lastRefillTimestamp = now;
        }
    }

    public tryConsume(tokens: number = 1): { allowed: boolean; remaining: number; retryAfterMs?: number } {
        this.refill();
        if (this.tokens >= tokens) {
            this.tokens -= tokens;
            return { allowed: true, remaining: Math.floor(this.tokens) };
        } else {
            const missing = tokens - this.tokens;
            const retryAfterMs = Math.ceil((missing / this.refillRatePerSec) * 1000);
            return { allowed: false, remaining: Math.floor(this.tokens), retryAfterMs };
        }
    }
}
