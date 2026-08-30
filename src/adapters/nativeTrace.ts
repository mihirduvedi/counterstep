import type {
  AdapterResult,
  CanonicalEvent,
  NativeTraceV1,
  RawEventAccounting,
} from "../core/schemas/index";
import {
  CANONICAL_EVENT_SCHEMA_VERSION,
  NATIVE_TRACE_SCHEMA_VERSION,
} from "../core/schemas/index";
import { compareInstants } from "../core/timestamps";

export const NATIVE_ADAPTER_VERSION = "1.0.0";
export const NATIVE_ADAPTER_FORMAT = NATIVE_TRACE_SCHEMA_VERSION;
export const NATIVE_ADAPTER_NAME = "nativeTrace";

const CANONICAL_EVENT_SCHEMA = CANONICAL_EVENT_SCHEMA_VERSION;

/**
 * Convert a validated NativeTraceV1 into canonical events with full accounting.
 *
 * Invariants:
 * - Every raw event produces exactly one accounting record.
 * - Duplicate source event IDs are rejected (returned as unparsed with a reason).
 * - Events are ordered by (timestamp instant ASC, original source order ASC for ties).
 * - Canonical IDs are stable within the receipt: evt-NNNNNN (zero-padded 6-digits).
 * - Missing destinationBoundary defaults to "unknown".
 * - Missing dataCategories defaults to [].
 * - approvalRef values are native source event IDs and are carried through
 *   verbatim. Canonical events retain sourceEventId for deterministic linkage.
 */
export function adaptNativeTrace(trace: NativeTraceV1): AdapterResult {
  const events: CanonicalEvent[] = [];
  const accounting: RawEventAccounting[] = [];

  // Detect duplicate source event IDs upfront — reject entire duplicate entries
  const seenSourceIds = new Set<string>();
  const duplicateIds = new Set<string>();
  for (const ev of trace.events) {
    if (seenSourceIds.has(ev.id)) {
      duplicateIds.add(ev.id);
    }
    seenSourceIds.add(ev.id);
  }

  // Sort events: timestamp instant ASC, then original index for ties
  type Indexed = { ev: NativeTraceV1["events"][number]; originalIndex: number };
  const indexed: Indexed[] = trace.events.map((ev, originalIndex) => ({
    ev,
    originalIndex,
  }));
  indexed.sort((a: Indexed, b: Indexed) => {
    const instantOrder = compareInstants(a.ev.timestamp, b.ev.timestamp);
    if (instantOrder !== 0) return instantOrder;
    return a.originalIndex - b.originalIndex;
  });

  let sequence = 0;

  for (const { ev, originalIndex } of indexed) {
    const rawPointer = `events[${originalIndex}]`;

    if (duplicateIds.has(ev.id)) {
      accounting.push({
        rawPointer,
        sourceEventId: ev.id,
        status: "unparsed",
        canonicalEventIds: [],
        reason: `Duplicate source event ID "${ev.id}" — rejected per MVP policy.`,
        material: true,
      });
      continue;
    }

    sequence += 1;
    const eventId = `evt-${String(sequence).padStart(6, "0")}`;

    const canonical: CanonicalEvent = {
      schemaVersion: CANONICAL_EVENT_SCHEMA,
      eventId,
      sourceEventId: ev.id,
      traceId: trace.traceId,
      parentEventId: ev.parentId,
      sequence,
      timestamp: ev.timestamp,
      actorType: ev.actor.type,
      actorId: ev.actor.id,
      operation: ev.operation,
      toolName: ev.toolName,
      sourceSystem: ev.sourceSystem,
      destinationSystem: ev.destinationSystem,
      destinationBoundary: ev.destinationBoundary ?? "unknown",
      resourceType: ev.resourceType,
      dataCategories: ev.dataCategories ?? [],
      quantity: ev.quantity,
      stateChange: ev.stateChange,
      status: ev.status,
      // approvalRef carries the native source event ID verbatim
      approvalRef: ev.approvalRef,
      actionKey: ev.actionKey,
      attempt: ev.attempt,
      rawPointer,
      adapterWarnings: [],
      riskTags: [],
    };

    events.push(canonical);
    accounting.push({
      rawPointer,
      sourceEventId: ev.id,
      status: "mapped",
      canonicalEventIds: [eventId],
      material: true,
    });
  }

  return {
    format: NATIVE_ADAPTER_FORMAT,
    adapterVersion: NATIVE_ADAPTER_VERSION,
    events,
    accounting,
    warnings: [],
  };
}
