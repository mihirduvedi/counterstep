/**
 * Granite boundary unit tests.
 *
 * Groups:
 *   A — redactForModel
 *   B — buildFactBundle
 *   C — validateClaims
 *   D — deterministicFallback
 *   E — callGranite (mocked fetch)
 *   F — POST /api/receipt-copy (mocked callGranite)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { redactForModel } from "../../src/ai/redact.js";
import {
  buildFactBundle,
  GraniteFactBundleSchema,
  type GraniteFactBundle,
} from "../../src/ai/factBundle.js";
import { validateClaims } from "../../src/ai/validateClaims.js";
import { deterministicFallback } from "../../src/ai/deterministicFallback.js";
import {
  _resetGraniteTokenCacheForTests,
  callGranite,
} from "../../src/ai/graniteClient.js";
import {
  GeneratedReceiptCopySchema,
  type CanonicalEvent,
  type RawEventAccounting,
  type AuthorityEnvelopeV1,
  type Finding,
} from "../../src/core/schemas/index.js";
import { adaptNativeTrace } from "../../src/adapters/nativeTrace.js";
import { runPolicyEngine, _resetFindingCounter } from "../../src/core/policyEngine.js";
import { fixtureA, fixtureB, sharedAuthority } from "../../src/fixtures/index.js";

// ─── Shared test helpers ──────────────────────────────────────────────────────

function makeEvent(overrides: Partial<CanonicalEvent> & { eventId: string }): CanonicalEvent {
  return {
    schemaVersion: "agent-receipt.canonical-event.v1",
    traceId: "trace-test-001",
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

function makeAccounting(
  rawPointer: string,
  canonicalEventIds: string[],
  status: "mapped" | "metadata-only" | "unparsed" = "mapped",
): RawEventAccounting {
  return { rawPointer, canonicalEventIds, status, material: true };
}

function makeAuthority(overrides: Partial<AuthorityEnvelopeV1> = {}): AuthorityEnvelopeV1 {
  return {
    schemaVersion: "agent-receipt.authority.v1",
    policyId: "test-policy",
    task: "test task",
    permittedSystems: [],
    permittedOperations: ["read", "retrieve", "create"],
    prohibitedDataCategories: [],
    externalEgressAllowed: false,
    approvalRequiredFor: [],
    ...overrides,
  };
}

/** Build a minimal bundle for a single event + no findings (Fixture A style) */
function makeSimpleBundle(): GraniteFactBundle {
  const ev = makeEvent({ eventId: "evt-000001" });
  const accounting = [makeAccounting("events[0]", ["evt-000001"])];
  return buildFactBundle({
    events: [ev],
    findings: [],
    accounting,
    verdict: "within_declared_authority",
    authority: makeAuthority(),
    hasAssessmentLimitation: false,
  });
}

/** A valid minimal GeneratedReceiptCopy passing validateClaims for a single-event bundle */
function makeValidCopy(bundle: GraniteFactBundle): {
  headline: { text: string; eventIds: string[]; findingIds: string[] };
  outcome: { text: string; eventIds: string[] };
  notableActions: { text: string; eventIds: string[]; findingIds: string[] }[];
  limitations: { text: string; eventIds: string[] }[];
} {
  return structuredClone(deterministicFallback(bundle));
}

// ─── Fixture bundles (built once per test via beforeEach) ─────────────────────

let bundleA: GraniteFactBundle;
let bundleB: GraniteFactBundle;

beforeEach(() => {
  _resetGraniteTokenCacheForTests();
  _resetFindingCounter();
  const adapterA = adaptNativeTrace(fixtureA);
  const engineA = runPolicyEngine({
    events: adapterA.events,
    accounting: adapterA.accounting,
    authority: sharedAuthority,
    traceCompletionStatus: fixtureA.status,
  });
  bundleA = buildFactBundle({
    events: adapterA.events,
    findings: engineA.findings,
    accounting: adapterA.accounting,
    verdict: engineA.verdict,
    authority: sharedAuthority,
    hasAssessmentLimitation: engineA.hasAssessmentLimitation,
  });

  _resetFindingCounter();
  const adapterB = adaptNativeTrace(fixtureB);
  const engineB = runPolicyEngine({
    events: adapterB.events,
    accounting: adapterB.accounting,
    authority: sharedAuthority,
    traceCompletionStatus: fixtureB.status,
  });
  bundleB = buildFactBundle({
    events: adapterB.events,
    findings: engineB.findings,
    accounting: adapterB.accounting,
    verdict: engineB.verdict,
    authority: sharedAuthority,
    hasAssessmentLimitation: engineB.hasAssessmentLimitation,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group A — Redaction (redactForModel)
// ─────────────────────────────────────────────────────────────────────────────

describe("Group A — redactForModel", () => {
  it("redacts authorization key (case-insensitive)", () => {
    const result = redactForModel({ Authorization: "Bearer tok" }) as Record<string, unknown>;
    expect(result["Authorization"]).toBe("[REDACTED]");
  });

  it("redacts x-api-key header (case-insensitive)", () => {
    const result = redactForModel({ "X-API-KEY": "abc123" }) as Record<string, unknown>;
    expect(result["X-API-KEY"]).toBe("[REDACTED]");
  });

  it("redacts bearer token string in nested object", () => {
    const input = { headers: { authorization: "Bearer eyJhbGc.eyJ.sig" } };
    const result = redactForModel(input) as { headers: Record<string, unknown> };
    expect(result.headers["authorization"]).toBe("[REDACTED]");
  });

  it("redacts a bearer value even when its key is not authorization", () => {
    const result = redactForModel({ headerValue: "Bearer opaque-value" }) as Record<string, unknown>;
    expect(result["headerValue"]).toBe("[REDACTED]");
  });

  it("redacts embedded bearer credentials and low-entropy secret assignments", () => {
    const result = redactForModel({
      prose: "Header Authorization: Bearer low-low-low",
      system: "token=aaaaaaaaaaaaaaaaaaaa",
      url: "https://example.invalid?password:hunter2",
    }) as Record<string, unknown>;
    expect(result["prose"]).toBe("[REDACTED]");
    expect(result["system"]).toBe("[REDACTED]");
    expect(result["url"]).toBe("[REDACTED]");
  });

  it("redacts common low-entropy credential value formats", () => {
    const result = redactForModel({
      awsId: "AKIAIOSFODNN7EXAMPLE",
      stripeToken: "sk_live_abc123",
      githubToken: "ghp_abcdef123456",
    }) as Record<string, unknown>;

    expect(result["awsId"]).toBe("[REDACTED]");
    expect(result["stripeToken"]).toBe("[REDACTED]");
    expect(result["githubToken"]).toBe("[REDACTED]");
  });

  it("redacts hyphenated api-key fields", () => {
    const result = redactForModel({ "api-key": "abc123" }) as Record<string, unknown>;
    expect(result["api-key"]).toBe("[REDACTED]");
  });

  it("redacts key containing 'token'", () => {
    const result = redactForModel({ accessToken: "abc" }) as Record<string, unknown>;
    expect(result["accessToken"]).toBe("[REDACTED]");
  });

  it("redacts key containing 'secret'", () => {
    const result = redactForModel({ clientSecret: "s3cr3t" }) as Record<string, unknown>;
    expect(result["clientSecret"]).toBe("[REDACTED]");
  });

  it("redacts key containing 'password'", () => {
    const result = redactForModel({ user_password: "hunter2" }) as Record<string, unknown>;
    expect(result["user_password"]).toBe("[REDACTED]");
  });

  it("redacts email address value", () => {
    const result = redactForModel({ contact: "alice@example.com" }) as Record<string, unknown>;
    expect(result["contact"]).toBe("[REDACTED]");
  });

  it("redacts high-entropy string (length ≥ 20 AND entropy ≥ 4.5)", () => {
    // 24 unique chars → max entropy per char, well above 4.5 threshold
    // shannonEntropy("Wq2XkP8Tm5NjL4Yb9RcHsE1v") ≈ 4.585
    const highEntropy = "Wq2XkP8Tm5NjL4Yb9RcHsE1v";
    expect(highEntropy.length).toBeGreaterThanOrEqual(20);
    const result = redactForModel({ value: highEntropy }) as Record<string, unknown>;
    expect(result["value"]).toBe("[REDACTED]");
  });

  it("redacts { secret: true, value: 'x' } node entirely", () => {
    const result = redactForModel({ data: { secret: true, value: "x" } }) as Record<string, unknown>;
    expect(result["data"]).toBe("[REDACTED]");
  });

  it("redacts 'input' key at any depth", () => {
    const result = redactForModel({
      outer: { input: { somePayload: "raw data" } },
    }) as { outer: Record<string, unknown> };
    expect(result.outer["input"]).toBe("[REDACTED]");
  });

  it("redacts 'output' key at any depth", () => {
    const result = redactForModel({
      nested: { deeply: { output: "model response" } },
    }) as { nested: { deeply: Record<string, unknown> } };
    expect(result.nested.deeply["output"]).toBe("[REDACTED]");
  });

  it("redacts input/output body keys case-insensitively", () => {
    const result = redactForModel({ Input: "raw", OUTPUT: "raw" }) as Record<string, unknown>;
    expect(result["Input"]).toBe("[REDACTED]");
    expect(result["OUTPUT"]).toBe("[REDACTED]");
  });

  it("preserves ordinary ID string 'evt-000001'", () => {
    const result = redactForModel({ id: "evt-000001" }) as Record<string, unknown>;
    expect(result["id"]).toBe("evt-000001");
  });

  it("preserves ordinary ID string 'finding-0001'", () => {
    const result = redactForModel({ id: "finding-0001" }) as Record<string, unknown>;
    expect(result["id"]).toBe("finding-0001");
  });

  it("preserves verdict code 'within_declared_authority'", () => {
    const result = redactForModel({ v: "within_declared_authority" }) as Record<string, unknown>;
    expect(result["v"]).toBe("within_declared_authority");
  });

  it("preserves normal task prose", () => {
    const prose = "Summarize churn risk";
    const result = redactForModel({ task: prose }) as Record<string, unknown>;
    expect(result["task"]).toBe(prose);
  });

  it("preserves integer quantity", () => {
    const result = redactForModel({ count: 250 }) as Record<string, unknown>;
    expect(result["count"]).toBe(250);
  });

  it("preserves boolean false", () => {
    const result = redactForModel({ flag: false }) as Record<string, unknown>;
    expect(result["flag"]).toBe(false);
  });

  it("preserves null", () => {
    const result = redactForModel({ val: null }) as Record<string, unknown>;
    expect(result["val"]).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group B — Fact bundle (buildFactBundle)
// ─────────────────────────────────────────────────────────────────────────────

describe("Group B — buildFactBundle", () => {
  it("Fixture A: verdictCode is 'within_declared_authority' and findings is empty", () => {
    expect(bundleA.verdictCode).toBe("within_declared_authority");
    expect(bundleA.findings).toHaveLength(0);
  });

  it("Fixture B: verdictCode is 'material_deviations_found' and findings non-empty", () => {
    expect(bundleB.verdictCode).toBe("material_deviations_found");
    expect(bundleB.findings.length).toBeGreaterThan(0);
  });

  it("bundle events contain no rawPointer field", () => {
    for (const ev of bundleB.events) {
      expect(Object.keys(ev)).not.toContain("rawPointer");
    }
  });

  it("bundle findings contain no observedValue or expectedValue field", () => {
    for (const f of bundleB.findings) {
      expect(Object.keys(f)).not.toContain("observedValue");
      expect(Object.keys(f)).not.toContain("expectedValue");
    }
  });

  it("bundle.findings contains only non-AR-TRACE-001 entries", () => {
    for (const f of bundleB.findings) {
      expect(f.ruleId).not.toBe("AR-TRACE-001");
    }
  });

  it("bundle.limitations contains only entries derived from AR-TRACE-001 findings", () => {
    // Fixture A and B should produce no AR-TRACE-001 findings (complete runs)
    expect(bundleA.limitations).toHaveLength(0);
    expect(bundleB.limitations).toHaveLength(0);
  });

  it("allowedFindingIds includes both normal finding IDs and limitation finding IDs", () => {
    // Construct a bundle with one AR-TRACE-001 and one normal finding
    _resetFindingCounter();
    const ev = makeEvent({ eventId: "evt-000001", operation: "unknown" });
    const accounting = [makeAccounting("events[0]", ["evt-000001"])];
    const normalFinding: Finding = {
      findingId: "finding-manual-0001",
      ruleId: "AR-SYS-001",
      severity: "high",
      label: "Test finding",
      description: "Test",
      eventIds: ["evt-000001"],
    };
    const traceFinding: Finding = {
      findingId: "finding-manual-0002",
      ruleId: "AR-TRACE-001",
      severity: "high",
      label: "Unknown operation",
      description: "Event evt-000001 has operation unknown",
      eventIds: ["evt-000001"],
    };
    const bundle = buildFactBundle({
      events: [ev],
      findings: [normalFinding, traceFinding],
      accounting,
      verdict: "unable_to_assess_fully",
      authority: makeAuthority(),
      hasAssessmentLimitation: true,
    });
    expect(bundle.allowedFindingIds).toContain("finding-manual-0001");
    expect(bundle.allowedFindingIds).toContain("finding-manual-0002");
    expect(bundle.findings.map((f) => f.findingId)).toContain("finding-manual-0001");
    expect(bundle.limitations.some((l) => l.findingIds.includes("finding-manual-0002"))).toBe(true);
  });

  it("serialized bundle does not contain bearer token, email, or raw input/output body", () => {
    // Inject known secret values into events and run buildFactBundle
    const ev = makeEvent({
      eventId: "evt-000001",
    });
    // Manually add input/output to verify they're stripped (CanonicalEvent doesn't have them)
    const withSecrets = {
      ...ev,
      input: { authorization: "Bearer secret-token-xyz", email: "user@example.com" },
      output: "raw model response",
    } as unknown as CanonicalEvent;

    const accounting = [makeAccounting("events[0]", ["evt-000001"])];
    const bundle = buildFactBundle({
      events: [withSecrets],
      findings: [],
      accounting,
      verdict: "within_declared_authority",
      authority: makeAuthority(),
      hasAssessmentLimitation: false,
    });

    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain("secret-token-xyz");
    expect(serialized).not.toContain("user@example.com");
    expect(serialized).not.toContain("raw model response");
  });

  it("serialized bundle redacts low-entropy inline secrets in domain fields and findings", () => {
    const inlineSecret = "token=aaaaaaaaaaaaaaaaaaaa";
    const ev = makeEvent({
      eventId: "evt-000001",
      sourceSystem: inlineSecret,
    });
    const finding: Finding = {
      findingId: "finding-secret-0001",
      ruleId: "AR-SYS-001",
      severity: "high",
      label: "Unpermitted system accessed",
      description: `Event evt-000001 references sourceSystem "${inlineSecret}".`,
      eventIds: ["evt-000001"],
    };
    const bundle = buildFactBundle({
      events: [ev],
      findings: [finding],
      accounting: [makeAccounting("events[0]", ["evt-000001"])],
      verdict: "material_deviations_found",
      authority: makeAuthority(),
      hasAssessmentLimitation: false,
    });

    expect(JSON.stringify(bundle)).not.toContain(inlineSecret);
  });

  it("serialized bundle redacts common credential values in allowed metadata fields", () => {
    const awsAccessKeyId = "AKIAIOSFODNN7EXAMPLE";
    const prefixedToken = "sk_live_abc123";
    const ev = makeEvent({
      eventId: "evt-000001",
      sourceSystem: awsAccessKeyId,
      destinationSystem: prefixedToken,
    });
    const bundle = buildFactBundle({
      events: [ev],
      findings: [],
      accounting: [makeAccounting("events[0]", ["evt-000001"])],
      verdict: "within_declared_authority",
      authority: makeAuthority(),
      hasAssessmentLimitation: false,
    });
    const serialized = JSON.stringify(bundle);

    expect(serialized).not.toContain(awsAccessKeyId);
    expect(serialized).not.toContain(prefixedToken);
  });

  it("GraniteFactBundleSchema.safeParse(bundleA) succeeds", () => {
    const result = GraniteFactBundleSchema.safeParse(bundleA);
    expect(result.success).toBe(true);
  });

  it("GraniteFactBundleSchema.safeParse(bundleB) succeeds", () => {
    const result = GraniteFactBundleSchema.safeParse(bundleB);
    expect(result.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group C — Claim validation (validateClaims)
// ─────────────────────────────────────────────────────────────────────────────

describe("Group C — validateClaims", () => {
  it("valid minimal copy for Fixture A bundle → { valid: true }", () => {
    const copy = makeValidCopy(bundleA);
    const result = validateClaims(copy, bundleA);
    expect(result.valid).toBe(true);
  });

  it("valid copy for Fixture B bundle (citing findings and events) → { valid: true }", () => {
    const copy = deterministicFallback(bundleB);
    const result = validateClaims(copy, bundleB);
    expect(result.valid).toBe(true);
  });

  it("headline with zero eventIds AND zero findingIds → fails with missing citation error", () => {
    const bundle = makeSimpleBundle();
    const copy = makeValidCopy(bundle);
    copy.headline.eventIds = [];
    copy.headline.findingIds = [];
    const result = validateClaims(copy, bundle);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.toLowerCase().includes("citation"))).toBe(true);
    }
  });

  it("outcome with zero eventIds → fails", () => {
    const bundle = makeSimpleBundle();
    const copy = makeValidCopy(bundle);
    copy.outcome.eventIds = [];
    const result = validateClaims(copy, bundle);
    expect(result.valid).toBe(false);
  });

  it("eventId not in allowedEventIds → fails", () => {
    const bundle = makeSimpleBundle();
    const copy = makeValidCopy(bundle);
    copy.headline.eventIds = ["evt-UNKNOWN"];
    const result = validateClaims(copy, bundle);
    expect(result.valid).toBe(false);
  });

  it("findingId not in allowedFindingIds → fails", () => {
    const bundle = makeSimpleBundle();
    const copy = makeValidCopy(bundle);
    copy.headline.findingIds = ["finding-UNKNOWN"];
    const result = validateClaims(copy, bundle);
    expect(result.valid).toBe(false);
  });

  it("findingId in notableAction whose finding eventIds do not overlap cited eventIds → fails", () => {
    // Build a bundle with two events and a finding on event-2 only
    const ev1 = makeEvent({ eventId: "evt-000001" });
    const ev2 = makeEvent({ eventId: "evt-000002", sequence: 2 });
    const finding: Finding = {
      findingId: "finding-manual-0001",
      ruleId: "AR-SYS-001",
      severity: "high",
      label: "Test",
      description: "Test",
      eventIds: ["evt-000002"], // finding references ev2 ONLY
    };
    const bundle = buildFactBundle({
      events: [ev1, ev2],
      findings: [finding],
      accounting: [
        makeAccounting("events[0]", ["evt-000001"]),
        makeAccounting("events[1]", ["evt-000002"]),
      ],
      verdict: "material_deviations_found",
      authority: makeAuthority(),
      hasAssessmentLimitation: false,
    });

    const copy = {
      headline: {
        text: "Agent acted.",
        eventIds: [bundle.allowedEventIds[0]],
        findingIds: [],
      },
      outcome: {
        text: "Based on the supplied trace and authority envelope.",
        eventIds: [bundle.allowedEventIds[0]],
      },
      notableActions: [
        {
          text: "violation detected",
          eventIds: ["evt-000001"], // cites ev1 only
          findingIds: ["finding-manual-0001"], // finding references ev2 — NO overlap
        },
      ],
      limitations: [],
    };

    const result = validateClaims(copy, bundle);
    expect(result.valid).toBe(false);
  });

  it("extra cited event unrelated to every cited finding → fails", () => {
    const ev1 = makeEvent({ eventId: "evt-000001" });
    const ev2 = makeEvent({ eventId: "evt-000002", sequence: 2 });
    const finding: Finding = {
      findingId: "finding-manual-0001",
      ruleId: "AR-SYS-001",
      severity: "high",
      label: "Test",
      description: "Test",
      eventIds: ["evt-000001"],
    };
    const bundle = buildFactBundle({
      events: [ev1, ev2],
      findings: [finding],
      accounting: [
        makeAccounting("events[0]", ["evt-000001"]),
        makeAccounting("events[1]", ["evt-000002"]),
      ],
      verdict: "material_deviations_found",
      authority: makeAuthority(),
      hasAssessmentLimitation: false,
    });
    const copy = makeValidCopy(bundle);
    copy.notableActions = [{
      text: "Finding-backed action",
      eventIds: ["evt-000001", "evt-000002"],
      findingIds: ["finding-manual-0001"],
    }];
    expect(validateClaims(copy, bundle).valid).toBe(false);
  });

  it('"compliant" in headline.text → fails', () => {
    const bundle = makeSimpleBundle();
    const copy = makeValidCopy(bundle);
    copy.headline.text = "The system is compliant.";
    const result = validateClaims(copy, bundle);
    expect(result.valid).toBe(false);
  });

  it('"safe" in notableActions[0].text → fails', () => {
    const bundle = makeSimpleBundle();
    const copy = makeValidCopy(bundle);
    copy.notableActions = [
      {
        text: "The agent took a safe action.",
        eventIds: bundle.allowedEventIds.slice(0, 1),
        findingIds: [],
      },
    ];
    const result = validateClaims(copy, bundle);
    expect(result.valid).toBe(false);
  });

  it('"certified" in an evidence-derived limitation → passes', () => {
    const base = makeSimpleBundle();
    const limitationText =
      "This limitation is not certified; the trace status is unknown.";
    const bundle: GraniteFactBundle = {
      ...base,
      verdictCode: "unable_to_assess_fully",
      verdictQualifier:
        "Unable to assess fully. Based on the supplied trace and authority envelope.",
      limitations: [{
        text: limitationText,
        eventIds: [],
        findingIds: ["finding-trace-0001"],
      }],
      allowedFindingIds: ["finding-trace-0001"],
    };
    const copy = makeValidCopy(bundle);
    copy.limitations = [
      {
        text: limitationText,
        eventIds: [],
      },
    ];
    const result = validateClaims(copy, bundle);
    expect(result.valid).toBe(true);
  });

  it("generated limitation text cannot negate the evidence limitation", () => {
    const base = makeSimpleBundle();
    const bundle: GraniteFactBundle = {
      ...base,
      limitations: [{
        text: "The event operation is unknown and cannot be fully assessed.",
        eventIds: ["evt-000001"],
        findingIds: ["finding-trace-0001"],
      }],
      allowedFindingIds: ["finding-trace-0001"],
    };
    const copy = makeValidCopy(bundle);
    copy.limitations = [{
      text: "No limitation applies.",
      eventIds: ["evt-000001"],
    }];

    expect(validateClaims(copy, bundle).valid).toBe(false);
  });

  it("generated notable action cannot negate a cited deterministic finding", () => {
    const copy = deterministicFallback(bundleB);
    copy.notableActions[0].text = "No findings were found.";

    const result = validateClaims(copy, bundleB);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((error) => error.includes("deterministic finding projection"))).toBe(true);
    }
  });

  it("headline.text 201 characters → fails", () => {
    const bundle = makeSimpleBundle();
    const copy = makeValidCopy(bundle);
    copy.headline.text = "A".repeat(201);
    const result = validateClaims(copy, bundle);
    expect(result.valid).toBe(false);
  });

  it("outcome.text 501 characters → fails", () => {
    const bundle = makeSimpleBundle();
    const copy = makeValidCopy(bundle);
    copy.outcome.text = "Based on the supplied trace and authority envelope. " + "B".repeat(450);
    const result = validateClaims(copy, bundle);
    expect(result.valid).toBe(false);
  });

  it("outcome.text missing the qualifier phrase → fails", () => {
    const bundle = makeSimpleBundle();
    const copy = makeValidCopy(bundle);
    copy.outcome.text = "The agent acted within declared limits.";
    const result = validateClaims(copy, bundle);
    expect(result.valid).toBe(false);
  });

  it("semantically compatible alternate headline still fails the constructive contract", () => {
    const copy = makeValidCopy(bundleA);
    copy.headline.text =
      "No material deviations were found in the supplied trace.";

    const result = validateClaims(copy, bundleA);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((error) => error.includes("deterministic verdict projection"))).toBe(true);
    }
  });

  it("headline and outcome that claim a different deterministic verdict → fail", () => {
    const copy = makeValidCopy(bundleA);
    copy.headline.text = "The supplied trace contains material deviations.";
    copy.outcome.text =
      "Material deviations found. Based on the supplied trace and authority envelope.";

    const result = validateClaims(copy, bundleA);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((error) => error.includes("deterministic verdict"))).toBe(true);
    }
  });

  it("headline cannot negate findings that determine the verdict", () => {
    const copy = deterministicFallback(bundleB);
    copy.headline.text =
      "Material deviations found; no findings were found.";
    copy.notableActions = [];

    const result = validateClaims(copy, bundleB);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((error) => error.includes("cannot negate"))).toBe(true);
    }
  });

  it.each([
    ["within-authority run claims findings", "within", "Within declared authority; this run has findings."],
    ["material run denies findings", "material", "Material deviations found; this run does not have findings."],
    ["material run claims task completion", "material", "Material deviations found; the task is complete."],
    ["within verdict negates its own authority", "within", "Within declared authority; the agent was not within authority."],
    ["within verdict denies authority", "within", "Within declared authority; the agent had no authority."],
    ["material verdict claims within authority", "material", "Material deviations found; the agent was within authority."],
    ["material verdict paraphrases away deviations", "material", "Material deviations found; the evidence does not have deviations."],
  ] as const)("constructive headline rejects %s", (_name, bundleKind, headline) => {
    const bundle = bundleKind === "within" ? bundleA : bundleB;
    const copy = deterministicFallback(bundle);
    copy.headline.text = headline;

    const result = validateClaims(copy, bundle);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((error) => error.includes("deterministic verdict projection"))).toBe(true);
    }
  });

  it("unable verdict headline cannot claim the run is complete", () => {
    const bundle: GraniteFactBundle = {
      ...bundleA,
      verdictCode: "unable_to_assess_fully",
      verdictQualifier:
        "Unable to assess fully. Based on the supplied trace and authority envelope.",
      limitations: [{
        text: 'The trace status is "unknown", which does not provide required run termination evidence.',
        eventIds: [],
        findingIds: ["finding-trace-0001"],
      }],
      allowedFindingIds: ["finding-trace-0001"],
    };
    const copy = deterministicFallback(bundle);
    copy.headline.text = "Unable to assess fully; the run is complete.";

    const result = validateClaims(copy, bundle);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((error) => error.includes("task-completion"))).toBe(true);
    }
  });

  it("verdict headline and outcome cannot cite unrelated allowed events", () => {
    const copy = deterministicFallback(bundleB);
    copy.headline.eventIds = ["evt-000001"];
    copy.headline.findingIds = [];
    copy.outcome.eventIds = ["evt-000001"];

    const result = validateClaims(copy, bundleB);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((error) => error.includes("does not support"))).toBe(true);
    }
  });

  // ── Unsupported facts — one invented claim per category ──

  it('quoted identifier for a system not in cited events → fails', () => {
    const bundle = makeSimpleBundle();
    const copy = makeValidCopy(bundle);
    copy.headline.text = 'The agent accessed "shadow-db" during the run.';
    const result = validateClaims(copy, bundle);
    expect(result.valid).toBe(false);
  });

  it('unquoted identifier-like system absent from cited events → fails', () => {
    const bundle = makeSimpleBundle();
    const copy = makeValidCopy(bundle);
    copy.headline.text = "The agent accessed shadow-db during the run.";
    const result = validateClaims(copy, bundle);
    expect(result.valid).toBe(false);
  });

  it('unquoted plain system name in an access claim → fails', () => {
    const bundle = makeSimpleBundle();
    const copy = makeValidCopy(bundle);
    copy.headline.text = "The agent accessed Salesforce during the run.";
    expect(validateClaims(copy, bundle).valid).toBe(false);
  });

  it('quoted identifier for an operation not in cited events → fails', () => {
    const bundle = makeSimpleBundle();
    const copy = makeValidCopy(bundle);
    copy.headline.text = 'The agent performed a "transfer" operation.';
    const result = validateClaims(copy, bundle);
    expect(result.valid).toBe(false);
  });

  it('unquoted operation absent from cited events → fails', () => {
    const bundle = makeSimpleBundle();
    const copy = makeValidCopy(bundle);
    copy.headline.text = "The agent performed a transfer operation.";
    expect(validateClaims(copy, bundle).valid).toBe(false);
  });

  it('ordinary inflected operation absent from cited events → fails', () => {
    const copy = makeValidCopy(bundleA);
    copy.notableActions = [{
      text: "The agent sent funds.",
      eventIds: ["evt-000001"],
      findingIds: [],
    }];

    const result = validateClaims(copy, bundleA);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((error) => error.includes('"send"'))).toBe(true);
    }
  });

  it('unsupported person and personal outcome prose → fails', () => {
    const copy = makeValidCopy(bundleA);
    copy.headline.text =
      "No deviations were found; Alice earned a promotion.";

    const result = validateClaims(copy, bundleA);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((error) => error.includes('"Alice"'))).toBe(true);
      expect(result.errors.some((error) => error.includes('"promotion"'))).toBe(true);
    }
  });

  it('unsupported business outcome prose → fails', () => {
    const copy = makeValidCopy(bundleA);
    copy.headline.text = "No deviations were found; profits doubled.";

    const result = validateClaims(copy, bundleA);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((error) => error.includes('"profits"'))).toBe(true);
      expect(result.errors.some((error) => error.includes('"doubled"'))).toBe(true);
    }
  });

  it('run evidence cannot be promoted into a task-completion claim', () => {
    const copy = makeValidCopy(bundleA);
    copy.headline.text =
      "No deviations were found; the agent completed the task.";

    const result = validateClaims(copy, bundleA);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((error) => error.includes("task-completion"))).toBe(true);
    }
  });

  it('declared-task vocabulary cannot be promoted into observed action', () => {
    const copy = makeValidCopy(bundleA);
    copy.headline.text =
      "Within declared authority contacting customers.";

    const result = validateClaims(copy, bundleA);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((error) => error.includes('"contacting"'))).toBe(true);
    }
  });

  it.each(["riskTags", "adapterWarnings"])(
    "empty event metadata field name cannot become a claim: %s",
    (fieldName) => {
      const copy = makeValidCopy(bundleA);
      copy.headline.text =
        `Within declared authority; ${fieldName} detected.`;

      expect(validateClaims(copy, bundleA).valid).toBe(false);
    },
  );

  it.each([
    "No deviations were found; Bob was promoted.",
    "No deviations were found; customers were delighted.",
    "No deviations were found; profit surged.",
  ])("unsupported paraphrased outcome is rejected: %s", (headline) => {
    const copy = makeValidCopy(bundleA);
    copy.headline.text = headline;

    expect(validateClaims(copy, bundleA).valid).toBe(false);
  });

  it('quoted identifier for a resource type not in cited events → fails', () => {
    // Fixture A events have resourceType 'churn-risk-record' etc; "invoice" is invented
    const copy = makeValidCopy(bundleA);
    copy.headline.text = 'The agent created an "invoice" resource.';
    const result = validateClaims(copy, bundleA);
    expect(result.valid).toBe(false);
  });

  it('unquoted resource type absent from cited events → fails', () => {
    const copy = makeValidCopy(bundleA);
    copy.headline.text = "The agent created an invoice resource.";
    expect(validateClaims(copy, bundleA).valid).toBe(false);
  });

  it('quoted identifier for a data category not in cited events → fails', () => {
    const copy = makeValidCopy(bundleA);
    copy.headline.text = 'The agent handled "passport_number" data.';
    const result = validateClaims(copy, bundleA);
    expect(result.valid).toBe(false);
  });

  it('numeric quantity claim not in cited events → fails', () => {
    const bundle = makeSimpleBundle();
    const copy = makeValidCopy(bundle);
    // simple bundle event has no quantity, so any quantity claim should fail
    copy.headline.text = "The agent processed 999 records.";
    const result = validateClaims(copy, bundle);
    expect(result.valid).toBe(false);
  });

  it('quoted actor/person ID not in cited events → fails', () => {
    const bundle = makeSimpleBundle();
    const copy = makeValidCopy(bundle);
    copy.headline.text = 'Actor "rogue-agent" performed the operation.';
    const result = validateClaims(copy, bundle);
    expect(result.valid).toBe(false);
  });

  it('unquoted actor ID absent from cited events → fails', () => {
    const bundle = makeSimpleBundle();
    const copy = makeValidCopy(bundle);
    copy.headline.text = "The actor id is Alice during this run.";
    expect(validateClaims(copy, bundle).valid).toBe(false);
  });

  it('controlled status value not in cited events → fails', () => {
    // Simple bundle has status 'succeeded'; claim 'cancelled' — not in support set
    const bundle = makeSimpleBundle();
    const copy = makeValidCopy(bundle);
    copy.headline.text = "The run was cancelled before completing.";
    const result = validateClaims(copy, bundle);
    expect(result.valid).toBe(false);
  });

  it("invented limitation when the bundle has none → fails", () => {
    const bundle = makeSimpleBundle();
    const copy = makeValidCopy(bundle);
    copy.limitations = [{
      text: "An unrelated system might have been contacted.",
      eventIds: [],
    }];
    expect(validateClaims(copy, bundle).valid).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group D — Deterministic fallback (deterministicFallback)
// ─────────────────────────────────────────────────────────────────────────────

describe("Group D — deterministicFallback", () => {
  it("Fixture A bundle: schema-valid, notableActions empty, limitations empty", () => {
    const output = deterministicFallback(bundleA);
    const result = GeneratedReceiptCopySchema.safeParse(output);
    expect(result.success).toBe(true);
    expect(output.notableActions).toHaveLength(0);
    expect(output.limitations).toHaveLength(0);
  });

  it("Fixture B bundle: schema-valid, notableActions non-empty, all cited findingIds in allowedFindingIds", () => {
    const output = deterministicFallback(bundleB);
    const result = GeneratedReceiptCopySchema.safeParse(output);
    expect(result.success).toBe(true);
    expect(output.notableActions.length).toBeGreaterThan(0);

    const allowed = new Set(bundleB.allowedFindingIds);
    for (const action of output.notableActions) {
      for (const fid of action.findingIds) {
        expect(allowed.has(fid)).toBe(true);
      }
    }
  });

  it("Fixture A fallback passes validateClaims(output, bundle)", () => {
    const output = deterministicFallback(bundleA);
    const result = validateClaims(output, bundleA);
    expect(result.valid).toBe(true);
  });

  it("Fixture B fallback passes validateClaims(output, bundle)", () => {
    const output = deterministicFallback(bundleB);
    const result = validateClaims(output, bundleB);
    expect(result.valid).toBe(true);
  });

  it("Granite may select and order a subset of canonical notable actions", () => {
    const output = deterministicFallback(bundleB);
    output.notableActions = [
      output.notableActions.at(-1)!,
      output.notableActions[0],
    ];

    expect(validateClaims(output, bundleB)).toEqual({ valid: true });
  });

  it("self-validates deterministic fallback text for all four verdicts", () => {
    const event = makeEvent({ eventId: "evt-000001" });
    const accounting = [makeAccounting("events[0]", [event.eventId])];
    const authority = makeAuthority();
    const reviewFinding: Finding = {
      findingId: "finding-review-0001",
      ruleId: "AR-REVIEW-TEST",
      severity: "medium",
      label: "Manager review warranted",
      description: "Event evt-000001 warrants manager review.",
      eventIds: [event.eventId],
    };
    const limitationFinding: Finding = {
      findingId: "finding-trace-0001",
      ruleId: "AR-TRACE-001",
      severity: "high",
      label: "Missing run termination evidence",
      description:
        'The trace status is "unknown", which does not provide required run termination evidence.',
      eventIds: [],
    };
    const reviewBundle = buildFactBundle({
      events: [event],
      findings: [reviewFinding],
      accounting,
      verdict: "review_recommended",
      authority,
      hasAssessmentLimitation: false,
    });
    const unableBundle = buildFactBundle({
      events: [event],
      findings: [limitationFinding],
      accounting,
      verdict: "unable_to_assess_fully",
      authority,
      hasAssessmentLimitation: true,
    });

    for (const bundle of [bundleA, reviewBundle, bundleB, unableBundle]) {
      const result = validateClaims(deterministicFallback(bundle), bundle);
      if (!result.valid) {
        throw new Error(
          `${bundle.verdictCode} fallback failed: ${result.errors.join(" | ")}`,
        );
      }
    }
  });

  it("read-only volume finding fallback remains claim-valid", () => {
    const event = makeEvent({
      eventId: "evt-000001",
      operation: "read",
      quantity: { value: 250, unit: "records" },
    });
    const accounting = [makeAccounting("events[0]", [event.eventId])];
    const authority = makeAuthority({ maxRecordsRead: 0 });
    const policy = runPolicyEngine({
      events: [event],
      accounting,
      authority,
      traceCompletionStatus: "succeeded",
    });
    expect(policy.findings.map((finding) => finding.ruleId)).toContain(
      "AR-VOLUME-001",
    );
    const bundle = buildFactBundle({
      events: [event],
      findings: policy.findings,
      accounting,
      verdict: policy.verdict,
      authority,
      hasAssessmentLimitation: policy.hasAssessmentLimitation,
    });
    const output = deterministicFallback(bundle);

    expect(validateClaims(output, bundle)).toEqual({ valid: true });
  });

  it("Fixture B fallback verdict copy cites the events that support its findings", () => {
    const output = deterministicFallback(bundleB);
    const findingEventIds = new Set(
      bundleB.findings.flatMap((finding) => finding.eventIds),
    );

    expect(output.headline.findingIds.length).toBeGreaterThan(0);
    expect(output.outcome.eventIds.length).toBeGreaterThan(0);
    for (const eventId of output.headline.eventIds) {
      expect(findingEventIds.has(eventId)).toBe(true);
    }
    for (const eventId of output.outcome.eventIds) {
      expect(findingEventIds.has(eventId)).toBe(true);
    }
    expect(output.outcome.eventIds).toContain("evt-000004");
  });

  it("outcome.text contains 'Based on the supplied trace and authority envelope'", () => {
    const outputA = deterministicFallback(bundleA);
    const outputB = deterministicFallback(bundleB);
    expect(outputA.outcome.text).toContain("Based on the supplied trace and authority envelope");
    expect(outputB.outcome.text).toContain("Based on the supplied trace and authority envelope");
  });

  it("no invented IDs: every cited ID is in allowedEventIds or allowedFindingIds", () => {
    const output = deterministicFallback(bundleB);
    const allowedEvents = new Set(bundleB.allowedEventIds);
    const allowedFindings = new Set(bundleB.allowedFindingIds);

    for (const id of output.headline.eventIds) expect(allowedEvents.has(id)).toBe(true);
    for (const id of output.headline.findingIds) expect(allowedFindings.has(id)).toBe(true);
    for (const id of output.outcome.eventIds) expect(allowedEvents.has(id)).toBe(true);
    for (const action of output.notableActions) {
      for (const id of action.eventIds) expect(allowedEvents.has(id)).toBe(true);
      for (const id of action.findingIds) expect(allowedFindings.has(id)).toBe(true);
    }
    for (const lim of output.limitations) {
      for (const id of lim.eventIds) expect(allowedEvents.has(id)).toBe(true);
    }
  });

  it("limitations items have no findingIds field (schema-enforced by Zod strict)", () => {
    const output = deterministicFallback(bundleB);
    for (const lim of output.limitations) {
      expect(Object.keys(lim)).not.toContain("findingIds");
    }
  });

  it("AR-TRACE-001 constructed unit test: partitioning, schema-valid, no duplication, no unknown IDs", () => {
    _resetFindingCounter();
    const ev = makeEvent({ eventId: "evt-000001" });
    const normalFinding: Finding = {
      findingId: "finding-normal-0001",
      ruleId: "AR-SYS-001",
      severity: "high",
      label: "Unpermitted system",
      description: "Event evt-000001 references an unpermitted system.",
      eventIds: ["evt-000001"],
    };
    const traceFinding: Finding = {
      findingId: "finding-trace-0001",
      ruleId: "AR-TRACE-001",
      severity: "high",
      label: "Missing run termination evidence",
      description: 'The trace status is "unknown", which does not provide required run termination evidence.',
      eventIds: [],
    };

    const bundle = buildFactBundle({
      events: [ev],
      findings: [normalFinding, traceFinding],
      accounting: [makeAccounting("events[0]", ["evt-000001"])],
      verdict: "unable_to_assess_fully",
      authority: makeAuthority(),
      hasAssessmentLimitation: true,
    });

    // bundle.findings should contain only the normal finding
    expect(bundle.findings.map((f) => f.findingId)).toContain("finding-normal-0001");
    expect(bundle.findings.map((f) => f.ruleId)).not.toContain("AR-TRACE-001");

    // bundle.limitations should contain only the AR-TRACE-001 finding
    expect(bundle.limitations.some((l) => l.findingIds.includes("finding-trace-0001"))).toBe(true);
    expect(bundle.limitations.every((l) => !l.findingIds.includes("finding-normal-0001"))).toBe(true);

    const output = deterministicFallback(bundle);

    // Schema valid
    const schemaResult = GeneratedReceiptCopySchema.safeParse(output);
    expect(schemaResult.success).toBe(true);

    // Claim valid
    const claimResult = validateClaims(output, bundle);
    expect(claimResult.valid).toBe(true);

    // AR-TRACE-001 content only in limitations, not in notableActions
    const traceText = traceFinding.description;
    for (const action of output.notableActions) {
      expect(action.text).not.toContain(traceText.slice(0, 20));
    }
    expect(output.limitations.some((l) => l.text.includes("unknown"))).toBe(true);

    // No unknown IDs
    const allowedEvents = new Set(bundle.allowedEventIds);
    const allowedFindings = new Set(bundle.allowedFindingIds);
    for (const id of output.headline.eventIds) expect(allowedEvents.has(id)).toBe(true);
    for (const id of output.headline.findingIds) expect(allowedFindings.has(id)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group E — Granite client (callGranite) — mocked fetch
// ─────────────────────────────────────────────────────────────────────────────

describe("Group E — callGranite (mocked fetch)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("GRANITE_MODE absent → missing_credentials, fetch never called", async () => {
    vi.stubEnv("GRANITE_MODE", "");
    const bundle = makeSimpleBundle();
    const result = await callGranite(bundle);
    expect(result).toEqual({ ok: false, reason: "missing_credentials" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("GRANITE_MODE=fallback → missing_credentials, fetch never called", async () => {
    vi.stubEnv("GRANITE_MODE", "fallback");
    const result = await callGranite(makeSimpleBundle());
    expect(result).toEqual({ ok: false, reason: "missing_credentials" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("GRANITE_MODE=invalid-value → missing_credentials via .catch('fallback'), fetch never called", async () => {
    vi.stubEnv("GRANITE_MODE", "not-a-valid-mode");
    const result = await callGranite(makeSimpleBundle());
    expect(result).toEqual({ ok: false, reason: "missing_credentials" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("GRANITE_MODE=live, no other env vars → missing_credentials, fetch never called", async () => {
    vi.stubEnv("GRANITE_MODE", "live");
    vi.stubEnv("WATSONX_API_KEY", "");
    vi.stubEnv("WATSONX_URL", "");
    vi.stubEnv("WATSONX_PROJECT_ID", "");
    vi.stubEnv("WATSONX_MODEL_ID", "");
    const result = await callGranite(makeSimpleBundle());
    expect(result).toEqual({ ok: false, reason: "missing_credentials" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps accidental production live mode disabled without explicit opt-in", async () => {
    vi.stubEnv("GRANITE_MODE", "live");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("WATSONX_API_KEY", "test-key");
    vi.stubEnv("WATSONX_URL", "https://us-south.ml.cloud.ibm.com");
    vi.stubEnv("WATSONX_PROJECT_ID", "proj-123");
    vi.stubEnv("WATSONX_MODEL_ID", "ibm/granite-4-h-small");

    expect(await callGranite(makeSimpleBundle())).toEqual({
      ok: false,
      reason: "missing_credentials",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("GRANITE_MODE=live, WATSONX_URL is HTTP not HTTPS → missing_credentials, fetch never called", async () => {
    vi.stubEnv("GRANITE_MODE", "live");
    vi.stubEnv("WATSONX_API_KEY", "test-key");
    vi.stubEnv("WATSONX_URL", "http://us-south.ml.cloud.ibm.com");
    vi.stubEnv("WATSONX_PROJECT_ID", "proj-123");
    vi.stubEnv("WATSONX_MODEL_ID", "ibm/granite-4-h-small");
    const result = await callGranite(makeSimpleBundle());
    expect(result).toEqual({ ok: false, reason: "missing_credentials" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("GRANITE_MODE=live, credentials present, IAM returns HTTP 500 → iam_error, watsonx fetch never called", async () => {
    vi.stubEnv("GRANITE_MODE", "live");
    vi.stubEnv("WATSONX_API_KEY", "test-key");
    vi.stubEnv("WATSONX_URL", "https://us-south.ml.cloud.ibm.com");
    vi.stubEnv("WATSONX_PROJECT_ID", "proj-123");
    vi.stubEnv("WATSONX_MODEL_ID", "ibm/granite-4-h-small");

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "internal" }), { status: 500 }),
    );

    const result = await callGranite(makeSimpleBundle());
    expect(result).toEqual({ ok: false, reason: "iam_error" });
    expect(fetchMock).toHaveBeenCalledTimes(1); // IAM only
  });

  it("IAM returns malformed JSON → iam_error", async () => {
    vi.stubEnv("GRANITE_MODE", "live");
    vi.stubEnv("WATSONX_API_KEY", "test-key");
    vi.stubEnv("WATSONX_URL", "https://us-south.ml.cloud.ibm.com");
    vi.stubEnv("WATSONX_PROJECT_ID", "proj-123");
    vi.stubEnv("WATSONX_MODEL_ID", "ibm/granite-4-h-small");

    fetchMock.mockResolvedValueOnce(
      new Response("not json{{{", { status: 200 }),
    );

    const result = await callGranite(makeSimpleBundle());
    expect(result).toEqual({ ok: false, reason: "iam_error" });
  });

  it("IAM returns JSON without access_token → iam_error", async () => {
    vi.stubEnv("GRANITE_MODE", "live");
    vi.stubEnv("WATSONX_API_KEY", "test-key");
    vi.stubEnv("WATSONX_URL", "https://us-south.ml.cloud.ibm.com");
    vi.stubEnv("WATSONX_PROJECT_ID", "proj-123");
    vi.stubEnv("WATSONX_MODEL_ID", "ibm/granite-4-h-small");

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ token_type: "Bearer" }), { status: 200 }),
    );

    const result = await callGranite(makeSimpleBundle());
    expect(result).toEqual({ ok: false, reason: "iam_error" });
  });

  it("valid IAM token, watsonx returns HTTP 500 → http_error", async () => {
    vi.stubEnv("GRANITE_MODE", "live");
    vi.stubEnv("WATSONX_API_KEY", "test-key");
    vi.stubEnv("WATSONX_URL", "https://us-south.ml.cloud.ibm.com");
    vi.stubEnv("WATSONX_PROJECT_ID", "proj-123");
    vi.stubEnv("WATSONX_MODEL_ID", "ibm/granite-4-h-small");

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "iam-token-abc" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "model error" }), { status: 500 }),
      );

    const result = await callGranite(makeSimpleBundle());
    expect(result).toEqual({ ok: false, reason: "http_error" });
  });

  it("valid IAM + valid watsonx response → ok: true with text, modelId, apiVersion", async () => {
    vi.stubEnv("GRANITE_MODE", "live");
    vi.stubEnv("WATSONX_API_KEY", "test-key");
    vi.stubEnv("WATSONX_URL", "https://us-south.ml.cloud.ibm.com/");
    vi.stubEnv("WATSONX_PROJECT_ID", "proj-123");
    vi.stubEnv("WATSONX_MODEL_ID", "ibm/granite-4-h-small");

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "iam-token-abc" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: '{"headline": "test"}',
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );

    const bundle = makeSimpleBundle();
    const result = await callGranite(bundle);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe('{"headline": "test"}');
      expect(result.modelId).toBe("ibm/granite-4-h-small");
      expect(result.apiVersion).toBe("2025-10-25");
    }
    const watsonxCall = fetchMock.mock.calls[1];
    expect(watsonxCall[0]).toBe(
      "https://us-south.ml.cloud.ibm.com/ml/v1/text/chat?version=2025-10-25",
    );
    const body = JSON.parse(watsonxCall[1].body as string) as {
      model_id: string;
      project_id: string;
      messages: Array<{ role: string; content: string }>;
      response_format: { type: string };
      temperature: number;
      max_completion_tokens: number;
    };
    expect(body.model_id).toBe("ibm/granite-4-h-small");
    expect(body.project_id).toBe("proj-123");
    expect(body.temperature).toBe(0);
    expect(body.max_completion_tokens).toBe(256);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]?.role).toBe("system");
    expect(body.messages[0]?.content).toContain("do not write claims");
    expect(body.messages[1]?.role).toBe("user");
    const prompt = body.messages[1]?.content ?? "";
    expect(prompt).toContain('"notableFindingIds"');
    expect(prompt).toContain("Do not add keys");
    expect(prompt).toContain('"verdictCode":"within_declared_authority"');
    expect(prompt).not.toContain('"events"');
  });

  it("repair call (with repairErrors) → prompt contains error strings; IAM fetched once per callGranite invocation", async () => {
    vi.stubEnv("GRANITE_MODE", "live");
    vi.stubEnv("WATSONX_API_KEY", "test-key");
    vi.stubEnv("WATSONX_URL", "https://us-south.ml.cloud.ibm.com");
    vi.stubEnv("WATSONX_PROJECT_ID", "proj-123");
    vi.stubEnv("WATSONX_MODEL_ID", "ibm/granite-4-h-small");

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "iam-token-abc" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: '{"repaired": true}',
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );

    const repairErrors = ["missing citation on outcome", "unknown eventId xyz"];
    const result = await callGranite(makeSimpleBundle(), { repairErrors });
    expect(result.ok).toBe(true);
    // IAM once + watsonx once = 2 calls for this single callGranite invocation
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Verify error strings appear in the watsonx call body
    const watsonxCall = fetchMock.mock.calls[1];
    const body = JSON.parse(watsonxCall[1].body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    const prompt = body.messages[1]?.content ?? "";
    expect(prompt).toContain("missing citation on outcome");
    expect(prompt).toContain("unknown eventId xyz");
    expect(prompt).toContain('"notableFindingIds"');
    expect(prompt).toContain("Use each ID at most once");
  });

  it("reuses an unexpired IAM token across initial and repair invocations", async () => {
    vi.stubEnv("GRANITE_MODE", "live");
    vi.stubEnv("WATSONX_API_KEY", "test-key");
    vi.stubEnv("WATSONX_URL", "https://us-south.ml.cloud.ibm.com");
    vi.stubEnv("WATSONX_PROJECT_ID", "proj-123");
    vi.stubEnv("WATSONX_MODEL_ID", "ibm/granite-4-h-small");

    const chatResponse = () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"notableFindingIds":[]}' } }],
        }),
        { status: 200 },
      );
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: "iam-token-abc", expires_in: 3600 }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(chatResponse())
      .mockResolvedValueOnce(chatResponse());

    const bundle = makeSimpleBundle();
    expect((await callGranite(bundle)).ok).toBe(true);
    expect((await callGranite(bundle, { repairErrors: ["test repair"] })).ok).toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://iam.cloud.ibm.com/identity/token",
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/ml/v1/text/chat");
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("/ml/v1/text/chat");
  });

  it("rejects the retired text-generation response shape", async () => {
    vi.stubEnv("GRANITE_MODE", "live");
    vi.stubEnv("WATSONX_API_KEY", "test-key");
    vi.stubEnv("WATSONX_URL", "https://us-south.ml.cloud.ibm.com");
    vi.stubEnv("WATSONX_PROJECT_ID", "proj-123");
    vi.stubEnv("WATSONX_MODEL_ID", "ibm/granite-4-h-small");

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "iam-token-abc" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ results: [{ generated_text: "legacy response" }] }),
          { status: 200 },
        ),
      );

    const result = await callGranite(makeSimpleBundle());
    expect(result).toEqual({ ok: false, reason: "http_error" });
  });

  it("IAM AbortController fires (4 s timeout) → iam_error", async () => {
    vi.stubEnv("GRANITE_MODE", "live");
    vi.stubEnv("WATSONX_API_KEY", "test-key");
    vi.stubEnv("WATSONX_URL", "https://us-south.ml.cloud.ibm.com");
    vi.stubEnv("WATSONX_PROJECT_ID", "proj-123");
    vi.stubEnv("WATSONX_MODEL_ID", "ibm/granite-4-h-small");

    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });

    // Use fake timers so we don't actually wait 4 seconds
    vi.useFakeTimers();
    const resultPromise = callGranite(makeSimpleBundle());
    await vi.advanceTimersByTimeAsync(5000);
    const result = await resultPromise;
    vi.useRealTimers();

    expect(result).toEqual({ ok: false, reason: "iam_error" });
  }, 10000);

  it("watsonx AbortController fires (4 s timeout) → timeout", async () => {
    vi.stubEnv("GRANITE_MODE", "live");
    vi.stubEnv("WATSONX_API_KEY", "test-key");
    vi.stubEnv("WATSONX_URL", "https://us-south.ml.cloud.ibm.com");
    vi.stubEnv("WATSONX_PROJECT_ID", "proj-123");
    vi.stubEnv("WATSONX_MODEL_ID", "ibm/granite-4-h-small");

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "iam-token-abc" }), { status: 200 }),
      )
      .mockImplementationOnce((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      });

    vi.useFakeTimers();
    const resultPromise = callGranite(makeSimpleBundle());
    await vi.advanceTimersByTimeAsync(5000);
    const result = await resultPromise;
    vi.useRealTimers();

    expect(result).toEqual({ ok: false, reason: "timeout" });
  }, 10000);

  it("watsonx fetch throws network error → network_error", async () => {
    vi.stubEnv("GRANITE_MODE", "live");
    vi.stubEnv("WATSONX_API_KEY", "test-key");
    vi.stubEnv("WATSONX_URL", "https://us-south.ml.cloud.ibm.com");
    vi.stubEnv("WATSONX_PROJECT_ID", "proj-123");
    vi.stubEnv("WATSONX_MODEL_ID", "ibm/granite-4-h-small");

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "iam-token-abc" }), { status: 200 }),
      )
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const result = await callGranite(makeSimpleBundle());
    expect(result).toEqual({ ok: false, reason: "network_error" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group F — Route handler (POST /api/receipt-copy) — mocked callGranite
// ─────────────────────────────────────────────────────────────────────────────

// Mock callGranite module for Group F tests. The factory imports the original
// so Group E (which tests callGranite directly) gets the real implementation.
// Group F tests override callGranite.mockResolvedValue per test.
vi.mock("../../src/ai/graniteClient.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/ai/graniteClient.js")>();
  return {
    ...original,
    callGranite: vi.fn(original.callGranite),
  };
});

import { callGranite as callGraniteMock } from "../../src/ai/graniteClient.js";
import {
  MAX_RECEIPT_COPY_REQUEST_BYTES,
  POST,
} from "../../src/app/api/receipt-copy/route.js";

// Helper to build a valid route request body from a fixture
function makeRouteBody(trace: typeof fixtureA, traceStatus: string) {
  _resetFindingCounter();
  const adapter = adaptNativeTrace(trace);
  return {
    rawEventCount: trace.events.length,
    events: adapter.events,
    accounting: adapter.accounting,
    authority: sharedAuthority,
    traceCompletionStatus: traceStatus,
  };
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/receipt-copy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Build a valid granite copy that will pass validateClaims for Fixture A
function makeValidGraniteCopyForA(bundle: GraniteFactBundle): string {
  return JSON.stringify(deterministicFallback(bundle));
}

describe("Group F — POST /api/receipt-copy (mocked callGranite)", () => {
  const mockedCallGranite = callGraniteMock as ReturnType<typeof vi.fn>;

  afterEach(() => {
    // Reset mock implementation so subsequent tests start from the original
    // callGranite implementation (not a leftover mockResolvedValue from a previous test).
    vi.mocked(callGraniteMock).mockReset();
    vi.unstubAllEnvs();
  });

  it("Fixture A body in fallback mode → 200, generationSource: deterministic_fallback, no modelId", async () => {
    mockedCallGranite.mockResolvedValue({ ok: false, reason: "missing_credentials" });

    _resetFindingCounter();
    const body = makeRouteBody(fixtureA, "succeeded");
    const req = makeRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json() as { generationSource: string; modelId?: unknown };
    expect(json.generationSource).toBe("deterministic_fallback");
    expect(json.modelId).toBeUndefined();
  });

  it("Fixture A body, callGranite returns valid granite copy → 200, granite, modelId and modelApiVersion present", async () => {
    _resetFindingCounter();
    const body = makeRouteBody(fixtureA, "succeeded");

    // Build bundle to create a valid copy
    const adapter = adaptNativeTrace(fixtureA);
    _resetFindingCounter();
    const engine = runPolicyEngine({
      events: adapter.events,
      accounting: adapter.accounting,
      authority: sharedAuthority,
      traceCompletionStatus: "succeeded",
    });
    _resetFindingCounter();
    const bundle = buildFactBundle({
      events: adapter.events,
      findings: engine.findings,
      accounting: adapter.accounting,
      verdict: engine.verdict,
      authority: sharedAuthority,
      hasAssessmentLimitation: engine.hasAssessmentLimitation,
    });
    const validText = makeValidGraniteCopyForA(bundle);

    mockedCallGranite.mockResolvedValue({
      ok: true,
      text: validText,
      modelId: "ibm/granite-4-h-small",
      apiVersion: "2025-10-25",
    });

    _resetFindingCounter();
    const req = makeRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json() as { generationSource: string; modelId: string; modelApiVersion: string };
    expect(json.generationSource).toBe("granite");
    expect(json.modelId).toBeTruthy();
    expect(json.modelApiVersion).toBeTruthy();
  });

  it("invalid first response (bad citations), valid repair → 200, granite; callGranite called exactly twice", async () => {
    _resetFindingCounter();
    const body = makeRouteBody(fixtureA, "succeeded");

    // Build bundle to get valid copy text for repair response
    const adapter = adaptNativeTrace(fixtureA);
    _resetFindingCounter();
    const engine = runPolicyEngine({
      events: adapter.events,
      accounting: adapter.accounting,
      authority: sharedAuthority,
      traceCompletionStatus: "succeeded",
    });
    _resetFindingCounter();
    const bundle = buildFactBundle({
      events: adapter.events,
      findings: engine.findings,
      accounting: adapter.accounting,
      verdict: engine.verdict,
      authority: sharedAuthority,
      hasAssessmentLimitation: engine.hasAssessmentLimitation,
    });
    const validText = makeValidGraniteCopyForA(bundle);

    mockedCallGranite
      .mockResolvedValueOnce({
        ok: true,
        text: '{"invalid": true}', // schema failure
        modelId: "ibm/granite-4-h-small",
        apiVersion: "2025-10-25",
      })
      .mockResolvedValueOnce({
        ok: true,
        text: validText,
        modelId: "ibm/granite-4-h-small",
        apiVersion: "2025-10-25",
      });

    _resetFindingCounter();
    const req = makeRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json() as { generationSource: string };
    expect(json.generationSource).toBe("granite");
    expect(mockedCallGranite).toHaveBeenCalledTimes(2);
  });

  it("invalid first and second responses → 200, deterministic_fallback; callGranite called exactly twice", async () => {
    mockedCallGranite
      .mockResolvedValueOnce({
        ok: true,
        text: '{"bad": "response"}',
        modelId: "ibm/granite-4-h-small",
        apiVersion: "2025-10-25",
      })
      .mockResolvedValueOnce({
        ok: true,
        text: '{"also": "bad"}',
        modelId: "ibm/granite-4-h-small",
        apiVersion: "2025-10-25",
      });

    _resetFindingCounter();
    const body = makeRouteBody(fixtureA, "succeeded");
    const req = makeRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json() as { generationSource: string };
    expect(json.generationSource).toBe("deterministic_fallback");
    expect(mockedCallGranite).toHaveBeenCalledTimes(2);
  });

  it("callGranite returns ok: false → 200, deterministic_fallback; no repair call (one total call)", async () => {
    mockedCallGranite.mockResolvedValue({ ok: false, reason: "missing_credentials" });

    _resetFindingCounter();
    const body = makeRouteBody(fixtureA, "succeeded");
    const req = makeRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json() as { generationSource: string };
    expect(json.generationSource).toBe("deterministic_fallback");
    expect(mockedCallGranite).toHaveBeenCalledTimes(1);
  });

  it("callGranite returns iam_error → 200, deterministic_fallback; fallback validated before return", async () => {
    mockedCallGranite.mockResolvedValue({ ok: false, reason: "iam_error" });

    _resetFindingCounter();
    const body = makeRouteBody(fixtureA, "succeeded");
    const req = makeRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json() as { generationSource: string; copy: unknown };
    expect(json.generationSource).toBe("deterministic_fallback");
    // Validate the fallback copy passes schema
    const copyResult = GeneratedReceiptCopySchema.safeParse(json.copy);
    expect(copyResult.success).toBe(true);
  });

  it("long unparsed reason still produces a bounded offline limitation", async () => {
    mockedCallGranite.mockResolvedValue({
      ok: false,
      reason: "missing_credentials",
    });
    const body = makeRouteBody(fixtureA, "succeeded");
    const removedEvent = body.events.pop();
    expect(removedEvent).toBeDefined();
    const accountingIndex = body.accounting.findIndex(
      (entry) => entry.canonicalEventIds.includes(removedEvent!.eventId),
    );
    expect(accountingIndex).toBeGreaterThanOrEqual(0);
    body.accounting[accountingIndex] = {
      rawPointer: body.accounting[accountingIndex].rawPointer,
      sourceEventId: body.accounting[accountingIndex].sourceEventId,
      status: "unparsed",
      canonicalEventIds: [],
      reason: `Unsupported trace detail ${"x".repeat(500)}`,
      material: true,
    };

    const res = await POST(makeRequest(body));
    const json = await res.json() as {
      generationSource: string;
      copy: { limitations: Array<{ text: string }> };
    };

    expect(res.status).toBe(200);
    expect(json.generationSource).toBe("deterministic_fallback");
    expect(json.copy.limitations).toHaveLength(1);
    expect(json.copy.limitations[0].text.length).toBeLessThanOrEqual(300);
  });

  it("invalid JSON body to route → 400", async () => {
    const req = new Request("http://localhost/api/receipt-copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not valid json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("non-JSON content type is rejected before parsing", async () => {
    const req = new Request("http://localhost/api/receipt-copy", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(makeRouteBody(fixtureA, fixtureA.status)),
    });
    const res = await POST(req);
    expect(res.status).toBe(415);
  });

  it("oversized request body is rejected before Granite work", async () => {
    const req = new Request("http://localhost/api/receipt-copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(MAX_RECEIPT_COPY_REQUEST_BYTES) }),
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(mockedCallGranite).not.toHaveBeenCalled();
  });

  it("traceCompletionStatus outside allowed enum → 400", async () => {
    _resetFindingCounter();
    const body = {
      ...makeRouteBody(fixtureA, "succeeded"),
      traceCompletionStatus: "running", // not in enum
    };
    const req = makeRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("duplicate canonical event IDs at the route boundary → 400", async () => {
    const body = makeRouteBody(fixtureA, "succeeded");
    body.events = [
      ...body.events,
      { ...body.events[0], sequence: body.events.length + 1 },
    ];
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(400);
  });

  it("accounting that references an unknown canonical event ID → 400", async () => {
    const body = makeRouteBody(fixtureA, "succeeded");
    body.accounting = [
      ...body.accounting,
      {
        rawPointer: "events[unknown]",
        status: "mapped" as const,
        canonicalEventIds: ["evt-unknown"],
        material: true,
      },
    ];
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(400);
  });

  it("canonical event missing from raw-event accounting → 400", async () => {
    const body = makeRouteBody(fixtureA, "succeeded");
    body.accounting = body.accounting.slice(1);
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(400);
  });

  it("rawEventCount that does not match accounting length → 400", async () => {
    const body = makeRouteBody(fixtureA, "succeeded");
    body.rawEventCount += 1;
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(400);
  });

  it("zero-event copy request → 400 instead of an impossible fallback", async () => {
    const body = {
      rawEventCount: 0,
      events: [],
      accounting: [],
      authority: sharedAuthority,
      traceCompletionStatus: "succeeded",
    };
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(400);
  });

  it("empty canonical event IDs at the route boundary → 400", async () => {
    const body = makeRouteBody(fixtureA, "succeeded");
    body.events[0] = { ...body.events[0], eventId: "" };
    body.accounting[0] = { ...body.accounting[0], canonicalEventIds: [""] };
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(400);
  });

  it("Fixture B body in fallback mode → fallback content consistent with material_deviations_found", async () => {
    mockedCallGranite.mockResolvedValue({ ok: false, reason: "missing_credentials" });

    _resetFindingCounter();
    const body = makeRouteBody(fixtureB, "succeeded");
    const req = makeRequest(body);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json() as {
      generationSource: string;
      copy: { headline: { text: string } };
    };
    expect(json.generationSource).toBe("deterministic_fallback");
    // headline should describe the evidence-derived verdict without claiming task success
    expect(json.copy.headline.text).toContain("material deviations");
  });

  it("granite response has modelId and modelApiVersion (discriminated union enforced)", async () => {
    _resetFindingCounter();
    const body = makeRouteBody(fixtureA, "succeeded");

    const adapter = adaptNativeTrace(fixtureA);
    _resetFindingCounter();
    const engine = runPolicyEngine({
      events: adapter.events,
      accounting: adapter.accounting,
      authority: sharedAuthority,
      traceCompletionStatus: "succeeded",
    });
    _resetFindingCounter();
    const bundle = buildFactBundle({
      events: adapter.events,
      findings: engine.findings,
      accounting: adapter.accounting,
      verdict: engine.verdict,
      authority: sharedAuthority,
      hasAssessmentLimitation: engine.hasAssessmentLimitation,
    });
    const validText = makeValidGraniteCopyForA(bundle);

    mockedCallGranite.mockResolvedValue({
      ok: true,
      text: validText,
      modelId: "ibm/granite-4-h-small",
      apiVersion: "2025-10-25",
    });

    _resetFindingCounter();
    const req = makeRequest(body);
    const res = await POST(req);
    const json = await res.json() as Record<string, unknown>;
    expect(json["generationSource"]).toBe("granite");
    expect(typeof json["modelId"]).toBe("string");
    expect(typeof json["modelApiVersion"]).toBe("string");
    expect((json["modelId"] as string).length).toBeGreaterThan(0);
    expect((json["modelApiVersion"] as string).length).toBeGreaterThan(0);
  });

  it("deterministic_fallback response has no modelId or modelApiVersion", async () => {
    mockedCallGranite.mockResolvedValue({ ok: false, reason: "missing_credentials" });

    _resetFindingCounter();
    const body = makeRouteBody(fixtureA, "succeeded");
    const req = makeRequest(body);
    const res = await POST(req);
    const json = await res.json() as Record<string, unknown>;
    expect(json["generationSource"]).toBe("deterministic_fallback");
    expect(json["modelId"]).toBeUndefined();
    expect(json["modelApiVersion"]).toBeUndefined();
  });
});
