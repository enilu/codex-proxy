import { describe, expect, it } from "vitest";
import type { Account } from "../../../../shared/types";
import { extractWeeklyLimitAccounts, extractWeeklyLimits } from "../weeklyLimits";

const week = 7 * 24 * 60 * 60;

function account(overrides: Partial<Account>): Account {
  return {
    id: "acct-1",
    email: "a@example.com",
    status: "active",
    planType: "plus",
    quotaFetchedAt: "2026-06-17T00:00:00.000Z",
    ...overrides,
  };
}

describe("extractWeeklyLimits", () => {
  it("extracts every weekly quota bucket for each account", () => {
    const rows = extractWeeklyLimits([
      account({
        quota: {
          plan_type: "plus",
          rate_limit: {
            limit_reached: false,
            used_percent: 20,
            remaining_percent: 80,
            reset_at: 1000,
            limit_window_seconds: 300,
          },
          secondary_rate_limit: {
            limit_reached: false,
            used_percent: 80,
            remaining_percent: 20,
            reset_at: 2000,
            limit_window_seconds: week,
          },
          code_review_rate_limit: {
            allowed: true,
            limit_reached: true,
            used_percent: 99,
            remaining_percent: 1,
            reset_at: 1500,
            limit_window_seconds: week,
          },
          rate_limits_by_limit_id: {
            cloud_tasks: {
              limit_id: "cloud_tasks",
              limit_name: "cloud_tasks",
              allowed: true,
              limit_reached: false,
              used_percent: 41,
              remaining_percent: 59,
              reset_at: 3000,
              limit_window_seconds: week,
              secondary_rate_limit: {
                limit_reached: true,
                used_percent: 100,
                remaining_percent: 0,
                reset_at: 2500,
                limit_window_seconds: week,
              },
            },
          },
        },
      }),
    ]);

    expect(rows.map((row) => row.limitId)).toEqual([
      "additional:cloud_tasks:secondary",
      "code_review",
      "secondary",
      "additional:cloud_tasks",
    ]);
    expect(rows[0]).toMatchObject({
      limitName: "cloud tasks weekly",
      state: "exhausted",
      usedPercent: 100,
      remainingPercent: 0,
    });
    expect(rows[1]).toMatchObject({
      limitName: "Code review",
      state: "exhausted",
      usedPercent: 99,
    });
  });

  it("ignores non-weekly windows and accounts without quota", () => {
    const rows = extractWeeklyLimits([
      account({ id: "no-quota", quota: undefined }),
      account({
        id: "short-window",
        quota: {
          plan_type: "plus",
          rate_limit: {
            limit_reached: false,
            used_percent: 10,
            reset_at: 100,
            limit_window_seconds: 300,
          },
          secondary_rate_limit: null,
          code_review_rate_limit: null,
        },
      }),
    ]);

    expect(rows).toEqual([]);
  });

  it("extracts multiple historical weekly snapshots for the same account", () => {
    const rows = extractWeeklyLimits([
      account({
        quotaHistory: [
          {
            key: "secondary:1000",
            fetchedAt: "2026-06-01T00:00:00.000Z",
            quota: {
              plan_type: "plus",
              rate_limit: {
                limit_reached: false,
                used_percent: 10,
                reset_at: 500,
                limit_window_seconds: 300,
              },
              secondary_rate_limit: {
                limit_reached: false,
                used_percent: 45,
                remaining_percent: 55,
                reset_at: 1000,
                limit_window_seconds: week,
              },
              code_review_rate_limit: null,
            },
          },
          {
            key: "secondary:2000",
            fetchedAt: "2026-06-08T00:00:00.000Z",
            quota: {
              plan_type: "plus",
              rate_limit: {
                limit_reached: false,
                used_percent: 10,
                reset_at: 500,
                limit_window_seconds: 300,
              },
              secondary_rate_limit: {
                limit_reached: true,
                used_percent: 100,
                remaining_percent: 0,
                reset_at: 2000,
                limit_window_seconds: week,
              },
              code_review_rate_limit: null,
            },
          },
        ],
      }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.snapshotKey)).toEqual(["secondary:2000", "secondary:1000"]);
    expect(rows.map((row) => row.state)).toEqual(["exhausted", "available"]);
  });

  it("deduplicates historical weekly snapshots when reset_at drifts within tolerance", () => {
    const rows = extractWeeklyLimits([
      account({
        quotaHistory: [
          {
            key: "secondary:1000",
            fetchedAt: "2026-06-01T00:00:00.000Z",
            quota: {
              plan_type: "plus",
              rate_limit: {
                limit_reached: false,
                used_percent: 10,
                reset_at: 500,
                limit_window_seconds: 300,
              },
              secondary_rate_limit: {
                limit_reached: false,
                used_percent: 67,
                remaining_percent: 33,
                reset_at: 1000,
                limit_window_seconds: week,
              },
              code_review_rate_limit: null,
            },
          },
          {
            key: "secondary:1001",
            fetchedAt: "2026-06-01T00:05:00.000Z",
            quota: {
              plan_type: "plus",
              rate_limit: {
                limit_reached: false,
                used_percent: 10,
                reset_at: 500,
                limit_window_seconds: 300,
              },
              secondary_rate_limit: {
                limit_reached: false,
                used_percent: 68,
                remaining_percent: 32,
                reset_at: 1001,
                limit_window_seconds: week,
              },
              code_review_rate_limit: null,
            },
          },
        ],
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      snapshotKey: "secondary:1001",
      usedPercent: 68,
      remainingPercent: 32,
      resetAt: 1001,
    });
  });

  it("builds one account row with current, weekly, model weekly, and latest 7 previous-window history points", () => {
    const quotaHistory = Array.from({ length: 8 }, (_, index) => ({
      key: `secondary:${index}`,
      fetchedAt: `2026-06-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      quota: {
        plan_type: "pro",
        rate_limit: {
          limit_reached: false,
          used_percent: 1,
          remaining_percent: 99,
          reset_at: 500 + index,
          limit_window_seconds: 300,
        },
        secondary_rate_limit: {
          limit_reached: false,
          used_percent: index * 10,
          remaining_percent: 100 - index * 10,
          reset_at: index < 7 ? 1000 + index : 2000,
          limit_window_seconds: week,
        },
        code_review_rate_limit: null,
        rate_limits_by_limit_id: {
          codex_bengalfox: {
            limit_id: "codex_bengalfox",
            limit_name: "GPT-5.3-Codex-Spark",
            allowed: true,
            limit_reached: false,
            used_percent: 0,
            remaining_percent: 100,
            reset_at: 2000 + index,
            limit_window_seconds: 300,
            secondary_rate_limit: {
              limit_reached: false,
              used_percent: 5,
              remaining_percent: 95,
              reset_at: 3000 + index,
              limit_window_seconds: week,
            },
          },
        },
      },
    }));

    const rows = extractWeeklyLimitAccounts([
      account({
        quotaHistory,
        quota: quotaHistory[7].quota,
        quotaFetchedAt: "2026-06-09T00:00:00.000Z",
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].currentWindow?.remainingPercent).toBe(99);
    expect(rows[0].weeklyWindow?.remainingPercent).toBe(30);
    expect(rows[0].modelWeeklyLimits).toHaveLength(1);
    expect(rows[0].modelWeeklyLimits[0]).toMatchObject({
      limitName: "GPT-5.3-Codex-Spark weekly",
      remainingPercent: 95,
    });
    expect(rows[0].weeklyHistory).toHaveLength(7);
    expect(rows[0].weeklyHistory.map((point) => point.usedPercent)).toEqual([0, 10, 20, 30, 40, 50, 60]);
  });

  it("excludes current weekly reset snapshots from history", () => {
    const rows = extractWeeklyLimitAccounts([
      account({
        quota: {
          plan_type: "prolite",
          rate_limit: {
            allowed: true,
            limit_reached: false,
            used_percent: 23,
            remaining_percent: 77,
            reset_at: 1781771459,
            limit_window_seconds: 18000,
          },
          secondary_rate_limit: {
            limit_reached: false,
            used_percent: 19,
            remaining_percent: 81,
            reset_at: 1782340229,
            limit_window_seconds: week,
          },
          code_review_rate_limit: null,
        },
        quotaFetchedAt: "2026-06-18T05:13:14.164Z",
        quotaHistory: [
          {
            key: "secondary:29695767:604800",
            fetchedAt: "2026-06-17T19:02:15.738Z",
            quota: {
              plan_type: "prolite",
              rate_limit: {
                allowed: true,
                limit_reached: false,
                used_percent: 0,
                remaining_percent: 100,
                reset_at: 1781748098,
                limit_window_seconds: 18000,
              },
              secondary_rate_limit: {
                limit_reached: false,
                used_percent: 92,
                remaining_percent: 8,
                reset_at: 1781746049,
                limit_window_seconds: week,
              },
              code_review_rate_limit: null,
            },
          },
          {
            key: "additional:codex_bengalfox:secondary:29705892:604800|secondary:29705670:604800",
            fetchedAt: "2026-06-18T02:12:05.388Z",
            quota: {
              plan_type: "prolite",
              rate_limit: {
                allowed: true,
                limit_reached: false,
                used_percent: 59,
                remaining_percent: 41,
                reset_at: 1781753430,
                limit_window_seconds: 18000,
              },
              secondary_rate_limit: {
                limit_reached: false,
                used_percent: 9,
                remaining_percent: 91,
                reset_at: 1782340230,
                limit_window_seconds: week,
              },
              code_review_rate_limit: null,
            },
          },
          {
            key: "secondary:29705670:604800",
            fetchedAt: "2026-06-18T05:13:14.164Z",
            quota: {
              plan_type: "prolite",
              rate_limit: {
                allowed: true,
                limit_reached: false,
                used_percent: 23,
                remaining_percent: 77,
                reset_at: 1781771459,
                limit_window_seconds: 18000,
              },
              secondary_rate_limit: {
                limit_reached: false,
                used_percent: 19,
                remaining_percent: 81,
                reset_at: 1782340229,
                limit_window_seconds: week,
              },
              code_review_rate_limit: null,
            },
          },
        ],
      }),
    ]);

    expect(rows[0].weeklyWindow?.usedPercent).toBe(19);
    expect(rows[0].weeklyHistory.map((point) => point.usedPercent)).toEqual([92]);
  });

  it("marks accounts with allowed=false current windows as limited even when weekly quota remains", () => {
    const rows = extractWeeklyLimitAccounts([
      account({
        quota: {
          plan_type: "plus",
          rate_limit: {
            allowed: false,
            limit_reached: false,
            used_percent: 0,
            remaining_percent: 0,
            reset_at: 500,
            limit_window_seconds: 300,
          },
          secondary_rate_limit: {
            limit_reached: false,
            used_percent: 54,
            remaining_percent: 46,
            reset_at: 1000,
            limit_window_seconds: week,
          },
          code_review_rate_limit: null,
        },
      }),
    ]);

    expect(rows[0].risk).toBe("limited");
    expect(rows[0].currentWindow?.allowed).toBe(false);
    expect(rows[0].weeklyWindow?.remainingPercent).toBe(46);
  });
});
