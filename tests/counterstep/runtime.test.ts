import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getDailyRunLimit,
  getAgentMode,
  getGeminiBackend,
  getRunExecutionAdmission,
} from "../../src/counterstep/runtime.js";

describe("Counterstep deployment runtime configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails toward the low-cost daily default when no override is supplied", () => {
    vi.stubEnv("COUNTERSTEP_MAX_DAILY_RUNS", undefined);
    expect(getDailyRunLimit()).toBe(10);
  });

  it("selects Vertex AI only with an explicit complete server configuration", () => {
    vi.stubEnv("COUNTERSTEP_AGENT_MODE", "gemini");
    vi.stubEnv("GEMINI_API_KEY", undefined);
    vi.stubEnv("GOOGLE_GENAI_USE_ENTERPRISE", "true");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "counterstep-demo-123");
    vi.stubEnv("GOOGLE_CLOUD_LOCATION", "global");
    expect(getGeminiBackend()).toBe("vertex-ai");
    expect(getAgentMode()).toBe("gemini");
  });

  it("fails closed when neither Gemini backend is completely configured", () => {
    vi.stubEnv("COUNTERSTEP_AGENT_MODE", "gemini");
    vi.stubEnv("GEMINI_API_KEY", undefined);
    vi.stubEnv("GOOGLE_GENAI_USE_ENTERPRISE", "true");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "counterstep-demo-123");
    vi.stubEnv("GOOGLE_CLOUD_LOCATION", undefined);
    expect(getGeminiBackend()).toBe("unconfigured");
    expect(getAgentMode()).toBe("no_execution");
  });

  it("retains the server-only Gemini API path for local rehearsal", () => {
    vi.stubEnv("GOOGLE_GENAI_USE_ENTERPRISE", undefined);
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    expect(getGeminiBackend()).toBe("gemini-api");
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
