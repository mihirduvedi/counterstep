import { z } from "zod";

import type {
  AuthorityEnvelopeV1,
  CanonicalEvent,
  Finding,
  RawEventAccounting,
  Verdict,
} from "./schemas/index";
import { VerdictSchema } from "./schemas/index";

export const POLICY_DECISION_LEDGER_SCHEMA_VERSION =
  "agent-receipt.policy-decision-ledger.v1" as const;

export const PolicyDecisionStatusSchema = z.enum([
  "deviation_found",
  "no_finding",
  "unable_to_assess",
  "not_active",
]);
export type PolicyDecisionStatus = z.infer<
  typeof PolicyDecisionStatusSchema
>;

export const PolicyDecisionEntrySchema = z
  .object({
    decisionId: z.string().regex(/^decision-\d{3}$/),
    category: z.enum(["authority", "behavior", "evidence"]),
    ruleIds: z.array(z.string().min(1)).min(1),
    policyPath: z.string().min(1).optional(),
    title: z.string().min(1),
    criterion: z.string().min(1),
    status: PolicyDecisionStatusSchema,
    summary: z.string().min(1),
    findingIds: z.array(z.string().min(1)),
    eventIds: z.array(z.string().min(1)),
    rawPointers: z.array(z.string().min(1)),
  })
  .strict();
export type PolicyDecisionEntry = z.infer<
  typeof PolicyDecisionEntrySchema
>;

export const PolicyDecisionLedgerSchema = z
  .object({
    schemaVersion: z.literal(POLICY_DECISION_LEDGER_SCHEMA_VERSION),
    traceId: z.string().min(1),
    policyId: z.string().min(1),
    verdict: VerdictSchema,
    counts: z
      .object({
        total: z.number().int().nonnegative(),
        deviations: z.number().int().nonnegative(),
        noFindings: z.number().int().nonnegative(),
        unableToAssess: z.number().int().nonnegative(),
        notActive: z.number().int().nonnegative(),
      })
      .strict(),
    entries: z.array(PolicyDecisionEntrySchema).min(1),
  })
  .strict()
  .superRefine((ledger, context) => {
    const expected = {
      total: ledger.entries.length,
      deviations: ledger.entries.filter(
        (entry) => entry.status === "deviation_found",
      ).length,
      noFindings: ledger.entries.filter(
        (entry) => entry.status === "no_finding",
      ).length,
      unableToAssess: ledger.entries.filter(
        (entry) => entry.status === "unable_to_assess",
      ).length,
      notActive: ledger.entries.filter(
        (entry) => entry.status === "not_active",
      ).length,
    };
    for (const [key, value] of Object.entries(expected)) {
      const countKey = key as keyof typeof expected;
      if (ledger.counts[countKey] !== value) {
        context.addIssue({
          code: "custom",
          path: ["counts", countKey],
          message: `Count must equal ${value}`,
        });
      }
    }

    const decisionIds = new Set<string>();
    ledger.entries.forEach((entry, index) => {
      if (decisionIds.has(entry.decisionId)) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "decisionId"],
          message: `Duplicate decisionId "${entry.decisionId}"`,
        });
      }
      decisionIds.add(entry.decisionId);
      for (const field of ["ruleIds", "findingIds", "eventIds", "rawPointers"] as const) {
        if (new Set(entry[field]).size !== entry[field].length) {
          context.addIssue({
            code: "custom",
            path: ["entries", index, field],
            message: `${field} must not contain duplicates`,
          });
        }
      }
    });
  });
export type PolicyDecisionLedger = z.infer<
  typeof PolicyDecisionLedgerSchema
>;

export type BuildPolicyDecisionLedgerInput = {
  traceId: string;
  events: CanonicalEvent[];
  accounting: RawEventAccounting[];
  authority: AuthorityEnvelopeV1;
  findings: Finding[];
  verdict: Verdict;
};

/**
 * Record the outcome of every deterministic rule family, including checks that
 * produced no finding or were not activated by the declared authority. This is
 * derived only from canonical facts, accounting, authority, and policy output.
 */
export function buildPolicyDecisionLedger(
  input: BuildPolicyDecisionLedgerInput,
): PolicyDecisionLedger {
  const { authority, events, findings } = input;
  const eventsById = new Map(events.map((event) => [event.eventId, event]));
  const accountingPointers = new Set(
    input.accounting.map((entry) => entry.rawPointer),
  );
  const entries: PolicyDecisionEntry[] = [];

  const findingsFor = (...ruleIds: string[]): Finding[] =>
    findings.filter((finding) => ruleIds.includes(finding.ruleId));

  const evidenceFor = (
    relatedFindings: Finding[],
    fallbackEventIds: string[] = [],
    fallbackRawPointers: string[] = [],
  ) => {
    const eventIds = unique([
      ...relatedFindings.flatMap((finding) => finding.eventIds),
      ...fallbackEventIds,
    ]);
    const rawPointers = unique([
      ...eventIds.flatMap((eventId) => {
        const rawPointer = eventsById.get(eventId)?.rawPointer;
        return rawPointer ? [rawPointer] : [];
      }),
      ...relatedFindings.flatMap((finding) => {
        const observed = finding.observedValue;
        return typeof observed === "string" && accountingPointers.has(observed)
          ? [observed]
          : [];
      }),
      ...fallbackRawPointers,
    ]);
    return {
      findingIds: unique(
        relatedFindings.map((finding) => finding.findingId),
      ),
      eventIds,
      rawPointers,
    };
  };

  const addEntry = (
    entry: Omit<PolicyDecisionEntry, "decisionId">,
  ): void => {
    entries.push({
      decisionId: `decision-${String(entries.length + 1).padStart(3, "0")}`,
      ...entry,
    });
  };

  const systemFindings = findingsFor("AR-SYS-001");
  const systemEvents = events.filter(
    (event) => event.sourceSystem || event.destinationSystem,
  );
  const namedSystems = unique(
    systemEvents.flatMap((event) =>
      [event.sourceSystem, event.destinationSystem].filter(
        (system): system is string => system !== undefined,
      ),
    ),
  );
  addEntry({
    category: "authority",
    ruleIds: ["AR-SYS-001"],
    policyPath: "permittedSystems",
    title: "System allowlist",
    criterion: `${authority.permittedSystems.length} permitted ${countWord(authority.permittedSystems.length, "system")}`,
    status:
      systemFindings.length > 0 ? "deviation_found" : "no_finding",
    summary:
      systemFindings.length > 0
        ? `${systemFindings.length} supplied ${countWord(systemFindings.length, "system reference")} fell outside the declared allowlist.`
        : namedSystems.length === 0
          ? "No supplied canonical event names a source or destination system. Missing system fields remain unknown."
          : `No supplied event names a system outside the allowlist. ${namedSystems.length} explicit ${countWord(namedSystems.length, "system")} ${wasWere(namedSystems.length)} evaluated; missing system fields remain unknown.`,
    ...evidenceFor(
      systemFindings,
      systemEvents.map((event) => event.eventId),
    ),
  });

  const operationFindings = findingsFor("AR-OP-001");
  const operationEvents = events.filter(
    (event) =>
      (event.status === "succeeded" ||
        event.status === "unknown" ||
        event.stateChange) &&
      event.operation !== "error" &&
      event.operation !== "unknown",
  );
  addEntry({
    category: "authority",
    ruleIds: ["AR-OP-001"],
    policyPath: "permittedOperations",
    title: "Operation allowlist",
    criterion: `${authority.permittedOperations.length} permitted ${countWord(authority.permittedOperations.length, "operation")}`,
    status:
      operationFindings.length > 0 ? "deviation_found" : "no_finding",
    summary:
      operationFindings.length > 0
        ? `${operationFindings.length} applicable ${countWord(operationFindings.length, "event")} named an operation outside the declared allowlist.`
        : operationEvents.length === 0
          ? "No supplied event met the operation-rule conditions. Unknown operations are handled by the evidence check instead."
          : `No applicable supplied event names an operation outside the allowlist. ${operationEvents.length} ${countWord(operationEvents.length, "event")} ${wasWere(operationEvents.length)} evaluated.`,
    ...evidenceFor(
      operationFindings,
      operationEvents.map((event) => event.eventId),
    ),
  });

  const egressFindings = findingsFor("AR-EGRESS-001");
  const externalEvents = events.filter(
    (event) => event.destinationBoundary === "external",
  );
  const egressActive = !authority.externalEgressAllowed;
  addEntry({
    category: "authority",
    ruleIds: ["AR-EGRESS-001"],
    policyPath: "externalEgressAllowed",
    title: "External egress",
    criterion: egressActive
      ? "External egress prohibited"
      : "External egress permitted",
    status: !egressActive
      ? "not_active"
      : egressFindings.length > 0
        ? "deviation_found"
        : "no_finding",
    summary: !egressActive
      ? "The authority envelope permits external egress, so the prohibition rule is not active."
      : egressFindings.length > 0
        ? `${egressFindings.length} supplied ${countWord(egressFindings.length, "event")} named an external destination while egress was prohibited.`
        : "No supplied event names an external destination. Missing destination boundaries remain unknown.",
    ...evidenceFor(
      egressFindings,
      egressActive
        ? externalEvents.length > 0
          ? externalEvents.map((event) => event.eventId)
          : events.map((event) => event.eventId)
        : [],
    ),
  });

  const dataFindings = findingsFor("AR-DATA-001");
  const consequentialEvents = events.filter(isMovingOrWriting);
  const dataActive = authority.prohibitedDataCategories.length > 0;
  addEntry({
    category: "authority",
    ruleIds: ["AR-DATA-001"],
    policyPath: "prohibitedDataCategories",
    title: "Restricted data categories",
    criterion: dataActive
      ? `${authority.prohibitedDataCategories.length} prohibited ${countWord(authority.prohibitedDataCategories.length, "category", "categories")}`
      : "No prohibited categories declared",
    status: !dataActive
      ? "not_active"
      : dataFindings.length > 0
        ? "deviation_found"
        : "no_finding",
    summary: !dataActive
      ? "The authority envelope declares no prohibited data category, so this rule is not active."
      : dataFindings.length > 0
        ? `${dataFindings.length} consequential supplied ${countWord(dataFindings.length, "event")} explicitly named prohibited data.`
        : "No consequential supplied event explicitly names a prohibited data category. Missing data-category fields remain unknown.",
    ...evidenceFor(
      dataFindings,
      dataActive
        ? consequentialEvents.map((event) => event.eventId)
        : [],
    ),
  });

  const volumeFindings = findingsFor("AR-VOLUME-001");
  const volumeLimitFindings = findings.filter(
    (finding) =>
      finding.ruleId === "AR-TRACE-001" &&
      finding.policyPath === "maxRecordsRead",
  );
  const volumeEvents = events.filter(
    (event) =>
      ["read", "retrieve"].includes(event.operation) &&
      event.status === "succeeded",
  );
  const knownRecordTotal = volumeEvents.reduce(
    (total, event) =>
      event.quantity?.unit === "records"
        ? total + BigInt(event.quantity.value)
        : total,
    0n,
  );
  const volumeActive = authority.maxRecordsRead !== undefined;
  const volumeEvidence = [...volumeFindings, ...volumeLimitFindings];
  addEntry({
    category: "authority",
    ruleIds: ["AR-VOLUME-001", "AR-TRACE-001"],
    policyPath: "maxRecordsRead",
    title: "Record-read limit",
    criterion: volumeActive
      ? `${authority.maxRecordsRead} records maximum`
      : "No record-read limit declared",
    status: !volumeActive
      ? "not_active"
      : volumeLimitFindings.length > 0
        ? "unable_to_assess"
        : volumeFindings.length > 0
          ? "deviation_found"
          : "no_finding",
    summary: !volumeActive
      ? "The authority envelope declares no record-read limit, so this rule is not active."
      : volumeLimitFindings.length > 0
        ? `${volumeLimitFindings.length} successful read or retrieve ${countWord(volumeLimitFindings.length, "event")} omitted a usable record count, so the limit cannot be assessed.`
        : volumeFindings.length > 0
          ? `${knownRecordTotal.toString()} supplied records exceeded the declared ${authority.maxRecordsRead}-record limit.`
          : `${knownRecordTotal.toString()} supplied records were counted across ${volumeEvents.length} successful read or retrieve ${countWord(volumeEvents.length, "event")}; no limit finding was produced.`,
    ...evidenceFor(
      volumeEvidence,
      volumeActive ? volumeEvents.map((event) => event.eventId) : [],
    ),
  });

  const approvalFindings = findingsFor(
    "AR-APPROVAL-001",
    "AR-APPROVAL-002",
  );
  const approvalEvents = events.filter(
    (event) =>
      authority.approvalRequiredFor.includes(event.operation) &&
      event.status === "succeeded",
  );
  const approvalActive = authority.approvalRequiredFor.length > 0;
  addEntry({
    category: "authority",
    ruleIds: ["AR-APPROVAL-001", "AR-APPROVAL-002"],
    policyPath: "approvalRequiredFor",
    title: "Prior human approval",
    criterion: approvalActive
      ? `${authority.approvalRequiredFor.length} approval-required ${countWord(authority.approvalRequiredFor.length, "operation")}`
      : "No operations require approval",
    status: !approvalActive
      ? "not_active"
      : approvalFindings.length > 0
        ? "deviation_found"
        : "no_finding",
    summary: !approvalActive
      ? "The authority envelope marks no operation as approval-required, so these rules are not active."
      : approvalFindings.length > 0
        ? `${approvalFindings.length} approval ${countWord(approvalFindings.length, "finding")} recorded a missing or late linked human approval.`
        : approvalEvents.length === 0
          ? "No successful supplied action used an approval-required operation."
          : `Every supplied successful approval-required action had a linked prior human approval. ${approvalEvents.length} ${countWord(approvalEvents.length, "action")} ${wasWere(approvalEvents.length)} evaluated.`,
    ...evidenceFor(
      approvalFindings,
      approvalActive
        ? approvalEvents.length > 0
          ? approvalEvents.map((event) => event.eventId)
          : events.map((event) => event.eventId)
        : [],
    ),
  });

  const retryFindings = findingsFor("AR-RETRY-001");
  const retryEvents = events.filter((event) => event.actionKey !== undefined);
  addEntry({
    category: "behavior",
    ruleIds: ["AR-RETRY-001"],
    title: "Uncertain-result retry",
    criterion: "Increasing attempts that share an action key",
    status: retryFindings.length > 0 ? "deviation_found" : "no_finding",
    summary:
      retryFindings.length > 0
        ? `${retryFindings.length} retry ${countWord(retryFindings.length, "pattern")} followed a failed or unknown result, so a repeated side effect is possible.`
        : "No later attempt followed a failed or unknown result within a shared action key.",
    ...evidenceFor(
      retryFindings,
      retryEvents.length > 0
        ? retryEvents.map((event) => event.eventId)
        : events.map((event) => event.eventId),
    ),
  });

  const errorFindings = findingsFor("AR-ERROR-001");
  addEntry({
    category: "behavior",
    ruleIds: ["AR-ERROR-001"],
    title: "State change after branch error",
    criterion: "Successful state change after an unhandled branch error",
    status: errorFindings.length > 0 ? "deviation_found" : "no_finding",
    summary:
      errorFindings.length > 0
        ? `${errorFindings.length} successful state ${countWord(errorFindings.length, "change")} followed an unhandled error in the same parent branch.`
        : "No successful state change followed a recorded unhandled error in the same parent branch.",
    ...evidenceFor(
      errorFindings,
      events.map((event) => event.eventId),
    ),
  });

  const traceFindings = findingsFor("AR-TRACE-001");
  addEntry({
    category: "evidence",
    ruleIds: ["AR-TRACE-001"],
    title: "Trace sufficiency",
    criterion: "Material accounting, known operations, quantities, and terminal status",
    status:
      traceFindings.length > 0 ? "unable_to_assess" : "no_finding",
    summary:
      traceFindings.length > 0
        ? `${traceFindings.length} trace-sufficiency ${countWord(traceFindings.length, "finding")} limit what can be concluded from the supplied evidence.`
        : "No material unparsed record, unknown operation, active-limit quantity gap, or nonterminal run status was found in the supplied trace.",
    ...evidenceFor(
      traceFindings,
      traceFindings.length === 0
        ? events.map((event) => event.eventId)
        : [],
      traceFindings.length === 0
        ? input.accounting.map((entry) => entry.rawPointer)
        : [],
    ),
  });

  const counts = {
    total: entries.length,
    deviations: entries.filter(
      (entry) => entry.status === "deviation_found",
    ).length,
    noFindings: entries.filter((entry) => entry.status === "no_finding")
      .length,
    unableToAssess: entries.filter(
      (entry) => entry.status === "unable_to_assess",
    ).length,
    notActive: entries.filter((entry) => entry.status === "not_active")
      .length,
  };

  return PolicyDecisionLedgerSchema.parse({
    schemaVersion: POLICY_DECISION_LEDGER_SCHEMA_VERSION,
    traceId: input.traceId,
    policyId: authority.policyId,
    verdict: input.verdict,
    counts,
    entries,
  });
}

function isMovingOrWriting(event: CanonicalEvent): boolean {
  return (
    event.stateChange ||
    event.destinationBoundary === "external" ||
    event.destinationBoundary === "internal" ||
    ["create", "update", "delete", "send"].includes(event.operation)
  );
}

function countWord(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return count === 1 ? singular : plural;
}

function wasWere(count: number): "was" | "were" {
  return count === 1 ? "was" : "were";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
