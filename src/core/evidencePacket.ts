import { z } from "zod";

import { formatCoverageSummary } from "./coverage";
import { sha256HexPortable } from "./portableDigest";
import {
  buildRecoveryPlanExport,
  RECOVERY_PLAN_SCHEMA_VERSION,
  RecoveryIncidentSchema,
  RecoveryPlanExportSchema,
} from "./recoveryPlan";
import type {
  BuildRecoveryPlanExportInput,
  RecoveryAction,
  RecoveryIncident,
  RecoveryPlanExport,
} from "./recoveryPlan";
import {
  CoverageSummarySchema,
  NonBlankStringSchema,
  RECEIPT_SCHEMA_VERSION,
  ReceiptResultSchema,
  ReviewDispositionSchema,
  Rfc3339Schema,
  VerdictSchema,
} from "./schemas/index";
import type { ReceiptResult } from "./schemas/index";
import {
  verifyReceipt,
} from "./verifyReceipt";
import type {
  ReceiptVerificationGate,
  ReceiptVerificationGateId,
  ReceiptVerificationReport,
  ReceiptVerificationStatus,
} from "./verifyReceipt";

export const EVIDENCE_PACKET_SCHEMA_VERSION =
  "agent-receipt.evidence-packet.v1" as const;
export const DECISION_BRIEF_SCHEMA_VERSION =
  "agent-receipt.decision-brief.v1" as const;
export const MAX_EVIDENCE_PACKET_BYTES = 4 * 1024 * 1024;

export const EVIDENCE_PACKET_QUALIFIER =
  "Based only on the supplied trace and authority envelope. This packet records a post-run assessment; it does not authenticate the exporter or prove that the trace was complete." as const;

export const EVIDENCE_PACKET_LIMITATIONS = [
  "The packet manifest proves internal consistency only; anyone who can rewrite the packet can also recompute its manifest.",
  "The packet does not authenticate the exporter or provide a digital signature, tamper-proof provenance, or nonrepudiation.",
  "The original trace bytes are not included, so the packet cannot prove that they match the input digest recorded in the receipt.",
  "The packet cannot establish that the supplied trace was complete or accurately captured.",
  "Recovery actions are proposals only; the packet contains no credentials, approval, execution command, or proof of current external state.",
] as const;

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const ArtifactIdSchema = z.enum([
  "receipt",
  "decision_brief",
  "recovery_plan",
]);
export type EvidencePacketArtifactId = z.infer<typeof ArtifactIdSchema>;

export const EvidencePacketArtifactSchema = z
  .object({
    artifactId: ArtifactIdSchema,
    schemaVersion: NonBlankStringSchema,
    mediaType: z.literal("application/json"),
    serialization: z.literal("UTF-8 JSON with two-space indentation"),
    byteLength: z.number().int().nonnegative().safe(),
    sha256: Sha256Schema,
  })
  .strict();
export type EvidencePacketArtifact = z.infer<
  typeof EvidencePacketArtifactSchema
>;

export const DecisionBriefSchema = z
  .object({
    schemaVersion: z.literal(DECISION_BRIEF_SCHEMA_VERSION),
    qualifier: z.literal(EVIDENCE_PACKET_QUALIFIER),
    traceId: NonBlankStringSchema,
    requestedTask: NonBlankStringSchema,
    verdict: VerdictSchema,
    verdictLabel: NonBlankStringSchema,
    verdictQualifier: NonBlankStringSchema,
    reviewerDisposition: ReviewDispositionSchema,
    coverage: CoverageSummarySchema,
    coverageSummary: NonBlankStringSchema,
    findingCount: z.number().int().nonnegative().safe(),
    incidentCount: z.number().int().nonnegative().safe(),
    proposedActionCount: z.number().int().nonnegative().safe(),
    generationSource: z.enum(["granite", "deterministic_fallback"]),
    incidents: z.array(RecoveryIncidentSchema),
  })
  .strict()
  .superRefine((brief, context) => {
    if (brief.findingCount !== brief.incidents.reduce(
      (total, incident) => total + incident.findingCount,
      0,
    )) {
      context.addIssue({
        code: "custom",
        path: ["findingCount"],
        message: "findingCount must equal the findings grouped into incidents.",
      });
    }
    if (brief.incidentCount !== brief.incidents.length) {
      context.addIssue({
        code: "custom",
        path: ["incidentCount"],
        message: "incidentCount must equal the number of incidents.",
      });
    }
  });
export type DecisionBrief = z.infer<typeof DecisionBriefSchema>;

const FixedLimitationsSchema = z.tuple([
  z.literal(EVIDENCE_PACKET_LIMITATIONS[0]),
  z.literal(EVIDENCE_PACKET_LIMITATIONS[1]),
  z.literal(EVIDENCE_PACKET_LIMITATIONS[2]),
  z.literal(EVIDENCE_PACKET_LIMITATIONS[3]),
  z.literal(EVIDENCE_PACKET_LIMITATIONS[4]),
]);

export const EvidencePacketSchema = z
  .object({
    schemaVersion: z.literal(EVIDENCE_PACKET_SCHEMA_VERSION),
    qualifier: z.literal(EVIDENCE_PACKET_QUALIFIER),
    assembledAt: Rfc3339Schema,
    sourceTrace: z
      .object({
        traceId: NonBlankStringSchema,
        digestAlgorithm: z.literal("SHA-256"),
        inputSha256: Sha256Schema,
        sourceBytes: z.number().int().nonnegative().safe(),
      })
      .strict(),
    manifest: z.array(EvidencePacketArtifactSchema).length(3),
    decisionBrief: DecisionBriefSchema,
    receipt: ReceiptResultSchema,
    recoveryPlan: RecoveryPlanExportSchema,
    limitations: FixedLimitationsSchema,
  })
  .strict()
  .superRefine((packet, context) => {
    const artifacts = new Map(
      packet.manifest.map((artifact) => [artifact.artifactId, artifact]),
    );
    if (artifacts.size !== packet.manifest.length) {
      context.addIssue({
        code: "custom",
        path: ["manifest"],
        message: "Manifest artifact IDs must be unique.",
      });
    }
    const expectedVersions: Record<EvidencePacketArtifactId, string> = {
      receipt: RECEIPT_SCHEMA_VERSION,
      decision_brief: DECISION_BRIEF_SCHEMA_VERSION,
      recovery_plan: RECOVERY_PLAN_SCHEMA_VERSION,
    };
    for (const [artifactId, schemaVersion] of Object.entries(
      expectedVersions,
    ) as Array<[EvidencePacketArtifactId, string]>) {
      const artifact = artifacts.get(artifactId);
      if (!artifact) {
        context.addIssue({
          code: "custom",
          path: ["manifest"],
          message: `Manifest is missing artifact "${artifactId}".`,
        });
      } else if (artifact.schemaVersion !== schemaVersion) {
        context.addIssue({
          code: "custom",
          path: ["manifest", artifactId, "schemaVersion"],
          message: `Manifest schemaVersion must be "${schemaVersion}".`,
        });
      }
    }

    const receipt = packet.receipt;
    const brief = packet.decisionBrief;
    const recovery = packet.recoveryPlan;
    const matchingFields: Array<[
      string,
      unknown,
      unknown,
    ]> = [
      ["assembledAt", packet.assembledAt, receipt.integrity.generatedAt],
      ["sourceTrace.traceId", packet.sourceTrace.traceId, receipt.run.traceId],
      ["sourceTrace.inputSha256", packet.sourceTrace.inputSha256, receipt.integrity.sha256],
      ["sourceTrace.sourceBytes", packet.sourceTrace.sourceBytes, receipt.integrity.byteLength],
      ["decisionBrief.traceId", brief.traceId, receipt.run.traceId],
      ["decisionBrief.requestedTask", brief.requestedTask, receipt.authority.task],
      ["decisionBrief.verdict", brief.verdict, receipt.verdict],
      ["decisionBrief.verdictLabel", brief.verdictLabel, receipt.verdictLabel],
      ["decisionBrief.verdictQualifier", brief.verdictQualifier, receipt.verdictQualifier],
      ["decisionBrief.reviewerDisposition", brief.reviewerDisposition, receipt.reviewerDisposition],
      ["decisionBrief.coverage", JSON.stringify(brief.coverage), JSON.stringify(receipt.coverage)],
      ["decisionBrief.findingCount", brief.findingCount, receipt.findings.length],
      ["decisionBrief.generationSource", brief.generationSource, receipt.integrity.generationSource],
      ["recoveryPlan.sourceReceipt.traceId", recovery.sourceReceipt.traceId, receipt.run.traceId],
      ["recoveryPlan.sourceReceipt.inputSha256", recovery.sourceReceipt.inputSha256, receipt.integrity.sha256],
      ["recoveryPlan.sourceReceipt.policyId", recovery.sourceReceipt.policyId, receipt.authority.policyId],
      ["recoveryPlan.sourceReceipt.verdict", recovery.sourceReceipt.verdict, receipt.verdict],
      ["recoveryPlan.sourceReceipt.reviewerDisposition", recovery.sourceReceipt.reviewerDisposition, receipt.reviewerDisposition],
      ["recoveryPlan.sourceReceipt.generatedAt", recovery.sourceReceipt.generatedAt, receipt.integrity.generatedAt],
      ["decisionBrief.incidents", JSON.stringify(brief.incidents), JSON.stringify(recovery.incidents)],
    ];
    for (const [path, actual, expected] of matchingFields) {
      if (actual !== expected) {
        context.addIssue({
          code: "custom",
          path: path.split("."),
          message: "Packet field must match the embedded receipt or recovery plan.",
        });
      }
    }
    if (brief.proposedActionCount !== recovery.actions.length) {
      context.addIssue({
        code: "custom",
        path: ["decisionBrief", "proposedActionCount"],
        message: "proposedActionCount must equal the recovery-plan action count.",
      });
    }
  });
export type EvidencePacket = z.infer<typeof EvidencePacketSchema>;

export type BuildEvidencePacketInput = BuildRecoveryPlanExportInput;

export async function buildEvidencePacket(
  input: BuildEvidencePacketInput,
): Promise<EvidencePacket> {
  const receipt = ReceiptResultSchema.parse(input.receipt);
  const incidents = input.incidents.map((incident) =>
    RecoveryIncidentSchema.parse(incident),
  );
  const recoveryPlan = await buildRecoveryPlanExport({
    receipt,
    incidents,
    actions: input.actions,
  });
  const decisionBrief = DecisionBriefSchema.parse({
    schemaVersion: DECISION_BRIEF_SCHEMA_VERSION,
    qualifier: EVIDENCE_PACKET_QUALIFIER,
    traceId: receipt.run.traceId,
    requestedTask: receipt.authority.task,
    verdict: receipt.verdict,
    verdictLabel: receipt.verdictLabel,
    verdictQualifier: receipt.verdictQualifier,
    reviewerDisposition: receipt.reviewerDisposition,
    coverage: receipt.coverage,
    coverageSummary: formatCoverageSummary(receipt.coverage),
    findingCount: receipt.findings.length,
    incidentCount: incidents.length,
    proposedActionCount: input.actions.length,
    generationSource: receipt.integrity.generationSource,
    incidents,
  });
  const artifactText = canonicalArtifactText(
    receipt,
    decisionBrief,
    recoveryPlan,
  );
  const manifest = await Promise.all(
    (["receipt", "decision_brief", "recovery_plan"] as const).map(
      async (artifactId) => {
        const text = artifactText[artifactId];
        const bytes = new TextEncoder().encode(text);
        const schemaVersion = artifactId === "receipt"
          ? RECEIPT_SCHEMA_VERSION
          : artifactId === "decision_brief"
            ? DECISION_BRIEF_SCHEMA_VERSION
            : RECOVERY_PLAN_SCHEMA_VERSION;
        return EvidencePacketArtifactSchema.parse({
          artifactId,
          schemaVersion,
          mediaType: "application/json",
          serialization: "UTF-8 JSON with two-space indentation",
          byteLength: bytes.byteLength,
          sha256: await sha256HexPortable(bytes),
        });
      },
    ),
  );

  return EvidencePacketSchema.parse({
    schemaVersion: EVIDENCE_PACKET_SCHEMA_VERSION,
    qualifier: EVIDENCE_PACKET_QUALIFIER,
    assembledAt: receipt.integrity.generatedAt,
    sourceTrace: {
      traceId: receipt.run.traceId,
      digestAlgorithm: "SHA-256",
      inputSha256: receipt.integrity.sha256,
      sourceBytes: receipt.integrity.byteLength,
    },
    manifest,
    decisionBrief,
    receipt,
    recoveryPlan,
    limitations: [...EVIDENCE_PACKET_LIMITATIONS],
  });
}

export async function serializeEvidencePacket(
  input: BuildEvidencePacketInput,
): Promise<string> {
  return JSON.stringify(await buildEvidencePacket(input), null, 2);
}

export async function verifyPortableArtifact(
  inputBytes: Uint8Array,
): Promise<ReceiptVerificationReport> {
  const exactBytes = Uint8Array.from(inputBytes);
  if (exactBytes.byteLength <= MAX_EVIDENCE_PACKET_BYTES) {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(exactBytes);
      const document = JSON.parse(text) as unknown;
      if (
        typeof document === "object" &&
        document !== null &&
        "schemaVersion" in document &&
        document.schemaVersion === EVIDENCE_PACKET_SCHEMA_VERSION
      ) {
        return verifyEvidencePacket(exactBytes);
      }
    } catch {
      // The receipt verifier reports the exact byte, UTF-8, or JSON failure.
    }
  }
  return verifyReceipt(exactBytes);
}

export async function verifyEvidencePacket(
  inputBytes: Uint8Array,
): Promise<ReceiptVerificationReport> {
  const exactBytes = Uint8Array.from(inputBytes);
  const gates: ReceiptVerificationGate[] = [];
  let fileSha256: string | null = null;

  try {
    fileSha256 = await sha256HexPortable(exactBytes);
    gates.push(pass(
      "exact_byte_digest",
      "SHA-256 was computed from the exact packet bytes before decoding or parsing.",
    ));
  } catch {
    gates.push(fail(
      "exact_byte_digest",
      "The browser could not compute a SHA-256 digest for this packet.",
    ));
    appendPacketNotRun(gates, [
      "size_limit",
      "utf8",
      "json",
      "packet_contract",
      "artifact_manifest",
      "embedded_receipt_replay",
      "recovery_plan_binding",
    ]);
    return packetReport("rejected", fileSha256, exactBytes.byteLength, gates);
  }

  if (exactBytes.byteLength > MAX_EVIDENCE_PACKET_BYTES) {
    gates.push(fail(
      "size_limit",
      `The evidence packet is larger than the 4 MiB limit (${MAX_EVIDENCE_PACKET_BYTES} bytes).`,
      [{ path: "$", message: `Received ${exactBytes.byteLength} bytes.` }],
    ));
    appendPacketNotRun(gates, [
      "utf8",
      "json",
      "packet_contract",
      "artifact_manifest",
      "embedded_receipt_replay",
      "recovery_plan_binding",
    ]);
    return packetReport("rejected", fileSha256, exactBytes.byteLength, gates);
  }
  gates.push(pass("size_limit", "The packet is within the 4 MiB input limit."));

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(exactBytes);
    gates.push(pass("utf8", "The exact packet bytes decode as UTF-8."));
  } catch {
    gates.push(fail("utf8", "The evidence packet must be encoded as UTF-8 JSON."));
    appendPacketNotRun(gates, [
      "json",
      "packet_contract",
      "artifact_manifest",
      "embedded_receipt_replay",
      "recovery_plan_binding",
    ]);
    return packetReport("rejected", fileSha256, exactBytes.byteLength, gates);
  }

  let document: unknown;
  try {
    document = JSON.parse(text) as unknown;
    gates.push(pass("json", "The decoded packet contains valid JSON."));
  } catch (error) {
    gates.push(fail(
      "json",
      "The decoded packet is not valid JSON.",
      [{
        path: "$",
        message: error instanceof SyntaxError ? error.message : "JSON parsing failed.",
      }],
    ));
    appendPacketNotRun(gates, [
      "packet_contract",
      "artifact_manifest",
      "embedded_receipt_replay",
      "recovery_plan_binding",
    ]);
    return packetReport("rejected", fileSha256, exactBytes.byteLength, gates);
  }

  const parsed = EvidencePacketSchema.safeParse(document);
  if (!parsed.success) {
    gates.push(fail(
      "packet_contract",
      "The file is not a valid Agent Receipt Evidence Packet or its cross-artifact references do not hold.",
      parsed.error.issues.slice(0, 12).map((issue) => ({
        path: zodPath(issue.path),
        message: issue.message,
      })),
    ));
    appendPacketNotRun(gates, [
      "artifact_manifest",
      "embedded_receipt_replay",
      "recovery_plan_binding",
    ]);
    return packetReport("rejected", fileSha256, exactBytes.byteLength, gates);
  }
  const packet = parsed.data;
  gates.push(pass(
    "packet_contract",
    "The strict packet, decision brief, receipt, recovery plan, and cross-artifact references are valid.",
  ));

  const artifactText = canonicalArtifactText(
    packet.receipt,
    packet.decisionBrief,
    packet.recoveryPlan,
  );
  const manifestIssues: ReceiptVerificationGate["issues"] = [];
  for (const artifact of packet.manifest) {
    const bytes = new TextEncoder().encode(artifactText[artifact.artifactId]);
    const digest = await sha256HexPortable(bytes);
    if (artifact.byteLength !== bytes.byteLength) {
      manifestIssues.push({
        path: `$.manifest.${artifact.artifactId}.byteLength`,
        message: `Stored ${artifact.byteLength}; recomputed ${bytes.byteLength}.`,
      });
    }
    if (artifact.sha256 !== digest) {
      manifestIssues.push({
        path: `$.manifest.${artifact.artifactId}.sha256`,
        message: `Stored ${artifact.sha256}; recomputed ${digest}.`,
      });
    }
  }
  gates.push(manifestIssues.length === 0
    ? pass(
        "artifact_manifest",
        "All three canonical embedded artifacts match their recorded byte lengths and SHA-256 digests.",
      )
    : fail(
        "artifact_manifest",
        "At least one embedded artifact does not match the packet manifest.",
        manifestIssues,
      ));

  const serializedReceipt = artifactText.receipt;
  const embeddedReport = await verifyReceipt(
    new TextEncoder().encode(serializedReceipt),
  );
  const embeddedIssues = embeddedReport.gates
    .filter((gate) => gate.status === "failed")
    .flatMap((gate) => gate.issues.length > 0
      ? gate.issues.map((issue) => ({
          path: `$.receipt${issue.path === "$" ? "" : issue.path.slice(1)}`,
          message: `${gate.label}: ${issue.message}`,
        }))
      : [{ path: "$.receipt", message: `${gate.label}: ${gate.detail}` }])
    .slice(0, 12);
  gates.push(embeddedReport.status === "pass"
    ? pass(
        "embedded_receipt_replay",
        "The embedded receipt passes its full deterministic accounting, policy, and citation replay.",
      )
    : fail(
        "embedded_receipt_replay",
        "The embedded receipt does not pass its full deterministic replay.",
        embeddedIssues,
      ));

  const receiptArtifact = packet.manifest.find(
    (artifact) => artifact.artifactId === "receipt",
  );
  const bindingIssues: ReceiptVerificationGate["issues"] = [];
  if (
    !receiptArtifact ||
    packet.recoveryPlan.sourceReceipt.receiptDigest !== receiptArtifact.sha256
  ) {
    bindingIssues.push({
      path: "$.recoveryPlan.sourceReceipt.receiptDigest",
      message: "The recovery plan is not bound to the canonical receipt digest in the manifest.",
    });
  }
  gates.push(bindingIssues.length === 0
    ? pass(
        "recovery_plan_binding",
        "The citation-closed recovery plan is bound to the exact canonical receipt artifact and remains proposal-only.",
      )
    : fail(
        "recovery_plan_binding",
        "The recovery plan binding does not match the packet receipt artifact.",
        bindingIssues,
      ));

  const status = gates.every((gate) => gate.status === "passed")
    ? "pass"
    : "inconsistent";
  return packetReport(status, fileSha256, exactBytes.byteLength, gates, packet);
}

function canonicalArtifactText(
  receipt: ReceiptResult,
  decisionBrief: DecisionBrief,
  recoveryPlan: RecoveryPlanExport,
): Record<EvidencePacketArtifactId, string> {
  return {
    receipt: JSON.stringify(ReceiptResultSchema.parse(receipt), null, 2),
    decision_brief: JSON.stringify(
      DecisionBriefSchema.parse(decisionBrief),
      null,
      2,
    ),
    recovery_plan: JSON.stringify(
      RecoveryPlanExportSchema.parse(recoveryPlan),
      null,
      2,
    ),
  };
}

const PACKET_GATE_LABELS: Partial<Record<ReceiptVerificationGateId, string>> = {
  exact_byte_digest: "Exact packet digest",
  size_limit: "Packet size",
  utf8: "UTF-8 decoding",
  json: "JSON syntax",
  packet_contract: "Evidence packet contract",
  artifact_manifest: "Artifact manifest replay",
  embedded_receipt_replay: "Embedded receipt replay",
  recovery_plan_binding: "Recovery plan binding",
};

function pass(
  id: ReceiptVerificationGateId,
  detail: string,
): ReceiptVerificationGate {
  return {
    id,
    label: PACKET_GATE_LABELS[id] ?? id,
    status: "passed",
    detail,
    issues: [],
  };
}

function fail(
  id: ReceiptVerificationGateId,
  detail: string,
  issues: ReceiptVerificationGate["issues"] = [],
): ReceiptVerificationGate {
  return {
    id,
    label: PACKET_GATE_LABELS[id] ?? id,
    status: "failed",
    detail,
    issues,
  };
}

function appendPacketNotRun(
  gates: ReceiptVerificationGate[],
  ids: ReceiptVerificationGateId[],
): void {
  for (const id of ids) {
    gates.push({
      id,
      label: PACKET_GATE_LABELS[id] ?? id,
      status: "not_run",
      detail: "Not run because an earlier evidence-packet boundary failed.",
      issues: [],
    });
  }
}

function packetReport(
  status: ReceiptVerificationStatus,
  fileSha256: string | null,
  byteLength: number,
  gates: ReceiptVerificationGate[],
  packet?: EvidencePacket,
): ReceiptVerificationReport {
  return {
    status,
    fileSha256,
    byteLength,
    gates,
    ...(packet
      ? {
          summary: {
            artifactType: "evidence_packet" as const,
            artifactCount: packet.manifest.length,
            traceId: packet.receipt.run.traceId,
            verdict: packet.receipt.verdict,
            findingCount: packet.receipt.findings.length,
            rawEventCount: packet.receipt.coverage.rawEvents,
            generationSource: packet.receipt.integrity.generationSource,
          },
        }
      : {}),
    limitations: [...EVIDENCE_PACKET_LIMITATIONS],
  };
}

function zodPath(path: PropertyKey[]): string {
  if (path.length === 0) return "$";
  return path.reduce<string>((result, segment) => {
    if (typeof segment === "number") return `${result}[${segment}]`;
    return `${result}.${String(segment)}`;
  }, "$");
}

export type { RecoveryAction, RecoveryIncident };
