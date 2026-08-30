import {
  AuthorityEnvelopeV1Schema,
  CanonicalOperationSchema,
  NativeTraceV1Schema,
} from "../core/schemas/index";
import { OtlpExportTraceServiceRequestSchema } from "../adapters/otlpGenAi";
import {
  inspectGenericJson,
  resolveJsonPointer,
} from "../adapters/genericJson";
import type { GenericJsonInspection } from "../adapters/genericJson";
import type {
  RecoveryAction,
  RecoveryIncident,
} from "../core/recoveryPlan";
import type {
  AuthorityEnvelopeV1,
  CanonicalEvent,
  CanonicalOperation,
  Finding,
  NativeTraceV1,
  ReceiptResult,
} from "../core/schemas/index";

export const ALL_OPERATIONS = CanonicalOperationSchema.options;

export type TraceSourceKind = "synthetic" | "upload" | "paste";

export function formatTraceSourceLabel(kind: TraceSourceKind): string {
  switch (kind) {
    case "synthetic":
      return "Synthetic fixture";
    case "upload":
      return "Uploaded trace";
    case "paste":
      return "Pasted trace";
  }
}

export type AuthorityDraft = {
  policyId: string;
  task: string;
  permittedSystems: Array<{
    systemId: string;
    boundary: "local" | "internal" | "external";
  }>;
  permittedOperations: CanonicalOperation[];
  prohibitedDataCategories: string;
  externalEgressAllowed: boolean;
  maxRecordsRead: string;
  approvalRequiredFor: CanonicalOperation[];
};

export type IntakeValidation =
  | { ok: true; format: "native"; trace: NativeTraceV1 }
  | { ok: true; format: "otlp" }
  | {
      ok: true;
      format: "generic";
      rawDocument: unknown;
      inspection: GenericJsonInspection;
    }
  | {
      ok: false;
      code: "input_too_large" | "invalid_utf8" | "invalid_json" | "unsupported_format" | "invalid_trace";
      message: string;
      issues?: Array<{ path: string; message: string }>;
    };

export type AuthorityDraftValidation =
  | { ok: true; authority: AuthorityEnvelopeV1 }
  | { ok: false; issues: Array<{ path: string; message: string }> };

export type ReceiptMetrics = {
  events: number;
  systems: number;
  stateChanges: number;
  externalTransfers: number;
  approvals: number;
  errors: number;
  findings: number;
};

export function formatCountLabel(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return count === 1 ? singular : plural;
}

export type SystemEdge = {
  eventId: string;
  from: string;
  to: string;
  operation: CanonicalOperation;
  boundary: CanonicalEvent["destinationBoundary"];
  detail: string;
};

export type SystemsByBoundary = Record<
  "local" | "internal" | "external" | "unknown",
  string[]
>;

type Boundary = CanonicalEvent["destinationBoundary"];

export type HumanSystemSummary = {
  systemId: string;
  boundaries: Boundary[];
  roles: Array<"source" | "destination">;
  operations: CanonicalOperation[];
  statuses: CanonicalEvent["status"][];
  dataCategories: string[];
  eventIds: string[];
};

export type HumanActionSummary = {
  systems: HumanSystemSummary[];
  noObservedActivity: Array<{
    text: string;
    eventIds: string[];
  }>;
  actions: Array<{
    eventId: string;
    sequence: number;
    status: CanonicalEvent["status"];
    text: string;
  }>;
};

export type IncidentBrief = RecoveryIncident;
export type { RecoveryAction };

export function exactFixtureBytes(trace: NativeTraceV1): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(trace, null, 2)}\n`);
}

export function validateTraceBytes(
  rawBytes: Uint8Array,
  maxBytes: number,
): IntakeValidation {
  if (rawBytes.byteLength > maxBytes) {
    return {
      ok: false,
      code: "input_too_large",
      message: `This trace is larger than the 2 MiB limit (${maxBytes} bytes).`,
    };
  }

  let sourceText: string;
  try {
    sourceText = new TextDecoder("utf-8", { fatal: true }).decode(rawBytes);
  } catch {
    return {
      ok: false,
      code: "invalid_utf8",
      message: "Use UTF-8 JSON for the trace.",
    };
  }

  let rawDocument: unknown;
  try {
    rawDocument = JSON.parse(sourceText) as unknown;
  } catch (error) {
    return {
      ok: false,
      code: "invalid_json",
      message: formatJsonLocation(error, sourceText),
    };
  }

  if (typeof rawDocument !== "object" || rawDocument === null) {
    return {
      ok: false,
      code: "unsupported_format",
      message:
        "This schema is not supported. Use a JSON object or array containing action records.",
    };
  }

  if (!Array.isArray(rawDocument) && "resourceSpans" in rawDocument) {
    const otlp = OtlpExportTraceServiceRequestSchema.safeParse(rawDocument);
    if (!otlp.success) {
      return {
        ok: false,
        code: "invalid_trace",
        message: "The OTLP/JSON export does not match the supported resourceSpans shape.",
        issues: otlp.error.issues.map((issue) => ({
          path: issue.path.length > 0 ? issue.path.join(".") : "trace",
          message: issue.message,
        })),
      };
    }
    return { ok: true, format: "otlp" };
  }

  if (
    !Array.isArray(rawDocument) &&
    "schemaVersion" in rawDocument &&
    rawDocument.schemaVersion === "agent-receipt.native-trace.v1"
  ) {
    const trace = NativeTraceV1Schema.safeParse(rawDocument);
    if (!trace.success) {
      return {
        ok: false,
        code: "invalid_trace",
        message: "Some trace fields are invalid. Review the fields listed below.",
        issues: trace.error.issues.map((issue) => ({
          path: issue.path.length > 0 ? issue.path.join(".") : "trace",
          message: issue.message,
        })),
      };
    }
    return { ok: true, format: "native", trace: trace.data };
  }

  const inspection = inspectGenericJson(rawDocument);
  if (inspection.recordSets.length > 0) {
    return { ok: true, format: "generic", rawDocument, inspection };
  }

  return {
    ok: false,
    code: "unsupported_format",
    message:
      "No non-empty JSON record array was found. Use Native Trace v1, the documented OTLP/JSON shape, or an object/array containing action records.",
  };
}

export function authorityToDraft(
  authority: AuthorityEnvelopeV1,
): AuthorityDraft {
  return {
    policyId: authority.policyId,
    task: authority.task,
    permittedSystems: authority.permittedSystems.map((system) => ({ ...system })),
    permittedOperations: [...authority.permittedOperations],
    prohibitedDataCategories: authority.prohibitedDataCategories.join(", "),
    externalEgressAllowed: authority.externalEgressAllowed,
    maxRecordsRead:
      authority.maxRecordsRead === undefined
        ? ""
        : String(authority.maxRecordsRead),
    approvalRequiredFor: [...authority.approvalRequiredFor],
  };
}

export function blankAuthorityDraft(): AuthorityDraft {
  return {
    policyId: "",
    task: "",
    permittedSystems: [{ systemId: "", boundary: "internal" }],
    permittedOperations: [],
    prohibitedDataCategories: "",
    externalEgressAllowed: false,
    maxRecordsRead: "",
    approvalRequiredFor: [],
  };
}

export function validateAuthorityDraft(
  draft: AuthorityDraft,
): AuthorityDraftValidation {
  const maxRecordsRead = draft.maxRecordsRead.trim();
  const candidate = {
    schemaVersion: "agent-receipt.authority.v1",
    policyId: draft.policyId,
    task: draft.task,
    permittedSystems: draft.permittedSystems,
    permittedOperations: draft.permittedOperations,
    prohibitedDataCategories: splitDataCategories(
      draft.prohibitedDataCategories,
    ),
    externalEgressAllowed: draft.externalEgressAllowed,
    ...(maxRecordsRead === "" ? {} : { maxRecordsRead: Number(maxRecordsRead) }),
    approvalRequiredFor: draft.approvalRequiredFor,
  };
  const result = AuthorityEnvelopeV1Schema.safeParse(candidate);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.length > 0 ? issue.path.join(".") : "authority",
        message: issue.message,
      })),
    };
  }
  return { ok: true, authority: result.data };
}

export function summarizeReceipt(receipt: ReceiptResult): ReceiptMetrics {
  const systems = new Set<string>();
  for (const event of receipt.events) {
    if (event.sourceSystem) systems.add(event.sourceSystem);
    if (event.destinationSystem) systems.add(event.destinationSystem);
  }

  return {
    events: receipt.events.length,
    systems: systems.size,
    stateChanges: receipt.events.filter((event) => event.stateChange).length,
    externalTransfers: receipt.events.filter(
      (event) => event.destinationBoundary === "external",
    ).length,
    approvals: receipt.events.filter(
      (event) => event.operation === "approve" && event.status === "succeeded",
    ).length,
    errors: receipt.events.filter(
      (event) => event.operation === "error" || event.status === "failed",
    ).length,
    findings: receipt.findings.length,
  };
}

export function sortFindingsByAttention(
  findings: Finding[],
  events: CanonicalEvent[],
): Finding[] {
  const severityRank = { high: 0, medium: 1, low: 2 } as const;
  const sequenceByEventId = new Map(
    events.map((event) => [event.eventId, event.sequence]),
  );
  return [...findings].sort((left, right) => {
    const severity = severityRank[left.severity] - severityRank[right.severity];
    if (severity !== 0) return severity;
    const leftSequence = Math.min(
      ...left.eventIds.map((eventId) => sequenceByEventId.get(eventId) ?? Infinity),
    );
    const rightSequence = Math.min(
      ...right.eventIds.map((eventId) => sequenceByEventId.get(eventId) ?? Infinity),
    );
    return leftSequence - rightSequence;
  });
}

/**
 * Collapse rule-level findings into manager-sized incidents without hiding any
 * evidence. Findings are connected only by explicit event citations or a
 * shared trace actionKey; the model is never involved in this grouping.
 */
export function buildManagerIncidentBrief(
  receipt: ReceiptResult,
): IncidentBrief[] {
  if (receipt.findings.length === 0) return [];

  const eventsById = new Map(
    receipt.events.map((event) => [event.eventId, event]),
  );
  const parent = new Map(receipt.events.map((event) => [event.eventId, event.eventId]));

  const findRoot = (eventId: string): string => {
    const directParent = parent.get(eventId) ?? eventId;
    if (directParent === eventId) return eventId;
    const root = findRoot(directParent);
    parent.set(eventId, root);
    return root;
  };
  const connect = (left: string, right: string): void => {
    const leftRoot = findRoot(left);
    const rightRoot = findRoot(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };

  for (const finding of receipt.findings) {
    const [first, ...rest] = finding.eventIds.filter((id) => eventsById.has(id));
    if (!first) continue;
    for (const eventId of rest) connect(first, eventId);
  }

  const eventsByActionKey = new Map<string, CanonicalEvent[]>();
  for (const event of receipt.events) {
    if (!event.actionKey) continue;
    const group = eventsByActionKey.get(event.actionKey) ?? [];
    group.push(event);
    eventsByActionKey.set(event.actionKey, group);
  }
  for (const events of eventsByActionKey.values()) {
    const [first, ...rest] = events;
    if (!first) continue;
    for (const event of rest) connect(first.eventId, event.eventId);
  }

  const findingsByRoot = new Map<string, Finding[]>();
  const uncitedFindings: Finding[] = [];
  for (const finding of receipt.findings) {
    const firstEventId = finding.eventIds.find((id) => eventsById.has(id));
    if (!firstEventId) {
      uncitedFindings.push(finding);
      continue;
    }
    const root = findRoot(firstEventId);
    findingsByRoot.set(root, [...(findingsByRoot.get(root) ?? []), finding]);
  }

  const components = [...findingsByRoot.values()];
  if (uncitedFindings.length > 0) components.push(uncitedFindings);

  const severityRank = { high: 0, medium: 1, low: 2 } as const;
  const incidents = components.map((findings) => {
    const findingIds = findings.map((finding) => finding.findingId);
    const eventIds = [...new Set(findings.flatMap((finding) => finding.eventIds))]
      .filter((eventId) => eventsById.has(eventId))
      .sort(
        (left, right) =>
          (eventsById.get(left)?.sequence ?? Infinity) -
          (eventsById.get(right)?.sequence ?? Infinity),
      );
    const events = eventIds
      .map((eventId) => eventsById.get(eventId))
      .filter((event): event is CanonicalEvent => event !== undefined);
    const severity = [...findings]
      .sort(
        (left, right) =>
          severityRank[left.severity] - severityRank[right.severity],
      )[0]?.severity ?? "low";
    const systems = uniqueStrings(
      events.flatMap((event) =>
        [event.sourceSystem, event.destinationSystem].filter(
          (system): system is string => system !== undefined,
        ),
      ),
    );
    const dataCategories = uniqueStrings(
      events.flatMap((event) => event.dataCategories),
    );

    return {
      incidentId: "",
      title: buildIncidentTitle(events),
      summary: buildIncidentSummary(events, findings.length),
      severity,
      eventIds,
      findingIds,
      findingCount: findings.length,
      statuses: uniqueValues(events.map((event) => event.status)),
      systems,
      dataCategories,
    } satisfies IncidentBrief;
  });

  return incidents
    .sort((left, right) => {
      const severity = severityRank[left.severity] - severityRank[right.severity];
      if (severity !== 0) return severity;
      const leftSequence = eventsById.get(left.eventIds[0] ?? "")?.sequence ?? Infinity;
      const rightSequence = eventsById.get(right.eventIds[0] ?? "")?.sequence ?? Infinity;
      return leftSequence - rightSequence;
    })
    .map((incident, index) => ({
      ...incident,
      incidentId: `incident-${String(index + 1).padStart(3, "0")}`,
    }));
}

/**
 * Produce review-only recovery actions. These are deterministic, cited plans;
 * they do not call external systems or claim that remediation occurred.
 */
export function buildRecoveryPlan(
  receipt: ReceiptResult,
  incidents = buildManagerIncidentBrief(receipt),
): RecoveryAction[] {
  const findingsById = new Map(
    receipt.findings.map((finding) => [finding.findingId, finding]),
  );
  const eventsById = new Map(
    receipt.events.map((event) => [event.eventId, event]),
  );
  const actions: RecoveryAction[] = [];

  const addAction = (
    incident: IncidentBrief,
    key: string,
    details: Omit<RecoveryAction, "actionId" | "incidentId" | "eventIds" | "findingIds" | "status">,
    findingIds = incident.findingIds,
  ): void => {
    actions.push({
      actionId: `${incident.incidentId}-${key}`,
      incidentId: incident.incidentId,
      ...details,
      eventIds: incident.eventIds,
      findingIds,
      status: "proposed",
    });
  };

  for (const incident of incidents) {
    const findings = incident.findingIds
      .map((findingId) => findingsById.get(findingId))
      .filter((finding): finding is Finding => finding !== undefined);
    const ruleIds = new Set(findings.map((finding) => finding.ruleId));
    const events = incident.eventIds
      .map((eventId) => eventsById.get(eventId))
      .filter((event): event is CanonicalEvent => event !== undefined);
    const destination = humanizeSlug(
      events.find((event) => event.destinationSystem)?.destinationSystem ??
        events.find((event) => event.sourceSystem)?.sourceSystem ??
        "named system",
    );

    const isEvidenceOnlyIncident =
      events.length === 0 &&
      ruleIds.size > 0 &&
      [...ruleIds].every((ruleId) => ruleId === "AR-TRACE-001");

    if (
      ruleIds.has("AR-RETRY-001") ||
      events.some((event) => ["unknown", "started", "failed"].includes(event.status))
    ) {
      addAction(incident, "verify-state", {
        title: "Resolve the ambiguous destination state",
        description: `Inspect ${destination} audit history for every cited attempt before changing or deleting anything. Determine whether more than one side effect occurred and preserve that evidence with the incident record.`,
        authorityRequired: `A human reviewer with read access to ${destination} audit history`,
        reversibility: "Read-only verification; preserve evidence before later containment",
      });
    } else if (!isEvidenceOnlyIncident) {
      addAction(incident, "preserve-evidence", {
        title: "Preserve and verify the destination evidence",
        description: `Confirm the cited event state in ${destination}, record the affected scope, and retain the relevant logs before taking a corrective action.`,
        authorityRequired: `A human reviewer with read access to ${destination}`,
        reversibility: "Read-only verification",
      });
    }

    if (ruleIds.has("AR-DATA-001") || ruleIds.has("AR-EGRESS-001")) {
      const includesSend = events.some((event) => event.operation === "send");
      addAction(incident, "contain", {
        title: includesSend
          ? "Review delivery scope and available containment"
          : "Review access and contain the external copy",
        description: includesSend
          ? `Use ${destination} delivery logs to identify the actual recipient scope. If policy and platform controls permit, an authorized responder can apply recall, access, or follow-up procedures; Agent Receipt does not execute them.`
          : `Review sharing, retention, and access in ${destination}. If the exposure is confirmed, an authorized responder can revoke access or remove the copy after preserving required evidence; Agent Receipt does not execute that action.`,
        authorityRequired: "Data owner or incident-response approval",
        reversibility: includesSend
          ? "Delivery may be irreversible; document any platform limits"
          : "Potentially destructive; preserve evidence and confirm rollback first",
      }, findings.filter((finding) => ["AR-DATA-001", "AR-EGRESS-001"].includes(finding.ruleId)).map((finding) => finding.findingId));
    }

    if (
      ["AR-SYS-001", "AR-OP-001", "AR-APPROVAL-001", "AR-APPROVAL-002"].some(
        (ruleId) => ruleIds.has(ruleId),
      )
    ) {
      addAction(incident, "prevent-repeat", {
        title: "Correct the authority controls before another run",
        description: "Keep the recorded receipt unchanged. Update the agent or workflow so it cannot repeat the cited system, operation, or approval deviation, then run a new trace through Agent Receipt. Do not retroactively widen the authority envelope to make this run appear clean.",
        authorityRequired: "Workflow owner approval and a new declared authority envelope",
        reversibility: "Configuration change; retain the prior policy and receipt for comparison",
      }, findings.filter((finding) => ["AR-SYS-001", "AR-OP-001", "AR-APPROVAL-001", "AR-APPROVAL-002"].includes(finding.ruleId)).map((finding) => finding.findingId));
    }

    if (ruleIds.has("AR-TRACE-001")) {
      addAction(incident, "close-evidence-gap", {
        title: "Close the evidence gap before accepting the run",
        description: "Obtain the missing trace field or source record when it can be collected lawfully. If it cannot be recovered, keep the limitation visible and base the disposition on the incomplete evidence boundary.",
        authorityRequired: "Reviewer or trace-system owner",
        reversibility: "Evidence collection only; never rewrite the original trace bytes",
      }, findings.filter((finding) => finding.ruleId === "AR-TRACE-001").map((finding) => finding.findingId));
    }
  }

  return actions;
}

export function buildSystemEdges(events: CanonicalEvent[]): SystemEdge[] {
  return events.map((event) => {
    const from = event.sourceSystem ?? event.actorId;
    const to =
      event.destinationSystem ??
      (event.sourceSystem ? event.actorId : "Destination not supplied");
    return {
      eventId: event.eventId,
      from,
      to,
      operation: event.operation,
      boundary: event.destinationBoundary,
      detail: [
        event.dataCategories.length > 0
          ? event.dataCategories.join(", ")
          : "Data category not supplied",
        event.quantity
          ? `${event.quantity.value} ${event.quantity.unit}`
          : "Quantity not supplied",
      ].join(" · "),
    };
  });
}

export function groupSystemsByBoundary(
  events: CanonicalEvent[],
  authority: AuthorityEnvelopeV1,
): SystemsByBoundary {
  const groups: Record<keyof SystemsByBoundary, Set<string>> = {
    local: new Set(),
    internal: new Set(),
    external: new Set(),
    unknown: new Set(),
  };
  const declaredBoundary = new Map(
    authority.permittedSystems.map((system) => [system.systemId, system.boundary]),
  );

  for (const event of events) {
    if (event.sourceSystem) {
      const boundary = declaredBoundary.get(event.sourceSystem) ?? "unknown";
      groups[boundary].add(event.sourceSystem);
    }
    if (event.destinationSystem) {
      groups[event.destinationBoundary].add(event.destinationSystem);
    }
  }

  return {
    local: [...groups.local],
    internal: [...groups.internal],
    external: [...groups.external],
    unknown: [...groups.unknown],
  };
}

export function buildHumanActionSummary(
  receipt: ReceiptResult,
): HumanActionSummary {
  const declaredBoundary = new Map(
    receipt.authority.permittedSystems.map((system) => [
      system.systemId,
      system.boundary,
    ]),
  );
  const systems = new Map<string, HumanSystemSummary>();

  const recordSystem = (
    systemId: string,
    boundary: Boundary,
    role: "source" | "destination",
    event: CanonicalEvent,
  ) => {
    const existing = systems.get(systemId) ?? {
      systemId,
      boundaries: [],
      roles: [],
      operations: [],
      statuses: [],
      dataCategories: [],
      eventIds: [],
    };
    pushUnique(existing.boundaries, boundary);
    pushUnique(existing.roles, role);
    pushUnique(existing.operations, event.operation);
    pushUnique(existing.statuses, event.status);
    for (const category of event.dataCategories) {
      pushUnique(existing.dataCategories, category);
    }
    pushUnique(existing.eventIds, event.eventId);
    systems.set(systemId, existing);
  };

  for (const event of receipt.events) {
    if (event.sourceSystem) {
      recordSystem(
        event.sourceSystem,
        declaredBoundary.get(event.sourceSystem) ?? "unknown",
        "source",
        event,
      );
    }
    if (event.destinationSystem) {
      recordSystem(
        event.destinationSystem,
        event.destinationBoundary,
        "destination",
        event,
      );
    }
  }

  const allEventIds = receipt.events.map((event) => event.eventId);
  const referencedSystems = new Set(systems.keys());
  const referencedDataCategories = new Set(
    receipt.events.flatMap((event) => event.dataCategories),
  );
  const noObservedActivity: HumanActionSummary["noObservedActivity"] = [];

  for (const system of receipt.authority.permittedSystems) {
    if (!referencedSystems.has(system.systemId)) {
      noObservedActivity.push({
        text: `The declared ${humanizeSlug(system.systemId)} system does not appear in any supplied event.`,
        eventIds: allEventIds,
      });
    }
  }
  for (const category of receipt.authority.prohibitedDataCategories) {
    if (!referencedDataCategories.has(category)) {
      noObservedActivity.push({
        text: `The restricted data category ${humanizeSlug(category)} does not appear in any supplied event.`,
        eventIds: allEventIds,
      });
    }
  }
  if (
    !receipt.events.some(
      (event) =>
        event.destinationSystem !== undefined &&
        event.destinationBoundary === "external",
    )
  ) {
    noObservedActivity.push({
      text: "No supplied event names an external destination.",
      eventIds: allEventIds,
    });
  }
  if (noObservedActivity.length === 0) {
    noObservedActivity.push({
      text: "Every declared system and restricted data category appears in the trace, and at least one external destination is named.",
      eventIds: allEventIds,
    });
  }

  return {
    systems: [...systems.values()],
    noObservedActivity,
    actions: receipt.events.map((event) => ({
      eventId: event.eventId,
      sequence: event.sequence,
      status: event.status,
      text: humanizeEvent(event),
    })),
  };
}

export function resolveRawPointer(
  rawDocument: unknown,
  rawPointer: string,
): unknown {
  if (rawPointer.startsWith("/")) {
    return resolveJsonPointer(rawDocument, rawPointer);
  }
  if (typeof rawDocument !== "object" || rawDocument === null) {
    return undefined;
  }
  const nativeMatch = /^events\[(\d+)]$/.exec(rawPointer);
  if (nativeMatch) {
    const rawEvents = (rawDocument as { events?: unknown }).events;
    if (!Array.isArray(rawEvents)) return undefined;
    return rawEvents[Number(nativeMatch[1])];
  }

  const otlpMatch =
    /^resourceSpans\[(\d+)]\.scopeSpans\[(\d+)]\.spans\[(\d+)]$/.exec(
      rawPointer,
    );
  if (!otlpMatch) return undefined;
  const resourceSpans = (rawDocument as { resourceSpans?: unknown }).resourceSpans;
  if (!Array.isArray(resourceSpans)) return undefined;
  const resource = resourceSpans[Number(otlpMatch[1])];
  if (typeof resource !== "object" || resource === null) return undefined;
  const scopeSpans = (resource as { scopeSpans?: unknown }).scopeSpans;
  if (!Array.isArray(scopeSpans)) return undefined;
  const scope = scopeSpans[Number(otlpMatch[2])];
  if (typeof scope !== "object" || scope === null) return undefined;
  const spans = (scope as { spans?: unknown }).spans;
  if (!Array.isArray(spans)) return undefined;
  return spans[Number(otlpMatch[3])];
}

function splitDataCategories(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function humanizeEvent(event: CanonicalEvent): string {
  const operation = actionVerb(event.operation);
  const resource = humanizeSlug(event.resourceType ?? "unnamed resource");
  const system = event.destinationSystem ?? event.sourceSystem;
  const location = system
    ? `${locationPreposition(event.operation, Boolean(event.destinationSystem))} ${humanizeSlug(system)}`
    : "at an unspecified system";
  const attempt = event.attempt === undefined ? "" : `Attempt ${event.attempt}: `;
  const quantitySentence = event.quantity
    ? `Quantity: ${event.quantity.value.toLocaleString("en-US")} ${event.quantity.unit}.`
    : "Quantity was not supplied.";
  const dataSentence =
    event.dataCategories.length > 0
      ? `Named data: ${formatHumanList(event.dataCategories.map(humanizeSlug))}.`
      : "Data category was not supplied.";
  const details = `${quantitySentence} ${dataSentence}`;

  switch (event.status) {
    case "succeeded":
      return `${attempt}${capitalize(operation.past)} ${resource} ${location}. ${details}`;
    case "failed":
      return `${attempt}Tried to ${operation.base} ${resource} ${location}. The trace records a failed result. ${details}`;
    case "cancelled":
      return `${attempt}Started to ${operation.base} ${resource} ${location}. The trace records that the action was cancelled. ${details}`;
    case "started":
      return `${attempt}Started to ${operation.base} ${resource} ${location}. The trace has no completed result for this event. ${details}`;
    case "unknown":
      return `${attempt}Tried to ${operation.base} ${resource} ${location}. The result is unknown in the trace. ${details}`;
  }
}

function buildIncidentTitle(events: CanonicalEvent[]): string {
  if (events.length === 0) return "Evidence coverage requires review";

  const sorted = [...events].sort((left, right) => left.sequence - right.sequence);
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last) return "Cited agent activity requires review";

  const isRetry =
    sorted.length > 1 &&
    first.actionKey !== undefined &&
    sorted.every((event) => event.actionKey === first.actionKey);
  if (isRetry) {
    const destination = humanizeSlug(
      last.destinationSystem ?? last.sourceSystem ?? last.resourceType ?? "action",
    );
    const noun: Partial<Record<CanonicalOperation, string>> = {
      create: "creation",
      update: "update",
      delete: "deletion",
      send: "delivery",
      execute: "execution",
    };
    const article = first.status === "unknown" ? "an" : "a";
    return `${capitalize(destination)} ${noun[last.operation] ?? "action"} retried after ${article} ${first.status} result`;
  }

  const destination = humanizeSlug(
    last.destinationSystem ?? last.sourceSystem ?? "unspecified system",
  );
  const resource = humanizeSlug(last.resourceType ?? "action");
  const quantity = last.quantity?.value.toLocaleString("en-US");
  const quantifiedResource = quantity
    ? `${quantity} ${pluralize(resource, last.quantity?.value ?? 1)}`
    : resource;
  const verb = actionVerb(last.operation).past;
  const preposition = locationPreposition(
    last.operation,
    last.destinationSystem !== undefined,
  );
  return `${capitalize(quantifiedResource)} ${verb} ${preposition} ${destination}`;
}

function buildIncidentSummary(
  events: CanonicalEvent[],
  findingCount: number,
): string {
  if (events.length === 0) {
    return `${findingCount} deterministic ${findingCount === 1 ? "finding requires" : "findings require"} review, but no canonical event citation is available.`;
  }

  const statuses = uniqueValues(events.map((event) => event.status));
  const dataCategories = uniqueStrings(
    events.flatMap((event) => event.dataCategories).map(humanizeSlug),
  );
  const eventPhrase = `${events.length} cited ${events.length === 1 ? "event" : "events"}`;
  const statusPhrase = `recorded ${formatHumanList(statuses.map(humanizeSlug))} ${statuses.length === 1 ? "status" : "statuses"}`;
  const dataPhrase =
    dataCategories.length === 0
      ? "No data category was supplied for these events."
      : `Named data: ${formatHumanList(dataCategories)}.`;
  return `${eventPhrase} with ${statusPhrase}. ${dataPhrase} This incident carries ${findingCount} deterministic ${findingCount === 1 ? "finding" : "findings"}.`;
}

function actionVerb(operation: CanonicalOperation): {
  base: string;
  past: string;
} {
  const verbs: Record<CanonicalOperation, { base: string; past: string }> = {
    read: { base: "read", past: "read" },
    retrieve: { base: "retrieve", past: "retrieved" },
    create: { base: "create", past: "created" },
    update: { base: "update", past: "updated" },
    delete: { base: "delete", past: "deleted" },
    send: { base: "send", past: "sent" },
    execute: { base: "run", past: "ran" },
    approve: { base: "approve", past: "approved" },
    error: { base: "report an error for", past: "reported an error for" },
    unknown: {
      base: "perform an unknown operation on",
      past: "performed an unknown operation on",
    },
  };
  return verbs[operation];
}

function locationPreposition(
  operation: CanonicalOperation,
  hasDestination: boolean,
): "from" | "in" | "to" | "using" {
  if (!hasDestination) return "from";
  if (operation === "send") return "to";
  if (operation === "execute") return "using";
  return "in";
}

function humanizeSlug(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\bid\b/gi, "ID")
    .replace(/\bkb\b/gi, "KB");
}

function formatHumanList(items: string[]): string {
  if (items.length < 2) return items[0] ?? "unknown";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function pluralize(value: string, count: number): string {
  if (count === 1 || value.endsWith("s")) return value;
  if (value.endsWith("y") && !/[aeiou]y$/i.test(value)) {
    return `${value.slice(0, -1)}ies`;
  }
  return `${value}s`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function uniqueValues<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function pushUnique<T>(items: T[], value: T): void {
  if (!items.includes(value)) items.push(value);
}

function formatJsonLocation(error: unknown, sourceText: string): string {
  const rawMessage = error instanceof Error ? error.message : "";
  const positionMatch = /position\s+(\d+)/i.exec(rawMessage);
  if (!positionMatch) {
    return "The trace is not valid JSON. Check the syntax and try again.";
  }
  const position = Number(positionMatch[1]);
  const before = sourceText.slice(0, position);
  const line = before.split("\n").length;
  const lineStart = before.lastIndexOf("\n");
  const column = position - lineStart;
  return `The trace is not valid JSON near line ${line}, column ${column}.`;
}
