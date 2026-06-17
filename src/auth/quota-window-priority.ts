import type { AccountEntry, CodexQuotaWindow } from "./types.js";

export type QuotaWindowPriority = "secondary" | "primary";

export const DEFAULT_QUOTA_WINDOW_PRIORITY: readonly QuotaWindowPriority[] = [
  "secondary",
  "primary",
];

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
  priority = DEFAULT_QUOTA_WINDOW_PRIORITY,
): number {
  for (const quotaWindow of priority) {
    const aReset = windowForPriority(a, quotaWindow)?.reset_at;
    const bReset = windowForPriority(b, quotaWindow)?.reset_at;
    if (aReset != null && bReset != null && aReset !== bReset) {
      return aReset - bReset;
    }
  }
  return 0;
}
