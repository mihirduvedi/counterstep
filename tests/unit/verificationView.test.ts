import { describe, expect, it } from "vitest";
import type { ReceiptVerificationReport } from "../../src/core/verifyReceipt.js";
import { buildReceiptVerificationView } from "../../src/ui/verificationView.js";

describe("portable receipt verification view", () => {
  it.each([
    ["pass", "PASS", "The receipt checks agree."],
    ["rejected", "REJECTED", "This is not a valid portable receipt."],
    ["inconsistent", "CHECK FAILED", "The receipt contradicts its own evidence."],
  ] as const)("maps %s to explicit text, not color alone", (status, code, label) => {
    const view = buildReceiptVerificationView(report(status));

    expect(view.statusCode).toBe(code);
    expect(view.statusLabel).toBe(label);
    expect(view.gates[0]?.ariaLabel).toContain("Receipt contract: passed");
    expect(view.limitations).toContain(
      "Authenticity, tamper-proof provenance, digital signatures, or nonrepudiation.",
    );
  });

  it("names an evidence packet and its manifest size", () => {
    const source = report("pass");
    source.summary = {
      artifactType: "evidence_packet",
      artifactCount: 3,
      traceId: "trace-packet",
      verdict: "within_declared_authority",
      findingCount: 0,
      rawEventCount: 2,
      generationSource: "deterministic_fallback",
    };

    const view = buildReceiptVerificationView(source);

    expect(view.statusLabel).toBe("The evidence packet checks agree.");
    expect(view.summary?.artifactLabel).toBe("Evidence packet · 3 artifacts");
    expect(view.statusDescription).toContain("manifest");
  });

  it("marks failed and not-run gates with distinct readable labels", () => {
    const source = report("rejected");
    source.gates = [
      {
        id: "receipt_contract",
        label: "Receipt contract",
        status: "failed",
        detail: "The contract failed.",
        issues: [{ path: "$.schemaVersion", message: "Wrong schema." }],
      },
      {
        id: "policy_replay",
        label: "Deterministic policy replay",
        status: "not_run",
        detail: "Not run after the boundary failed.",
        issues: [],
      },
    ];

    const view = buildReceiptVerificationView(source);

    expect(view.gates.map((gate) => gate.marker)).toStrictEqual(["!", "—"]);
    expect(view.gates[0]?.ariaLabel).toContain("failed");
    expect(view.gates[1]?.ariaLabel).toContain("not run");
  });
});

function report(
  status: ReceiptVerificationReport["status"],
): ReceiptVerificationReport {
  return {
    status,
    fileSha256: "a".repeat(64),
    byteLength: 100,
    gates: [
      {
        id: "receipt_contract",
        label: "Receipt contract",
        status: "passed",
        detail: "The contract passed.",
        issues: [],
      },
    ],
    limitations: [
      "Authenticity, tamper-proof provenance, digital signatures, or nonrepudiation.",
    ],
  };
}
