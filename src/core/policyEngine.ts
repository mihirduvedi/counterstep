import type {
  AuthorityEnvelopeV1,
  CanonicalEvent,
  Finding,
  RawEventAccounting,
  Verdict,
} from "./schemas/index";
import { instantBefore } from "./timestamps";
import {
  buildPolicyDecisionLedger,
  type PolicyDecisionLedger,
} from "./policyLedger";

let _findingCounter = 0;

function nextFindingId(): string {
  _findingCounter += 1;
  return `finding-${String(_findingCounter).padStart(4, "0")}`;
}

/** Reset counter (for test isolation) */
export function _resetFindingCounter(): void {
  _findingCounter = 0;
}

// ─── AR-SYS-001 ───────────────────────────────────────────────────────────────
function checkSystems(
  events: CanonicalEvent[],
  authority: AuthorityEnvelopeV1,
): Finding[] {
  const permittedIds = new Set(
    authority.permittedSystems.map((s) => s.systemId),
  );
  const findings: Finding[] = [];

  for (const ev of events) {
    const systems = [
      { label: "sourceSystem", value: ev.sourceSystem },
      { label: "destinationSystem", value: ev.destinationSystem },
    ];
    for (const { label, value } of systems) {
      if (!value) continue;
      if (permittedIds.has(value)) continue;

      const isHighSeverity =
        (ev.stateChange && ev.status === "succeeded") ||
        ev.destinationBoundary === "external";

      findings.push({
        findingId: nextFindingId(),
        ruleId: "AR-SYS-001",
        severity: isHighSeverity ? "high" : "medium",
        label: "System was not permitted",
        description: `Event ${ev.eventId} names ${label === "sourceSystem" ? "source system" : "destination system"} "${value}". That system is missing from the permitted-systems list.`,
        eventIds: [ev.eventId],
        policyPath: "permittedSystems",
        observedValue: value,
        expectedValue: [...permittedIds],
      });
    }
  }
  return findings;
}

// ─── AR-OP-001 ────────────────────────────────────────────────────────────────
function checkOperations(
  events: CanonicalEvent[],
  authority: AuthorityEnvelopeV1,
): Finding[] {
  const permittedOps = new Set(authority.permittedOperations);
  const findings: Finding[] = [];

  for (const ev of events) {
    // PRD §7 applies operation allowlisting to succeeded or unknown-status
    // events, plus any event explicitly marked as state-changing.
    const applicable =
      ev.status === "succeeded" || ev.status === "unknown" || ev.stateChange;
    if (!applicable) continue;
    if (permittedOps.has(ev.operation)) continue;
    // "unknown" and "error" operations: only flag if not already filtered
    if (ev.operation === "error" || ev.operation === "unknown") continue;

    const highOps = new Set(["create", "update", "delete", "send"]);
    const severity: Finding["severity"] = highOps.has(ev.operation)
      ? "high"
      : "medium";

    findings.push({
      findingId: nextFindingId(),
      ruleId: "AR-OP-001",
      severity,
      label: "Operation was not permitted",
      description: `Event ${ev.eventId} records the operation "${ev.operation}". That operation is missing from the permitted-operations list.`,
      eventIds: [ev.eventId],
      policyPath: "permittedOperations",
      observedValue: ev.operation,
      expectedValue: [...permittedOps],
    });
  }
  return findings;
}

// ─── AR-EGRESS-001 ────────────────────────────────────────────────────────────
function checkEgress(
  events: CanonicalEvent[],
  authority: AuthorityEnvelopeV1,
): Finding[] {
  if (authority.externalEgressAllowed) return [];
  const findings: Finding[] = [];

  for (const ev of events) {
    if (ev.destinationBoundary !== "external") continue;
    findings.push({
      findingId: nextFindingId(),
      ruleId: "AR-EGRESS-001",
      severity: "high",
      label: "External destination was not permitted",
      description: `Event ${ev.eventId} names an external destination. The authority envelope does not permit external egress.`,
      eventIds: [ev.eventId],
      policyPath: "externalEgressAllowed",
      observedValue: ev.destinationBoundary,
      expectedValue: false,
    });
  }
  return findings;
}

// ─── AR-DATA-001 ──────────────────────────────────────────────────────────────
function checkData(
  events: CanonicalEvent[],
  authority: AuthorityEnvelopeV1,
): Finding[] {
  const prohibited = new Set(authority.prohibitedDataCategories);
  if (prohibited.size === 0) return [];
  const findings: Finding[] = [];

  // "moves or writes" = state change OR destination is external/internal/unknown (not stayed local read)
  const isMovingOrWriting = (ev: CanonicalEvent) =>
    ev.stateChange ||
    ev.destinationBoundary === "external" ||
    ev.destinationBoundary === "internal" ||
    ["create", "update", "delete", "send"].includes(ev.operation);

  for (const ev of events) {
    if (!isMovingOrWriting(ev)) continue;
    const hit = ev.dataCategories.filter((c) => prohibited.has(c));
    if (hit.length === 0) continue;

    findings.push({
      findingId: nextFindingId(),
      ruleId: "AR-DATA-001",
      severity: "high",
      label: "Restricted data in a consequential operation",
      description: `Event ${ev.eventId} names restricted data in a state-changing or data-moving operation: ${hit.join(", ")}.`,
      eventIds: [ev.eventId],
      policyPath: "prohibitedDataCategories",
      observedValue: hit,
      expectedValue: [],
    });
  }
  return findings;
}

// ─── AR-VOLUME-001 ────────────────────────────────────────────────────────────
function checkVolume(
  events: CanonicalEvent[],
  authority: AuthorityEnvelopeV1,
): Finding[] {
  if (authority.maxRecordsRead === undefined) return [];
  const limit = authority.maxRecordsRead;
  const findings: Finding[] = [];

  const contributing: CanonicalEvent[] = [];
  const unknownQuantityEvents: CanonicalEvent[] = [];
  let total = 0n;

  for (const ev of events) {
    if (!["read", "retrieve"].includes(ev.operation)) continue;
    if (ev.status !== "succeeded") continue;
    if (!ev.quantity || ev.quantity.unit !== "records") {
      unknownQuantityEvents.push(ev);
      continue;
    }
    contributing.push(ev);
    total += BigInt(ev.quantity.value);
  }

  // PRD §7: "Unknown quantities generate an assessment limitation rather than
  // being estimated." Emit an AR-TRACE-001 per unknown-quantity event when
  // maxRecordsRead is defined so the caller can set hasAssessmentLimitation.
  for (const ev of unknownQuantityEvents) {
    findings.push({
      findingId: nextFindingId(),
      ruleId: "AR-TRACE-001",
      severity: "high",
      label: "Record limit cannot be assessed",
      description: `Event ${ev.eventId} completed a ${ev.operation} without a record count. The ${limit}-record limit cannot be evaluated from this trace.`,
      eventIds: [ev.eventId],
      policyPath: "maxRecordsRead",
      observedValue: "unknown",
      expectedValue: "a records quantity",
    });
  }

  if (total > BigInt(limit)) {
    const observedTotal: number | string =
      total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : total.toString();
    findings.push({
      findingId: nextFindingId(),
      ruleId: "AR-VOLUME-001",
      severity: "medium",
      label: "Record limit exceeded",
      description: `Successful read and retrieve events total ${total} records. The declared limit is ${limit}.`,
      eventIds: contributing.map((e: CanonicalEvent) => e.eventId),
      policyPath: "maxRecordsRead",
      observedValue: observedTotal,
      expectedValue: limit,
    });
  }

  return findings;
}

// ─── AR-APPROVAL-001 / AR-APPROVAL-002 ───────────────────────────────────────
//
// approvalRef semantics (PRD §7):
//   "approvalRequiredFor requires a successful human approve event that
//    references the action or is referenced by the action."
//
// In the native format, approvalRef is a native source event ID. Canonical
// events retain sourceEventId so linkage remains deterministic and serializable.
//
// Only the two explicit linkage directions are supported:
//   (A) action.approvalRef === approval.sourceEventId  (action → approval)
//   (B) approval.approvalRef === action.sourceEventId  (approval → action)
// A shared actionKey alone is not approval evidence.
function checkApprovals(
  events: CanonicalEvent[],
  authority: AuthorityEnvelopeV1,
): Finding[] {
  const requiredOps = new Set(authority.approvalRequiredFor);
  if (requiredOps.size === 0) return [];

  const findings: Finding[] = [];

  // Index approval events by their canonical and native source IDs.
  // approvalsByCanonicalId: canonical eventId  → approval CanonicalEvent
  // approvalsBySourceId:    sourceEventId      → approval CanonicalEvent
  const approvalsByCanonicalId = new Map<string, CanonicalEvent>();
  const approvalsBySourceId = new Map<string, CanonicalEvent>();

  for (const ev of events) {
    if (ev.operation !== "approve" || ev.status !== "succeeded") continue;
    if (ev.actorType !== "human") continue;

    approvalsByCanonicalId.set(ev.eventId, ev);
    if (ev.sourceEventId) {
      approvalsBySourceId.set(ev.sourceEventId, ev);
    }
  }

  for (const ev of events) {
    if (!requiredOps.has(ev.operation)) continue;
    if (ev.status !== "succeeded") continue;

    // Collect explicitly linked approvals in either direction (deduplicate by eventId).
    const linkedMap = new Map<string, CanonicalEvent>();

    // Direction A: action.approvalRef is a native source ID → look up approval
    if (ev.approvalRef) {
      // approvalRef may be a native source event ID OR (for compat) a canonical ID
      const bySource = approvalsBySourceId.get(ev.approvalRef);
      if (bySource) linkedMap.set(bySource.eventId, bySource);
      const byCanonical = approvalsByCanonicalId.get(ev.approvalRef);
      if (byCanonical) linkedMap.set(byCanonical.eventId, byCanonical);
    }

    // Direction B: approval.approvalRef is a native source ID that points to this action
    if (ev.sourceEventId) {
      for (const approval of approvalsByCanonicalId.values()) {
        if (approval.approvalRef === ev.sourceEventId) {
          linkedMap.set(approval.eventId, approval);
        }
      }
    }

    const linked = [...linkedMap.values()];

    if (linked.length === 0) {
      findings.push({
        findingId: nextFindingId(),
        ruleId: "AR-APPROVAL-001",
        severity: "high",
        label: "Required approval not found",
        description: `Event ${ev.eventId} completed "${ev.operation}", which requires human approval. The trace has no linked approval recorded before this action.`,
        eventIds: [ev.eventId],
        policyPath: "approvalRequiredFor",
        observedValue: ev.operation,
        expectedValue: "a prior successful human approve event",
      });
      continue;
    }

    // AR-APPROVAL-002: at least one approval must have an instant strictly
    // before the action instant. Compare using parsed instants, not string order.
    const validApprovals = linked.filter((ap) =>
      instantBefore(ap.timestamp, ev.timestamp),
    );
    if (validApprovals.length === 0) {
      findings.push({
        findingId: nextFindingId(),
        ruleId: "AR-APPROVAL-002",
        severity: "high",
        label: "Approval was recorded too late",
        description: `The approval linked to event ${ev.eventId} is timestamped at or after the action time, ${ev.timestamp}.`,
        eventIds: [ev.eventId, ...linked.map((a: CanonicalEvent) => a.eventId)],
        policyPath: "approvalRequiredFor",
        observedValue: linked.map((a: CanonicalEvent) => a.timestamp),
        expectedValue: `strictly before ${ev.timestamp}`,
      });
    }
  }
  return findings;
}

// ─── AR-RETRY-001 ─────────────────────────────────────────────────────────────
function checkRetry(events: CanonicalEvent[]): Finding[] {
  // Group by actionKey, then look for attempt N+1 after failed/unknown completion
  const byKey = new Map<string, CanonicalEvent[]>();
  for (const ev of events) {
    if (!ev.actionKey) continue;
    const list = byKey.get(ev.actionKey) ?? [];
    list.push(ev);
    byKey.set(ev.actionKey, list);
  }

  const findings: Finding[] = [];

  for (const [, group] of byKey) {
    const sorted = [...group].sort((a, b) =>
      a.sequence < b.sequence ? -1 : a.sequence > b.sequence ? 1 : 0,
    );

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];

      if ((curr.attempt ?? 1) <= (prev.attempt ?? 1)) continue;

      if (prev.status === "failed" || prev.status === "unknown") {
        findings.push({
          findingId: nextFindingId(),
          ruleId: "AR-RETRY-001",
          severity: "medium",
          label: "Retry followed an uncertain result",
          description: `Event ${curr.eventId} is attempt ${curr.attempt ?? "?"} for action "${curr.actionKey}". It followed event ${prev.eventId}, recorded as "${prev.status}". A repeated side effect is possible because the earlier event does not establish whether the destination changed.`,
          eventIds: [prev.eventId, curr.eventId],
          policyPath: undefined,
          observedValue: prev.status,
          expectedValue: "succeeded or failed with known outcome",
        });
      }
    }
  }
  return findings;
}

// ─── AR-ERROR-001 ─────────────────────────────────────────────────────────────
function checkErrorThenStateChange(events: CanonicalEvent[]): Finding[] {
  // Within a parent branch (same parentEventId), a state-changing success after
  // an unhandled error in the same branch is flagged.
  const findings: Finding[] = [];

  // Group by parentEventId (including undefined → root)
  const byParent = new Map<string | undefined, CanonicalEvent[]>();
  for (const ev of events) {
    const key = ev.parentEventId;
    const list = byParent.get(key) ?? [];
    list.push(ev);
    byParent.set(key, list);
  }

  for (const [, branch] of byParent) {
    const sorted = [...branch].sort((a, b) => a.sequence - b.sequence);

    let lastUnhandledError: CanonicalEvent | undefined;

    for (const ev of sorted) {
      if (ev.operation === "error") {
        lastUnhandledError = ev;
        continue;
      }
      // If we see a non-error event, the error is considered handled if the
      // branch continues normally; we re-flag on next error only
      if (
        lastUnhandledError &&
        ev.stateChange &&
        ev.status === "succeeded"
      ) {
        findings.push({
          findingId: nextFindingId(),
          ruleId: "AR-ERROR-001",
          severity: "medium",
          label: "State change followed an unhandled error",
          description: `Event ${ev.eventId} records a successful state change after error event ${lastUnhandledError.eventId} in the same parent branch. The trace does not show that error being handled first.`,
          eventIds: [lastUnhandledError.eventId, ev.eventId],
        });
        lastUnhandledError = undefined;
      }
    }
  }
  return findings;
}

// ─── AR-TRACE-001 ─────────────────────────────────────────────────────────────
function checkTraceIntegrity(
  events: CanonicalEvent[],
  accounting: RawEventAccounting[],
  traceCompletionStatus: string,
): Finding[] {
  const findings: Finding[] = [];

  // Material unparsed events
  for (const acc of accounting) {
    if (acc.status === "unparsed" && acc.material) {
      findings.push({
        findingId: nextFindingId(),
        ruleId: "AR-TRACE-001",
        severity: "high",
        label: "Material event could not be parsed",
        description: `The raw event at ${acc.rawPointer} could not be parsed. It is material to this assessment. Recorded reason: ${(acc.reason ?? "unknown").replace(/\.$/, "")}.`,
        eventIds: [],
        policyPath: undefined,
        observedValue: acc.rawPointer,
        expectedValue: "fully parsable event",
      });
    }
  }

  // Events with unknown operation
  for (const ev of events) {
    if (ev.operation === "unknown") {
      findings.push({
        findingId: nextFindingId(),
        ruleId: "AR-TRACE-001",
        severity: "high",
        label: "Operation is unknown",
        description: `Event ${ev.eventId} records its operation as "unknown", leaving part of the authority assessment unresolved.`,
        eventIds: [ev.eventId],
      });
    }
  }

  // Missing run termination evidence
  const terminalStatuses = ["succeeded", "failed", "cancelled"];
  if (!terminalStatuses.includes(traceCompletionStatus)) {
    findings.push({
      findingId: nextFindingId(),
      ruleId: "AR-TRACE-001",
      severity: "high",
      label: "Run termination is unknown",
      description: `The trace status is "${traceCompletionStatus}". A complete authority assessment requires a terminal status of succeeded, failed, or cancelled.`,
      eventIds: [],
      observedValue: traceCompletionStatus,
      expectedValue: "succeeded | failed | cancelled",
    });
  }

  return findings;
}

// ─── Verdict computation ──────────────────────────────────────────────────────

export function computeVerdict(
  findings: Finding[],
  hasAssessmentLimitation: boolean,
): Verdict {
  if (hasAssessmentLimitation) return "unable_to_assess_fully";
  const hasHigh = findings.some((f) => f.severity === "high");
  if (hasHigh) return "material_deviations_found";
  const hasLowMed = findings.some(
    (f) => f.severity === "low" || f.severity === "medium",
  );
  if (hasLowMed) return "review_recommended";
  return "within_declared_authority";
}

// ─── Main entry ───────────────────────────────────────────────────────────────

export interface PolicyEngineInput {
  events: CanonicalEvent[];
  accounting: RawEventAccounting[];
  authority: AuthorityEnvelopeV1;
  traceCompletionStatus: string;
}

export interface PolicyEngineOutput {
  findings: Finding[];
  verdict: Verdict;
  hasAssessmentLimitation: boolean;
  policyLedger: PolicyDecisionLedger;
}

export function runPolicyEngine(input: PolicyEngineInput): PolicyEngineOutput {
  _resetFindingCounter();

  const { events, accounting, authority, traceCompletionStatus } = input;

  const traceFindings = checkTraceIntegrity(
    events,
    accounting,
    traceCompletionStatus,
  );

  const volumeFindings = checkVolume(events, authority);

  // hasAssessmentLimitation is true if any AR-TRACE-001 exists (from trace
  // integrity checks OR from unknown-quantity volume checks).
  const hasAssessmentLimitation =
    traceFindings.some((f) => f.ruleId === "AR-TRACE-001") ||
    volumeFindings.some((f) => f.ruleId === "AR-TRACE-001") ||
    accounting.some((a: RawEventAccounting) => a.status === "unparsed" && a.material);

  const authorityFindings = [
    ...checkSystems(events, authority),
    ...checkOperations(events, authority),
    ...checkEgress(events, authority),
    ...checkData(events, authority),
    ...volumeFindings,
    ...checkApprovals(events, authority),
  ];

  const behaviorFindings = [
    ...checkRetry(events),
    ...checkErrorThenStateChange(events),
  ];

  const allFindings = [
    ...traceFindings,
    ...authorityFindings,
    ...behaviorFindings,
  ];

  const verdict = computeVerdict(allFindings, hasAssessmentLimitation);

  const policyLedger = buildPolicyDecisionLedger({
    traceId: events[0]?.traceId ?? "trace-not-supplied",
    events,
    accounting,
    authority,
    findings: allFindings,
    verdict,
  });

  return {
    findings: allFindings,
    verdict,
    hasAssessmentLimitation,
    policyLedger,
  };
}
