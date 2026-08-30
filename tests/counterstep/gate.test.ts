import { describe, expect, it } from "vitest";

import { buildFixtureRecoveryPlan } from "../../src/counterstep/fixturePlanner.js";
import { evaluateRecoveryPlan } from "../../src/counterstep/gate.js";
import {
  createInitialResources,
  createRemediationAuthority,
  getSourceIncidentContext,
} from "../../src/counterstep/incident.js";
import { digestObject } from "../../src/counterstep/digest.js";
import {
  InspectionRecordSchema,
  PlanDecisionSchema,
  RemediationRunSchema,
  SandboxResourceSchema,
} from "../../src/counterstep/schemas.js";

describe("deterministic recovery plan gate", () => {
  it("approves the exact inspected and cited fixture plan", async () => {
    const source = await getSourceIncidentContext();
    const runId = "run-gate-1";
    const issuedAt = "2026-08-29T18:00:00.000Z";
    const authority = createRemediationAuthority({
      runId,
      sourceReceiptDigest: source.sourceReceiptDigest,
      issuedAt,
      expiresAt: "2026-08-29T18:15:00.000Z",
    });
    const run = RemediationRunSchema.parse({
      schemaVersion: "counterstep.remediation-run.v1",
      runId,
      demoId: "demo-gate-1",
      sourceReceiptDigest: source.sourceReceiptDigest,
      status: "planning",
      generationSource: "deterministic_fixture",
      modelId: "gemini-3.5-flash-lite",
      agentFramework: "google-adk-typescript",
      authorityId: authority.authorityId,
      closureGoals: source.closureGoals,
      toolCallCount: 2,
      writeCount: 0,
      replanCount: 0,
      startedAt: issuedAt,
    });
    const resources = createInitialResources(run.demoId, issuedAt);
    const inspections = resources.map((resource, index) =>
      InspectionRecordSchema.parse({
        runId,
        resourceId: resource.resourceId,
        snapshot: resource,
        stateDigest: digestObject(resource),
        inspectedAt: issuedAt,
        eventId: `event-inspection-${index + 1}`,
      }),
    );
    const plan = buildFixtureRecoveryPlan({
      runId,
      planId: "plan-gate-1",
      sourceReceiptDigest: source.sourceReceiptDigest,
      incidents: source.incidents,
      inspections,
    });
    const decision = evaluateRecoveryPlan({
      candidate: plan,
      run,
      authority,
      incidents: source.incidents,
      inspections,
      decidedAt: "2026-08-29T18:01:00.000Z",
    });
    expect(decision.status).toBe("approved");
  });

  it("rejects fabricated citations before any write", async () => {
    const source = await getSourceIncidentContext();
    const runId = "run-gate-2";
    const issuedAt = "2026-08-29T18:00:00.000Z";
    const authority = createRemediationAuthority({
      runId,
      sourceReceiptDigest: source.sourceReceiptDigest,
      issuedAt,
      expiresAt: "2026-08-29T18:15:00.000Z",
    });
    const run = RemediationRunSchema.parse({
      schemaVersion: "counterstep.remediation-run.v1",
      runId,
      demoId: "demo-gate-2",
      sourceReceiptDigest: source.sourceReceiptDigest,
      status: "planning",
      generationSource: "deterministic_fixture",
      modelId: "gemini-3.5-flash-lite",
      agentFramework: "google-adk-typescript",
      authorityId: authority.authorityId,
      closureGoals: source.closureGoals,
      toolCallCount: 2,
      writeCount: 0,
      replanCount: 0,
      startedAt: issuedAt,
    });
    const resources = createInitialResources(run.demoId, issuedAt);
    const inspections = resources.map((resource, index) =>
      InspectionRecordSchema.parse({
        runId,
        resourceId: resource.resourceId,
        snapshot: resource,
        stateDigest: digestObject(resource),
        inspectedAt: issuedAt,
        eventId: `event-inspection-${index + 1}`,
      }),
    );
    const plan = buildFixtureRecoveryPlan({
      runId,
      planId: "plan-gate-2",
      sourceReceiptDigest: source.sourceReceiptDigest,
      incidents: source.incidents,
      inspections,
    });
    const tampered = structuredClone(plan);
    const writeStep = tampered.steps.find(
      (step) => step.tool === "revoke_external_access",
    );
    if (!writeStep || writeStep.tool === "verify_closure") {
      throw new Error("Expected spreadsheet write step.");
    }
    writeStep.eventIds = ["evt-fabricated"];
    const decision = evaluateRecoveryPlan({
      candidate: tampered,
      run,
      authority,
      incidents: source.incidents,
      inspections,
      decidedAt: "2026-08-29T18:01:00.000Z",
    });
    expect(decision.status).toBe("rejected");
    if (decision.status === "approved") throw new Error("Expected rejection.");
    expect(decision.reasonCodes).toContain("unknown_event");
  });

  it("admits one stale replacement plan against fresh inspections and remaining budgets", async () => {
    const source = await getSourceIncidentContext();
    const runId = "run-gate-replan";
    const issuedAt = "2026-08-29T18:00:00.000Z";
    const authority = createRemediationAuthority({
      runId,
      sourceReceiptDigest: source.sourceReceiptDigest,
      issuedAt,
      expiresAt: "2026-08-29T18:15:00.000Z",
    });
    const initialResources = createInitialResources("demo-gate-replan", issuedAt);
    const initialInspections = initialResources.map((resource, index) =>
      InspectionRecordSchema.parse({
        runId,
        resourceId: resource.resourceId,
        snapshot: resource,
        stateDigest: digestObject(resource),
        inspectedAt: issuedAt,
        eventId: `event-replan-initial-${index + 1}`,
      }),
    );
    const initialPlan = buildFixtureRecoveryPlan({
      runId,
      planId: "plan-gate-original",
      sourceReceiptDigest: source.sourceReceiptDigest,
      incidents: source.incidents,
      inspections: initialInspections,
    });
    const existingDecision = PlanDecisionSchema.parse({
      status: "approved",
      plan: initialPlan,
      approvedStepIds: initialPlan.steps.map((step) => step.stepId),
      decidedAt: "2026-08-29T18:01:00.000Z",
    });
    const latestResources = initialResources.map((resource) =>
      resource.kind === "spreadsheet"
        ? SandboxResourceSchema.parse({
            ...resource,
            version: resource.version + 1,
            updatedAt: "2026-08-29T18:02:00.000Z",
          })
        : SandboxResourceSchema.parse({
            ...resource,
            deliveryState: "cancelled",
            version: resource.version + 1,
            updatedAt: "2026-08-29T18:02:00.000Z",
          }),
    );
    const latestInspections = latestResources.map((resource, index) =>
      InspectionRecordSchema.parse({
        runId,
        resourceId: resource.resourceId,
        snapshot: resource,
        stateDigest: digestObject(resource),
        inspectedAt: "2026-08-29T18:02:00.000Z",
        eventId: `event-replan-latest-${index + 1}`,
      }),
    );
    const run = RemediationRunSchema.parse({
      schemaVersion: "counterstep.remediation-run.v1",
      runId,
      demoId: "demo-gate-replan",
      sourceReceiptDigest: source.sourceReceiptDigest,
      status: "authorizing",
      generationSource: "deterministic_fixture",
      modelId: "gemini-3.5-flash-lite",
      agentFramework: "google-adk-typescript",
      authorityId: authority.authorityId,
      closureGoals: source.closureGoals,
      activePlanId: initialPlan.planId,
      toolCallCount: 8,
      writeCount: 1,
      replanCount: 0,
      startedAt: issuedAt,
      terminalReasonCode: "stale_revision",
    });
    const replacementPlan = buildFixtureRecoveryPlan({
      runId,
      planId: "plan-gate-replacement",
      sourceReceiptDigest: source.sourceReceiptDigest,
      incidents: source.incidents,
      inspections: [...initialInspections, ...latestInspections],
    });

    const approved = evaluateRecoveryPlan({
      candidate: replacementPlan,
      run,
      authority,
      incidents: source.incidents,
      inspections: [...initialInspections, ...latestInspections],
      existingDecision,
      decidedAt: "2026-08-29T18:03:00.000Z",
    });
    expect(approved.status).toBe("approved");

    const exhausted = evaluateRecoveryPlan({
      candidate: replacementPlan,
      run: RemediationRunSchema.parse({ ...run, replanCount: 1 }),
      authority,
      incidents: source.incidents,
      inspections: [...initialInspections, ...latestInspections],
      existingDecision,
      decidedAt: "2026-08-29T18:03:00.000Z",
    });
    expect(exhausted.status).toBe("rejected");
    if (exhausted.status === "approved") throw new Error("Expected rejection.");
    expect(exhausted.reasonCodes).toContain("replacement_plan_not_allowed");

    const noWriteBudget = evaluateRecoveryPlan({
      candidate: replacementPlan,
      run: RemediationRunSchema.parse({ ...run, writeCount: 2 }),
      authority,
      incidents: source.incidents,
      inspections: [...initialInspections, ...latestInspections],
      existingDecision,
      decidedAt: "2026-08-29T18:03:00.000Z",
    });
    expect(noWriteBudget.status).toBe("rejected");
    if (noWriteBudget.status === "approved") {
      throw new Error("Expected write-budget rejection.");
    }
    expect(noWriteBudget.reasonCodes).toContain("write_limit_exceeded");
  });
});
