/**
 * Simple token-bucket rate limiter, ported conceptually from
 * downloader/core .../utils/speedlimiter/SpeedLimiter.kt.
 *
 * `limitBytesPerSec <= 0` means unlimited: acquire() resolves immediately.
 * Multiple DownloadTasks can share one SpeedLimiter instance (e.g. a single
 * global limiter) or each can have their own (per-download limit).
 */
export class SpeedLimiter {
  private limitBytesPerSec: number;
  private tokens: number;
  private lastRefill: number;

  constructor(limitBytesPerSec: number) {
    this.limitBytesPerSec = Math.max(0, limitBytesPerSec);
    this.tokens = this.limitBytesPerSec;
    this.lastRefill = Date.now();
  }

  setLimit(limitBytesPerSec: number) {
    this.limitBytesPerSec = Math.max(0, limitBytesPerSec);
    this.tokens = Math.min(this.tokens, this.limitBytesPerSec || Number.POSITIVE_INFINITY);
  }

  getLimit() {
    return this.limitBytesPerSec;
  }

  private refill() {
    if (this.limitBytesPerSec <= 0) return;
    const now = Date.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    this.lastRefill = now;
    this.tokens = Math.min(this.limitBytesPerSec, this.tokens + elapsedSec * this.limitBytesPerSec);
  }

  /**
   * Requests permission to transfer `bytes`. Resolves with the number of bytes
   * actually granted (may be less than requested when the bucket is nearly
   * empty, allowing the caller to read smaller chunks instead of blocking a
   * long time for a big chunk).
   */
  async acquire(bytes: number): Promise<number> {
    if (this.limitBytesPerSec <= 0) return bytes;
    this.refill();
    if (this.tokens >= bytes) {
      this.tokens -= bytes;
      return bytes;
    }
    if (this.tokens > 0) {
      const granted = this.tokens;
      this.tokens = 0;
      return granted;
    }
    // no tokens left: wait for a small slice to regenerate
    const waitMs = Math.min(200, (1 / this.limitBytesPerSec) * 1000 * Math.max(1, bytes / 8));
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.refill();
    const granted = Math.min(bytes, this.tokens);
    this.tokens -= granted;
    return granted || 1; // never fully stall
  }
}
