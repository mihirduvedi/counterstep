import { buildFactBundle } from "../ai/factBundle";
import { generateReceiptCopy } from "../ai/generateReceiptCopy";
import { validateClaims } from "../ai/validateClaims";
import {
  buildReceipt,
  serializeReceipt,
  type BuildReceiptResult,
} from "../core/receipt";
import { sha256HexPortable } from "../core/portableDigest";
import { runPolicyEngine } from "../core/policyEngine";
import type { PolicyDecisionLedger } from "../core/policyLedger";
import {
  serializeEvidencePacket,
  verifyEvidencePacket,
} from "../core/evidencePacket";
import {
  buildRecoveryPlanExport,
  serializeRecoveryPlan,
} from "../core/recoveryPlan";
import type { ReceiptResult, Verdict } from "../core/schemas/index";
import {
  fixtureA,
  fixtureB,
  fixtureCIncomplete,
  otlpDemoAuthority,
  otlpGenAiFixture,
  sharedAuthority,
} from "../fixtures";
import {
  buildManagerIncidentBrief,
  buildRecoveryPlan,
  exactFixtureBytes,
} from "../ui/receiptView";
import genericReleaseLog from "../../examples/codex-policy-ledger-release-generic-log.json";
import genericReleaseMapping from "../../examples/codex-policy-ledger-release-generic-mapping.json";
import type { AuthorityEnvelopeV1 } from "../core/schemas/index";

const EVALUATION_TIME = "2026-08-27T23:00:00.000Z";

const releaseAuthority: AuthorityEnvelopeV1 = {
  schemaVersion: "agent-receipt.authority.v1",
  policyId: "policy-codex-release-001",
  task: "Inspect and improve Agent Receipt, verify the exact candidate, then commit, push, and deploy only after explicit human approval.",
  permittedSystems: [
    { systemId: "local-workspace", boundary: "local" },
    { systemId: "local-shell", boundary: "local" },
    { systemId: "git-local", boundary: "local" },
    { systemId: "github", boundary: "external" },
    { systemId: "github-actions", boundary: "external" },
    { systemId: "vercel", boundary: "external" },
  ],
  permittedOperations: [
    "read",
    "retrieve",
    "create",
    "update",
    "send",
    "execute",
    "approve",
  ],
  prohibitedDataCategories: [],
  externalEgressAllowed: true,
  approvalRequiredFor: ["send"],
};

type EvaluationCase = {
  name: string;
  receipt: ReceiptResult;
  expectedVerdict: Verdict;
};

export type HackathonEvaluationResult = {
  methodology: "automated_synthetic_corpus";
  corpus: {
    cases: number;
    verdictCasesPassed: number;
    rawRecords: number;
    accountedRawRecords: number;
    canonicalEvents: number;
    nativeCases: number;
    otlpCases: number;
    genericCases: number;
  };
  seededPolicyRules: {
    expected: string[];
    detected: string[];
    passed: number;
  };
  policyDecisionLedger: {
    cases: number;
    decisions: number;
    deviations: number;
    noFindings: number;
    unableToAssess: number;
    notActive: number;
    expectedRunRecordedEveryRule: boolean;
    overreachingRunShowsFiredAndNonFired: boolean;
    incompleteRunSeparatesUnknownFromInactive: boolean;
  };
  trustChecks: {
    knownDigestCasesPassed: number;
    deterministicReplayPassed: boolean;
    receiptSchemaCasesPassed: number;
    generatedItemsWithValidCitations: number;
    invalidCitationRejected: boolean;
    invalidGraniteSelectionFellBack: boolean;
    materialUnparsedSpanForcedIncompleteVerdict: boolean;
    genericMappedExamplePassed: boolean;
  };
  recoveryPlan: {
    incidents: number;
    proposedActions: number;
    citedEvents: number;
    citedFindings: number;
    receiptDigestBound: boolean;
    deterministicReplayPassed: boolean;
    executionBoundaryClosed: boolean;
  };
  evidencePacket: {
    artifactCount: number;
    manifestDigestsValid: boolean;
    embeddedReceiptReplayPassed: boolean;
    recoveryBindingPassed: boolean;
    deterministicReplayPassed: boolean;
    alteredFindingDetected: boolean;
  };
};

export async function runHackathonEvaluation(): Promise<HackathonEvaluationResult> {
  const nativeA = await requireReceipt(
    buildReceipt(
      { rawBytes: exactFixtureBytes(fixtureA), authority: sharedAuthority },
      { now: () => EVALUATION_TIME },
    ),
  );
  const nativeB = await requireReceipt(
    buildReceipt(
      { rawBytes: exactFixtureBytes(fixtureB), authority: sharedAuthority },
      { now: () => EVALUATION_TIME },
    ),
  );
  const otlp = await requireReceipt(
    buildReceipt(
      {
        rawBytes: formattedBytes(otlpGenAiFixture),
        authority: otlpDemoAuthority,
      },
      { now: () => EVALUATION_TIME },
    ),
  );
  const incompleteReceipt = await requireReceipt(
    buildReceipt(
      {
        rawBytes: formattedBytes(fixtureCIncomplete),
        authority: otlpDemoAuthority,
      },
      { now: () => EVALUATION_TIME },
    ),
  );
  const genericReceipt = await requireReceipt(
    buildReceipt(
      {
        rawBytes: formattedBytes(genericReleaseLog),
        authority: releaseAuthority,
        genericJsonMapping: genericReleaseMapping,
      },
      { now: () => EVALUATION_TIME },
    ),
  );

  const cases: EvaluationCase[] = [
    {
      name: "native expected run",
      receipt: nativeA,
      expectedVerdict: "within_declared_authority",
    },
    {
      name: "native overreaching run",
      receipt: nativeB,
      expectedVerdict: "material_deviations_found",
    },
    {
      name: "narrow OTLP GenAI export",
      receipt: otlp,
      expectedVerdict: "within_declared_authority",
    },
    {
      name: "incomplete OTLP evidence",
      receipt: incompleteReceipt,
      expectedVerdict: "unable_to_assess_fully",
    },
    {
      name: "explicitly mapped generic JSON release log",
      receipt: genericReceipt,
      expectedVerdict: "within_declared_authority",
    },
  ];

  const expectedRuleIds = [
    "AR-SYS-001",
    "AR-OP-001",
    "AR-EGRESS-001",
    "AR-DATA-001",
    "AR-APPROVAL-001",
    "AR-RETRY-001",
  ];
  const detectedRuleIds = unique(
    nativeB.findings.map((finding) => finding.ruleId),
  ).filter((ruleId) => expectedRuleIds.includes(ruleId));
  const ledgers = cases.map((item) => policyLedgerFor(item.receipt));
  const expectedLedger = ledgers[0];
  const overreachingLedger = ledgers[1];
  const incompleteLedger = ledgers[3];

  const replay = await requireReceipt(
    buildReceipt(
      { rawBytes: exactFixtureBytes(fixtureB), authority: sharedAuthority },
      { now: () => EVALUATION_TIME },
    ),
  );

  const bundle = buildFactBundle({
    events: nativeB.events,
    findings: nativeB.findings,
    accounting: nativeB.accounting,
    verdict: nativeB.verdict,
    authority: nativeB.authority,
    hasAssessmentLimitation: nativeB.findings.some(
      (finding) => finding.ruleId === "AR-TRACE-001",
    ),
    coverage: nativeB.coverage,
  });
  const invalidCopy = structuredClone(nativeB.copy);
  invalidCopy.headline.eventIds = ["evt-invented"];
  const invalidCitationRejected = !validateClaims(invalidCopy, bundle).valid;

  const invalidSelection = await generateReceiptCopy(bundle, {
    callGranite: async () => ({
      ok: true,
      text: JSON.stringify({ notableFindingIds: ["finding-invented"] }),
      modelId: "ibm/evaluation-double",
      apiVersion: "2025-10-25",
    }),
  });

  const incidents = buildManagerIncidentBrief(nativeB);
  const recoveryInput = {
    receipt: nativeB,
    incidents,
    actions: buildRecoveryPlan(nativeB, incidents),
  };
  const recoveryPlan = await buildRecoveryPlanExport(recoveryInput);
  const expectedReceiptDigest = await sha256HexPortable(
    new TextEncoder().encode(serializeReceipt(nativeB)),
  );
  const serializedPacket = await serializeEvidencePacket(recoveryInput);
  const packetReport = await verifyEvidencePacket(
    new TextEncoder().encode(serializedPacket),
  );
  const alteredPacket = JSON.parse(serializedPacket) as {
    receipt: { findings: Array<{ description: string }> };
  };
  if (!alteredPacket.receipt.findings[0]) {
    throw new Error("Evaluation packet has no finding to alter.");
  }
  alteredPacket.receipt.findings[0].description =
    "This deterministic finding was altered after packet assembly.";
  const alteredPacketReport = await verifyEvidencePacket(
    new TextEncoder().encode(JSON.stringify(alteredPacket, null, 2)),
  );
  const packetGatePassed = (id: "artifact_manifest" | "embedded_receipt_replay" | "recovery_plan_binding") =>
    packetReport.gates.find((gate) => gate.id === id)?.status === "passed";

  return {
    methodology: "automated_synthetic_corpus",
    corpus: {
      cases: cases.length,
      verdictCasesPassed: cases.filter(
        (item) => item.receipt.verdict === item.expectedVerdict,
      ).length,
      rawRecords: sum(cases.map((item) => item.receipt.coverage.rawEvents)),
      accountedRawRecords: sum(
        cases.map((item) => item.receipt.coverage.accountedRawEvents),
      ),
      canonicalEvents: sum(
        cases.map((item) => item.receipt.coverage.canonicalEvents),
      ),
      nativeCases: cases.filter(
        (item) =>
          item.receipt.integrity.inputFormat ===
          "agent-receipt.native-trace.v1",
      ).length,
      otlpCases: cases.filter(
        (item) =>
          item.receipt.integrity.inputFormat ===
          "otlp-json-resource-spans.v1",
      ).length,
      genericCases: cases.filter(
        (item) =>
          item.receipt.integrity.inputFormat === "generic-json-records.v1",
      ).length,
    },
    seededPolicyRules: {
      expected: expectedRuleIds,
      detected: detectedRuleIds,
      passed: expectedRuleIds.filter((ruleId) => detectedRuleIds.includes(ruleId))
        .length,
    },
    policyDecisionLedger: {
      cases: ledgers.length,
      decisions: sum(ledgers.map((ledger) => ledger.counts.total)),
      deviations: sum(ledgers.map((ledger) => ledger.counts.deviations)),
      noFindings: sum(ledgers.map((ledger) => ledger.counts.noFindings)),
      unableToAssess: sum(
        ledgers.map((ledger) => ledger.counts.unableToAssess),
      ),
      notActive: sum(ledgers.map((ledger) => ledger.counts.notActive)),
      expectedRunRecordedEveryRule:
        expectedLedger?.counts.total === 9 &&
        expectedLedger.counts.noFindings === 9,
      overreachingRunShowsFiredAndNonFired:
        overreachingLedger?.counts.deviations === 6 &&
        overreachingLedger.counts.noFindings === 3,
      incompleteRunSeparatesUnknownFromInactive:
        incompleteLedger?.counts.unableToAssess === 1 &&
        incompleteLedger.counts.notActive === 2,
    },
    trustChecks: {
      knownDigestCasesPassed: [
        nativeA.integrity.sha256 ===
          "270901ead9e358c7f8c360d65c0cf59c82861180cd867f7ea51132ee371e8b9e",
        nativeB.integrity.sha256 ===
          "19d64c62de2f63509741ff0c96e4394e35ce5fdb869e5dfc3d7f8d744f527926",
      ].filter(Boolean).length,
      deterministicReplayPassed:
        serializeReceipt(nativeB) === serializeReceipt(replay),
      receiptSchemaCasesPassed: cases.length,
      generatedItemsWithValidCitations: cases.reduce(
        (total, item) =>
          total +
          2 +
          item.receipt.copy.notableActions.length +
          item.receipt.copy.limitations.length,
        0,
      ),
      invalidCitationRejected,
      invalidGraniteSelectionFellBack:
        invalidSelection.generationSource === "deterministic_fallback",
      materialUnparsedSpanForcedIncompleteVerdict:
        incompleteReceipt.verdict === "unable_to_assess_fully" &&
        incompleteReceipt.coverage.unparsed === 1,
      genericMappedExamplePassed:
        genericReceipt.verdict === "within_declared_authority" &&
        genericReceipt.coverage.rawEvents === 10 &&
        genericReceipt.coverage.mapped === 10 &&
        genericReceipt.integrity.genericJsonMapping !== undefined,
    },
    recoveryPlan: {
      incidents: recoveryPlan.incidents.length,
      proposedActions: recoveryPlan.actions.length,
      citedEvents: recoveryPlan.evidence.events.length,
      citedFindings: recoveryPlan.evidence.findings.length,
      receiptDigestBound:
        recoveryPlan.sourceReceipt.receiptDigest === expectedReceiptDigest,
      deterministicReplayPassed:
        (await serializeRecoveryPlan(recoveryInput)) ===
        (await serializeRecoveryPlan(recoveryInput)),
      executionBoundaryClosed:
        recoveryPlan.executionBoundary.status === "not_executed" &&
        recoveryPlan.executionBoundary.currentExternalState === "unknown" &&
        recoveryPlan.executionBoundary.executionAuthority === "not_granted" &&
        recoveryPlan.executionBoundary.approval === "required",
    },
    evidencePacket: {
      artifactCount: packetReport.summary?.artifactCount ?? 0,
      manifestDigestsValid: packetGatePassed("artifact_manifest"),
      embeddedReceiptReplayPassed: packetGatePassed("embedded_receipt_replay"),
      recoveryBindingPassed: packetGatePassed("recovery_plan_binding"),
      deterministicReplayPassed:
        serializedPacket === await serializeEvidencePacket(recoveryInput),
      alteredFindingDetected:
        alteredPacketReport.status === "inconsistent" &&
        alteredPacketReport.gates.find(
          (gate) => gate.id === "artifact_manifest",
        )?.status === "failed" &&
        alteredPacketReport.gates.find(
          (gate) => gate.id === "embedded_receipt_replay",
        )?.status === "failed",
    },
};

}

function policyLedgerFor(receipt: ReceiptResult): PolicyDecisionLedger {
  return runPolicyEngine({
    events: receipt.events,
    accounting: receipt.accounting,
    authority: receipt.authority,
    traceCompletionStatus: receipt.run.status,
  }).policyLedger;
}

async function requireReceipt(
  result: Promise<BuildReceiptResult>,
): Promise<ReceiptResult> {
  const resolved = await result;
  if (!resolved.ok) {
    throw new Error(
      `Evaluation receipt failed: ${resolved.error.code} ${resolved.error.message}`,
    );
  }
  return resolved.receipt;
}

function formattedBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
