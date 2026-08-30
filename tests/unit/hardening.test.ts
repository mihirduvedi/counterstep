/**
 * Tests for the three contract gaps hardened in this slice:
 * 1. RFC 3339 timestamp validation + instant-based ordering/comparison
 * 2. Unknown-quantity assessment limitation (AR-TRACE-001 via checkVolume)
 * 3. Approval linkage — both directions, native source ID resolution
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  compareInstants,
  isRfc3339WithTz,
  instantBefore,
  toInstantMs,
} from "../../src/core/timestamps.js";
import {
  IntegrityMetadataSchema,
  NativeEventV1Schema,
  NativeTraceV1Schema,
} from "../../src/core/schemas/index.js";
import type { CanonicalEvent, AuthorityEnvelopeV1 } from "../../src/core/schemas/index.js";
import { adaptNativeTrace } from "../../src/adapters/nativeTrace.js";
import type { NativeTraceV1 } from "../../src/core/schemas/index.js";
import { runPolicyEngine, _resetFindingCounter } from "../../src/core/policyEngine.js";

beforeEach(() => { _resetFindingCounter(); });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function baseTrace(events: NativeTraceV1["events"]): NativeTraceV1 {
  return {
    schemaVersion: "agent-receipt.native-trace.v1",
    traceId: "trace-ts-test",
    agent: { id: "agent-test" },
    startedAt: "2024-01-01T00:00:00Z",
    status: "succeeded",
    events,
  };
}

function makeCanonicalEvent(overrides: Partial<CanonicalEvent> & { eventId: string }): CanonicalEvent {
  return {
    schemaVersion: "agent-receipt.canonical-event.v1",
    traceId: "trace-001",
    sequence: 1,
    timestamp: "2024-01-01T00:01:00Z",
    actorType: "agent",
    actorId: "agent-test",
    operation: "read",
    destinationBoundary: "internal",
    dataCategories: [],
    stateChange: false,
    status: "succeeded",
    rawPointer: "events[0]",
    adapterWarnings: [],
    riskTags: [],
    ...overrides,
  };
}

function makeAuthority(overrides: Partial<AuthorityEnvelopeV1> = {}): AuthorityEnvelopeV1 {
  return {
    schemaVersion: "agent-receipt.authority.v1",
    policyId: "test-policy",
    task: "test task",
    permittedSystems: [],
    permittedOperations: ["read", "retrieve", "send", "approve"],
    prohibitedDataCategories: [],
    externalEgressAllowed: false,
    approvalRequiredFor: [],
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. RFC 3339 timestamp validation
// ═══════════════════════════════════════════════════════════════════════════════

describe("RFC 3339 timestamp validation — isRfc3339WithTz", () => {
  it("accepts UTC Z suffix", () => {
    expect(isRfc3339WithTz("2024-01-01T00:00:00Z")).toBe(true);
  });

  it("accepts positive offset +HH:MM", () => {
    expect(isRfc3339WithTz("2024-01-01T05:30:00+05:30")).toBe(true);
  });

  it("accepts negative offset -HH:MM", () => {
    expect(isRfc3339WithTz("2024-01-01T00:00:00-08:00")).toBe(true);
  });

  it("accepts sub-second precision with Z", () => {
    expect(isRfc3339WithTz("2024-01-01T00:00:00.123456Z")).toBe(true);
  });

  it("accepts sub-second precision with offset", () => {
    expect(isRfc3339WithTz("2024-08-01T14:30:00.999+02:00")).toBe(true);
  });

  it("rejects plain date string", () => {
    expect(isRfc3339WithTz("2024-01-01")).toBe(false);
  });

  it("rejects ISO 8601 without timezone", () => {
    expect(isRfc3339WithTz("2024-01-01T00:00:00")).toBe(false);
  });

  it("rejects impossible calendar dates", () => {
    expect(isRfc3339WithTz("2024-02-30T00:00:00Z")).toBe(false);
    expect(isRfc3339WithTz("2023-02-29T00:00:00Z")).toBe(false);
  });

  it("rejects space separator", () => {
    expect(isRfc3339WithTz("2024-01-01 00:00:00Z")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isRfc3339WithTz("")).toBe(false);
  });
});

describe("RFC 3339 — Zod schema enforcement on NativeEventV1", () => {
  it("rejects event with timestamp missing timezone", () => {
    const raw = {
      id: "ev-1",
      timestamp: "2024-01-01T00:00:00", // no tz
      actor: { type: "agent", id: "a1" },
      operation: "read",
      stateChange: false,
      status: "succeeded",
    };
    expect(NativeEventV1Schema.safeParse(raw).success).toBe(false);
  });

  it("rejects NativeTraceV1 with startedAt missing timezone", () => {
    const raw = {
      schemaVersion: "agent-receipt.native-trace.v1",
      traceId: "t1",
      agent: { id: "a1" },
      startedAt: "2024-01-01T00:00:00", // no tz
      status: "succeeded",
      events: [],
    };
    expect(NativeTraceV1Schema.safeParse(raw).success).toBe(false);
  });

  it("accepts NativeTraceV1 with fully valid RFC 3339 timestamps", () => {
    const raw = {
      schemaVersion: "agent-receipt.native-trace.v1",
      traceId: "t1",
      agent: { id: "a1" },
      startedAt: "2024-01-01T00:00:00+05:30",
      status: "succeeded",
      events: [],
    };
    expect(NativeTraceV1Schema.safeParse(raw).success).toBe(true);
  });
});

describe("Integrity metadata contract", () => {
  const validMetadata = {
    sha256: "a".repeat(64),
    byteLength: 128,
    inputFormat: "agent-receipt.native-trace.v1",
    schemaVersion: "agent-receipt.native-trace.v1",
    adapterName: "nativeTrace",
    adapterVersion: "1.0.0",
    authoritySchemaVersion: "agent-receipt.authority.v1",
    policyId: "policy-001",
    canonicalEventSchemaVersion: "agent-receipt.canonical-event.v1",
    receiptSchemaVersion: "agent-receipt.receipt.v1",
    generatedAt: "2026-08-25T21:00:00-07:00",
    generationSource: "deterministic_fallback",
  };

  it("accepts the PRD fallback source value and an RFC 3339 generation timestamp", () => {
    expect(IntegrityMetadataSchema.safeParse(validMetadata).success).toBe(true);
  });

  it("rejects the old hyphenated fallback value and an invalid generation timestamp", () => {
    expect(
      IntegrityMetadataSchema.safeParse({
        ...validMetadata,
        generationSource: "deterministic-fallback",
      }).success,
    ).toBe(false);
    expect(
      IntegrityMetadataSchema.safeParse({
        ...validMetadata,
        generatedAt: "2026-02-30T21:00:00-08:00",
      }).success,
    ).toBe(false);
  });
});

describe("instantBefore — cross-timezone comparison", () => {
  it("correctly orders identical instants expressed in different timezones", () => {
    // 2024-01-01T00:00:00Z and 2024-01-01T05:30:00+05:30 are the same instant
    const utc = "2024-01-01T00:00:00Z";
    const ist = "2024-01-01T05:30:00+05:30";
    expect(instantBefore(utc, ist)).toBe(false);
    expect(instantBefore(ist, utc)).toBe(false);
    expect(toInstantMs(utc)).toBe(toInstantMs(ist));
  });

  it("correctly determines earlier instant across different offsets", () => {
    // 2024-01-01T01:00:00+05:30 (UTC 19:30 previous day) is before 2024-01-01T00:00:00Z
    const earlier = "2023-12-31T19:30:00+00:00"; // explicit UTC
    const later = "2024-01-01T00:00:00Z";
    expect(instantBefore(earlier, later)).toBe(true);
    expect(instantBefore(later, earlier)).toBe(false);
  });

  it("preserves ordering below JavaScript Date millisecond precision", () => {
    const earlier = "2024-01-01T00:00:00.0001Z";
    const later = "2024-01-01T00:00:00.0002Z";

    expect(toInstantMs(earlier)).toBe(toInstantMs(later));
    expect(compareInstants(earlier, later)).toBe(-1);
    expect(compareInstants(later, earlier)).toBe(1);
    expect(instantBefore(earlier, later)).toBe(true);
  });
});

describe("Adapter — instant-based event ordering across timezone offsets", () => {
  it("orders events by their actual instant, not lexicographic string", () => {
    // ev-local happens at 14:00 UTC (16:00+02:00), ev-utc at 12:00Z
    // Lexicographically "2024-01-01T16:00:00+02:00" > "2024-01-01T12:00:00Z"
    // But by instant, 12:00Z is first.
    const trace = baseTrace([
      {
        id: "ev-local",
        timestamp: "2024-01-01T16:00:00+02:00", // 14:00 UTC — appears 2nd
        actor: { type: "agent", id: "a" },
        operation: "create",
        stateChange: true,
        status: "succeeded",
        dataCategories: [],
      },
      {
        id: "ev-utc",
        timestamp: "2024-01-01T12:00:00Z", // 12:00 UTC — should be 1st
        actor: { type: "agent", id: "a" },
        operation: "read",
        stateChange: false,
        status: "succeeded",
        dataCategories: [],
      },
    ]);
    const result = adaptNativeTrace(trace);
    expect(result.events[0].sourceEventId).toBe("ev-utc");
    expect(result.events[1].sourceEventId).toBe("ev-local");
  });

  it("preserves original source order for events at identical instants in different timezones", () => {
    // Both represent the same UTC instant
    const trace = baseTrace([
      {
        id: "ev-first",
        timestamp: "2024-01-01T05:30:00+05:30", // same instant as ev-second
        actor: { type: "agent", id: "a" },
        operation: "read",
        stateChange: false,
        status: "succeeded",
        dataCategories: [],
      },
      {
        id: "ev-second",
        timestamp: "2024-01-01T00:00:00Z",
        actor: { type: "agent", id: "a" },
        operation: "read",
        stateChange: false,
        status: "succeeded",
        dataCategories: [],
      },
    ]);
    const result = adaptNativeTrace(trace);
    // Tie broken by original source order (first in input wins)
    expect(result.events[0].sourceEventId).toBe("ev-first");
    expect(result.events[1].sourceEventId).toBe("ev-second");
  });

  it("orders distinct sub-millisecond instants instead of treating them as ties", () => {
    const trace = baseTrace([
      {
        id: "ev-later",
        timestamp: "2024-01-01T00:00:00.0002Z",
        actor: { type: "agent", id: "a" },
        operation: "send",
        stateChange: true,
        status: "succeeded",
        dataCategories: [],
      },
      {
        id: "ev-earlier",
        timestamp: "2024-01-01T00:00:00.0001Z",
        actor: { type: "human", id: "h" },
        operation: "approve",
        stateChange: false,
        status: "succeeded",
        dataCategories: [],
      },
    ]);

    const result = adaptNativeTrace(trace);

    expect(result.events.map((event) => event.sourceEventId)).toEqual([
      "ev-earlier",
      "ev-later",
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Unknown-quantity assessment limitation (AR-TRACE-001 from checkVolume)
// ═══════════════════════════════════════════════════════════════════════════════

describe("AR-TRACE-001 via unknown quantity — volume assessment limitation", () => {
  it("emits AR-TRACE-001 for a successful read with no records quantity when maxRecordsRead is set", () => {
    const ev = makeCanonicalEvent({
      eventId: "evt-000001",
      operation: "read",
      status: "succeeded",
      // quantity absent
    });
    const auth = makeAuthority({ maxRecordsRead: 500 });
    const { findings, verdict, hasAssessmentLimitation } = runPolicyEngine({
      events: [ev],
      accounting: [],
      authority: auth,
      traceCompletionStatus: "succeeded",
    });
    const limitation = findings.filter((f: { ruleId: string }) => f.ruleId === "AR-TRACE-001");
    expect(limitation.length).toBeGreaterThan(0);
    expect(limitation[0].eventIds).toContain("evt-000001");
    expect(hasAssessmentLimitation).toBe(true);
    expect(verdict).toBe("unable_to_assess_fully");
  });

  it("emits AR-TRACE-001 for a successful retrieve with non-records unit when maxRecordsRead is set", () => {
    const ev = makeCanonicalEvent({
      eventId: "evt-000001",
      operation: "retrieve",
      status: "succeeded",
      quantity: { value: 50, unit: "bytes" }, // bytes, not records
    });
    const auth = makeAuthority({ maxRecordsRead: 500 });
    const { findings, hasAssessmentLimitation } = runPolicyEngine({
      events: [ev],
      accounting: [],
      authority: auth,
      traceCompletionStatus: "succeeded",
    });
    expect(findings.some((f: { ruleId: string }) => f.ruleId === "AR-TRACE-001")).toBe(true);
    expect(hasAssessmentLimitation).toBe(true);
  });

  it("does NOT emit AR-TRACE-001 for unknown quantity when maxRecordsRead is absent", () => {
    const ev = makeCanonicalEvent({
      eventId: "evt-000001",
      operation: "read",
      status: "succeeded",
    });
    const auth = makeAuthority(); // no maxRecordsRead
    const { findings, hasAssessmentLimitation } = runPolicyEngine({
      events: [ev],
      accounting: [],
      authority: auth,
      traceCompletionStatus: "succeeded",
    });
    expect(findings.filter((f: { ruleId: string }) => f.ruleId === "AR-TRACE-001")).toHaveLength(0);
    expect(hasAssessmentLimitation).toBe(false);
  });

  it("does NOT flag unknown quantity for a failed read/retrieve", () => {
    const ev = makeCanonicalEvent({
      eventId: "evt-000001",
      operation: "read",
      status: "failed",
      // no quantity
    });
    const auth = makeAuthority({ maxRecordsRead: 500 });
    const { findings } = runPolicyEngine({
      events: [ev],
      accounting: [],
      authority: auth,
      traceCompletionStatus: "succeeded",
    });
    expect(findings.filter((f: { ruleId: string }) => f.ruleId === "AR-TRACE-001")).toHaveLength(0);
  });

  it("emits AR-VOLUME-001 AND AR-TRACE-001 when known quantities exceed limit and an unknown-qty event also exists", () => {
    const events = [
      makeCanonicalEvent({ eventId: "evt-000001", operation: "read", status: "succeeded", quantity: { value: 400, unit: "records" }, sequence: 1 }),
      makeCanonicalEvent({ eventId: "evt-000002", operation: "read", status: "succeeded", quantity: { value: 200, unit: "records" }, sequence: 2 }),
      makeCanonicalEvent({ eventId: "evt-000003", operation: "retrieve", status: "succeeded", sequence: 3 }), // unknown qty
    ];
    const auth = makeAuthority({ maxRecordsRead: 500 });
    const { findings, verdict } = runPolicyEngine({
      events,
      accounting: [],
      authority: auth,
      traceCompletionStatus: "succeeded",
    });
    expect(findings.some((f: { ruleId: string }) => f.ruleId === "AR-VOLUME-001")).toBe(true);
    expect(findings.some((f: { ruleId: string }) => f.ruleId === "AR-TRACE-001")).toBe(true);
    // Assessment limitation takes precedence over material_deviations_found
    expect(verdict).toBe("unable_to_assess_fully");
  });

  it("only counts records unit; other units (bytes, messages, files) are treated as unknown quantity", () => {
    const events = [
      makeCanonicalEvent({ eventId: "evt-000001", operation: "read", status: "succeeded", quantity: { value: 1000, unit: "bytes" }, sequence: 1 }),
    ];
    const auth = makeAuthority({ maxRecordsRead: 10 }); // limit 10, but "bytes" is not records
    const { findings, hasAssessmentLimitation } = runPolicyEngine({
      events,
      accounting: [],
      authority: auth,
      traceCompletionStatus: "succeeded",
    });
    // Should produce AR-TRACE-001 (unknown records), NOT AR-VOLUME-001
    expect(findings.some((f: { ruleId: string }) => f.ruleId === "AR-TRACE-001")).toBe(true);
    expect(findings.some((f: { ruleId: string }) => f.ruleId === "AR-VOLUME-001")).toBe(false);
    expect(hasAssessmentLimitation).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Approval linkage — both directions, source ID resolution
// ═══════════════════════════════════════════════════════════════════════════════

describe("Approval linkage — direction A: action.approvalRef → approval.sourceEventId", () => {
  it("resolves approval when action.approvalRef matches approval's native source event ID", () => {
    // The approval has native source ID "native-approval-01" → canonical "evt-000001"
    // The action has approvalRef = "native-approval-01" (native source ID)
    const trace = baseTrace([
      {
        id: "native-approval-01",
        timestamp: "2024-01-01T00:00:30Z",
        actor: { type: "human", id: "user-1" },
        operation: "approve",
        stateChange: false,
        status: "succeeded",
        dataCategories: [],
        actionKey: "send-action",
      },
      {
        id: "native-action-01",
        timestamp: "2024-01-01T00:01:00Z",
        actor: { type: "agent", id: "agent-1" },
        operation: "send",
        stateChange: true,
        status: "succeeded",
        dataCategories: [],
        approvalRef: "native-approval-01", // native source ID
      },
    ]);
    const adapter = adaptNativeTrace(trace);
    const auth = makeAuthority({ approvalRequiredFor: ["send"] });
    const { findings } = runPolicyEngine({
      events: adapter.events,
      accounting: adapter.accounting,
      authority: auth,
      traceCompletionStatus: "succeeded",
    });
    expect(findings.filter((f: { ruleId: string }) => f.ruleId === "AR-APPROVAL-001")).toHaveLength(0);
    expect(findings.filter((f: { ruleId: string }) => f.ruleId === "AR-APPROVAL-002")).toHaveLength(0);
  });

  it("raises AR-APPROVAL-001 when approvalRef is a dangling native source ID with no matching event", () => {
    const trace = baseTrace([
      {
        id: "native-action-01",
        timestamp: "2024-01-01T00:01:00Z",
        actor: { type: "agent", id: "agent-1" },
        operation: "send",
        stateChange: true,
        status: "succeeded",
        dataCategories: [],
        approvalRef: "non-existent-native-id",
      },
    ]);
    const adapter = adaptNativeTrace(trace);
    const auth = makeAuthority({ approvalRequiredFor: ["send"] });
    const { findings } = runPolicyEngine({
      events: adapter.events,
      accounting: adapter.accounting,
      authority: auth,
      traceCompletionStatus: "succeeded",
    });
    expect(findings.some((f: { ruleId: string }) => f.ruleId === "AR-APPROVAL-001")).toBe(true);
  });
});

describe("Approval linkage — direction B: approval.approvalRef → action.sourceEventId", () => {
  it("resolves approval when approval.approvalRef matches action's native source event ID", () => {
    // The approval's approvalRef points to the action's native source ID
    const trace = baseTrace([
      {
        id: "native-approval-02",
        timestamp: "2024-01-01T00:00:30Z",
        actor: { type: "human", id: "user-1" },
        operation: "approve",
        stateChange: false,
        status: "succeeded",
        dataCategories: [],
        approvalRef: "native-action-02", // approval → action direction
      },
      {
        id: "native-action-02",
        timestamp: "2024-01-01T00:01:00Z",
        actor: { type: "agent", id: "agent-1" },
        operation: "send",
        stateChange: true,
        status: "succeeded",
        dataCategories: [],
        // no approvalRef on the action side
      },
    ]);
    const adapter = adaptNativeTrace(trace);
    const auth = makeAuthority({ approvalRequiredFor: ["send"] });
    const { findings } = runPolicyEngine({
      events: adapter.events,
      accounting: adapter.accounting,
      authority: auth,
      traceCompletionStatus: "succeeded",
    });
    expect(findings.filter((f: { ruleId: string }) => f.ruleId === "AR-APPROVAL-001")).toHaveLength(0);
    expect(findings.filter((f: { ruleId: string }) => f.ruleId === "AR-APPROVAL-002")).toHaveLength(0);
  });
});

describe("Approval linkage — shared actionKey is not an explicit reference", () => {
  it("raises AR-APPROVAL-001 when events only share an actionKey", () => {
    const trace = baseTrace([
      {
        id: "native-approval-03",
        timestamp: "2024-01-01T00:00:30Z",
        actor: { type: "human", id: "user-1" },
        operation: "approve",
        stateChange: false,
        status: "succeeded",
        dataCategories: [],
        actionKey: "shared-key",
      },
      {
        id: "native-action-03",
        timestamp: "2024-01-01T00:01:00Z",
        actor: { type: "agent", id: "agent-1" },
        operation: "send",
        stateChange: true,
        status: "succeeded",
        dataCategories: [],
        actionKey: "shared-key",
      },
    ]);
    const adapter = adaptNativeTrace(trace);
    const auth = makeAuthority({ approvalRequiredFor: ["send"] });
    const { findings } = runPolicyEngine({
      events: adapter.events,
      accounting: adapter.accounting,
      authority: auth,
      traceCompletionStatus: "succeeded",
    });
    expect(findings.filter((f: { ruleId: string }) => f.ruleId === "AR-APPROVAL-001")).toHaveLength(1);
  });
});

describe("Approval linkage — AR-APPROVAL-002: timestamp comparison uses instants", () => {
  it("accepts an explicitly linked approval earlier by a sub-millisecond", () => {
    const trace = baseTrace([
      {
        id: "native-action-subms",
        timestamp: "2024-01-01T00:00:00.0002Z",
        actor: { type: "agent", id: "agent-1" },
        operation: "send",
        stateChange: true,
        status: "succeeded",
        dataCategories: [],
        approvalRef: "native-approval-subms",
      },
      {
        id: "native-approval-subms",
        timestamp: "2024-01-01T00:00:00.0001Z",
        actor: { type: "human", id: "user-1" },
        operation: "approve",
        stateChange: false,
        status: "succeeded",
        dataCategories: [],
      },
    ]);
    const adapter = adaptNativeTrace(trace);
    const auth = makeAuthority({ approvalRequiredFor: ["send"] });

    const { findings } = runPolicyEngine({
      events: adapter.events,
      accounting: adapter.accounting,
      authority: auth,
      traceCompletionStatus: "succeeded",
    });

    expect(findings.some((finding) => finding.ruleId === "AR-APPROVAL-001")).toBe(false);
    expect(findings.some((finding) => finding.ruleId === "AR-APPROVAL-002")).toBe(false);
  });

  it("raises AR-APPROVAL-002 when approval and action are the same instant in different timezones", () => {
    // Same instant: 2024-01-01T00:00:00Z = 2024-01-01T05:30:00+05:30
    const trace = baseTrace([
      {
        id: "native-approval-04",
        timestamp: "2024-01-01T05:30:00+05:30", // same UTC instant as action
        actor: { type: "human", id: "user-1" },
        operation: "approve",
        stateChange: false,
        status: "succeeded",
        dataCategories: [],
      },
      {
        id: "native-action-04",
        timestamp: "2024-01-01T00:00:00Z", // same instant as approval
        actor: { type: "agent", id: "agent-1" },
        operation: "send",
        stateChange: true,
        status: "succeeded",
        dataCategories: [],
        approvalRef: "native-approval-04",
      },
    ]);
    const adapter = adaptNativeTrace(trace);
    const auth = makeAuthority({ approvalRequiredFor: ["send"] });
    const { findings } = runPolicyEngine({
      events: adapter.events,
      accounting: adapter.accounting,
      authority: auth,
      traceCompletionStatus: "succeeded",
    });
    expect(findings.some((f: { ruleId: string }) => f.ruleId === "AR-APPROVAL-002")).toBe(true);
  });

  it("does NOT raise AR-APPROVAL-002 when approval is genuinely earlier by instant across different offsets", () => {
    // approval at 2024-01-01T04:30:00+05:30 = 2023-12-31T23:00:00Z (before action)
    const trace = baseTrace([
      {
        id: "native-approval-05",
        timestamp: "2024-01-01T04:30:00+05:30", // 23:00 UTC prev day
        actor: { type: "human", id: "user-1" },
        operation: "approve",
        stateChange: false,
        status: "succeeded",
        dataCategories: [],
      },
      {
        id: "native-action-05",
        timestamp: "2024-01-01T00:00:00Z", // 00:00 UTC
        actor: { type: "agent", id: "agent-1" },
        operation: "send",
        stateChange: true,
        status: "succeeded",
        dataCategories: [],
        approvalRef: "native-approval-05",
      },
    ]);
    const adapter = adaptNativeTrace(trace);
    const auth = makeAuthority({ approvalRequiredFor: ["send"] });
    const { findings } = runPolicyEngine({
      events: adapter.events,
      accounting: adapter.accounting,
      authority: auth,
      traceCompletionStatus: "succeeded",
    });
    expect(findings.filter((f: { ruleId: string }) => f.ruleId === "AR-APPROVAL-001")).toHaveLength(0);
    expect(findings.filter((f: { ruleId: string }) => f.ruleId === "AR-APPROVAL-002")).toHaveLength(0);
  });
});
