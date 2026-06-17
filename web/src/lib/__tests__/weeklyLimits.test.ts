import { describe, expect, it } from "vitest";
import type { Account } from "../../../../shared/types";
import { extractWeeklyLimits } from "../weeklyLimits";

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
});
