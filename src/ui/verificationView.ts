import type {
  ReceiptVerificationGate,
  ReceiptVerificationReport,
  ReceiptVerificationStatus,
} from "../core/verifyReceipt";

export type ReceiptVerificationView = {
  status: ReceiptVerificationStatus;
  statusCode: "PASS" | "REJECTED" | "CHECK FAILED";
  statusLabel: string;
  statusDescription: string;
  fileSha256: string;
  byteLengthLabel: string;
  gates: Array<ReceiptVerificationGate & {
    marker: "✓" | "!" | "—";
    ariaLabel: string;
  }>;
  summary?: {
    artifactLabel: string;
    traceId: string;
    verdict: string;
    findingCountLabel: string;
    rawEventCountLabel: string;
    generationSourceLabel: string;
  };
  limitations: string[];
};

export function buildReceiptVerificationView(
  report: ReceiptVerificationReport,
): ReceiptVerificationView {
  const artifactType = report.summary?.artifactType ?? "receipt";
  const status = statusCopy(report.status, artifactType);
  return {
    status: report.status,
    ...status,
    fileSha256: report.fileSha256 ?? "Digest unavailable",
    byteLengthLabel: `${report.byteLength.toLocaleString()} bytes received`,
    gates: report.gates.map((gate) => ({
      ...gate,
      marker:
        gate.status === "passed" ? "✓" : gate.status === "failed" ? "!" : "—",
      ariaLabel: `${gate.label}: ${gate.status.replace("_", " ")}. ${gate.detail}`,
    })),
    ...(report.summary
      ? {
          summary: {
            artifactLabel:
              report.summary.artifactType === "evidence_packet"
                ? `Evidence packet · ${report.summary.artifactCount} artifacts`
                : "Portable receipt · 1 artifact",
            traceId: report.summary.traceId,
            verdict: report.summary.verdict.replaceAll("_", " "),
            findingCountLabel: `${report.summary.findingCount} ${report.summary.findingCount === 1 ? "finding" : "findings"}`,
            rawEventCountLabel: `${report.summary.rawEventCount} raw ${report.summary.rawEventCount === 1 ? "event" : "events"}`,
            generationSourceLabel:
              report.summary.generationSource === "granite"
                ? "Granite wording"
                : "Deterministic wording",
          },
        }
      : {}),
    limitations: [...report.limitations],
  };
}

function statusCopy(
  status: ReceiptVerificationStatus,
  artifactType: "receipt" | "evidence_packet",
): Pick<
  ReceiptVerificationView,
  "statusCode" | "statusLabel" | "statusDescription"
> {
  const subject = artifactType === "evidence_packet" ? "evidence packet" : "receipt";
  if (status === "pass") {
    return {
      statusCode: "PASS",
      statusLabel: `The ${subject} checks agree.`,
      statusDescription:
        artifactType === "evidence_packet"
          ? "Its manifest, embedded receipt replay, and citation-closed recovery binding are internally consistent."
          : "Its structure, event accounting, deterministic policy output, and cited receipt notes are internally consistent.",
    };
  }
  if (status === "rejected") {
    return {
      statusCode: "REJECTED",
      statusLabel: `This is not a valid portable ${subject}.`,
      statusDescription:
        "A byte, format, schema, or cross-object boundary failed, so dependent checks were not run.",
    };
  }
  return {
    statusCode: "CHECK FAILED",
    statusLabel: `The ${subject} contradicts its own evidence.`,
    statusDescription:
      artifactType === "evidence_packet"
        ? "The packet parsed, but its manifest, receipt replay, or recovery binding did not match the stored result."
        : "The receipt parsed, but at least one deterministic replay or citation check did not match the stored result.",
  };
}
