/**
 * Renderer-safe TOTP timing helpers. These functions operate only on a
 * timestamp and public registration period; they never accept or derive a
 * secret.
 */

function assertPeriod(period: number): void {
  if (!Number.isSafeInteger(period) || period < 1) {
    throw new Error("Invalid authenticator period");
  }
}

/** Return the number of whole seconds until the next TOTP period boundary. */
export function remainingTotpSeconds(timestampMs: number, period: number): number {
  assertPeriod(period);
  if (!Number.isFinite(timestampMs)) throw new Error("Invalid authenticator timestamp");
  const timestampSeconds = Math.floor(timestampMs / 1_000);
  const elapsed = ((timestampSeconds % period) + period) % period;
  return period - elapsed;
}

/** Return the next period boundary as a millisecond timestamp. */
export function nextTotpTimestampMs(timestampMs: number, period: number): number {
  assertPeriod(period);
  if (!Number.isFinite(timestampMs)) throw new Error("Invalid authenticator timestamp");
  const timestampSeconds = Math.floor(timestampMs / 1_000);
  return (timestampSeconds + remainingTotpSeconds(timestampMs, period)) * 1_000;
}
