import { describe, it, expect, beforeEach } from "vitest";
import { runPolicyEngine, computeVerdict, _resetFindingCounter } from "../../src/core/policyEngine.js";
import type { AuthorityEnvelopeV1, CanonicalEvent, RawEventAccounting } from "../../src/core/schemas/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<CanonicalEvent> & { eventId: string }): CanonicalEvent {
  return {
    schemaVersion: "agent-receipt.canonical-event.v1",
    traceId: "trace-001",
    parentEventId: undefined,
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
    permittedSystems: [{ systemId: "crm", boundary: "internal" }],
    permittedOperations: ["read", "retrieve"],
    prohibitedDataCategories: [],
    externalEgressAllowed: false,
    approvalRequiredFor: [],
    ...overrides,
  };
}

beforeEach(() => { _resetFindingCounter(); });

// ─── AR-SYS-001 ───────────────────────────────────────────────────────────────

describe("AR-SYS-001 — unpermitted system", () => {
  it("raises medium finding for non-state-change to unknown system", () => {
    const ev = makeEvent({ eventId: "evt-000001", sourceSystem: "unknown-db", stateChange: false });
    const auth = makeAuthority({ permittedSystems: [] });
    const { findings } = runPolicyEngine({ events: [ev], accounting: [], authority: auth, traceCompletionStatus: "succeeded" });
    const f = findings.find(f => f.ruleId === "AR-SYS-001");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("medium");
    expect(f!.description).toContain('source system "unknown-db".');
  });

  it("raises high finding for successful state-change to unknown system", () => {
    const ev = makeEvent({ eventId: "evt-000001", destinationSystem: "bad-system", stateChange: true, status: "succeeded" });
    const auth = makeAuthority({ permittedSystems: [] });
    const { findings } = runPolicyEngine({ events: [ev], accounting: [], authority: auth, traceCompletionStatus: "succeeded" });
    const f = findings.find(f => f.ruleId === "AR-SYS-001");
    expect(f!.severity).toBe("high");
  });

  it("does not flag a permitted system", () => {
    const ev = makeEvent({ eventId: "evt-000001", sourceSystem: "crm" });
    const auth = makeAuthority();
    const { findings } = runPolicyEngine({ events: [ev], accounting: [], authority: auth, traceCompletionStatus: "succeeded" });
    expect(findings.filter(f => f.ruleId === "AR-SYS-001")).toHaveLength(0);
  });
});

// ─── AR-OP-001 ────────────────────────────────────────────────────────────────

describe("AR-OP-001 — unpermitted operation", () => {
  it("raises high finding for delete (not permitted)", () => {
    const ev = makeEvent({ eventId: "evt-000001", operation: "delete", stateChange: true, status: "succeeded" });
    const auth = makeAuthority();
    const { findings } = runPolicyEngine({ events: [ev], accounting: [], authority: auth, traceCompletionStatus: "succeeded" });
    const f = findings.find(f => f.ruleId === "AR-OP-001");
    expect(f!.severity).toBe("high");
    expect(f!.description).toContain('operation "delete".');
  });

  it("raises medium finding for execute (not permitted, non-high op)", () => {
    const ev = makeEvent({ eventId: "evt-000001", operation: "execute", stateChange: false, status: "succeeded" });
    const auth = makeAuthority();
    const { findings } = runPolicyEngine({ events: [ev], accounting: [], authority: auth, traceCompletionStatus: "succeeded" });
    const f = findings.find(f => f.ruleId === "AR-OP-001");
    expect(f!.severity).toBe("medium");
  });

  it("does not flag failed non-state-changing attempt", () => {
    const ev = makeEvent({ eventId: "evt-000001", operation: "delete", stateChange: false, status: "failed" });
    const auth = makeAuthority();
    const { findings } = runPolicyEngine({ events: [ev], accounting: [], authority: auth, traceCompletionStatus: "succeeded" });
    expect(findings.filter(f => f.ruleId === "AR-OP-001")).toHaveLength(0);
  });

  it.each(["started", "cancelled"] as const)(
    "does not flag %s non-state-changing attempt",
    (status) => {
      const ev = makeEvent({
        eventId: "evt-000001",
        operation: "delete",
        stateChange: false,
        status,
      });
      const auth = makeAuthority();
      const { findings } = runPolicyEngine({
        events: [ev],
        accounting: [],
        authority: auth,
        traceCompletionStatus: "succeeded",
      });
      expect(findings.filter(f => f.ruleId === "AR-OP-001")).toHaveLength(0);
    },
  );

  it("does not flag permitted operation", () => {
    const ev = makeEvent({ eventId: "evt-000001", operation: "read", status: "succeeded" });
    const auth = makeAuthority();
    const { findings } = runPolicyEngine({ events: [ev], accounting: [], authority: auth, traceCompletionStatus: "succeeded" });
    expect(findings.filter(f => f.ruleId === "AR-OP-001")).toHaveLength(0);
  });
});

// ─── AR-EGRESS-001 ────────────────────────────────────────────────────────────

describe("AR-EGRESS-001 — disallowed external egress", () => {
  it("raises high finding when external egress is disallowed", () => {
    const ev = makeEvent({ eventId: "evt-000001", destinationBoundary: "external" });
    const auth = makeAuthority({ externalEgressAllowed: false });
    const { findings } = runPolicyEngine({ events: [ev], accounting: [], authority: auth, traceCompletionStatus: "succeeded" });
    const f = findings.find(f => f.ruleId === "AR-EGRESS-001");
    expect(f!.severity).toBe("high");
  });

  it("does not flag when external egress is allowed", () => {
    const ev = makeEvent({ eventId: "evt-000001", destinationBoundary: "external" });
    const auth = makeAuthority({ externalEgressAllowed: true });
    const { findings } = runPolicyEngine({ events: [ev], accounting: [], authority: auth, traceCompletionStatus: "succeeded" });
    expect(findings.filter(f => f.ruleId === "AR-EGRESS-001")).toHaveLength(0);
  });

  it("does not flag when boundary is internal", () => {
    const ev = makeEvent({ eventId: "evt-000001", destinationBoundary: "internal" });
    const auth = makeAuthority({ externalEgressAllowed: false });
    const { findings } = runPolicyEngine({ events: [ev], accounting: [], authority: auth, traceCompletionStatus: "succeeded" });
    expect(findings.filter(f => f.ruleId === "AR-EGRESS-001")).toHaveLength(0);
  });
});

// ─── AR-DATA-001 ──────────────────────────────────────────────────────────────

describe("AR-DATA-001 — prohibited data category", () => {
  it("raises high finding when prohibited category is moved", () => {
    const ev = makeEvent({ eventId: "evt-000001", dataCategories: ["customer_email"], stateChange: true, status: "succeeded" });
    const auth = makeAuthority({ prohibitedDataCategories: ["customer_email"] });
    const { findings } = runPolicyEngine({ events: [ev], accounting: [], authority: auth, traceCompletionStatus: "succeeded" });
    const f = findings.find(f => f.ruleId === "AR-DATA-001");
    expect(f!.severity).toBe("high");
  });

  it("does not flag when data category is not prohibited", () => {
    const ev = makeEvent({ eventId: "evt-000001", dataCategories: ["churn_score"], stateChange: true });
    const auth = makeAuthority({ prohibitedDataCategories: ["customer_email"] });
    const { findings } = runPolicyEngine({ events: [ev], accounting: [], authority: auth, traceCompletionStatus: "succeeded" });
    expect(findings.filter(f => f.ruleId === "AR-DATA-001")).toHaveLength(0);
  });
});

// ─── AR-VOLUME-001 ────────────────────────────────────────────────────────────

describe("AR-VOLUME-001 — record read limit", () => {
  it("raises medium finding when sum exceeds limit", () => {
    const events = [
      makeEvent({ eventId: "evt-000001", operation: "read", status: "succeeded", quantity: { value: 300, unit: "records" } }),
      makeEvent({ eventId: "evt-000002", sequence: 2, operation: "retrieve", status: "succeeded", quantity: { value: 250, unit: "records" } }),
    ];
    const auth = makeAuthority({ maxRecordsRead: 500 });
    const { findings } = runPolicyEngine({ events, accounting: [], authority: auth, traceCompletionStatus: "succeeded" });
    const f = findings.find(f => f.ruleId === "AR-VOLUME-001");
    expect(f!.severity).toBe("medium");
    expect(f!.observedValue).toBe(550);
  });

  it("does not flag when within limit", () => {
    const events = [
      makeEvent({ eventId: "evt-000001", operation: "read", status: "succeeded", quantity: { value: 200, unit: "records" } }),
    ];
    const auth = makeAuthority({ maxRecordsRead: 500 });
    const { findings } = runPolicyEngine({ events, accounting: [], authority: auth, traceCompletionStatus: "succeeded" });
    expect(findings.filter(f => f.ruleId === "AR-VOLUME-001")).toHaveLength(0);
  });

  it("produces AR-TRACE-001 assessment limitation when quantity is unknown and maxRecordsRead is set", () => {
    const events = [
      makeEvent({ eventId: "evt-000001", operation: "read", status: "succeeded" }), // no quantity
    ];
    const auth = makeAuthority({ maxRecordsRead: 500 });
    const { findings, verdict, hasAssessmentLimitation } = runPolicyEngine({ events, accounting: [], authority: auth, traceCompletionStatus: "succeeded" });
    expect(findings.filter((f: { ruleId: string }) => f.ruleId === "AR-VOLUME-001")).toHaveLength(0);
    expect(findings.some((f: { ruleId: string }) => f.ruleId === "AR-TRACE-001")).toBe(true);
    expect(hasAssessmentLimitation).toBe(true);
    expect(verdict).toBe("unable_to_assess_fully");
  });

  it("does not produce AR-TRACE-001 when maxRecordsRead is not set and quantity is unknown", () => {
    const events = [
      makeEvent({ eventId: "evt-000001", operation: "read", status: "succeeded" }), // no quantity
    ];
    const auth = makeAuthority(); // no maxRecordsRead
    const { findings } = runPolicyEngine({ events, accounting: [], authority: auth, traceCompletionStatus: "succeeded" });
    expect(findings.filter((f: { ruleId: string }) => f.ruleId === "AR-TRACE-001")).toHaveLength(0);
    expect(findings.filter((f: { ruleId: string }) => f.ruleId === "AR-VOLUME-001")).toHaveLength(0);
  });

  it("still raises AR-VOLUME-001 for known quantities that exceed limit even when other events have unknown quantity", () => {
    const events = [
      makeEvent({ eventId: "evt-000001", operation: "read", status: "succeeded", quantity: { value: 450, unit: "records" } }),
      makeEvent({ eventId: "evt-000002", sequence: 2, operation: "read", status: "succeeded", quantity: { value: 100, unit: "records" } }),
      makeEvent({ eventId: "evt-000003", sequence: 3, operation: "retrieve", status: "succeeded" }), // unknown qty
    ];
    const auth = makeAuthority({ maxRecordsRead: 500 });
    const { findings, verdict } = runPolicyEngine({ events, accounting: [], authority: auth, traceCompletionStatus: "succeeded" });
    expect(findings.some((f: { ruleId: string }) => f.ruleId === "AR-VOLUME-001")).toBe(true);
    expect(findings.some((f: { ruleId: string }) => f.ruleId === "AR-TRACE-001")).toBe(true);
    expect(verdict).toBe("unable_to_assess_fully");
  });
});

// ─── AR-APPROVAL-001 / AR-APPROVAL-002 ───────────────────────────────────────

describe("AR-APPROVAL-001 — missing approval", () => {
  it("raises high finding when send has no linked approval", () => {
    const ev = makeEvent({ eventId: "evt-000001", operation: "send", status: "succeeded", actionKey: "send-001" });
    const auth = makeAuthority({ approvalRequiredFor: ["send"], permittedOperations: ["read", "send"] });
    const { findings } = runPolicyEngine({ events: [ev], accounting: [], authority: auth, traceCompletionStatus: "succeeded" });
    const f = findings.find(f => f.ruleId === "AR-APPROVAL-001");
    expect(f!.severity).toBe("high");
    expect(f!.description).toContain('completed "send", which requires human approval');
  });

  it("does not flag when a prior human approval is explicitly referenced", () => {
    const approval = makeEvent({
      eventId: "evt-000001",
      sequence: 1,
      timestamp: "2024-01-01T00:00:30Z",
      actorType: "human",
      actorId: "user-1",
      operation: "approve",
      status: "succeeded",
      stateChange: false,
    });
    const action = makeEvent({
      eventId: "evt-000002",
      sequence: 2,
      timestamp: "2024-01-01T00:01:00Z",
      operation: "send",
      status: "succeeded",
      approvalRef: "evt-000001",
    });
    const auth = makeAuthority({ approvalRequiredFor: ["send"], permittedOperations: ["read", "send"] });
    const { findings } = runPolicyEngine({ events: [approval, action], accounting: [], authority: auth, traceCompletionStatus: "succeeded" });
    expect(findings.filter(f => f.ruleId === "AR-APPROVAL-001")).toHaveLength(0);
  });
});

describe("AR-APPROVAL-002 — approval timestamp not before action", () => {
  it("raises high finding when approval timestamp equals action timestamp", () => {
    const approval = makeEvent({
      eventId: "evt-000001",
      sequence: 1,
      timestamp: "2024-01-01T00:01:00Z", // same as action
      actorType: "human",
      actorId: "user-1",
      operation: "approve",
      status: "succeeded",
      stateChange: false,
    });
    const action = makeEvent({
      eventId: "evt-000002",
      sequence: 2,
      timestamp: "2024-01-01T00:01:00Z",
      operation: "send",
      status: "succeeded",
      approvalRef: "evt-000001",
    });
    const auth = makeAuthority({ approvalRequiredFor: ["send"], permittedOperations: ["read", "send"] });
    const { findings } = runPolicyEngine({ events: [approval, action], accounting: [], authority: auth, traceCompletionStatus: "succeeded" });
    const f = findings.find(f => f.ruleId === "AR-APPROVAL-002");
    expect(f!.severity).toBe("high");
  });
});

// ─── AR-RETRY-001 ─────────────────────────────────────────────────────────────

describe("AR-RETRY-001 — retry after ambiguous completion", () => {
  it("raises medium finding after unknown completion — possible duplicate side effect language", () => {
    const attempt1 = makeEvent({
      eventId: "evt-000001",
      sequence: 1,
      operation: "create",
      status: "unknown",
      actionKey: "export-001",
      attempt: 1,
      stateChange: true,
    });
    const attempt2 = makeEvent({
      eventId: "evt-000002",
      sequence: 2,
      timestamp: "2024-01-01T00:02:00Z",
      operation: "create",
      status: "succeeded",
      actionKey: "export-001",
      attempt: 2,
      stateChange: true,
    });
    const auth = makeAuthority({ permittedOperations: ["read", "create"] });
    const { findings } = runPolicyEngine({ events: [attempt1, attempt2], accounting: [], authority: auth, traceCompletionStatus: "succeeded" });
    const f = findings.find(f => f.ruleId === "AR-RETRY-001");
    expect(f!.severity).toBe("medium");
    expect(f!.description).toContain('action "export-001".');
    expect(f!.description).toContain('recorded as "unknown".');
    expect(f!.description).toContain("A repeated side effect is possible");
    expect(f!.description).not.toContain("duplicate artifact created");
  });

  it("raises medium finding after failed completion", () => {
    const attempt1 = makeEvent({
      eventId: "evt-000001",
      sequence: 1,
      operation: "create",
      status: "failed",
      actionKey: "export-002",
      attempt: 1,
      stateChange: false,
    });
    const attempt2 = makeEvent({
      eventId: "evt-000002",
      sequence: 2,
      timestamp: "2024-01-01T00:02:00Z",
      operation: "create",
      status: "succeeded",
      actionKey: "export-002",
      attempt: 2,
      stateChange: true,
    });
    const auth = makeAuthority({ permittedOperations: ["read", "create"] });
    const { findings } = runPolicyEngine({ events: [attempt1, attempt2], accounting: [], authority: auth, traceCompletionStatus: "succeeded" });
    const f = findings.find(f => f.ruleId === "AR-RETRY-001");
    expect(f!.severity).toBe("medium");
  });

  it("does not flag a single attempt", () => {
    const ev = makeEvent({ eventId: "evt-000001", operation: "create", status: "succeeded", actionKey: "one-shot", attempt: 1, stateChange: true });
    const auth = makeAuthority({ permittedOperations: ["read", "create"] });
    const { findings } = runPolicyEngine({ events: [ev], accounting: [], authority: auth, traceCompletionStatus: "succeeded" });
    expect(findings.filter(f => f.ruleId === "AR-RETRY-001")).toHaveLength(0);
  });
});

// ─── AR-ERROR-001 ─────────────────────────────────────────────────────────────

describe("AR-ERROR-001 — state change after unhandled error", () => {
  it("raises medium finding when state-changing success follows error in same branch", () => {
    const errorEv = makeEvent({
      eventId: "evt-000001",
      sequence: 1,
      operation: "error",
      status: "failed",
      stateChange: false,
      parentEventId: "parent-001",
    });
    const actionEv = makeEvent({
      eventId: "evt-000002",
      sequence: 2,
      timestamp: "2024-01-01T00:02:00Z",
      operation: "create",
      status: "succeeded",
      stateChange: true,
      parentEventId: "parent-001",
    });
    const auth = makeAuthority({ permittedOperations: ["read", "create"] });
    const { findings } = runPolicyEngine({ events: [errorEv, actionEv], accounting: [], authority: auth, traceCompletionStatus: "succeeded" });
    const f = findings.find(f => f.ruleId === "AR-ERROR-001");
    expect(f!.severity).toBe("medium");
    expect(f!.eventIds).toContain("evt-000001");
    expect(f!.eventIds).toContain("evt-000002");
  });
});

// ─── AR-TRACE-001 ─────────────────────────────────────────────────────────────

describe("AR-TRACE-001 — trace integrity", () => {
  it("keeps the exact unknown operation token inside its quotation marks", () => {
    const ev = makeEvent({ eventId: "evt-000001", operation: "unknown" });
    const auth = makeAuthority();
    const { findings } = runPolicyEngine({ events: [ev], accounting: [], authority: auth, traceCompletionStatus: "succeeded" });
    const f = findings.find(f => f.ruleId === "AR-TRACE-001");
    expect(f!.description).toContain('operation as "unknown", leaving');
  });

  it("raises high finding for material unparsed event", () => {
    const ev = makeEvent({ eventId: "evt-000001" });
    const accounting: RawEventAccounting[] = [{
      rawPointer: "events[0]",
      status: "unparsed",
      canonicalEventIds: [],
      material: true,
      reason: "Unsupported event type",
    }];
    const auth = makeAuthority();
    const { findings, hasAssessmentLimitation } = runPolicyEngine({ events: [ev], accounting, authority: auth, traceCompletionStatus: "succeeded" });
    expect(findings.find(f => f.ruleId === "AR-TRACE-001")).toBeDefined();
    expect(hasAssessmentLimitation).toBe(true);
  });

  it("raises high finding for trace with unknown completion", () => {
    const ev = makeEvent({ eventId: "evt-000001" });
    const auth = makeAuthority();
    const { findings } = runPolicyEngine({ events: [ev], accounting: [], authority: auth, traceCompletionStatus: "unknown" });
    const f = findings.find(f => f.ruleId === "AR-TRACE-001");
    expect(f!.severity).toBe("high");
    expect(f!.description).toContain('trace status is "unknown".');
  });

  it("does not flag when trace has succeeded status", () => {
    const ev = makeEvent({ eventId: "evt-000001" });
    const auth = makeAuthority();
    const { findings } = runPolicyEngine({ events: [ev], accounting: [], authority: auth, traceCompletionStatus: "succeeded" });
    expect(findings.filter(f => f.ruleId === "AR-TRACE-001")).toHaveLength(0);
  });
});

// ─── Verdict computation ──────────────────────────────────────────────────────

describe("computeVerdict — precedence", () => {
  it("returns unable_to_assess_fully when there is an assessment limitation", () => {
    expect(computeVerdict([], true)).toBe("unable_to_assess_fully");
  });

  it("returns unable_to_assess_fully even when high findings exist", () => {
    const findings = [{ findingId: "f1", ruleId: "AR-SYS-001", severity: "high" as const, label: "", description: "", eventIds: [] }];
    expect(computeVerdict(findings, true)).toBe("unable_to_assess_fully");
  });

  it("returns material_deviations_found when high severity finding exists", () => {
    const findings = [{ findingId: "f1", ruleId: "AR-SYS-001", severity: "high" as const, label: "", description: "", eventIds: [] }];
    expect(computeVerdict(findings, false)).toBe("material_deviations_found");
  });

  it("returns review_recommended for only medium/low findings", () => {
    const findings = [{ findingId: "f1", ruleId: "AR-RETRY-001", severity: "medium" as const, label: "", description: "", eventIds: [] }];
    expect(computeVerdict(findings, false)).toBe("review_recommended");
  });

  it("returns within_declared_authority when no findings", () => {
    expect(computeVerdict([], false)).toBe("within_declared_authority");
  });
});
