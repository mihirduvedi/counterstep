import type { ReceiptResult } from "../core/schemas/index";

export type EvidenceGapItem = {
  findingId: string;
  label: string;
  description: string;
  eventIds: string[];
  rawPointers: string[];
  nextStep: string;
};

export type RawRecordView = {
  rawPointer: string;
  sourceEventId?: string;
  status: "mapped" | "metadata-only" | "unparsed";
  canonicalEventIds: string[];
  reason?: string;
  material: boolean;
  findingIds: string[];
};

export type EvidenceGapView = {
  accounted: number;
  total: number;
  mapped: number;
  metadataOnly: number;
  unparsed: number;
  gaps: EvidenceGapItem[];
  records: RawRecordView[];
};

/**
 * Build a deterministic review of the exact evidence that stopped a verdict.
 * No missing field is inferred and every raw-record pointer comes from the
 * adapter accounting ledger already validated by the receipt schema.
 */
export function buildEvidenceGapView(
  receipt: ReceiptResult,
): EvidenceGapView | null {
  const traceFindings = receipt.findings.filter(
    (finding) => finding.ruleId === "AR-TRACE-001",
  );
  if (
    receipt.verdict !== "unable_to_assess_fully" ||
    traceFindings.length === 0
  ) {
    return null;
  }

  const eventById = new Map(
    receipt.events.map((event) => [event.eventId, event]),
  );
  const accountingPointers = new Set(
    receipt.accounting.map((entry) => entry.rawPointer),
  );

  const gaps = traceFindings.map((finding) => {
    const pointers = finding.eventIds
      .map((eventId) => eventById.get(eventId)?.rawPointer)
      .filter((pointer): pointer is string => pointer !== undefined);

    if (
      typeof finding.observedValue === "string" &&
      accountingPointers.has(finding.observedValue)
    ) {
      pointers.push(finding.observedValue);
    }

    // Run status is derived across the submitted source records. When that
    // terminal evidence is missing, the entire accounting ledger is relevant.
    if (finding.label === "Run termination is unknown") {
      pointers.push(...receipt.accounting.map((entry) => entry.rawPointer));
    }

    return {
      findingId: finding.findingId,
      label: finding.label,
      description: finding.description,
      eventIds: [...finding.eventIds],
      rawPointers: unique(pointers),
      nextStep: nextStepFor(finding.label),
    };
  });

  const records = receipt.accounting.map((entry) => ({
    ...entry,
    canonicalEventIds: [...entry.canonicalEventIds],
    findingIds: gaps
      .filter(
        (gap) =>
          gap.rawPointers.includes(entry.rawPointer) ||
          gap.eventIds.some((eventId) =>
            entry.canonicalEventIds.includes(eventId),
          ),
      )
      .map((gap) => gap.findingId),
  }));

  return {
    accounted: receipt.coverage.accountedRawEvents,
    total: receipt.coverage.rawEvents,
    mapped: receipt.coverage.mapped,
    metadataOnly: receipt.coverage.metadataOnly,
    unparsed: receipt.coverage.unparsed,
    gaps,
    records,
  };
}

function nextStepFor(label: string): string {
  switch (label) {
    case "Material event could not be parsed":
      return "Provide the missing explicit adapter field or a supported source record. Preserve the original bytes unchanged.";
    case "Operation is unknown":
      return "Map the source operation to a supported explicit operation. Do not infer it from prompts or outputs.";
    case "Run termination is unknown":
      return "Provide a terminal source status of succeeded, failed, or cancelled. If it cannot be recovered, keep this limitation visible.";
    default:
      return "Obtain the missing source evidence when lawful. If it cannot be recovered, keep the assessment incomplete.";
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
