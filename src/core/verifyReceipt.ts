import { buildFactBundle } from "../ai/factBundle";
import { validateClaims } from "../ai/validateClaims";
import { computeCoverage } from "./coverage";
import { sha256HexPortable } from "./portableDigest";
import { runPolicyEngine } from "./policyEngine";
import { MAX_TRACE_BYTES } from "./receipt";
import { ReceiptResultSchema } from "./schemas/index";
import type { ReceiptResult } from "./schemas/index";

export type ReceiptVerificationStatus = "pass" | "rejected" | "inconsistent";

export type ReceiptVerificationGateId =
  | "exact_byte_digest"
  | "size_limit"
  | "utf8"
  | "json"
  | "receipt_contract"
  | "packet_contract"
  | "artifact_manifest"
  | "accounting_replay"
  | "policy_replay"
  | "citation_validation"
  | "embedded_receipt_replay"
  | "recovery_plan_binding";

export type ReceiptVerificationGate = {
  id: ReceiptVerificationGateId;
  label: string;
  status: "passed" | "failed" | "not_run";
  detail: string;
  issues: Array<{
    path: string;
    message: string;
  }>;
};

export type ReceiptVerificationSummary = {
  artifactType: "receipt" | "evidence_packet";
  artifactCount: number;
  traceId: string;
  verdict: ReceiptResult["verdict"];
  findingCount: number;
  rawEventCount: number;
  generationSource: ReceiptResult["integrity"]["generationSource"];
};

export type ReceiptVerificationReport = {
  status: ReceiptVerificationStatus;
  fileSha256: string | null;
  byteLength: number;
  gates: ReceiptVerificationGate[];
  summary?: ReceiptVerificationSummary;
  limitations: string[];
};

export const RECEIPT_VERIFIER_LIMITATIONS = [
  "Whether the source trace was complete or accurately captured.",
  "Whether the exporting system or the person who produced the receipt was trustworthy.",
  "Whether the original trace bytes match the digest recorded inside the receipt, because those bytes are not included in the export.",
  "Authenticity, tamper-proof provenance, digital signatures, or nonrepudiation.",
  "Anything beyond the supplied receipt, its cited canonical evidence, and its authority envelope.",
] as const;

const GATE_LABELS: Record<ReceiptVerificationGateId, string> = {
  exact_byte_digest: "Exact file digest",
  size_limit: "File size",
  utf8: "UTF-8 decoding",
  json: "JSON syntax",
  receipt_contract: "Receipt contract",
  packet_contract: "Evidence packet contract",
  artifact_manifest: "Artifact manifest replay",
  accounting_replay: "Event accounting replay",
  policy_replay: "Deterministic policy replay",
  citation_validation: "Cited claim validation",
  embedded_receipt_replay: "Embedded receipt replay",
  recovery_plan_binding: "Recovery plan binding",
};

/**
 * Verify a portable receipt entirely from its received bytes. The file digest
 * is computed before decoding or parsing. Passing means the receipt is
 * internally self-consistent; it is not an authenticity or provenance claim.
 */
export async function verifyReceipt(
  inputBytes: Uint8Array,
): Promise<ReceiptVerificationReport> {
  const exactBytes = Uint8Array.from(inputBytes);
  const gates: ReceiptVerificationGate[] = [];
  let fileSha256: string | null = null;

  try {
    fileSha256 = await sha256HexPortable(exactBytes);
    gates.push(
      passed(
        "exact_byte_digest",
        "SHA-256 was computed from the exact received bytes before decoding or parsing.",
      ),
    );
  } catch {
    gates.push(
      failed(
        "exact_byte_digest",
        "The browser could not compute a SHA-256 digest for this file.",
      ),
    );
    appendNotRun(gates, [
      "size_limit",
      "utf8",
      "json",
      "receipt_contract",
      "accounting_replay",
      "policy_replay",
      "citation_validation",
    ]);
    return report("rejected", fileSha256, exactBytes.byteLength, gates);
  }

  if (exactBytes.byteLength > MAX_TRACE_BYTES) {
    gates.push(
      failed(
        "size_limit",
        `The receipt is larger than the 2 MiB limit (${MAX_TRACE_BYTES} bytes).`,
        [{ path: "$", message: `Received ${exactBytes.byteLength} bytes.` }],
      ),
    );
    appendNotRun(gates, [
      "utf8",
      "json",
      "receipt_contract",
      "accounting_replay",
      "policy_replay",
      "citation_validation",
    ]);
    return report("rejected", fileSha256, exactBytes.byteLength, gates);
  }
  gates.push(passed("size_limit", "The receipt is within the 2 MiB input limit."));

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(exactBytes);
    gates.push(passed("utf8", "The exact bytes decode as UTF-8."));
  } catch {
    gates.push(failed("utf8", "The receipt must be encoded as UTF-8 JSON."));
    appendNotRun(gates, [
      "json",
      "receipt_contract",
      "accounting_replay",
      "policy_replay",
      "citation_validation",
    ]);
    return report("rejected", fileSha256, exactBytes.byteLength, gates);
  }

  let document: unknown;
  try {
    document = JSON.parse(text) as unknown;
    gates.push(passed("json", "The decoded file contains valid JSON."));
  } catch (error) {
    gates.push(
      failed(
        "json",
        "The decoded file is not valid JSON.",
        [{
          path: "$",
          message: error instanceof SyntaxError ? error.message : "JSON parsing failed.",
        }],
      ),
    );
    appendNotRun(gates, [
      "receipt_contract",
      "accounting_replay",
      "policy_replay",
      "citation_validation",
    ]);
    return report("rejected", fileSha256, exactBytes.byteLength, gates);
  }

  const receiptResult = ReceiptResultSchema.safeParse(document);
  if (!receiptResult.success) {
    const issues = receiptResult.error.issues.slice(0, 12).map((issue) => ({
      path: zodPath(issue.path),
      message: issue.message,
    }));
    gates.push(
      failed(
        "receipt_contract",
        "The file is not a valid Agent Receipt export or its cross-object invariants do not hold.",
        issues,
      ),
    );
    appendNotRun(gates, [
      "accounting_replay",
      "policy_replay",
      "citation_validation",
    ]);
    return report("rejected", fileSha256, exactBytes.byteLength, gates);
  }

  const receipt = receiptResult.data;
  gates.push(
    passed(
      "receipt_contract",
      "The strict receipt schema and its cross-object references are valid.",
    ),
  );

  try {
    const replayedCoverage = computeCoverage({
      rawEventCount: receipt.accounting.length,
      events: receipt.events,
      accounting: receipt.accounting,
    });
    if (JSON.stringify(replayedCoverage) === JSON.stringify(receipt.coverage)) {
      gates.push(
        passed(
          "accounting_replay",
          "Every raw event is accounted for and the coverage totals recompute exactly.",
        ),
      );
    } else {
      gates.push(
        failed(
          "accounting_replay",
          "The stored coverage totals do not match a fresh accounting replay.",
          coverageDiff(receipt.coverage, replayedCoverage),
        ),
      );
    }
  } catch (error) {
    gates.push(
      failed(
        "accounting_replay",
        "The event accounting could not be replayed.",
        [{ path: "$.accounting", message: safeError(error) }],
      ),
    );
  }

  const replayedPolicy = runPolicyEngine({
    events: receipt.events,
    accounting: receipt.accounting,
    authority: receipt.authority,
    traceCompletionStatus: receipt.run.status,
  });
  const policyIssues: ReceiptVerificationGate["issues"] = [];
  if (receipt.verdict !== replayedPolicy.verdict) {
    policyIssues.push({
      path: "$.verdict",
      message: `Stored ${receipt.verdict}; recomputed ${replayedPolicy.verdict}.`,
    });
  }
  if (JSON.stringify(receipt.findings) !== JSON.stringify(replayedPolicy.findings)) {
    policyIssues.push({
      path: "$.findings",
      message: "Stored findings do not exactly match the deterministic policy output.",
    });
  }
  gates.push(
    policyIssues.length === 0
      ? passed(
          "policy_replay",
          "The verdict and full finding records match a fresh deterministic policy replay.",
        )
      : failed(
          "policy_replay",
          "The deterministic policy output does not match the stored receipt.",
          policyIssues,
        ),
  );

  try {
    const bundle = buildFactBundle({
      events: receipt.events,
      findings: receipt.findings,
      accounting: receipt.accounting,
      verdict: receipt.verdict,
      authority: receipt.authority,
      hasAssessmentLimitation: receipt.findings.some(
        (finding) => finding.ruleId === "AR-TRACE-001",
      ),
      coverage: receipt.coverage,
    });
    const claims = validateClaims(receipt.copy, bundle);
    gates.push(
      claims.valid
        ? passed(
            "citation_validation",
            "Every exported receipt note is an allowed deterministic projection with valid event and finding citations.",
          )
        : failed(
            "citation_validation",
            "One or more exported receipt notes are not supported by their citations.",
            claims.errors.slice(0, 12).map((message) => ({
              path: "$.copy",
              message,
            })),
          ),
    );
  } catch (error) {
    gates.push(
      failed(
        "citation_validation",
        "The receipt notes could not be validated against the cited fact bundle.",
        [{ path: "$.copy", message: safeError(error) }],
      ),
    );
  }

  const status = gates.every((gate) => gate.status === "passed")
    ? "pass"
    : "inconsistent";
  return report(status, fileSha256, exactBytes.byteLength, gates, {
    artifactType: "receipt",
    artifactCount: 1,
    traceId: receipt.run.traceId,
    verdict: receipt.verdict,
    findingCount: receipt.findings.length,
    rawEventCount: receipt.coverage.rawEvents,
    generationSource: receipt.integrity.generationSource,
  });
}

function passed(
  id: ReceiptVerificationGateId,
  detail: string,
): ReceiptVerificationGate {
  return { id, label: GATE_LABELS[id], status: "passed", detail, issues: [] };
}

function failed(
  id: ReceiptVerificationGateId,
  detail: string,
  issues: ReceiptVerificationGate["issues"] = [],
): ReceiptVerificationGate {
  return { id, label: GATE_LABELS[id], status: "failed", detail, issues };
}

function appendNotRun(
  gates: ReceiptVerificationGate[],
  ids: ReceiptVerificationGateId[],
): void {
  for (const id of ids) {
    gates.push({
      id,
      label: GATE_LABELS[id],
      status: "not_run",
      detail: "Not run because an earlier receipt boundary failed.",
      issues: [],
    });
  }
}

function report(
  status: ReceiptVerificationStatus,
  fileSha256: string | null,
  byteLength: number,
  gates: ReceiptVerificationGate[],
  summary?: ReceiptVerificationSummary,
): ReceiptVerificationReport {
  return {
    status,
    fileSha256,
    byteLength,
    gates,
    ...(summary ? { summary } : {}),
    limitations: [...RECEIPT_VERIFIER_LIMITATIONS],
  };
}

function zodPath(path: PropertyKey[]): string {
  if (path.length === 0) return "$";
  return path.reduce<string>((result, segment) => {
    if (typeof segment === "number") return `${result}[${segment}]`;
    return `${result}.${String(segment)}`;
  }, "$");
}

function coverageDiff(
  stored: ReceiptResult["coverage"],
  replayed: ReceiptResult["coverage"],
): ReceiptVerificationGate["issues"] {
  const issues: ReceiptVerificationGate["issues"] = [];
  for (const key of Object.keys(stored) as Array<keyof typeof stored>) {
    if (stored[key] !== replayed[key]) {
      issues.push({
        path: `$.coverage.${key}`,
        message: `Stored ${stored[key]}; recomputed ${replayed[key]}.`,
      });
    }
  }
  return issues;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : "Validation failed.";
}
