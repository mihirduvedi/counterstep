import { describe, expect, it } from "vitest";

import { buildReceipt } from "../../src/core/receipt.js";
import {
  PolicyDecisionLedgerSchema,
  type PolicyDecisionLedger,
} from "../../src/core/policyLedger.js";
import {
  fixtureA,
  fixtureB,
  fixtureCIncomplete,
  otlpDemoAuthority,
  sharedAuthority,
} from "../../src/fixtures/index.js";
import { exactFixtureBytes } from "../../src/ui/receiptView.js";

function formattedBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

function entry(ledger: PolicyDecisionLedger, ruleId: string) {
  const result = ledger.entries.find((item) => item.ruleIds.includes(ruleId));
  if (!result) throw new Error(`Missing policy decision for ${ruleId}`);
  return result;
}

describe("policy decision ledger", () => {
  it("records every clear rule family for the expected run", async () => {
    const result = await buildReceipt({
      rawBytes: exactFixtureBytes(fixtureA),
      authority: sharedAuthority,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(PolicyDecisionLedgerSchema.safeParse(result.policyLedger).success).toBe(
      true,
    );
    expect(result.policyLedger).toMatchObject({
      traceId: fixtureA.traceId,
      policyId: sharedAuthority.policyId,
      verdict: "within_declared_authority",
      counts: {
        total: 9,
        deviations: 0,
        noFindings: 9,
        unableToAssess: 0,
        notActive: 0,
      },
    });
    expect(
      result.policyLedger.entries.map((item) => item.status),
    ).toEqual(Array.from({ length: 9 }, () => "no_finding"));
    expect(entry(result.policyLedger, "AR-VOLUME-001")).toMatchObject({
      status: "no_finding",
      policyPath: "maxRecordsRead",
      eventIds: ["evt-000001", "evt-000002"],
    });
  });

  it("shows fired and non-fired rules together for the overreaching run", async () => {
    const result = await buildReceipt({
      rawBytes: exactFixtureBytes(fixtureB),
      authority: sharedAuthority,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.policyLedger.counts).toEqual({
      total: 9,
      deviations: 6,
      noFindings: 3,
      unableToAssess: 0,
      notActive: 0,
    });
    for (const ruleId of [
      "AR-SYS-001",
      "AR-OP-001",
      "AR-EGRESS-001",
      "AR-DATA-001",
      "AR-APPROVAL-001",
      "AR-RETRY-001",
    ]) {
      const decision = entry(result.policyLedger, ruleId);
      expect(decision.status).toBe("deviation_found");
      expect(decision.findingIds.length).toBeGreaterThan(0);
      expect(decision.eventIds.length).toBeGreaterThan(0);
      expect(decision.rawPointers.length).toBeGreaterThan(0);
    }
    expect(entry(result.policyLedger, "AR-VOLUME-001").status).toBe(
      "no_finding",
    );
    expect(entry(result.policyLedger, "AR-ERROR-001").status).toBe(
      "no_finding",
    );
    expect(entry(result.policyLedger, "AR-TRACE-001").status).toBe(
      "no_finding",
    );
  });

  it("keeps inactive constraints separate from an explicit evidence refusal", async () => {
    const result = await buildReceipt({
      rawBytes: formattedBytes(fixtureCIncomplete),
      authority: otlpDemoAuthority,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.policyLedger.counts).toEqual({
      total: 9,
      deviations: 0,
      noFindings: 6,
      unableToAssess: 1,
      notActive: 2,
    });
    expect(entry(result.policyLedger, "AR-VOLUME-001").status).toBe(
      "not_active",
    );
    expect(entry(result.policyLedger, "AR-APPROVAL-001").status).toBe(
      "not_active",
    );

    const traceDecision = result.policyLedger.entries.find(
      (item) => item.title === "Trace sufficiency",
    );
    expect(traceDecision).toBeDefined();
    if (!traceDecision) return;
    expect(traceDecision.status).toBe("unable_to_assess");
    expect(traceDecision.findingIds).toHaveLength(2);
    expect(traceDecision.rawPointers).toContain(
      "resourceSpans[0].scopeSpans[0].spans[1]",
    );
    expect(traceDecision.summary).toContain("supplied evidence");
    expect(entry(result.policyLedger, "AR-SYS-001").summary).toContain(
      "1 explicit system was evaluated",
    );
    expect(entry(result.policyLedger, "AR-OP-001").summary).toContain(
      "1 event was evaluated",
    );
  });

  it("rejects ledger count drift at its strict Zod contract", async () => {
    const result = await buildReceipt({
      rawBytes: exactFixtureBytes(fixtureA),
      authority: sharedAuthority,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const altered = structuredClone(result.policyLedger);
    altered.counts.noFindings = 8;
    const parsed = PolicyDecisionLedgerSchema.safeParse(altered);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues).toContainEqual(
      expect.objectContaining({ path: ["counts", "noFindings"] }),
    );
  });
});
