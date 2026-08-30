import { describe, it, expect, beforeEach } from "vitest";
import { adaptNativeTrace } from "../../src/adapters/nativeTrace.js";
import { runPolicyEngine, _resetFindingCounter } from "../../src/core/policyEngine.js";
import { NativeTraceV1Schema, AuthorityEnvelopeV1Schema } from "../../src/core/schemas/index.js";
import type { CanonicalEvent, Finding, RawEventAccounting } from "../../src/core/schemas/index.js";
import { fixtureA, fixtureB, sharedAuthority } from "../../src/fixtures/index.js";

beforeEach(() => { _resetFindingCounter(); });

// ─── Fixture A: Expected run ──────────────────────────────────────────────────

describe("Golden test — Fixture A: Expected run", () => {
  it("passes schema validation", () => {
    expect(NativeTraceV1Schema.safeParse(fixtureA).success).toBe(true);
    expect(AuthorityEnvelopeV1Schema.safeParse(sharedAuthority).success).toBe(true);
  });

  it("produces verdict within_declared_authority", () => {
    const adapter = adaptNativeTrace(fixtureA);
    const { verdict, findings } = runPolicyEngine({
      events: adapter.events,
      accounting: adapter.accounting,
      authority: sharedAuthority,
      traceCompletionStatus: fixtureA.status,
    });
    expect(verdict).toBe("within_declared_authority");
    expect(findings.filter((f: Finding) => f.ruleId !== "AR-TRACE-001")).toHaveLength(0);
  });

  it("produces 100% raw-event accounting", () => {
    const adapter = adaptNativeTrace(fixtureA);
    expect(adapter.accounting).toHaveLength(fixtureA.events.length);
    expect(adapter.accounting.every((a: RawEventAccounting) => a.status === "mapped")).toBe(true);
  });

  it("has zero authority findings", () => {
    const adapter = adaptNativeTrace(fixtureA);
    const { findings } = runPolicyEngine({
      events: adapter.events,
      accounting: adapter.accounting,
      authority: sharedAuthority,
      traceCompletionStatus: fixtureA.status,
    });
    const authorityRules = ["AR-SYS-001", "AR-OP-001", "AR-EGRESS-001", "AR-DATA-001", "AR-VOLUME-001", "AR-APPROVAL-001", "AR-APPROVAL-002"];
    expect(findings.filter((f: Finding) => authorityRules.includes(f.ruleId))).toHaveLength(0);
  });

  it("has zero external transfers", () => {
    const adapter = adaptNativeTrace(fixtureA);
    expect(adapter.events.filter((e: CanonicalEvent) => e.destinationBoundary === "external")).toHaveLength(0);
  });

  it("has one local state-changing action", () => {
    const adapter = adaptNativeTrace(fixtureA);
    const localStateChange = adapter.events.filter((e: CanonicalEvent) => e.destinationBoundary === "local" && e.stateChange);
    expect(localStateChange).toHaveLength(1);
  });
});

// ─── Fixture B: Overreaching run ──────────────────────────────────────────────

describe("Golden test — Fixture B: Overreaching run", () => {
  it("passes schema validation", () => {
    expect(NativeTraceV1Schema.safeParse(fixtureB).success).toBe(true);
  });

  it("produces verdict material_deviations_found", () => {
    const adapter = adaptNativeTrace(fixtureB);
    const { verdict } = runPolicyEngine({
      events: adapter.events,
      accounting: adapter.accounting,
      authority: sharedAuthority,
      traceCompletionStatus: fixtureB.status,
    });
    expect(verdict).toBe("material_deviations_found");
  });

  it("raises AR-SYS-001 for external spreadsheet", () => {
    const adapter = adaptNativeTrace(fixtureB);
    const { findings } = runPolicyEngine({
      events: adapter.events,
      accounting: adapter.accounting,
      authority: sharedAuthority,
      traceCompletionStatus: fixtureB.status,
    });
    const f = findings.filter((f: Finding) => f.ruleId === "AR-SYS-001");
    expect(f.length).toBeGreaterThan(0);
    expect(f.some((x: Finding) => String(x.observedValue).includes("external-spreadsheet") || String(x.observedValue).includes("email-service"))).toBe(true);
  });

  it("raises AR-EGRESS-001 for disallowed external egress", () => {
    const adapter = adaptNativeTrace(fixtureB);
    const { findings } = runPolicyEngine({
      events: adapter.events,
      accounting: adapter.accounting,
      authority: sharedAuthority,
      traceCompletionStatus: fixtureB.status,
    });
    expect(findings.some((f: Finding) => f.ruleId === "AR-EGRESS-001")).toBe(true);
  });

  it("raises AR-DATA-001 for prohibited customer_email", () => {
    const adapter = adaptNativeTrace(fixtureB);
    const { findings } = runPolicyEngine({
      events: adapter.events,
      accounting: adapter.accounting,
      authority: sharedAuthority,
      traceCompletionStatus: fixtureB.status,
    });
    expect(findings.some((f: Finding) => f.ruleId === "AR-DATA-001")).toBe(true);
  });

  it("raises AR-APPROVAL-001 for send without prior approval", () => {
    const adapter = adaptNativeTrace(fixtureB);
    const { findings } = runPolicyEngine({
      events: adapter.events,
      accounting: adapter.accounting,
      authority: sharedAuthority,
      traceCompletionStatus: fixtureB.status,
    });
    expect(findings.some((f: Finding) => f.ruleId === "AR-APPROVAL-001")).toBe(true);
  });

  it("raises AR-RETRY-001 with possible duplicate side effect language — not confirmed duplicate", () => {
    const adapter = adaptNativeTrace(fixtureB);
    const { findings } = runPolicyEngine({
      events: adapter.events,
      accounting: adapter.accounting,
      authority: sharedAuthority,
      traceCompletionStatus: fixtureB.status,
    });
    const retryFindings = findings.filter((f: Finding) => f.ruleId === "AR-RETRY-001");
    expect(retryFindings.length).toBeGreaterThan(0);
    expect(retryFindings.every((f: Finding) => f.description.includes("A repeated side effect is possible"))).toBe(true);
    expect(retryFindings.every((f: Finding) => !f.description.includes("duplicate artifact created"))).toBe(true);
  });

  it("produces 100% raw-event accounting", () => {
    const adapter = adaptNativeTrace(fixtureB);
    expect(adapter.accounting).toHaveLength(fixtureB.events.length);
    expect(adapter.accounting.every((a: RawEventAccounting) => a.status === "mapped")).toBe(true);
  });

  it("all findings link to canonical and raw event IDs", () => {
    const adapter = adaptNativeTrace(fixtureB);
    const { findings } = runPolicyEngine({
      events: adapter.events,
      accounting: adapter.accounting,
      authority: sharedAuthority,
      traceCompletionStatus: fixtureB.status,
    });
    const canonicalIds = new Set(adapter.events.map((e: CanonicalEvent) => e.eventId));
    for (const f of findings) {
      for (const id of f.eventIds) {
        expect(canonicalIds.has(id)).toBe(true);
      }
    }
  });

  it("raises AR-OP-001 for send which is not in permittedOperations", () => {
    const adapter = adaptNativeTrace(fixtureB);
    const { findings } = runPolicyEngine({
      events: adapter.events,
      accounting: adapter.accounting,
      authority: sharedAuthority,
      traceCompletionStatus: fixtureB.status,
    });
    expect(findings.some((f: Finding) => f.ruleId === "AR-OP-001" && String(f.observedValue).includes("send"))).toBe(true);
  });
});
