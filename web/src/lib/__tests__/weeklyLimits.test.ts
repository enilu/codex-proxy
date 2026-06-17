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
});
