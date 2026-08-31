import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getDailyRunLimit,
  getRunExecutionAdmission,
} from "../../src/counterstep/runtime.js";

describe("Counterstep deployment runtime configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses a bounded default and derives the UTC admission key", () => {
    vi.stubEnv("COUNTERSTEP_MAX_DAILY_RUNS", "37");
    expect(getDailyRunLimit()).toBe(37);
    expect(
      getRunExecutionAdmission(new Date("2026-08-29T23:59:59.000-07:00")),
    ).toStrictEqual({
      dateKey: "2026-08-30",
      maxRuns: 37,
      timestamp: "2026-08-30T06:59:59.000Z",
    });
  });

  it.each(["0", "-1", "not-a-number", "10001"])(
    "fails closed for invalid daily limit %s",
    (configured) => {
      vi.stubEnv("COUNTERSTEP_MAX_DAILY_RUNS", configured);
      expect(() => getDailyRunLimit()).toThrow();
    },
  );
});
