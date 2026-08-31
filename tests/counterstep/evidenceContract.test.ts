import { describe, expect, it } from "vitest";

import {
  CLOSURE_QUALIFIER,
  assertClosureAvailable,
  assertDownloadedClosure,
  assertLocalProductionRehearsalHealth,
  assertLiveHealth,
  assertLiveRunEvidence,
  computeClosureDigest,
} from "../../scripts/evidence-contract.mjs";

function validLiveView() {
  const runId = "run-live-evidence";
  const event = (sequence: number, stateChange = false) => ({
    eventId: `event-live-${sequence}`,
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
      eventIds: events.map((item) => item.eventId),
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
      {
        status: "satisfied",
        evidenceEventIds: [events[1].eventId],
      },
      {
        status: "satisfied",
        evidenceEventIds: [events[3].eventId],
      },
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
      readResourceIds: ["sheet-live", "message-live"],
    },
    inspections: [
      { resourceId: "sheet-live" },
      { resourceId: "message-live" },
    ],
    events,
    approvedPlans: [{ planId: "plan-live" }],
    closure,
  };
}

describe("live and deployed evidence contract", () => {
  it("accepts eligible Gemini/ADK health and a digest-valid cited run", () => {
    expect(() =>
      assertLiveHealth({
        ok: true,
        deployment: "cloud-run",
        repository: "firestore",
        repositoryReachable: true,
        geminiConfigured: true,
        modelBackend: "vertex-ai",
        agentMode: "gemini",
        modelId: "gemini-3.5-flash-lite",
        agentFramework: "google-adk-typescript",
      }, { requireCloud: true }),
    ).not.toThrow();
    const view = validLiveView();
    expect(() => assertLiveRunEvidence(view)).not.toThrow();
    expect(() => assertDownloadedClosure(view, view.closure)).not.toThrow();
  });

  it("accepts only explicitly local Firestore rehearsal health", () => {
    const health = {
      ok: true,
      deployment: "local",
      repository: "firestore",
      repositoryReachable: true,
      geminiConfigured: true,
      modelBackend: "gemini-api",
      agentMode: "gemini",
      modelId: "gemini-3.5-flash-lite",
      agentFramework: "google-adk-typescript",
    };
    expect(() => assertLocalProductionRehearsalHealth(health)).not.toThrow();
    expect(() =>
      assertLocalProductionRehearsalHealth({
        ...health,
        deployment: "cloud-run",
      }),
    ).toThrow("must identify as local");
    expect(() =>
      assertLocalProductionRehearsalHealth({
        ...health,
        repository: "memory",
      }),
    ).toThrow("reachable Firestore persistence");
  });

  it("rejects drifted closure content and non-Gemini provenance", () => {
    const view = validLiveView();
    view.closure.goalResults[0].evidenceEventIds = ["invented-event"];
    expect(() => assertLiveRunEvidence(view)).toThrow();
    const wrongProvenance = validLiveView();
    wrongProvenance.run.generationSource = "deterministic_fixture";
    expect(() => assertLiveRunEvidence(wrongProvenance)).toThrow(
      "Run provenance is not Gemini",
    );
  });

  it("reports a fail-closed terminal run before attempting receipt download", () => {
    expect(() =>
      assertClosureAvailable({
        run: {
          runId: "run-no-closure",
          status: "failed",
          terminalReasonCode: "agent_stopped_without_closure",
          writeCount: 0,
        },
        closure: undefined,
      }),
    ).toThrow(
      "Live run run-no-closure ended failed without a closure (agent_stopped_without_closure); writes=0.",
    );
  });
});
