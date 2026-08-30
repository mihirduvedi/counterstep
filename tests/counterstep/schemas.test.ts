import { describe, expect, it } from "vitest";

import {
  RecoveryPlanSchema,
  SandboxResourceSchema,
} from "../../src/counterstep/schemas.js";

describe("Counterstep strict schemas", () => {
  it("rejects unknown resource fields", () => {
    const parsed = SandboxResourceSchema.safeParse({
      schemaVersion: "counterstep.resource.v1",
      demoId: "demo-1",
      resourceId: "sheet-1",
      kind: "spreadsheet",
      version: 3,
      boundary: "external",
      accessState: "externally_shared",
      dataCategories: ["customer_email"],
      recordCount: 120,
      sourceActionKey: "export-1",
      updatedAt: "2026-08-29T18:00:00.000Z",
      rawRows: [{ email: "must-not-cross-the-boundary@example.test" }],
    });
    expect(parsed.success).toBe(false);
  });

  it("requires final deterministic verification", () => {
    const parsed = RecoveryPlanSchema.safeParse({
      schemaVersion: "counterstep.recovery-plan.v1",
      planId: "plan-1",
      runId: "run-1",
      sourceReceiptDigest: "a".repeat(64),
      rationaleSummary: "Revoke the exposed spreadsheet.",
      steps: [
        {
          stepId: "step-1",
          tool: "revoke_external_access",
          resourceId: "sheet-1",
          expectedVersion: 3,
          incidentIds: ["incident-1"],
          findingIds: ["finding-1"],
          eventIds: ["event-1"],
          intendedPostcondition: "Access is revoked.",
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});
