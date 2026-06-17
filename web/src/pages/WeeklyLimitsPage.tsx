import { useMemo, useState } from "preact/hooks";
import { useI18n, useT } from "../../../shared/i18n/context";
import type { TranslationKey } from "../../../shared/i18n/translations";
import { formatResetTime } from "../../../shared/utils/format";
import { useAccounts } from "../../../shared/hooks/use-accounts";
import { extractWeeklyLimits, type WeeklyLimitRow, type WeeklyLimitState } from "../lib/weeklyLimits";

type StateFilter = "all" | WeeklyLimitState;

const stateOptions: Array<{ value: StateFilter; label: TranslationKey }> = [
  { value: "all", label: "filterAll" },
  { value: "exhausted", label: "weeklyLimitsExhausted" },
  { value: "available", label: "weeklyLimitsAvailable" },
  { value: "unknown", label: "weeklyLimitsUnknown" },
];

const stateStyles: Record<WeeklyLimitState, string> = {
  exhausted: "bg-danger-container text-danger border-danger/30",
  available: "bg-success-container text-success border-success/30",
  unknown: "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800/30 dark:text-slate-400 dark:border-slate-700/30",
};

function percentText(value: number | null): string {
  return value == null ? "—" : `${value}%`;
}

function accountName(row: WeeklyLimitRow): string {
  return row.label ? `${row.label} (${row.email})` : row.email;
}

export function WeeklyLimitsPage({ embedded }: { embedded?: boolean } = {}) {
  const t = useT();
  const { lang } = useI18n();
  const { list, loading, refreshing, refresh } = useAccounts();
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const rows = useMemo(() => extractWeeklyLimits(list), [list]);
  const affectedAccounts = useMemo(
    () => new Set(rows.filter((row) => row.state === "exhausted").map((row) => row.accountId)).size,
    [rows],
  );
  const accountsWithWeeklyLimits = useMemo(
    () => new Set(rows.map((row) => row.accountId)).size,
    [rows],
  );
  const missingQuotaCount = list.filter((account) => !account.quota).length;

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (stateFilter !== "all" && row.state !== stateFilter) return false;
      if (!needle) return true;
      return [
        row.email,
        row.label ?? "",
        row.planType ?? "",
        row.limitName,
        row.accountStatus,
      ].some((value) => value.toLowerCase().includes(needle));
    });
  }, [rows, search, stateFilter]);

  const showMessage = (text: string, error = false) => {
    setMessage({ text, error });
    setTimeout(() => setMessage(null), 3500);
  };

  const refreshQuota = async (accountId: string) => {
    setRefreshingId(accountId);
    try {
      const resp = await fetch(`/auth/accounts/${encodeURIComponent(accountId)}/quota`);
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || data.detail || `HTTP ${resp.status}`);
      }
      await refresh();
      showMessage(t("weeklyLimitsRefreshSuccess"));
    } catch (err) {
      showMessage(err instanceof Error ? err.message : String(err), true);
    } finally {
      setRefreshingId(null);
    }
  };

  const content = (
    <div class="flex flex-col gap-4">
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard label={t("weeklyLimitsTotalAccounts")} value={String(list.length)} />
        <SummaryCard label={t("weeklyLimitsAccountsWithLimits")} value={String(accountsWithWeeklyLimits)} />
        <SummaryCard label={t("weeklyLimitsLimitRows")} value={String(rows.length)} />
        <SummaryCard label={t("weeklyLimitsAffectedAccounts")} value={String(affectedAccounts)} />
        <SummaryCard label={t("weeklyLimitsMissingQuota")} value={String(missingQuotaCount)} />
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={search}
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          placeholder={t("weeklyLimitsSearch")}
          class="flex-1 min-w-[220px] px-3 py-2 text-sm border border-gray-200 dark:border-border-dark rounded-lg bg-white dark:bg-card-dark text-slate-700 dark:text-text-main focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <div class="flex flex-wrap gap-1.5">
          {stateOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => setStateFilter(option.value)}
              class={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                stateFilter === option.value
                  ? "bg-primary-container text-primary border-primary/30"
                  : "bg-white dark:bg-card-dark border-gray-200 dark:border-border-dark text-slate-500 dark:text-text-dim hover:border-primary/40"
              }`}
            >
              {t(option.label)}
            </button>
          ))}
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          class="px-3 py-2 text-xs font-medium rounded-lg border border-gray-200 dark:border-border-dark text-slate-600 dark:text-text-dim hover:bg-slate-100 dark:hover:bg-border-dark disabled:opacity-40 transition-colors"
        >
          {refreshing ? t("refreshing") : t("refreshList")}
        </button>
      </div>

      {message && (
        <div class={`px-4 py-2 rounded-lg text-sm font-medium ${
          message.error
            ? "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400"
            : "bg-primary-container text-primary"
        }`}>
          {message.text}
        </div>
      )}

      <div class="bg-white dark:bg-card-dark border border-gray-200 dark:border-border-dark rounded-xl overflow-hidden">
        <div class="overflow-x-auto">
          <div class="min-w-[900px]">
            <div class="grid grid-cols-[minmax(180px,1.5fr)_minmax(120px,1fr)_96px_96px_120px_120px_80px] gap-3 px-4 py-2.5 border-b border-gray-100 dark:border-border-dark bg-slate-50 dark:bg-bg-dark text-xs text-slate-500 dark:text-text-dim font-medium">
              <span>{t("weeklyLimitsAccount")}</span>
              <span>{t("weeklyLimitsLimit")}</span>
              <span>{t("weeklyLimitsState")}</span>
              <span>{t("weeklyLimitsUsed")}</span>
              <span>{t("weeklyLimitsRemaining")}</span>
              <span>{t("weeklyLimitsReset")}</span>
              <span class="text-right">{t("weeklyLimitsActions")}</span>
            </div>
            {loading ? (
              <div class="px-4 py-10 text-center text-sm text-slate-400 dark:text-text-dim">Loading...</div>
            ) : filteredRows.length === 0 ? (
              <div class="px-4 py-10 text-center text-sm text-slate-400 dark:text-text-dim">
                {rows.length === 0 ? t("weeklyLimitsNoData") : t("noMatchingAccounts")}
              </div>
            ) : (
              filteredRows.map((row) => {
                const reset = row.resetAt ? formatResetTime(row.resetAt, lang === "zh") : "—";
                return (
                  <div
                    key={`${row.accountId}:${row.snapshotKey ?? row.quotaFetchedAt ?? "current"}:${row.limitId}`}
                    class="grid grid-cols-[minmax(180px,1.5fr)_minmax(120px,1fr)_96px_96px_120px_120px_80px] gap-3 px-4 py-3 border-b border-gray-50 dark:border-border-dark/50 text-sm items-center"
                  >
                    <div class="min-w-0">
                      <div class="font-medium text-slate-700 dark:text-text-main truncate" title={accountName(row)}>
                        {accountName(row)}
                      </div>
                      <div class="text-xs text-slate-400 dark:text-text-dim truncate">
                        {row.planType || t("freeTier")} · {row.accountStatus}
                      </div>
                    </div>
                    <span class="text-slate-600 dark:text-text-dim truncate" title={row.limitName}>
                      {row.limitName}
                    </span>
                    <span>
                      <span class={`inline-flex px-2 py-0.5 rounded-full text-[0.68rem] font-medium border ${stateStyles[row.state]}`}>
                        {t(row.state === "exhausted"
                          ? "weeklyLimitsExhausted"
                          : row.state === "available"
                            ? "weeklyLimitsAvailable"
                            : "weeklyLimitsUnknown")}
                      </span>
                    </span>
                    <div>
                      <div class="font-medium text-slate-700 dark:text-text-main">{percentText(row.usedPercent)}</div>
                      {row.usedPercent != null && (
                        <div class="mt-1 h-1.5 rounded-full bg-slate-100 dark:bg-border-dark overflow-hidden">
                          <div
                            class={`h-1.5 ${row.state === "exhausted" ? "bg-red-500" : row.usedPercent >= 80 ? "bg-amber-500" : "bg-primary-action"}`}
                            style={{ width: `${row.usedPercent}%` }}
                          />
                        </div>
                      )}
                    </div>
                    <span class="text-slate-600 dark:text-text-dim">{percentText(row.remainingPercent)}</span>
                    <div class="text-xs text-slate-500 dark:text-text-dim">
                      <div>{reset}</div>
                      {row.quotaFetchedAt && (
                        <div class="text-[0.65rem] text-slate-400 dark:text-text-dim/70">
                          {new Date(row.quotaFetchedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => refreshQuota(row.accountId)}
                      disabled={refreshingId === row.accountId}
                      class="justify-self-end px-2.5 py-1.5 text-xs font-medium rounded-lg text-primary hover:bg-primary/10 disabled:opacity-40 transition-colors"
                    >
                      {refreshingId === row.accountId ? t("refreshing") : t("refresh")}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );

  if (embedded) return content;

  return (
    <div class="min-h-screen bg-slate-50 dark:bg-bg-dark flex flex-col">
      <header class="sticky top-0 z-50 bg-white dark:bg-card-dark border-b border-gray-200 dark:border-border-dark px-4 py-3">
        <div class="max-w-[1100px] mx-auto flex items-center gap-3">
          <a href="#/" class="text-sm text-slate-500 dark:text-text-dim hover:text-primary transition-colors">
            &larr; {t("backToDashboard")}
          </a>
          <h1 class="text-base font-semibold text-slate-800 dark:text-text-main">{t("weeklyLimits")}</h1>
        </div>
      </header>
      <main class="flex-grow px-4 md:px-8 py-6 max-w-[1100px] mx-auto w-full">
        {content}
      </main>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div class="bg-white dark:bg-card-dark rounded-xl border border-gray-200 dark:border-border-dark p-4">
      <div class="text-xs text-slate-500 dark:text-text-dim mb-1">{label}</div>
      <div class="text-lg font-semibold text-slate-800 dark:text-text-main">{value}</div>
    </div>
  );
}
