import type { Account, AccountQuotaWindow } from "../../../shared/types";

const WEEK_SECONDS = 7 * 24 * 60 * 60;
const WEEK_TOLERANCE_SECONDS = 60;

export type WeeklyLimitState = "exhausted" | "available" | "unknown";

export interface WeeklyLimitRow {
  accountId: string;
  email: string;
  label?: string;
  planType?: string;
  accountStatus: string;
  limitId: string;
  limitName: string;
  usedPercent: number | null;
  remainingPercent: number | null;
  limitReached: boolean | null;
  resetAt: number | null;
  quotaFetchedAt: string | null;
  state: WeeklyLimitState;
}

interface LimitCandidate {
  id: string;
  name: string;
  window: AccountQuotaWindow | null | undefined;
  allowed?: boolean;
}

function isWeeklyWindow(window: AccountQuotaWindow | null | undefined): boolean {
  const seconds = window?.limit_window_seconds;
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return false;
  return Math.abs(seconds - WEEK_SECONDS) <= WEEK_TOLERANCE_SECONDS;
}

function percent(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function deriveState(
  window: AccountQuotaWindow | null | undefined,
  allowed?: boolean,
): WeeklyLimitState {
  if (window?.limit_reached === true) return "exhausted";
  if (percent(window?.used_percent) === 100) return "exhausted";
  if (allowed === false) return "unknown";
  if (window?.used_percent != null || window?.remaining_percent != null || window?.reset_at != null) {
    return "available";
  }
  return "unknown";
}

function displayLimitName(value: string | null | undefined, fallback: string): string {
  const raw = (value ?? "").trim();
  return raw ? raw.replace(/_/g, " ") : fallback;
}

export function extractWeeklyLimits(accounts: Account[]): WeeklyLimitRow[] {
  const rows: WeeklyLimitRow[] = [];

  for (const account of accounts) {
    const quota = account.quota;
    if (!quota) continue;

    const candidates: LimitCandidate[] = [
      { id: "primary", name: "Primary", window: quota.rate_limit },
      { id: "secondary", name: "Weekly", window: quota.secondary_rate_limit },
      {
        id: "code_review",
        name: "Code review",
        window: quota.code_review_rate_limit,
        allowed: quota.code_review_rate_limit?.allowed,
      },
    ];

    for (const bucket of Object.values(quota.rate_limits_by_limit_id ?? {})) {
      const limitId = bucket.limit_id || "additional";
      const limitName = displayLimitName(bucket.limit_name || bucket.limit_id, limitId);
      candidates.push({
        id: `additional:${limitId}`,
        name: limitName,
        window: bucket,
        allowed: bucket.allowed,
      });
      candidates.push({
        id: `additional:${limitId}:secondary`,
        name: `${limitName} weekly`,
        window: bucket.secondary_rate_limit,
      });
    }

    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (!isWeeklyWindow(candidate.window) || seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      const usedPercent = percent(candidate.window?.used_percent);
      const remainingPercent = percent(candidate.window?.remaining_percent);
      rows.push({
        accountId: account.id,
        email: account.email,
        label: account.label,
        planType: account.planType,
        accountStatus: account.status,
        limitId: candidate.id,
        limitName: candidate.name,
        usedPercent,
        remainingPercent,
        limitReached: candidate.window?.limit_reached ?? null,
        resetAt: candidate.window?.reset_at ?? null,
        quotaFetchedAt: account.quotaFetchedAt ?? null,
        state: deriveState(candidate.window, candidate.allowed),
      });
    }
  }

  return rows.sort((a, b) => {
    const stateRank = (state: WeeklyLimitState) =>
      state === "exhausted" ? 0 : state === "unknown" ? 1 : 2;
    const stateDiff = stateRank(a.state) - stateRank(b.state);
    if (stateDiff !== 0) return stateDiff;
    const usedDiff = (b.usedPercent ?? -1) - (a.usedPercent ?? -1);
    if (usedDiff !== 0) return usedDiff;
    const resetDiff = (a.resetAt ?? Number.MAX_SAFE_INTEGER) - (b.resetAt ?? Number.MAX_SAFE_INTEGER);
    if (resetDiff !== 0) return resetDiff;
    return a.email.localeCompare(b.email);
  });
}
