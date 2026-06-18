import { useMemo, useState } from "preact/hooks";
import { useI18n, useT } from "../../../shared/i18n/context";
import { formatResetTime, formatWindowDuration } from "../../../shared/utils/format";
import { useAccounts } from "../../../shared/hooks/use-accounts";
import {
  extractWeeklyLimitAccounts,
  type LimitWindowSummary,
  type WeeklyLimitAccountRisk,
  type WeeklyLimitAccountRow,
  type WeeklyLimitHistoryPoint,
  type WeeklyLimitRow,
} from "../lib/weeklyLimits";

type RiskFilter = "all" | "recommended" | "low" | "limited" | "stale" | "unknown";
type SortMode = "risk" | "remaining" | "reset" | "updated" | "plan";

const tableGrid =
  "grid-cols-[minmax(250px,1.2fr)_110px_minmax(160px,0.8fr)_minmax(200px,0.9fr)_minmax(190px,0.85fr)_minmax(118px,0.5fr)_98px]";

const riskRank: Record<WeeklyLimitAccountRisk, number> = {
  limited: 0,
  low: 1,
  stale: 2,
  unknown: 3,
  recommended: 4,
};

function percentText(value: number | null | undefined): string {
  return value == null ? "-" : `${value}%`;
}

function accountName(row: WeeklyLimitAccountRow): string {
  return row.label ? `${row.label} (${row.email})` : row.email;
}

function localText(lang: string, zh: string, en: string): string {
  return lang === "zh" ? zh : en;
}

function remainingClass(value: number | null | undefined): string {
  if (value == null) return "text-slate-500 dark:text-text-dim";
  if (value <= 10) return "text-danger";
  if (value <= 30) return "text-warning";
  return "text-success";
}

function usedBarClass(value: number | null | undefined): string {
  if (value == null) return "bg-slate-300 dark:bg-border-dark";
  if (value >= 90) return "bg-danger";
  if (value >= 70) return "bg-warning";
  return "bg-primary-action";
}

function riskBadgeClass(risk: WeeklyLimitAccountRisk): string {
  if (risk === "recommended") return "bg-success-container text-success border-success/30";
  if (risk === "low" || risk === "stale") return "bg-warning-container text-warning border-warning/30";
  if (risk === "limited") return "bg-danger-container text-danger border-danger/30";
  return "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800/40 dark:text-text-dim dark:border-border-dark";
}

function statusBadgeClass(status: string): string {
  if (status === "active") return "bg-success-container text-success border-success/30";
  if (status === "disabled") return "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800/40 dark:text-text-dim dark:border-border-dark";
  if (status === "refreshing") return "bg-warning-container text-warning border-warning/30";
  return "bg-danger-container text-danger border-danger/30";
}

function riskLabel(risk: WeeklyLimitAccountRisk, lang: string): string {
  const zh: Record<WeeklyLimitAccountRisk, string> = {
    recommended: "推荐",
    low: "周额度低",
    limited: "当前不可用",
    stale: "需验证",
    unknown: "未知",
  };
  const en: Record<WeeklyLimitAccountRisk, string> = {
    recommended: "Recommended",
    low: "Low weekly quota",
    limited: "Unavailable",
    stale: "Verify",
    unknown: "Unknown",
  };
  return lang === "zh" ? zh[risk] : en[risk];
}

function formatDateTime(value: string | null | undefined, lang: string): string {
  if (!value) return "-";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "-";
  return d.toLocaleString(lang === "zh" ? "zh-CN" : undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelativeReset(resetAt: number | null | undefined, lang: string): { relative: string; absolute: string } {
  if (!resetAt) return { relative: "-", absolute: "-" };
  const deltaMs = resetAt * 1000 - Date.now();
  if (deltaMs <= 0) {
    return {
      relative: localText(lang, "可刷新", "Ready"),
      absolute: formatResetTime(resetAt, lang === "zh"),
    };
  }
  const totalMinutes = Math.ceil(deltaMs / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  let relative: string;
  if (days > 0) {
    relative = lang === "zh" ? `${days}天${hours}小时后` : `${days}d ${hours}h`;
  } else if (hours > 0) {
    relative = lang === "zh" ? `${hours}小时${minutes}分后` : `${hours}h ${minutes}m`;
  } else {
    relative = lang === "zh" ? `${minutes}分钟后` : `${minutes}m`;
  }
  return {
    relative,
    absolute: formatResetTime(resetAt, lang === "zh"),
  };
}

function sortRows(rows: WeeklyLimitAccountRow[], sortMode: SortMode): WeeklyLimitAccountRow[] {
  const copy = [...rows];
  if (sortMode === "remaining") {
    return copy.sort((a, b) =>
      (a.weeklyWindow?.remainingPercent ?? 101) - (b.weeklyWindow?.remainingPercent ?? 101)
    );
  }
  if (sortMode === "reset") {
    return copy.sort((a, b) =>
      (a.weeklyWindow?.resetAt ?? Number.MAX_SAFE_INTEGER) -
      (b.weeklyWindow?.resetAt ?? Number.MAX_SAFE_INTEGER)
    );
  }
  if (sortMode === "updated") {
    return copy.sort((a, b) =>
      new Date(b.quotaFetchedAt ?? 0).getTime() - new Date(a.quotaFetchedAt ?? 0).getTime()
    );
  }
  if (sortMode === "plan") {
    return copy.sort((a, b) =>
      (a.quotaPlanType ?? a.planType ?? "").localeCompare(b.quotaPlanType ?? b.planType ?? "") ||
      a.email.localeCompare(b.email)
    );
  }
  return copy.sort((a, b) => {
    const riskDiff = riskRank[a.risk] - riskRank[b.risk];
    if (riskDiff !== 0) return riskDiff;
    const remainingDiff = (a.weeklyWindow?.remainingPercent ?? 101) - (b.weeklyWindow?.remainingPercent ?? 101);
    if (remainingDiff !== 0) return remainingDiff;
    return a.email.localeCompare(b.email);
  });
}

export function WeeklyLimitsPage({ embedded }: { embedded?: boolean } = {}) {
  const t = useT();
  const { lang } = useI18n();
  const { list, loading, refreshing, refresh } = useAccounts();
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("risk");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const rows = useMemo(() => extractWeeklyLimitAccounts(list), [list]);
  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (riskFilter !== "all" && row.risk !== riskFilter) return false;
      if (!needle) return true;
      return [
        row.email,
        row.label ?? "",
        row.planType ?? "",
        row.quotaPlanType ?? "",
        row.accountStatus,
        row.proxyName ?? "",
        ...row.modelWeeklyLimits.map((limit) => limit.limitName),
      ].some((value) => value.toLowerCase().includes(needle));
    });
    return sortRows(filtered, sortMode);
  }, [rows, search, riskFilter, sortMode]);

  const recommendedRows = rows.filter((row) => row.risk === "recommended");
  const bestRow = recommendedRows[0] ?? rows.find((row) => row.weeklyWindow) ?? null;
  const lowCount = rows.filter((row) => row.risk === "low").length;
  const limitedCount = rows.filter((row) => row.risk === "limited").length;
  const staleCount = rows.filter((row) => row.risk === "stale").length;
  const missingQuotaCount = rows.filter((row) => row.missingQuota).length;

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
      <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)] gap-3">
        <div class="bg-white dark:bg-card-dark border border-gray-200 dark:border-border-dark rounded-lg p-4 shadow-sm">
          <div class="text-xs font-semibold text-slate-500 dark:text-text-dim mb-2">
            {localText(lang, "推荐可用账号", "Recommended account")}
          </div>
          {bestRow ? (
            <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-4 items-center">
              <div class="min-w-0">
                <div class="text-xl font-bold text-slate-800 dark:text-text-main truncate" title={accountName(bestRow)}>
                  {accountName(bestRow)}
                </div>
                <div class="flex flex-wrap gap-2 mt-2">
                  <Badge className={statusBadgeClass(bestRow.accountStatus)}>{bestRow.accountStatus}</Badge>
                  <Badge className={riskBadgeClass(bestRow.risk)}>{riskLabel(bestRow.risk, lang)}</Badge>
                  <Badge>{bestRow.quotaPlanType || bestRow.planType || t("freeTier")}</Badge>
                  {bestRow.proxyName && <Badge>{bestRow.proxyName}</Badge>}
                </div>
              </div>
              <div class="text-right">
                <div class={`text-3xl font-extrabold leading-none ${remainingClass(bestRow.weeklyWindow?.remainingPercent)}`}>
                  {percentText(bestRow.weeklyWindow?.remainingPercent)}
                </div>
                <div class="mt-1 text-xs text-slate-500 dark:text-text-dim">
                  {localText(lang, "周额度剩余", "Weekly remaining")}
                </div>
              </div>
            </div>
          ) : (
            <div class="text-sm text-slate-500 dark:text-text-dim">{t("weeklyLimitsNoData")}</div>
          )}
        </div>

        <div class="bg-white dark:bg-card-dark border border-gray-200 dark:border-border-dark rounded-lg p-3 shadow-sm">
          <RiskLine label={localText(lang, "周额度低于 20%", "Weekly quota <= 20%")} value={lowCount} tone="warning" />
          <RiskLine label={localText(lang, "当前窗口不可用", "Current window unavailable")} value={limitedCount} tone="danger" />
          <RiskLine label={localText(lang, "需要刷新验证", "Needs verification")} value={staleCount} tone="warning" />
          <RiskLine label={localText(lang, "推荐可调度账号", "Recommended routable")} value={recommendedRows.length} tone="success" last />
        </div>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard label={t("weeklyLimitsTotalAccounts")} value={String(list.length)} />
        <SummaryCard label={localText(lang, "推荐可用", "Recommended")} value={String(recommendedRows.length)} tone="success" />
        <SummaryCard label={localText(lang, "周额度紧张", "Low weekly quota")} value={String(lowCount)} tone="warning" />
        <SummaryCard label={localText(lang, "当前限流", "Limited now")} value={String(limitedCount)} tone="danger" />
        <SummaryCard label={t("weeklyLimitsMissingQuota")} value={String(missingQuotaCount)} />
      </div>

      <div class="grid grid-cols-1 xl:grid-cols-[minmax(260px,1fr)_auto_auto] gap-2 items-center">
        <input
          type="text"
          value={search}
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          placeholder={localText(lang, "搜索邮箱、计划、状态、代理、模型...", "Search email, plan, status, proxy, model...")}
          class="w-full px-3 py-2 text-sm border border-gray-200 dark:border-border-dark rounded-lg bg-white dark:bg-card-dark text-slate-700 dark:text-text-main focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <div class="flex flex-wrap gap-1.5">
          {([
            ["all", t("filterAll")],
            ["recommended", localText(lang, "推荐可用", "Recommended")],
            ["low", localText(lang, "周额度紧张", "Low quota")],
            ["limited", localText(lang, "当前限流", "Limited")],
            ["stale", localText(lang, "待刷新", "Refresh")],
          ] as Array<[RiskFilter, string]>).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setRiskFilter(value)}
              class={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                riskFilter === value
                  ? "bg-primary-container text-primary border-primary/30"
                  : "bg-white dark:bg-card-dark border-gray-200 dark:border-border-dark text-slate-500 dark:text-text-dim hover:border-primary/40"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div class="flex gap-2">
          <select
            value={sortMode}
            onChange={(e) => setSortMode((e.target as HTMLSelectElement).value as SortMode)}
            class="px-3 py-2 text-xs rounded-lg border border-gray-200 dark:border-border-dark bg-white dark:bg-card-dark text-slate-600 dark:text-text-dim focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="risk">{localText(lang, "排序：风险优先", "Sort: Risk first")}</option>
            <option value="remaining">{localText(lang, "剩余额度最低", "Lowest remaining")}</option>
            <option value="reset">{localText(lang, "恢复时间最近", "Soonest reset")}</option>
            <option value="updated">{localText(lang, "最近刷新", "Recently updated")}</option>
            <option value="plan">{localText(lang, "计划类型", "Plan")}</option>
          </select>
          <button
            onClick={refresh}
            disabled={refreshing}
            class="px-3 py-2 text-xs font-medium rounded-lg border border-gray-200 dark:border-border-dark text-slate-600 dark:text-text-dim hover:bg-slate-100 dark:hover:bg-border-dark disabled:opacity-40 transition-colors"
          >
            {refreshing ? t("refreshing") : t("refreshList")}
          </button>
        </div>
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

      <div class="bg-white dark:bg-card-dark border border-gray-200 dark:border-border-dark rounded-lg overflow-hidden shadow-sm">
        <div class="overflow-x-auto">
          <div class="min-w-[1210px]">
            <div class={`grid ${tableGrid} gap-3 px-4 py-2.5 border-b border-gray-100 dark:border-border-dark bg-slate-50 dark:bg-bg-dark text-xs text-slate-500 dark:text-text-dim font-semibold`}>
              <span>{t("weeklyLimitsAccount")}</span>
              <span>{t("weeklyLimitsState")}</span>
              <span>{localText(lang, "当前窗口", "Current window")}</span>
              <span>{localText(lang, "周额度", "Weekly quota")}</span>
              <span>{localText(lang, "历史周额度", "History")}</span>
              <span>{localText(lang, "恢复时间", "Reset")}</span>
              <span class="text-right">{t("weeklyLimitsActions")}</span>
            </div>
            {loading ? (
              <div class="px-4 py-10 text-center text-sm text-slate-400 dark:text-text-dim">Loading...</div>
            ) : filteredRows.length === 0 ? (
              <div class="px-4 py-10 text-center text-sm text-slate-400 dark:text-text-dim">
                {rows.length === 0 ? t("weeklyLimitsNoData") : t("noMatchingAccounts")}
              </div>
            ) : (
              filteredRows.map((row) => (
                <div key={row.accountId}>
                  <AccountQuotaRow
                    row={row}
                    lang={lang}
                    refreshing={refreshingId === row.accountId}
                    expanded={expandedId === row.accountId}
                    onRefresh={() => refreshQuota(row.accountId)}
                    onToggle={() => setExpandedId(expandedId === row.accountId ? null : row.accountId)}
                  />
                  {expandedId === row.accountId && <AccountDetails row={row} lang={lang} />}
                </div>
              ))
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
        <div class="max-w-[1180px] mx-auto flex items-center gap-3">
          <a href="#/" class="text-sm text-slate-500 dark:text-text-dim hover:text-primary transition-colors">
            &larr; {t("backToDashboard")}
          </a>
          <h1 class="text-base font-semibold text-slate-800 dark:text-text-main">{t("weeklyLimits")}</h1>
        </div>
      </header>
      <main class="flex-grow px-4 md:px-8 py-6 max-w-[1180px] mx-auto w-full">
        {content}
      </main>
    </div>
  );
}

function AccountQuotaRow({
  row,
  lang,
  refreshing,
  expanded,
  onRefresh,
  onToggle,
}: {
  row: WeeklyLimitAccountRow;
  lang: string;
  refreshing: boolean;
  expanded: boolean;
  onRefresh: () => void;
  onToggle: () => void;
}) {
  const reset = formatRelativeReset(row.weeklyWindow?.resetAt, lang);
  const currentTitle = row.currentWindow?.limitWindowSeconds
    ? formatWindowDuration(row.currentWindow.limitWindowSeconds, lang === "zh")
    : localText(lang, "当前窗口", "Current");
  return (
    <div class={`grid ${tableGrid} gap-3 px-4 py-3 border-b border-gray-50 dark:border-border-dark/50 text-sm items-center ${
      row.risk === "limited" || row.risk === "low" ? "bg-amber-50/45 dark:bg-warning-container/10" : ""
    }`}>
      <div class="min-w-0">
        <div class="flex items-center gap-2 min-w-0">
          <div class="font-semibold text-slate-700 dark:text-text-main truncate" title={accountName(row)}>
            {accountName(row)}
          </div>
          {(row.staleQuota || row.quotaVerifyRequired) && (
            <Badge className="bg-warning-container text-warning border-warning/30">{localText(lang, "旧", "stale")}</Badge>
          )}
        </div>
        <div class="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-400 dark:text-text-dim">
          <span>{row.quotaPlanType || row.planType || localText(lang, "免费", "Free")}</span>
          {row.proxyName && <span>{row.proxyName}</span>}
          <span>{localText(lang, "上次", "Updated")} {formatDateTime(row.quotaFetchedAt, lang)}</span>
        </div>
      </div>

      <div class="flex flex-wrap gap-1.5">
        <Badge className={statusBadgeClass(row.accountStatus)}>{row.accountStatus}</Badge>
        <Badge className={riskBadgeClass(row.risk)}>{riskLabel(row.risk, lang)}</Badge>
      </div>

      <QuotaCell
        title={currentTitle}
        summary={row.currentWindow}
        fallback={row.missingQuota ? localText(lang, "无数据", "No data") : undefined}
        lang={lang}
      />

      <QuotaCell
        title="Weekly"
        row={row.weeklyWindow}
        fallback={row.missingQuota ? localText(lang, "无数据", "No data") : undefined}
        lang={lang}
      />

      <HistoryCell history={row.weeklyHistory} lang={lang} />

      <div class="text-xs text-slate-500 dark:text-text-dim leading-snug">
        <div class="font-semibold text-slate-700 dark:text-text-main">{reset.relative}</div>
        <div>{reset.absolute}</div>
      </div>

      <div class="flex justify-end gap-1.5">
        <button
          onClick={onRefresh}
          disabled={refreshing}
          class="w-8 h-8 inline-grid place-items-center rounded-lg border border-primary/20 bg-primary-container/70 text-primary hover:bg-primary-container disabled:opacity-40 transition-colors"
          title={localText(lang, "刷新额度", "Refresh quota")}
        >
          <RefreshIcon spin={refreshing} />
        </button>
        <button
          onClick={onToggle}
          class="w-8 h-8 inline-grid place-items-center rounded-lg border border-gray-200 dark:border-border-dark text-slate-500 dark:text-text-dim hover:bg-slate-100 dark:hover:bg-border-dark transition-colors"
          title={localText(lang, "展开详情", "Toggle details")}
        >
          <ChevronIcon up={expanded} />
        </button>
      </div>
    </div>
  );
}

function QuotaCell({
  title,
  summary,
  row,
  fallback,
  lang,
}: {
  title: string;
  summary?: LimitWindowSummary | null;
  row?: WeeklyLimitRow | null;
  fallback?: string;
  lang: string;
}) {
  const usedPercent = row?.usedPercent ?? summary?.usedPercent ?? null;
  const remainingPercent = row?.remainingPercent ?? summary?.remainingPercent ?? null;
  const allowed = summary?.allowed;
  if (!row && !summary) {
    return <div class="text-xs text-slate-400 dark:text-text-dim">{fallback ?? "-"}</div>;
  }
  return (
    <div class="min-w-0">
      <div class="flex items-baseline justify-between gap-2 mb-1.5">
        <span class="text-xs font-semibold text-slate-500 dark:text-text-dim truncate">{title}</span>
        <span class={`text-xs font-bold ${remainingClass(remainingPercent)}`}>
          {percentText(remainingPercent)} {localText(lang, "剩余", "left")}
        </span>
      </div>
      <div class="h-2 rounded-full bg-slate-100 dark:bg-border-dark overflow-hidden">
        <div class={`h-full rounded-full ${usedBarClass(usedPercent)}`} style={{ width: `${usedPercent ?? 0}%` }} />
      </div>
      <div class="mt-1.5 flex justify-between gap-2 text-[0.68rem] text-slate-400 dark:text-text-dim">
        <span>{localText(lang, "已用", "Used")} {percentText(usedPercent)}</span>
        <span>{allowed === false ? "allowed=false" : row?.limitName ?? localText(lang, "允许", "Allowed")}</span>
      </div>
    </div>
  );
}

function HistoryCell({ history, lang }: { history: WeeklyLimitHistoryPoint[]; lang: string }) {
  if (history.length === 0) {
    return <div class="text-xs text-slate-400 dark:text-text-dim">{localText(lang, "暂无历史", "No history")}</div>;
  }
  const latest = history[history.length - 1];
  const title = localText(lang, `近 ${history.length} 条`, `Last ${history.length}`);
  return (
    <div class="min-w-0">
      <div class="flex justify-between gap-2 mb-1.5">
        <span class="text-xs font-semibold text-slate-500 dark:text-text-dim">{title}</span>
        <span class={`text-xs font-bold ${latest.usedPercent != null && latest.usedPercent >= 90 ? "text-danger" : latest.usedPercent != null && latest.usedPercent >= 70 ? "text-warning" : "text-success"}`}>
          {percentText(latest.usedPercent)}
        </span>
      </div>
      <div class="grid grid-cols-7 items-end gap-1 h-8">
        {history.map((item, index) => (
          <span
            key={`${item.key ?? item.fetchedAt ?? index}`}
            title={`${formatDateTime(item.fetchedAt, lang)} · ${localText(lang, "已用", "Used")} ${percentText(item.usedPercent)}`}
            class={`block rounded-t-sm border ${
              item.usedPercent != null && item.usedPercent >= 90
                ? "bg-red-200 border-red-300 dark:bg-red-900/40 dark:border-red-700"
                : item.usedPercent != null && item.usedPercent >= 70
                  ? "bg-amber-200 border-amber-300 dark:bg-amber-900/40 dark:border-amber-700"
                  : "bg-emerald-100 border-emerald-200 dark:bg-emerald-900/30 dark:border-emerald-700"
            }`}
            style={{ height: `${Math.max(4, Math.round((item.usedPercent ?? 0) * 0.3))}px` }}
          />
        ))}
        {Array.from({ length: Math.max(0, 7 - history.length) }).map((_, index) => (
          <span key={`empty-${index}`} class="block h-1 rounded-t-sm bg-slate-100 border border-slate-100 dark:bg-border-dark dark:border-border-dark" />
        ))}
      </div>
      <div class="mt-1.5 text-[0.68rem] text-slate-400 dark:text-text-dim truncate">
        {localText(lang, "最多保留 7 条快照", "Up to 7 snapshots")}
      </div>
    </div>
  );
}

function AccountDetails({ row, lang }: { row: WeeklyLimitAccountRow; lang: string }) {
  return (
    <div class="grid grid-cols-[260px_minmax(0,1fr)] gap-3 px-4 py-3 border-b border-gray-100 dark:border-border-dark bg-slate-50/70 dark:bg-bg-dark/60">
      <div class="bg-white dark:bg-card-dark border border-gray-200 dark:border-border-dark rounded-lg p-3">
        <div class="font-semibold text-slate-700 dark:text-text-main mb-3">
          {localText(lang, "模型专项额度", "Model-specific quota")}
        </div>
        {row.modelWeeklyLimits.length === 0 ? (
          <div class="text-xs text-slate-400 dark:text-text-dim">{localText(lang, "暂无模型专项额度", "No model-specific quota")}</div>
        ) : (
          <div class="flex flex-col gap-3">
            {row.modelWeeklyLimits.map((limit) => (
              <QuotaCell key={limit.limitId} title={limit.limitName} row={limit} lang={lang} />
            ))}
          </div>
        )}
      </div>
      <div class="bg-white dark:bg-card-dark border border-gray-200 dark:border-border-dark rounded-lg p-3">
        <div class="font-semibold text-slate-700 dark:text-text-main mb-3">
          {localText(lang, "quotaHistory 趋势（最多 7 条）", "quotaHistory trend (up to 7)")}
        </div>
        {row.weeklyHistory.length === 0 ? (
          <div class="text-xs text-slate-400 dark:text-text-dim">{localText(lang, "暂无历史快照", "No history snapshots")}</div>
        ) : (
          <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-slate-500 dark:text-text-dim">
            {row.weeklyHistory.map((point, index) => (
              <div key={`${point.key ?? point.fetchedAt ?? index}`} class="truncate" title={`${formatDateTime(point.fetchedAt, lang)} · ${percentText(point.usedPercent)}`}>
                {formatDateTime(point.fetchedAt, lang)}: {localText(lang, "已用", "Used")} {percentText(point.usedPercent)}
              </div>
            ))}
            {row.weeklyWindow?.resetAt && (
              <div class="truncate">
                {localText(lang, "周窗口 reset_at", "Weekly reset_at")}: {formatResetTime(row.weeklyWindow.resetAt, lang === "zh")}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "warning" | "danger";
}) {
  const toneClass = tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : tone === "danger" ? "text-danger" : "text-slate-800 dark:text-text-main";
  return (
    <div class="bg-white dark:bg-card-dark rounded-lg border border-gray-200 dark:border-border-dark p-3">
      <div class="text-xs text-slate-500 dark:text-text-dim mb-1">{label}</div>
      <div class={`text-xl font-bold ${toneClass}`}>{value}</div>
    </div>
  );
}

function RiskLine({
  label,
  value,
  tone,
  last,
}: {
  label: string;
  value: number;
  tone: "success" | "warning" | "danger";
  last?: boolean;
}) {
  const toneClass = tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-danger";
  return (
    <div class={`flex items-center justify-between gap-3 py-2 ${last ? "" : "border-b border-gray-100 dark:border-border-dark"}`}>
      <div class="flex items-center gap-2 text-sm text-slate-500 dark:text-text-dim">
        <span class={`w-2 h-2 rounded-full bg-current ${toneClass}`} />
        {label}
      </div>
      <div class={`text-base font-extrabold ${toneClass}`}>{value}</div>
    </div>
  );
}

function Badge({ children, className = "" }: { children: preact.ComponentChildren; className?: string }) {
  return (
    <span class={`inline-flex items-center min-h-[1.35rem] px-2 rounded-full border text-[0.68rem] font-semibold whitespace-nowrap ${className || "bg-white dark:bg-card-dark border-gray-200 dark:border-border-dark text-slate-500 dark:text-text-dim"}`}>
      {children}
    </span>
  );
}

function RefreshIcon({ spin }: { spin?: boolean }) {
  return (
    <svg class={spin ? "animate-spin" : ""} width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 6v5h-5M4 18v-5h5M18 9a6 6 0 0 0-10.5-3M6 15a6 6 0 0 0 10.5 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

function ChevronIcon({ up }: { up?: boolean }) {
  return (
    <svg class={up ? "rotate-180 transition-transform" : "transition-transform"} width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}
