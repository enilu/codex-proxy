import type { Account, AccountQuota, AccountQuotaWindow } from "../../../shared/types";

const WEEK_SECONDS = 7 * 24 * 60 * 60;
const WEEK_TOLERANCE_SECONDS = 60;
const HISTORY_LIMIT = 7;
const STALE_QUOTA_MS = 24 * 60 * 60 * 1000;

export type WeeklyLimitState = "exhausted" | "available" | "unknown";
export type WeeklyLimitAccountRisk = "recommended" | "low" | "limited" | "stale" | "unknown";

export interface WeeklyLimitRow {
  accountId: string;
  email: string;
  label?: string;
  planType?: string;
  accountStatus: string;
  proxyName?: string;
  limitId: string;
  limitName: string;
  usedPercent: number | null;
  remainingPercent: number | null;
  limitReached: boolean | null;
  resetAt: number | null;
  quotaFetchedAt: string | null;
  snapshotKey: string | null;
  state: WeeklyLimitState;
}

export interface LimitWindowSummary {
  usedPercent: number | null;
  remainingPercent: number | null;
  limitReached: boolean | null;
  resetAt: number | null;
  limitWindowSeconds: number | null;
  allowed: boolean | null;
  state: WeeklyLimitState;
}

export interface WeeklyLimitHistoryPoint {
  key: string | null;
  fetchedAt: string | null;
  usedPercent: number | null;
  remainingPercent: number | null;
  resetAt: number | null;
  state: WeeklyLimitState;
}

export interface WeeklyLimitAccountRow {
  accountId: string;
  email: string;
  label?: string;
  planType?: string;
  quotaPlanType?: string;
  accountStatus: string;
  proxyName?: string;
  quotaFetchedAt: string | null;
  quotaVerifyRequired: boolean;
  staleQuota: boolean;
  missingQuota: boolean;
  currentWindow: LimitWindowSummary | null;
  weeklyWindow: WeeklyLimitRow | null;
  modelWeeklyLimits: WeeklyLimitRow[];
  weeklyHistory: WeeklyLimitHistoryPoint[];
  risk: WeeklyLimitAccountRisk;
}

interface LimitCandidate {
  id: string;
  name: string;
  window: AccountQuotaWindow | null | undefined;
  allowed?: boolean | null;
}

interface QuotaSnapshotCandidate {
  quota: AccountQuota;
  fetchedAt: string | null;
  key: string | null;
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
  allowed?: boolean | null,
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

function sameWeeklyReset(a: number | null, b: number | null): boolean {
  if (a == null || b == null) return a === b;
  return Math.abs(a - b) <= WEEK_TOLERANCE_SECONDS;
}

function fetchedAtMs(value: string | null): number {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function snapshotSortMs(snapshot: QuotaSnapshotCandidate | WeeklyLimitHistoryPoint | WeeklyLimitRow): number {
  if ("quotaFetchedAt" in snapshot) return fetchedAtMs(snapshot.quotaFetchedAt);
  return fetchedAtMs(snapshot.fetchedAt);
}

function accountDisplayPlan(account: Account, quota?: AccountQuota): string | undefined {
  return quota?.plan_type || account.planType;
}

function collectSnapshots(account: Account, includeCurrent = true): QuotaSnapshotCandidate[] {
  const snapshots: QuotaSnapshotCandidate[] = [];
  for (const snapshot of account.quotaHistory ?? []) {
    snapshots.push({
      quota: snapshot.quota,
      fetchedAt: snapshot.fetchedAt,
      key: snapshot.key,
    });
  }
  if (includeCurrent && account.quota) {
    snapshots.push({
      quota: account.quota,
      fetchedAt: account.quotaFetchedAt ?? null,
      key: null,
    });
  }
  return snapshots.sort((a, b) => snapshotSortMs(a) - snapshotSortMs(b));
}

function quotaCandidates(quota: AccountQuota): LimitCandidate[] {
  const candidates: LimitCandidate[] = [
    { id: "primary", name: "Primary", window: quota.rate_limit, allowed: quota.rate_limit?.allowed },
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

  return candidates;
}

function windowSummary(window: AccountQuotaWindow | null | undefined, allowed?: boolean | null): LimitWindowSummary | null {
  if (!window) return null;
  const usedPercent = percent(window.used_percent);
  const remainingPercent = percent(window.remaining_percent);
  return {
    usedPercent,
    remainingPercent,
    limitReached: window.limit_reached ?? null,
    resetAt: window.reset_at ?? null,
    limitWindowSeconds: window.limit_window_seconds ?? null,
    allowed: allowed ?? window.allowed ?? null,
    state: deriveState(window, allowed ?? window.allowed),
  };
}

function toWeeklyRow(
  account: Account,
  quota: AccountQuota,
  snapshot: QuotaSnapshotCandidate,
  candidate: LimitCandidate,
): WeeklyLimitRow {
  const usedPercent = percent(candidate.window?.used_percent);
  const remainingPercent = percent(candidate.window?.remaining_percent);
  return {
    accountId: account.id,
    email: account.email,
    label: account.label,
    planType: accountDisplayPlan(account, quota),
    accountStatus: account.status,
    proxyName: account.proxyName,
    limitId: candidate.id,
    limitName: candidate.name,
    usedPercent,
    remainingPercent,
    limitReached: candidate.window?.limit_reached ?? null,
    resetAt: candidate.window?.reset_at ?? null,
    quotaFetchedAt: snapshot.fetchedAt,
    snapshotKey: snapshot.key,
    state: deriveState(candidate.window, candidate.allowed),
  };
}

function dedupeWeeklyRows(rows: WeeklyLimitRow[]): WeeklyLimitRow[] {
  const deduped: WeeklyLimitRow[] = [];
  for (const row of rows) {
    const existingIndex = deduped.findIndex((item) =>
      item.accountId === row.accountId &&
      item.limitId === row.limitId &&
      sameWeeklyReset(item.resetAt, row.resetAt)
    );
    if (existingIndex < 0) {
      deduped.push(row);
      continue;
    }
    const existing = deduped[existingIndex];
    if (fetchedAtMs(row.quotaFetchedAt) >= fetchedAtMs(existing.quotaFetchedAt)) {
      deduped[existingIndex] = row;
    }
  }
  return deduped;
}

function rowsForAccount(account: Account, dedupe = true, includeCurrent = true): WeeklyLimitRow[] {
  const rows: WeeklyLimitRow[] = [];
  for (const snapshot of collectSnapshots(account, includeCurrent)) {
    const seen = new Set<string>();
    for (const candidate of quotaCandidates(snapshot.quota)) {
      if (!isWeeklyWindow(candidate.window) || seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      rows.push(toWeeklyRow(account, snapshot.quota, snapshot, candidate));
    }
  }
  return dedupe ? dedupeWeeklyRows(rows) : rows;
}

function latestRowsByLimit(rows: WeeklyLimitRow[]): WeeklyLimitRow[] {
  const latest = new Map<string, WeeklyLimitRow>();
  for (const row of rows) {
    const existing = latest.get(row.limitId);
    if (!existing || fetchedAtMs(row.quotaFetchedAt) >= fetchedAtMs(existing.quotaFetchedAt)) {
      latest.set(row.limitId, row);
    }
  }
  return Array.from(latest.values());
}

function weeklyHistory(rows: WeeklyLimitRow[], currentResetAt: number | null | undefined): WeeklyLimitHistoryPoint[] {
  const points = rows
    .filter((row) =>
      row.limitId === "secondary" &&
      (currentResetAt == null || !sameWeeklyReset(row.resetAt, currentResetAt))
    )
    .sort((a, b) => snapshotSortMs(a) - snapshotSortMs(b))
    .map((row) => ({
      key: row.snapshotKey,
      fetchedAt: row.quotaFetchedAt,
      usedPercent: row.usedPercent,
      remainingPercent: row.remainingPercent,
      resetAt: row.resetAt,
      state: row.state,
    }));
  const compacted: WeeklyLimitHistoryPoint[] = [];
  for (const point of points) {
    const previous = compacted[compacted.length - 1];
    if (
      previous &&
      previous.usedPercent === point.usedPercent &&
      previous.remainingPercent === point.remainingPercent &&
      sameWeeklyReset(previous.resetAt, point.resetAt)
    ) {
      compacted[compacted.length - 1] = point;
      continue;
    }
    compacted.push(point);
  }
  return compacted.slice(-HISTORY_LIMIT);
}

function isStaleQuota(account: Account): boolean {
  if ((account as Account & { quotaVerifyRequired?: boolean }).quotaVerifyRequired) return true;
  if (!account.quotaFetchedAt) return false;
  return Date.now() - fetchedAtMs(account.quotaFetchedAt) > STALE_QUOTA_MS;
}

function deriveRisk(row: Omit<WeeklyLimitAccountRow, "risk">): WeeklyLimitAccountRisk {
  if (row.missingQuota || !row.weeklyWindow) return "unknown";
  if (row.currentWindow?.allowed === false || row.currentWindow?.limitReached === true) return "limited";
  if (row.weeklyWindow.state === "exhausted" || row.weeklyWindow.remainingPercent === 0) return "limited";
  if (row.weeklyWindow.remainingPercent != null && row.weeklyWindow.remainingPercent <= 20) return "low";
  if (row.staleQuota || row.quotaVerifyRequired || row.accountStatus === "refreshing") return "stale";
  if (row.accountStatus === "active" && row.currentWindow?.allowed !== false) return "recommended";
  return "unknown";
}

function accountRiskRank(risk: WeeklyLimitAccountRisk): number {
  if (risk === "limited") return 0;
  if (risk === "low") return 1;
  if (risk === "stale") return 2;
  if (risk === "unknown") return 3;
  return 4;
}

export function extractWeeklyLimits(accounts: Account[]): WeeklyLimitRow[] {
  return dedupeWeeklyRows(accounts.flatMap(rowsForAccount)).sort((a, b) => {
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

export function extractWeeklyLimitAccounts(accounts: Account[]): WeeklyLimitAccountRow[] {
  return accounts.map((account) => {
    const snapshots = collectSnapshots(account);
    const latestSnapshot = snapshots[snapshots.length - 1];
    const allWeeklyRows = rowsForAccount(account, false);
    const dedupedWeeklyRows = dedupeWeeklyRows(allWeeklyRows);
    const latestWeeklyRows = latestRowsByLimit(dedupedWeeklyRows);
    const weeklyWindow = latestWeeklyRows.find((row) => row.limitId === "secondary") ?? null;
    const modelWeeklyLimits = latestWeeklyRows
      .filter((row) => row.limitId.startsWith("additional:") && row.limitId.endsWith(":secondary"))
      .sort((a, b) => (a.remainingPercent ?? 101) - (b.remainingPercent ?? 101));
    const base: Omit<WeeklyLimitAccountRow, "risk"> = {
      accountId: account.id,
      email: account.email,
      label: account.label,
      planType: account.planType,
      quotaPlanType: accountDisplayPlan(account, latestSnapshot?.quota),
      accountStatus: account.status,
      proxyName: account.proxyName,
      quotaFetchedAt: account.quotaFetchedAt ?? latestSnapshot?.fetchedAt ?? null,
      quotaVerifyRequired: Boolean((account as Account & { quotaVerifyRequired?: boolean }).quotaVerifyRequired),
      staleQuota: isStaleQuota(account),
      missingQuota: !account.quota,
      currentWindow: windowSummary(latestSnapshot?.quota.rate_limit, latestSnapshot?.quota.rate_limit?.allowed),
      weeklyWindow,
      modelWeeklyLimits,
      weeklyHistory: weeklyHistory(rowsForAccount(account, false, false), weeklyWindow?.resetAt),
    };
    return {
      ...base,
      risk: deriveRisk(base),
    };
  }).sort((a, b) => {
    const riskDiff = accountRiskRank(a.risk) - accountRiskRank(b.risk);
    if (riskDiff !== 0) return riskDiff;
    const remainingDiff = (a.weeklyWindow?.remainingPercent ?? 101) - (b.weeklyWindow?.remainingPercent ?? 101);
    if (remainingDiff !== 0) return remainingDiff;
    const resetDiff = (a.weeklyWindow?.resetAt ?? Number.MAX_SAFE_INTEGER) -
      (b.weeklyWindow?.resetAt ?? Number.MAX_SAFE_INTEGER);
    if (resetDiff !== 0) return resetDiff;
    return a.email.localeCompare(b.email);
  });
}
