import type { AccountEntry, CodexQuotaWindow } from "./types.js";

export type QuotaWindowPriority = "secondary" | "primary";

const SECONDARY_EXPIRY_BUCKETS_SECONDS = [
  12 * 60 * 60,
  24 * 60 * 60,
  72 * 60 * 60,
] as const;

const PRIMARY_SOFT_CAP_PERCENT = 80;
const PRIMARY_HARD_AVOID_PERCENT = 90;
const SECONDARY_LOW_REMAINING_PERCENT = 10;

function windowForPriority(
  entry: AccountEntry,
  priority: QuotaWindowPriority,
): CodexQuotaWindow | null | undefined {
  if (priority === "secondary") return entry.cachedQuota?.secondary_rate_limit;
  const primary = entry.cachedQuota?.rate_limit;
  if (primary?.reset_at != null) return primary;
  return (
    entry.usage.window_reset_at != null
      ? {
          used_percent: null,
          reset_at: entry.usage.window_reset_at,
          limit_window_seconds: entry.usage.limit_window_seconds ?? null,
        }
      : null
  );
}

export function hasAnyReachedCachedQuota(entry: AccountEntry): boolean {
  const quota = entry.cachedQuota;
  return Boolean(
    quota?.rate_limit?.limit_reached ||
    quota?.secondary_rate_limit?.limit_reached ||
    quota?.code_review_rate_limit?.limit_reached,
  );
}

function primaryPressureBucket(entry: AccountEntry): number {
  const used = windowForPriority(entry, "primary")?.used_percent;
  if (used == null) return 0;
  if (used >= PRIMARY_HARD_AVOID_PERCENT) return 3;
  if (used >= PRIMARY_SOFT_CAP_PERCENT) return 2;
  if (used >= 60) return 1;
  return 0;
}

function shouldBoostSecondaryExpiry(window: CodexQuotaWindow | null | undefined): boolean {
  if (!window) return false;
  if (window.used_percent != null && window.used_percent >= 100 - SECONDARY_LOW_REMAINING_PERCENT) {
    return false;
  }
  if (window.remaining_percent != null && window.remaining_percent <= SECONDARY_LOW_REMAINING_PERCENT) {
    return false;
  }
  return window.reset_at != null;
}

function secondaryExpiryBucket(entry: AccountEntry, nowSec: number): number {
  const secondary = windowForPriority(entry, "secondary");
  if (!shouldBoostSecondaryExpiry(secondary)) return SECONDARY_EXPIRY_BUCKETS_SECONDS.length;

  const secondsUntilReset = Math.max(0, secondary!.reset_at! - nowSec);
  const bucket = SECONDARY_EXPIRY_BUCKETS_SECONDS.findIndex((limit) => secondsUntilReset <= limit);
  return bucket === -1 ? SECONDARY_EXPIRY_BUCKETS_SECONDS.length : bucket;
}

/**
 * Protect the short-lived primary window before applying any use-before-refresh
 * preference to the weekly/secondary window.
 */
export function comparePrimaryQuotaPressure(a: AccountEntry, b: AccountEntry): number {
  return primaryPressureBucket(a) - primaryPressureBucket(b);
}

/**
 * Prefer weekly quota that is close to refreshing, but only by coarse buckets.
 * Accounts in the same bucket are left tied so least-used/LRU can spread load.
 */
export function compareSecondaryExpiryBucket(
  a: AccountEntry,
  b: AccountEntry,
  nowSec = Math.floor(Date.now() / 1000),
): number {
  return secondaryExpiryBucket(a, nowSec) - secondaryExpiryBucket(b, nowSec);
}

/**
 * Prefer accounts whose longer-lived quota windows reset sooner, so quota that
 * is about to refresh is consumed before it would be lost.
 *
 * Unknown windows intentionally do not sort ahead of known windows. This keeps
 * brand-new accounts from being permanently penalized before the backend has
 * emitted quota headers for them.
 */
export function compareQuotaWindowPriority(
  a: AccountEntry,
  b: AccountEntry,
): number {
  const primaryPressureDiff = comparePrimaryQuotaPressure(a, b);
  if (primaryPressureDiff !== 0) return primaryPressureDiff;

  const secondaryExpiryDiff = compareSecondaryExpiryBucket(a, b);
  if (secondaryExpiryDiff !== 0) return secondaryExpiryDiff;
  return 0;
}
