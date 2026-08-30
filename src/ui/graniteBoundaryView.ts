import { buildFactBundle } from "../ai/factBundle";
import type { GraniteFactBundle } from "../ai/factBundle";
import type { ReceiptResult } from "../core/schemas/index";

export type GraniteBoundaryView = {
  bundle: GraniteFactBundle;
  serializedBundle: string;
  payloadBytes: number;
  generationSource: ReceiptResult["integrity"]["generationSource"];
  eventCount: number;
  findingCount: number;
  allowedEventCitationCount: number;
  allowedFindingCitationCount: number;
};

/**
 * Rebuild the exact minimized and redacted fact bundle that the server route
 * can pass to Granite. The preview is derived from the validated receipt, so
 * it never needs access to the retained raw source object.
 */
export function buildGraniteBoundaryView(
  receipt: ReceiptResult,
): GraniteBoundaryView {
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
  const serializedBundle = JSON.stringify(bundle, null, 2);

  return {
    bundle,
    serializedBundle,
    payloadBytes: new TextEncoder().encode(serializedBundle).byteLength,
    generationSource: receipt.integrity.generationSource,
    eventCount: bundle.events.length,
    findingCount: bundle.findings.length,
    allowedEventCitationCount: bundle.allowedEventIds.length,
    allowedFindingCitationCount: bundle.allowedFindingIds.length,
  };
}
