import { describe, expect, it } from "vitest";

import {
  buildRecoveryPlanExport,
  RECOVERY_PLAN_QUALIFIER,
  RecoveryPlanExportSchema,
  serializeRecoveryPlan,
} from "../../src/core/recoveryPlan.js";
import {
  buildReceipt,
  withReviewerDisposition,
} from "../../src/core/receipt.js";
import { fixtureA, fixtureB, sharedAuthority } from "../../src/fixtures/index.js";
import {
  buildManagerIncidentBrief,
  buildRecoveryPlan,
  exactFixtureBytes,
} from "../../src/ui/receiptView.js";

const FIXED_NOW = "2026-08-28T15:00:00.000Z";

async function receiptFor(trace: typeof fixtureA | typeof fixtureB) {
  const result = await buildReceipt(
    {
      rawBytes: exactFixtureBytes(trace),
      authority: sharedAuthority,
    },
    { now: () => FIXED_NOW },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.receipt;
}

function recoveryInput(receipt: Awaited<ReturnType<typeof receiptFor>>) {
  const incidents = buildManagerIncidentBrief(receipt);
  return {
    receipt,
    incidents,
    actions: buildRecoveryPlan(receipt, incidents),
  };
}

describe("recovery plan export", () => {
  it("binds the overreaching plan to a validated receipt with closed citations", async () => {
    const receipt = await receiptFor(fixtureB);
    const plan = await buildRecoveryPlanExport(recoveryInput(receipt));

    expect(RecoveryPlanExportSchema.safeParse(plan).success).toBe(true);
    expect(plan.schemaVersion).toBe("agent-receipt.recovery-plan.v1");
    expect(plan.qualifier).toBe(RECOVERY_PLAN_QUALIFIER);
    expect(plan.sourceReceipt).toMatchObject({
      digestAlgorithm: "SHA-256",
      traceId: fixtureB.traceId,
      inputSha256: receipt.integrity.sha256,
      policyId: sharedAuthority.policyId,
      verdict: "material_deviations_found",
      reviewerDisposition: "unreviewed",
    });
    expect(plan.sourceReceipt.receiptDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.executionBoundary).toEqual({
      status: "not_executed",
      currentExternalState: "unknown",
      executionAuthority: "not_granted",
      approval: "required",
      note: "Re-probe current state, verify rollback and idempotency, and obtain approval for an exact change before any external action.",
    });
    expect(plan.incidents).toHaveLength(2);
    expect(plan.actions).toHaveLength(6);
    expect(plan.evidence.events).toHaveLength(3);
    expect(plan.evidence.findings).toHaveLength(12);
    expect(
      new Set(plan.incidents.flatMap((incident) => incident.findingIds)),
    ).toEqual(new Set(plan.evidence.findings.map((finding) => finding.findingId)));
  });

  it("serializes byte-identically for the same receipt and derived plan", async () => {
    const receipt = await receiptFor(fixtureB);
    const input = recoveryInput(receipt);

    expect(await serializeRecoveryPlan(input)).toBe(
      await serializeRecoveryPlan(input),
    );
  });

  it("changes the receipt binding when the reviewer disposition changes", async () => {
    const receipt = await receiptFor(fixtureB);
    const accepted = withReviewerDisposition(receipt, "accepted");

    const originalPlan = await buildRecoveryPlanExport(recoveryInput(receipt));
    const acceptedPlan = await buildRecoveryPlanExport(recoveryInput(accepted));

    expect(acceptedPlan.sourceReceipt.reviewerDisposition).toBe("accepted");
    expect(acceptedPlan.sourceReceipt.receiptDigest).not.toBe(
      originalPlan.sourceReceipt.receiptDigest,
    );
  });

  it("exports an explicit empty plan when the receipt has no findings", async () => {
    const receipt = await receiptFor(fixtureA);
    const plan = await buildRecoveryPlanExport(recoveryInput(receipt));

    expect(plan.incidents).toEqual([]);
    expect(plan.actions).toEqual([]);
    expect(plan.evidence).toEqual({ events: [], findings: [] });
    expect(plan.executionBoundary.status).toBe("not_executed");
  });

  it("rejects recovery actions with invented evidence citations", async () => {
    const receipt = await receiptFor(fixtureB);
    const input = recoveryInput(receipt);
    const actions = structuredClone(input.actions);
    actions[0].eventIds = ["evt-invented"];

    await expect(
      buildRecoveryPlanExport({ ...input, actions }),
    ).rejects.toThrow();
  });

  it("does not copy retained raw input fields into the recovery export", async () => {
    const trace = structuredClone(fixtureB);
    const rawOnlySecret = "raw-only-secret-that-must-not-leave-the-trace";
    trace.events[3].input = { token: rawOnlySecret };
    const receipt = await receiptFor(trace);

    const serialized = await serializeRecoveryPlan(recoveryInput(receipt));

    expect(serialized).not.toContain(rawOnlySecret);
    expect(serialized).not.toContain('"input"');
    expect(serialized).not.toContain('"output"');
  });
});
