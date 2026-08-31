import { describe, expect, it, vi } from "vitest";

import {
  CLOSURE_QUALIFIER,
  computeClosureDigest,
} from "../../scripts/evidence-contract.mjs";
import {
  parseSmokeRunCount,
  requestJson,
  runSmokeJourney,
} from "../../scripts/smoke-journey.mjs";

function validJourneyView() {
  const runId = "run-smoke-journey";
  const event = (sequence: number, stateChange = false) => ({
    eventId: `event-smoke-${sequence}`,
    runId,
    sequence,
    stateChange,
    status: "succeeded",
    ...(stateChange
      ? {
          beforeVersion: sequence,
          afterVersion: sequence + 1,
          beforeDigest: "a".repeat(64),
          afterDigest: "b".repeat(64),
        }
      : {}),
  });
  const events = [event(1), event(2, true), event(3), event(4, true)];
  const closure = {
    qualifier: CLOSURE_QUALIFIER,
    outcome: "repaired",
    remediation: {
      runId,
      eventIds: events.map(({ eventId }) => eventId),
      actionReceipt: {
        verdict: "within_remediation_authority",
        coverage: {
          successfulWrites: 2,
          recordedEvents: events.length,
          accountedEvents: events.length,
        },
      },
    },
    goalResults: [
      { status: "satisfied", evidenceEventIds: [events[1].eventId] },
      { status: "satisfied", evidenceEventIds: [events[3].eventId] },
    ],
    integrity: {
      digest: "0".repeat(64),
      modelId: "gemini-3.5-flash-lite",
      agentFramework: "google-adk-typescript",
    },
  };
  closure.integrity.digest = computeClosureDigest(closure);
  return {
    run: {
      runId,
      generationSource: "gemini",
      modelId: "gemini-3.5-flash-lite",
      status: "repaired",
      writeCount: 2,
      toolCallCount: 2,
    },
    authority: {
      maxToolCalls: 12,
      readResourceIds: ["sheet-smoke", "message-smoke"],
    },
    inspections: [
      { resourceId: "sheet-smoke" },
      { resourceId: "message-smoke" },
    ],
    events,
    approvedPlans: [{ planId: "plan-smoke" }],
    closure,
  };
}

describe("shared strict smoke journey", () => {
  it("parses only an exact one-through-five run count", () => {
    expect(parseSmokeRunCount(undefined)).toBe(2);
    expect(parseSmokeRunCount("1")).toBe(1);
    expect(parseSmokeRunCount("5")).toBe(5);
    for (const invalid of ["0", "6", "2x", "02", " 2", "2 "]) {
      expect(() => parseSmokeRunCount(invalid)).toThrow(
        "must be an integer from 1 through 5",
      );
    }
  });

  it("runs reset, creation, execution, and receipt validation in order", async () => {
    const view = validJourneyView();
    const request = vi.fn(
      async (
        _baseUrl: string,
        path: string,
      ): Promise<Record<string, unknown>> => {
        if (path === "/api/demo/reset") {
          return {
            demo: { demoId: "demo-smoke", sourceReceiptDigest: "digest" },
          };
        }
        if (path === "/api/remediation-runs") {
          return { run: { runId: view.run.runId } };
        }
        if (path.endsWith("/execute")) return view;
        if (path.endsWith("/closure-receipt")) return view.closure;
        throw new Error(`Unexpected path ${path}`);
      },
    );

    const result = await runSmokeJourney({
      baseUrl: "http://127.0.0.1:8080",
      runNumber: 1,
      request,
    });

    expect(request.mock.calls.map((call) => call[1])).toEqual([
      "/api/demo/reset",
      "/api/remediation-runs",
      `/api/remediation-runs/${view.run.runId}/execute`,
      `/api/remediation-runs/${view.run.runId}/closure-receipt`,
    ]);
    expect(result.summary).toMatchObject({
      run: 1,
      runId: view.run.runId,
      status: "repaired",
      writes: 2,
      recordedEvents: 4,
      actionReceiptVerdict: "within_remediation_authority",
    });
  });

  it("fails with a stable message when an endpoint is not JSON", async () => {
    const fetchImpl = vi.fn(async () => {
      return {
        ok: false,
        status: 502,
        json: async () => {
          throw new SyntaxError("not JSON");
        },
      } as unknown as Response;
    });
    await expect(
      requestJson(
        "http://127.0.0.1:8080",
        "/api/health",
        undefined,
        fetchImpl,
      ),
    ).rejects.toThrow("/api/health returned a non-JSON response (502).");
  });
});
