import { describe, expect, it } from "vitest";
import { computeCoverage, CoverageInvariantError, formatCoverageSummary } from "../../src/core/coverage.js";
import {
  buildReceipt,
  MAX_TRACE_BYTES,
  serializeReceipt,
  withReviewerDisposition,
} from "../../src/core/receipt.js";
import {
  IntegrityMetadataSchema,
  ReceiptCopyGenerationResultSchema,
  ReceiptExportSchema,
} from "../../src/core/schemas/index.js";
import { fixtureA, fixtureB, sharedAuthority } from "../../src/fixtures/index.js";

const FIXED_NOW = "2026-08-26T19:00:00.000Z";

function bytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    rawBytes: bytes(fixtureA),
    authority: sharedAuthority,
    ...overrides,
  };
}

describe("receipt intake and assembly", () => {
  it("builds a strict deterministic receipt when no copy generator is provided", async () => {
    const result = await buildReceipt(validInput(), { now: () => FIXED_NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.integrity.generationSource).toBe(
      "deterministic_fallback",
    );
    expect(result.receipt.reviewerDisposition).toBe("unreviewed");
    expect(result.receipt.coverage).toEqual({
      rawEvents: 3,
      accountedRawEvents: 3,
      mapped: 3,
      metadataOnly: 0,
      unparsed: 0,
      canonicalEvents: 3,
    });
    expect(ReceiptExportSchema.safeParse(result.receipt).success).toBe(true);
  });

  it("snapshots exact bytes before asynchronous hashing", async () => {
    const original = bytes(fixtureA);
    const expected = Uint8Array.from(original);
    const resultPromise = buildReceipt(
      { rawBytes: original, authority: sharedAuthority },
      { now: () => FIXED_NOW },
    );
    original.fill(0);

    const result = await resultPromise;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.retainedSource.bytes).toEqual(expected);
  });

  it("snapshots authority before asynchronous hashing", async () => {
    const mutableAuthority = structuredClone(sharedAuthority);
    const expectedAuthority = structuredClone(sharedAuthority);
    const resultPromise = buildReceipt(
      { rawBytes: bytes(fixtureB), authority: mutableAuthority },
      { now: () => FIXED_NOW },
    );

    mutableAuthority.permittedSystems.push(
      { systemId: "external-spreadsheet", boundary: "external" },
      { systemId: "email-service", boundary: "external" },
    );
    mutableAuthority.permittedOperations.push("send");
    mutableAuthority.prohibitedDataCategories = [];
    mutableAuthority.externalEgressAllowed = true;
    mutableAuthority.approvalRequiredFor = [];

    const result = await resultPromise;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.authority).toStrictEqual(expectedAuthority);
    expect(result.receipt.verdict).toBe("material_deviations_found");
  });

  it("normalizes data-category slugs before deterministic policy checks", async () => {
    const trace = structuredClone(fixtureA);
    trace.events[2].dataCategories = [" Customer_Email "];

    const result = await buildReceipt(
      { rawBytes: bytes(trace), authority: sharedAuthority },
      { now: () => FIXED_NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.events[2].dataCategories).toEqual([
      "customer_email",
    ]);
    expect(result.receipt.findings.map((finding) => finding.ruleId)).toContain(
      "AR-DATA-001",
    );
  });

  it("rejects input over 2 MiB before decoding or parsing", async () => {
    const rawBytes = new Uint8Array(MAX_TRACE_BYTES + 1);
    const result = await buildReceipt({ rawBytes, authority: sharedAuthority });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("input_too_large");
    expect(result.retainedSource.bytes).toHaveLength(MAX_TRACE_BYTES + 1);
    expect(result.retainedSource.sha256).toBeUndefined();
    expect(result.retainedSource.rawDocument).toBeUndefined();
  });

  it("rejects invalid UTF-8 after hashing and before JSON parsing", async () => {
    const result = await buildReceipt({
      rawBytes: new Uint8Array([0xc3, 0x28]),
      authority: sharedAuthority,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_utf8");
    expect(result.retainedSource.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.retainedSource.rawDocument).toBeUndefined();
  });

  it("reports invalid JSON without echoing source contents", async () => {
    const secret = "not-json-super-secret-value";
    const result = await buildReceipt({
      rawBytes: new TextEncoder().encode(`{\n  "secret": "${secret}"`),
      authority: sharedAuthority,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_json");
    expect(result.error.message).toContain("not valid JSON");
    expect(result.error.message).not.toContain(secret);
  });

  it("selects the adapter only from the explicit schema version", async () => {
    const result = await buildReceipt({
      rawBytes: bytes({ ...fixtureA, schemaVersion: "unknown.trace.v1" }),
      authority: sharedAuthority,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("unsupported_format");
  });

  it("classifies empty trace and authority identifiers at their input boundaries", async () => {
    const invalidTrace = await buildReceipt({
      rawBytes: bytes({ ...fixtureA, traceId: "" }),
      authority: sharedAuthority,
    });
    expect(invalidTrace.ok).toBe(false);
    if (!invalidTrace.ok) expect(invalidTrace.error.code).toBe("invalid_trace");

    const invalidAuthority = await buildReceipt({
      rawBytes: bytes(fixtureA),
      authority: { ...sharedAuthority, policyId: "   " },
    });
    expect(invalidAuthority.ok).toBe(false);
    if (!invalidAuthority.ok) {
      expect(invalidAuthority.error.code).toBe("invalid_authority");
    }
  });

  it("rejects empty traces because the output contract requires event citations", async () => {
    const result = await buildReceipt({
      rawBytes: bytes({ ...fixtureA, events: [] }),
      authority: sharedAuthority,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_trace");
    expect(result.error.issues).toContainEqual({
      path: "events",
      message: "Add at least one event so every receipt note can cite evidence.",
    });
  });

  it("rejects duplicate native event IDs at the intake boundary", async () => {
    const duplicate = {
      ...fixtureA,
      events: [fixtureA.events[0], { ...fixtureA.events[1], id: "ev-a-001" }],
    };
    const result = await buildReceipt({
      rawBytes: bytes(duplicate),
      authority: sharedAuthority,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_trace");
    expect(result.error.issues?.[0]?.message).toContain("ev-a-001");
  });

  it("rejects negative quantities and negative authority volume limits", async () => {
    const negativeQuantity = {
      ...fixtureA,
      events: [
        {
          ...fixtureA.events[0],
          quantity: { value: -1, unit: "records" },
        },
      ],
    };
    const traceResult = await buildReceipt({
      rawBytes: bytes(negativeQuantity),
      authority: sharedAuthority,
    });
    expect(traceResult.ok).toBe(false);
    if (!traceResult.ok) expect(traceResult.error.code).toBe("invalid_trace");

    const authorityResult = await buildReceipt({
      rawBytes: bytes(fixtureA),
      authority: { ...sharedAuthority, maxRecordsRead: -1 },
    });
    expect(authorityResult.ok).toBe(false);
    if (!authorityResult.ok) {
      expect(authorityResult.error.code).toBe("invalid_authority");
    }

    const unsafeQuantity = await buildReceipt({
      rawBytes: bytes({
        ...fixtureA,
        events: [
          {
            ...fixtureA.events[0],
            quantity: { value: 1e308, unit: "records" },
          },
        ],
      }),
      authority: sharedAuthority,
    });
    expect(unsafeQuantity.ok).toBe(false);
    if (!unsafeQuantity.ok) {
      expect(unsafeQuantity.error.code).toBe("invalid_trace");
    }
  });

  it("uses an exact overflow-safe aggregate for large record totals", async () => {
    const largeTrace = {
      ...fixtureA,
      events: fixtureA.events.map((event, index) =>
        index < 2
          ? {
              ...event,
              quantity: {
                value: Number.MAX_SAFE_INTEGER,
                unit: "records" as const,
              },
            }
          : event,
      ),
    };
    const result = await buildReceipt(
      {
        rawBytes: bytes(largeTrace),
        authority: {
          ...sharedAuthority,
          maxRecordsRead: Number.MAX_SAFE_INTEGER,
        },
      },
      { now: () => FIXED_NOW },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const volumeFinding = result.receipt.findings.find(
      (finding) => finding.ruleId === "AR-VOLUME-001",
    );
    expect(volumeFinding?.observedValue).toBe("18014398509481982");
    const serialized = serializeReceipt(result.receipt);
    expect(serialized).not.toContain('"observedValue": null');
    expect(JSON.parse(serialized)).toHaveProperty(
      "findings.0.observedValue",
      "18014398509481982",
    );
  });

  it("falls back when generated copy is malformed or times out", async () => {
    const malformed = await buildReceipt(validInput(), {
      now: () => FIXED_NOW,
      generateCopy: async () => ({ generationSource: "granite" }),
    });
    expect(malformed.ok).toBe(true);
    if (malformed.ok) {
      expect(malformed.receipt.integrity.generationSource).toBe(
        "deterministic_fallback",
      );
    }

    let observedAbort = false;
    const timedOut = await buildReceipt(validInput(), {
      now: () => FIXED_NOW,
      copyTimeoutMs: 5,
      generateCopy: (_request, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            observedAbort = true;
            reject(new Error("aborted"));
          });
        }),
    });
    expect(timedOut.ok).toBe(true);
    expect(observedAbort).toBe(true);
    if (timedOut.ok) {
      expect(timedOut.receipt.integrity.generationSource).toBe(
        "deterministic_fallback",
      );
    }

    const baseline = await buildReceipt(validInput(), {
      now: () => FIXED_NOW,
    });
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) return;
    const abortResolved = await buildReceipt(validInput(), {
      now: () => FIXED_NOW,
      copyTimeoutMs: 5,
      generateCopy: (_request, { signal }) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => {
            resolve({
              generationSource: "granite",
              copy: baseline.receipt.copy,
              modelId: "late-model",
              modelApiVersion: "late-version",
            });
          });
        }),
    });
    expect(abortResolved.ok).toBe(true);
    if (abortResolved.ok) {
      expect(abortResolved.receipt.integrity.generationSource).toBe(
        "deterministic_fallback",
      );
    }
  });

  it("does not accept externally supplied prose labeled as local fallback", async () => {
    const baseline = await buildReceipt(validInput(), { now: () => FIXED_NOW });
    expect(baseline.ok).toBe(true);
    if (!baseline.ok) return;
    const spoofedCopy = {
      ...baseline.receipt.copy,
      headline: {
        ...baseline.receipt.copy.headline,
        text: "Within declared authority, an external generator wrote this.",
      },
    };

    const result = await buildReceipt(validInput(), {
      now: () => FIXED_NOW,
      generateCopy: async () => ({
        generationSource: "deterministic_fallback",
        copy: spoofedCopy,
      }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.integrity.generationSource).toBe(
      "deterministic_fallback",
    );
    expect(result.receipt.copy).toEqual(baseline.receipt.copy);
    expect(result.receipt.copy).not.toEqual(spoofedCopy);
  });

  it("keeps reviewer disposition separate from the deterministic verdict", async () => {
    const result = await buildReceipt(validInput(), { now: () => FIXED_NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rejected = withReviewerDisposition(result.receipt, "rejected");
    expect(rejected.reviewerDisposition).toBe("rejected");
    expect(rejected.verdict).toBe(result.receipt.verdict);
    expect(rejected.verdictLabel).toBe(result.receipt.verdictLabel);
    expect(() => withReviewerDisposition(result.receipt, "approved")).toThrow();
  });

  it("validates the receipt again immediately before JSON export", async () => {
    const result = await buildReceipt(validInput(), { now: () => FIXED_NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serialized = serializeReceipt(result.receipt);
    expect(ReceiptExportSchema.safeParse(JSON.parse(serialized)).success).toBe(
      true,
    );

    const unexpectedField = { ...result.receipt, privateRawTrace: fixtureA };
    expect(ReceiptExportSchema.safeParse(unexpectedField).success).toBe(false);

    const unsupportedClaim = {
      ...result.receipt,
      copy: {
        ...result.receipt.copy,
        headline: {
          ...result.receipt.copy.headline,
          text: "This run is certified and safe.",
        },
      },
    };
    expect(() => serializeReceipt(unsupportedClaim)).toThrow(
      "Receipt copy failed claim validation",
    );

    const relabeled = {
      ...result.receipt,
      verdict: "material_deviations_found" as const,
      verdictLabel: "Material deviations found",
      verdictQualifier:
        "Material deviations found. Based on the supplied trace and authority envelope.",
      copy: {
        headline: {
          text:
            "The supplied trace contains material deviations from the declared authority.",
          eventIds: result.receipt.copy.headline.eventIds,
          findingIds: [],
        },
        outcome: {
          text:
            "Material deviations found. Based on the supplied trace and authority envelope.",
          eventIds: result.receipt.copy.outcome.eventIds,
        },
        notableActions: [],
        limitations: [],
      },
    };
    expect(ReceiptExportSchema.safeParse(relabeled).success).toBe(true);
    expect(() => serializeReceipt(relabeled)).toThrow(
      "Receipt deterministic evidence failed validation",
    );

    const wrongRawLink = {
      ...result.receipt,
      events: result.receipt.events.map((event, index) =>
        index === 0
          ? {
              ...event,
              rawPointer: "events[2]",
              sourceEventId: "ev-a-003",
            }
          : event,
      ),
    };
    expect(ReceiptExportSchema.safeParse(wrongRawLink).success).toBe(false);
    expect(() => serializeReceipt(wrongRawLink)).toThrow();
  });
});

describe("coverage and generation metadata contracts", () => {
  it("rejects silent adapter loss and formats the P0 coverage sentence", () => {
    expect(() =>
      computeCoverage({ rawEventCount: 1, events: [], accounting: [] }),
    ).toThrow(CoverageInvariantError);

    expect(
      formatCoverageSummary({
        rawEvents: 2,
        accountedRawEvents: 2,
        mapped: 1,
        metadataOnly: 0,
        unparsed: 1,
        canonicalEvents: 1,
      }),
    ).toBe(
      "2 of 2 raw events accounted for: 1 mapped, 0 metadata-only, 1 unparsed.",
    );
  });

  it("requires model metadata for Granite and forbids it for fallback", () => {
    const copy = {
      headline: { text: "h", eventIds: ["evt-1"], findingIds: [] },
      outcome: {
        text: "Based on the supplied trace and authority envelope.",
        eventIds: ["evt-1"],
      },
      notableActions: [],
      limitations: [],
    };
    expect(
      ReceiptCopyGenerationResultSchema.safeParse({
        generationSource: "granite",
        copy,
      }).success,
    ).toBe(false);
    expect(
      ReceiptCopyGenerationResultSchema.safeParse({
        generationSource: "deterministic_fallback",
        copy,
        modelId: "should-not-exist",
      }).success,
    ).toBe(false);
  });

  it("tightens integrity digest and byte-length fields", () => {
    const base = {
      sha256: "a".repeat(64),
      byteLength: 1,
      inputFormat: "agent-receipt.native-trace.v1",
      schemaVersion: "agent-receipt.native-trace.v1",
      adapterName: "nativeTrace",
      adapterVersion: "1.0.0",
      authoritySchemaVersion: "agent-receipt.authority.v1",
      policyId: "policy",
      canonicalEventSchemaVersion: "agent-receipt.canonical-event.v1",
      receiptSchemaVersion: "agent-receipt.receipt.v1",
      generatedAt: FIXED_NOW,
      generationSource: "deterministic_fallback",
    };
    expect(IntegrityMetadataSchema.safeParse(base).success).toBe(true);
    expect(
      IntegrityMetadataSchema.safeParse({ ...base, sha256: "ABC" }).success,
    ).toBe(false);
    expect(
      IntegrityMetadataSchema.safeParse({ ...base, byteLength: -1 }).success,
    ).toBe(false);
    expect(
      IntegrityMetadataSchema.safeParse({
        ...base,
        generationSource: "granite",
      }).success,
    ).toBe(false);
  });
});
