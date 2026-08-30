import { describe, expect, it } from "vitest";

import { runHackathonEvaluation } from "../../src/evaluation/hackathonEvaluation.js";

describe("judge-facing automated evaluation", () => {
  it("meets the declared deterministic corpus and adversarial checks", async () => {
    const result = await runHackathonEvaluation();

    expect(result).toEqual({
      methodology: "automated_synthetic_corpus",
      corpus: {
        cases: 5,
        verdictCasesPassed: 5,
        rawRecords: 25,
        accountedRawRecords: 25,
        canonicalEvents: 22,
        nativeCases: 2,
        otlpCases: 2,
        genericCases: 1,
      },
      seededPolicyRules: {
        expected: [
          "AR-SYS-001",
          "AR-OP-001",
          "AR-EGRESS-001",
          "AR-DATA-001",
          "AR-APPROVAL-001",
          "AR-RETRY-001",
        ],
        detected: [
          "AR-SYS-001",
          "AR-OP-001",
          "AR-EGRESS-001",
          "AR-DATA-001",
          "AR-APPROVAL-001",
          "AR-RETRY-001",
        ],
        passed: 6,
      },
      policyDecisionLedger: {
        cases: 5,
        decisions: 45,
        deviations: 6,
        noFindings: 31,
        unableToAssess: 1,
        notActive: 7,
        expectedRunRecordedEveryRule: true,
        overreachingRunShowsFiredAndNonFired: true,
        incompleteRunSeparatesUnknownFromInactive: true,
      },
      trustChecks: {
        knownDigestCasesPassed: 2,
        deterministicReplayPassed: true,
        receiptSchemaCasesPassed: 5,
        generatedItemsWithValidCitations: 24,
        invalidCitationRejected: true,
        invalidGraniteSelectionFellBack: true,
        materialUnparsedSpanForcedIncompleteVerdict: true,
        genericMappedExamplePassed: true,
      },
      recoveryPlan: {
        incidents: 2,
        proposedActions: 6,
        citedEvents: 3,
        citedFindings: 12,
        receiptDigestBound: true,
        deterministicReplayPassed: true,
        executionBoundaryClosed: true,
      },
      evidencePacket: {
        artifactCount: 3,
        manifestDigestsValid: true,
        embeddedReceiptReplayPassed: true,
        recoveryBindingPassed: true,
        deterministicReplayPassed: true,
        alteredFindingDetected: true,
      },
    });
  });
});
