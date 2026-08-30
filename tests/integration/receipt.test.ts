import { describe, expect, it } from "vitest";
import {
  fixtureA,
  fixtureB,
  fixtureCIncomplete,
  otlpDemoAuthority,
  sharedAuthority,
} from "../../src/fixtures/index.js";
import { buildReceipt, serializeReceipt } from "../../src/core/receipt.js";
import { ReceiptExportSchema } from "../../src/core/schemas/index.js";
import type {
  CanonicalEvent,
  NativeTraceV1,
  ReceiptCopyRequest,
  ReceiptResult,
} from "../../src/core/schemas/index.js";

const GENERATED_AT = "2026-08-26T19:00:00.000Z";
const MODEL_ID = "ibm/granite-fixture-a-test";
const MODEL_API_VERSION = "2025-10-25";

const EXPECTED_A_BYTE_LENGTH = 1_751;
const EXPECTED_A_SHA256 =
  "270901ead9e358c7f8c360d65c0cf59c82861180cd867f7ea51132ee371e8b9e";
const EXPECTED_B_BYTE_LENGTH = 3_421;
const EXPECTED_B_SHA256 =
  "19d64c62de2f63509741ff0c96e4394e35ce5fdb869e5dfc3d7f8d744f527926";

const EXPECTED_A_COPY = {
  headline: {
    text:
      "No authority deviations appear in the supplied trace.",
    eventIds: ["evt-000001", "evt-000002", "evt-000003"],
    findingIds: [],
  },
  outcome: {
    text:
      "Within declared authority. Based on the supplied trace and authority envelope.",
    eventIds: ["evt-000001", "evt-000002", "evt-000003"],
  },
  notableActions: [],
  limitations: [],
};

const EXPECTED_B_FINDINGS = [
  {
    findingId: "finding-0001",
    ruleId: "AR-SYS-001",
    severity: "high",
    label: "System was not permitted",
    description:
      'Event evt-000004 names destination system "external-spreadsheet". That system is missing from the permitted-systems list.',
    eventIds: ["evt-000004"],
    policyPath: "permittedSystems",
    observedValue: "external-spreadsheet",
    expectedValue: ["crm", "internal-kb", "local-workspace"],
  },
  {
    findingId: "finding-0002",
    ruleId: "AR-SYS-001",
    severity: "high",
    label: "System was not permitted",
    description:
      'Event evt-000005 names destination system "external-spreadsheet". That system is missing from the permitted-systems list.',
    eventIds: ["evt-000005"],
    policyPath: "permittedSystems",
    observedValue: "external-spreadsheet",
    expectedValue: ["crm", "internal-kb", "local-workspace"],
  },
  {
    findingId: "finding-0003",
    ruleId: "AR-SYS-001",
    severity: "high",
    label: "System was not permitted",
    description:
      'Event evt-000006 names destination system "email-service". That system is missing from the permitted-systems list.',
    eventIds: ["evt-000006"],
    policyPath: "permittedSystems",
    observedValue: "email-service",
    expectedValue: ["crm", "internal-kb", "local-workspace"],
  },
  {
    findingId: "finding-0004",
    ruleId: "AR-OP-001",
    severity: "high",
    label: "Operation was not permitted",
    description:
      'Event evt-000006 records the operation "send". That operation is missing from the permitted-operations list.',
    eventIds: ["evt-000006"],
    policyPath: "permittedOperations",
    observedValue: "send",
    expectedValue: ["read", "retrieve", "create"],
  },
  {
    findingId: "finding-0005",
    ruleId: "AR-EGRESS-001",
    severity: "high",
    label: "External destination was not permitted",
    description:
      "Event evt-000004 names an external destination. The authority envelope does not permit external egress.",
    eventIds: ["evt-000004"],
    policyPath: "externalEgressAllowed",
    observedValue: "external",
    expectedValue: false,
  },
  {
    findingId: "finding-0006",
    ruleId: "AR-EGRESS-001",
    severity: "high",
    label: "External destination was not permitted",
    description:
      "Event evt-000005 names an external destination. The authority envelope does not permit external egress.",
    eventIds: ["evt-000005"],
    policyPath: "externalEgressAllowed",
    observedValue: "external",
    expectedValue: false,
  },
  {
    findingId: "finding-0007",
    ruleId: "AR-EGRESS-001",
    severity: "high",
    label: "External destination was not permitted",
    description:
      "Event evt-000006 names an external destination. The authority envelope does not permit external egress.",
    eventIds: ["evt-000006"],
    policyPath: "externalEgressAllowed",
    observedValue: "external",
    expectedValue: false,
  },
  {
    findingId: "finding-0008",
    ruleId: "AR-DATA-001",
    severity: "high",
    label: "Restricted data in a consequential operation",
    description:
      "Event evt-000004 names restricted data in a state-changing or data-moving operation: customer_email.",
    eventIds: ["evt-000004"],
    policyPath: "prohibitedDataCategories",
    observedValue: ["customer_email"],
    expectedValue: [],
  },
  {
    findingId: "finding-0009",
    ruleId: "AR-DATA-001",
    severity: "high",
    label: "Restricted data in a consequential operation",
    description:
      "Event evt-000005 names restricted data in a state-changing or data-moving operation: customer_email.",
    eventIds: ["evt-000005"],
    policyPath: "prohibitedDataCategories",
    observedValue: ["customer_email"],
    expectedValue: [],
  },
  {
    findingId: "finding-0010",
    ruleId: "AR-DATA-001",
    severity: "high",
    label: "Restricted data in a consequential operation",
    description:
      "Event evt-000006 names restricted data in a state-changing or data-moving operation: customer_email.",
    eventIds: ["evt-000006"],
    policyPath: "prohibitedDataCategories",
    observedValue: ["customer_email"],
    expectedValue: [],
  },
  {
    findingId: "finding-0011",
    ruleId: "AR-APPROVAL-001",
    severity: "high",
    label: "Required approval not found",
    description:
      'Event evt-000006 completed "send", which requires human approval. The trace has no linked approval recorded before this action.',
    eventIds: ["evt-000006"],
    policyPath: "approvalRequiredFor",
    observedValue: "send",
    expectedValue: "a prior successful human approve event",
  },
  {
    findingId: "finding-0012",
    ruleId: "AR-RETRY-001",
    severity: "medium",
    label: "Retry followed an uncertain result",
    description:
      'Event evt-000005 is attempt 2 for action "spreadsheet-export". It followed event evt-000004, recorded as "unknown". A repeated side effect is possible because the earlier event does not establish whether the destination changed.',
    eventIds: ["evt-000004", "evt-000005"],
    policyPath: undefined,
    observedValue: "unknown",
    expectedValue: "succeeded or failed with known outcome",
  },
];

const RECEIPT_EXPORT_KEYS = [
  "accounting",
  "authority",
  "copy",
  "coverage",
  "events",
  "findings",
  "integrity",
  "reviewerDisposition",
  "run",
  "schemaVersion",
  "verdict",
  "verdictLabel",
  "verdictQualifier",
  "warnings",
];

function exactFixtureBytes(trace: NativeTraceV1): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(trace, null, 2)}\n`);
}

function expectRawEventResolution(
  receipt: ReceiptResult,
  rawDocument: unknown,
): void {
  expect(rawDocument).toBeTypeOf("object");
  expect(rawDocument).not.toBeNull();
  if (typeof rawDocument !== "object" || rawDocument === null) {
    throw new Error("Expected retained raw document to be an object");
  }

  const rawEvents = (rawDocument as { events?: unknown }).events;
  expect(Array.isArray(rawEvents)).toBe(true);
  if (!Array.isArray(rawEvents)) {
    throw new Error("Expected retained raw document to contain events");
  }

  for (const event of receipt.events) {
    const pointerMatch = /^events\[(\d+)]$/.exec(event.rawPointer);
    expect(pointerMatch).not.toBeNull();
    if (!pointerMatch) throw new Error(`Invalid raw pointer ${event.rawPointer}`);

    const rawEvent = rawEvents[Number(pointerMatch[1])];
    expect(rawEvent).toBeTypeOf("object");
    expect(rawEvent).not.toBeNull();
    expect((rawEvent as { id?: unknown }).id).toBe(event.sourceEventId);

    const accountingEntry = receipt.accounting.find(
      (entry) => entry.rawPointer === event.rawPointer,
    );
    expect(accountingEntry).toBeDefined();
    expect(accountingEntry?.sourceEventId).toBe(event.sourceEventId);
    expect(accountingEntry?.canonicalEventIds).toStrictEqual([event.eventId]);
  }
}

function expectAllCopyCitationsResolve(receipt: ReceiptResult): void {
  const eventIds = new Set(receipt.events.map((event) => event.eventId));
  const findingIds = new Set(
    receipt.findings.map((finding) => finding.findingId),
  );
  const citedEventIds = [
    ...receipt.copy.headline.eventIds,
    ...receipt.copy.outcome.eventIds,
    ...receipt.copy.notableActions.flatMap((action) => action.eventIds),
    ...receipt.copy.limitations.flatMap((limitation) => limitation.eventIds),
  ];
  const citedFindingIds = [
    ...receipt.copy.headline.findingIds,
    ...receipt.copy.notableActions.flatMap((action) => action.findingIds),
  ];

  expect(citedEventIds.every((eventId) => eventIds.has(eventId))).toBe(true);
  expect(
    citedFindingIds.every((findingId) => findingIds.has(findingId)),
  ).toBe(true);
}

function expectSerializableExport(receipt: ReceiptResult): void {
  const serialized = serializeReceipt(receipt);
  const exported: unknown = JSON.parse(serialized);
  expect(ReceiptExportSchema.safeParse(exported).success).toBe(true);
  expect(JSON.stringify(exported)).toBe(JSON.stringify(receipt));
  expect(Object.keys(exported as object).sort()).toStrictEqual(
    RECEIPT_EXPORT_KEYS,
  );
  expect(exported).not.toHaveProperty("retainedSource");
  expect(exported).not.toHaveProperty("rawDocument");
  expect(exported).not.toHaveProperty("rawBytes");
}

function eventMapping(events: CanonicalEvent[]): Array<[string, string | undefined, string, number]> {
  return events.map((event) => [
    event.eventId,
    event.sourceEventId,
    event.rawPointer,
    event.sequence,
  ]);
}

describe("complete receipt orchestration", () => {
  it("Fixture A preserves exact bytes and produces a schema-valid Granite export within declared authority", async () => {
    const submittedBytes = exactFixtureBytes(fixtureA);
    const expectedBytes = Uint8Array.from(submittedBytes);
    let generatorCalls = 0;
    let generatedRequest: ReceiptCopyRequest | undefined;

    const buildPromise = buildReceipt(
      {
        rawBytes: submittedBytes,
        authority: sharedAuthority,
        reviewerDisposition: "accepted",
      },
      {
        now: () => GENERATED_AT,
        generateCopy: async (request) => {
          generatorCalls += 1;
          generatedRequest = request;
          return {
            generationSource: "granite",
            copy: EXPECTED_A_COPY,
            modelId: MODEL_ID,
            modelApiVersion: MODEL_API_VERSION,
          };
        },
      },
    );

    // The orchestrator must snapshot the supplied bytes before its first await.
    submittedBytes.fill(0);
    const result = await buildPromise;

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);

    const { receipt, retainedSource } = result;
    expect(generatorCalls).toBe(1);
    expect(generatedRequest?.rawEventCount).toBe(3);
    expect(generatedRequest?.authority).toStrictEqual(sharedAuthority);
    expect(retainedSource.bytes).not.toBe(submittedBytes);
    expect(retainedSource.bytes).toStrictEqual(expectedBytes);
    expect(new TextDecoder().decode(retainedSource.bytes)).toBe(
      `${JSON.stringify(fixtureA, null, 2)}\n`,
    );
    expect(retainedSource.sha256).toBe(EXPECTED_A_SHA256);
    expect(retainedSource.rawDocument).toStrictEqual(fixtureA);
    expect(retainedSource.trace).toStrictEqual(fixtureA);

    expect(receipt.schemaVersion).toBe("agent-receipt.receipt.v1");
    expect(receipt.run).toStrictEqual({
      traceId: "trace-fixture-a-001",
      agent: {
        id: "agent-crm-summariser",
        name: "CRM Summariser",
        version: "1.0.0",
      },
      startedAt: "2024-08-01T09:00:00Z",
      completedAt: "2024-08-01T09:05:00Z",
      status: "succeeded",
    });
    expect(receipt.authority).toStrictEqual(sharedAuthority);
    expect(receipt.reviewerDisposition).toBe("accepted");
    expect(receipt.verdict).toBe("within_declared_authority");
    expect(receipt.verdictLabel).toBe("Within declared authority");
    expect(receipt.verdictQualifier).toBe(
      "Within declared authority. Based on the supplied trace and authority envelope.",
    );
    expect(receipt.findings).toStrictEqual([]);
    expect(receipt.warnings).toStrictEqual([]);
    expect(receipt.coverage).toStrictEqual({
      rawEvents: 3,
      accountedRawEvents: 3,
      mapped: 3,
      metadataOnly: 0,
      unparsed: 0,
      canonicalEvents: 3,
    });
    expect(eventMapping(receipt.events)).toStrictEqual([
      ["evt-000001", "ev-a-001", "events[0]", 1],
      ["evt-000002", "ev-a-002", "events[1]", 2],
      ["evt-000003", "ev-a-003", "events[2]", 3],
    ]);
    expect(receipt.accounting).toStrictEqual([
      {
        rawPointer: "events[0]",
        sourceEventId: "ev-a-001",
        status: "mapped",
        canonicalEventIds: ["evt-000001"],
        material: true,
      },
      {
        rawPointer: "events[1]",
        sourceEventId: "ev-a-002",
        status: "mapped",
        canonicalEventIds: ["evt-000002"],
        material: true,
      },
      {
        rawPointer: "events[2]",
        sourceEventId: "ev-a-003",
        status: "mapped",
        canonicalEventIds: ["evt-000003"],
        material: true,
      },
    ]);
    expect(
      new Set(
        receipt.events.flatMap((event) =>
          [event.sourceSystem, event.destinationSystem].filter(
            (system): system is string => system !== undefined,
          ),
        ),
      ),
    ).toStrictEqual(new Set(["crm", "internal-kb", "local-workspace"]));
    expect(
      receipt.events.filter(
        (event) => event.destinationBoundary === "local" && event.stateChange,
      ),
    ).toHaveLength(1);
    expect(
      receipt.events.filter(
        (event) => event.destinationBoundary === "external",
      ),
    ).toHaveLength(0);
    expect(receipt.copy).toStrictEqual(EXPECTED_A_COPY);
    expect(receipt.copy.limitations).toStrictEqual([]);
    expect(receipt.integrity).toStrictEqual({
      sha256: EXPECTED_A_SHA256,
      byteLength: EXPECTED_A_BYTE_LENGTH,
      inputFormat: "agent-receipt.native-trace.v1",
      schemaVersion: "agent-receipt.native-trace.v1",
      adapterName: "nativeTrace",
      adapterVersion: "1.0.0",
      authoritySchemaVersion: "agent-receipt.authority.v1",
      policyId: "policy-crm-churn-001",
      canonicalEventSchemaVersion: "agent-receipt.canonical-event.v1",
      receiptSchemaVersion: "agent-receipt.receipt.v1",
      generatedAt: GENERATED_AT,
      generationSource: "granite",
      modelId: MODEL_ID,
      modelApiVersion: MODEL_API_VERSION,
    });

    expectRawEventResolution(receipt, retainedSource.rawDocument);
    expectAllCopyCitationsResolve(receipt);
    expectSerializableExport(receipt);
  });

  it("Fixture B preserves exact evidence and falls back to a fully cited material-deviation export when generation throws", async () => {
    const submittedBytes = exactFixtureBytes(fixtureB);
    const expectedBytes = Uint8Array.from(submittedBytes);
    let generatorCalls = 0;

    const result = await buildReceipt(
      {
        rawBytes: submittedBytes,
        authority: sharedAuthority,
        reviewerDisposition: "investigate",
      },
      {
        now: () => GENERATED_AT,
        generateCopy: async () => {
          generatorCalls += 1;
          throw new Error("Synthetic Granite outage");
        },
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);

    const { receipt, retainedSource } = result;
    expect(generatorCalls).toBe(1);
    expect(retainedSource.bytes).not.toBe(submittedBytes);
    expect(retainedSource.bytes).toStrictEqual(expectedBytes);
    expect(new TextDecoder().decode(retainedSource.bytes)).toBe(
      `${JSON.stringify(fixtureB, null, 2)}\n`,
    );
    expect(retainedSource.sha256).toBe(EXPECTED_B_SHA256);
    expect(retainedSource.rawDocument).toStrictEqual(fixtureB);
    expect(retainedSource.trace).toStrictEqual(fixtureB);

    expect(receipt.schemaVersion).toBe("agent-receipt.receipt.v1");
    expect(receipt.authority).toStrictEqual(sharedAuthority);
    expect(receipt.reviewerDisposition).toBe("investigate");
    expect(receipt.verdict).toBe("material_deviations_found");
    expect(receipt.verdictLabel).toBe("Material deviations found");
    expect(receipt.verdictQualifier).toBe(
      "Material deviations found. Based on the supplied trace and authority envelope.",
    );
    expect(receipt.warnings).toStrictEqual([]);
    expect(receipt.coverage).toStrictEqual({
      rawEvents: 6,
      accountedRawEvents: 6,
      mapped: 6,
      metadataOnly: 0,
      unparsed: 0,
      canonicalEvents: 6,
    });
    expect(eventMapping(receipt.events)).toStrictEqual([
      ["evt-000001", "ev-b-001", "events[0]", 1],
      ["evt-000002", "ev-b-002", "events[1]", 2],
      ["evt-000003", "ev-b-003", "events[2]", 3],
      ["evt-000004", "ev-b-004", "events[3]", 4],
      ["evt-000005", "ev-b-005", "events[4]", 5],
      ["evt-000006", "ev-b-006", "events[5]", 6],
    ]);
    expect(receipt.accounting).toStrictEqual([
      {
        rawPointer: "events[0]",
        sourceEventId: "ev-b-001",
        status: "mapped",
        canonicalEventIds: ["evt-000001"],
        material: true,
      },
      {
        rawPointer: "events[1]",
        sourceEventId: "ev-b-002",
        status: "mapped",
        canonicalEventIds: ["evt-000002"],
        material: true,
      },
      {
        rawPointer: "events[2]",
        sourceEventId: "ev-b-003",
        status: "mapped",
        canonicalEventIds: ["evt-000003"],
        material: true,
      },
      {
        rawPointer: "events[3]",
        sourceEventId: "ev-b-004",
        status: "mapped",
        canonicalEventIds: ["evt-000004"],
        material: true,
      },
      {
        rawPointer: "events[4]",
        sourceEventId: "ev-b-005",
        status: "mapped",
        canonicalEventIds: ["evt-000005"],
        material: true,
      },
      {
        rawPointer: "events[5]",
        sourceEventId: "ev-b-006",
        status: "mapped",
        canonicalEventIds: ["evt-000006"],
        material: true,
      },
    ]);
    expect(receipt.findings).toStrictEqual(EXPECTED_B_FINDINGS);
    expect(
      receipt.findings.map((finding) => finding.ruleId),
    ).toStrictEqual([
      "AR-SYS-001",
      "AR-SYS-001",
      "AR-SYS-001",
      "AR-OP-001",
      "AR-EGRESS-001",
      "AR-EGRESS-001",
      "AR-EGRESS-001",
      "AR-DATA-001",
      "AR-DATA-001",
      "AR-DATA-001",
      "AR-APPROVAL-001",
      "AR-RETRY-001",
    ]);
    expect(
      receipt.findings.some((finding) =>
        [
          "AR-VOLUME-001",
          "AR-TRACE-001",
          "AR-ERROR-001",
          "AR-APPROVAL-002",
        ].includes(finding.ruleId),
      ),
    ).toBe(false);

    const retryFinding = receipt.findings.find(
      (finding) => finding.ruleId === "AR-RETRY-001",
    );
    expect(retryFinding?.description).toContain("A repeated side effect is possible");
    expect(retryFinding?.description).toContain("does not establish whether the destination changed");
    expect(retryFinding?.description).not.toContain(
      "duplicate artifact created",
    );
    expect(
      receipt.events.filter(
        (event) => event.destinationBoundary === "external",
      ),
    ).toHaveLength(3);

    const expectedNotableActions = EXPECTED_B_FINDINGS.map((finding) => ({
      text: `${finding.label}: ${finding.description}`.slice(0, 300),
      eventIds: [...finding.eventIds],
      findingIds: [finding.findingId],
    }));
    expect(receipt.copy).toStrictEqual({
      headline: {
        text:
          "The supplied trace shows material deviations from the declared authority.",
        eventIds: ["evt-000004", "evt-000005", "evt-000006"],
        findingIds: EXPECTED_B_FINDINGS.map((finding) => finding.findingId),
      },
      outcome: {
        text:
          "Material deviations found. Based on the supplied trace and authority envelope.",
        eventIds: ["evt-000004", "evt-000005", "evt-000006"],
      },
      notableActions: expectedNotableActions,
      limitations: [],
    });
    expect(receipt.copy.limitations).toStrictEqual([]);
    expect(receipt.integrity).toStrictEqual({
      sha256: EXPECTED_B_SHA256,
      byteLength: EXPECTED_B_BYTE_LENGTH,
      inputFormat: "agent-receipt.native-trace.v1",
      schemaVersion: "agent-receipt.native-trace.v1",
      adapterName: "nativeTrace",
      adapterVersion: "1.0.0",
      authoritySchemaVersion: "agent-receipt.authority.v1",
      policyId: "policy-crm-churn-001",
      canonicalEventSchemaVersion: "agent-receipt.canonical-event.v1",
      receiptSchemaVersion: "agent-receipt.receipt.v1",
      generatedAt: GENERATED_AT,
      generationSource: "deterministic_fallback",
    });
    expect("modelId" in receipt.integrity).toBe(false);
    expect("modelApiVersion" in receipt.integrity).toBe(false);

    expectRawEventResolution(receipt, retainedSource.rawDocument);
    expectAllCopyCitationsResolve(receipt);
    for (const action of receipt.copy.notableActions) {
      const finding = receipt.findings.find(
        (candidate) => candidate.findingId === action.findingIds[0],
      );
      expect(finding).toBeDefined();
      expect(action.eventIds).toStrictEqual(finding?.eventIds);
    }
    expectSerializableExport(receipt);
  });

  it("Fixture C accounts for every OTLP span and refuses to overclaim across material evidence gaps", async () => {
    const submittedBytes = new TextEncoder().encode(
      `${JSON.stringify(fixtureCIncomplete, null, 2)}\n`,
    );
    const expectedBytes = Uint8Array.from(submittedBytes);
    const result = await buildReceipt(
      {
        rawBytes: submittedBytes,
        authority: otlpDemoAuthority,
      },
      { now: () => GENERATED_AT },
    );

    expect(result.ok, result.ok ? undefined : JSON.stringify(result.error)).toBe(true);
    if (!result.ok) return;

    const { receipt, retainedSource } = result;
    expect(retainedSource.bytes).not.toBe(submittedBytes);
    expect(retainedSource.bytes).toStrictEqual(expectedBytes);
    expect(retainedSource.rawDocument).toStrictEqual(fixtureCIncomplete);
    expect(receipt.verdict).toBe("unable_to_assess_fully");
    expect(receipt.verdictQualifier).toBe(
      "Authority assessment incomplete. Based on the supplied trace and authority envelope.",
    );
    expect(receipt.coverage).toStrictEqual({
      rawEvents: 3,
      accountedRawEvents: 3,
      mapped: 1,
      metadataOnly: 1,
      unparsed: 1,
      canonicalEvents: 1,
    });
    expect(receipt.accounting.map((entry) => entry.status)).toStrictEqual([
      "mapped",
      "unparsed",
      "metadata-only",
    ]);
    expect(receipt.accounting.map((entry) => entry.rawPointer)).toStrictEqual([
      "resourceSpans[0].scopeSpans[0].spans[0]",
      "resourceSpans[0].scopeSpans[0].spans[1]",
      "resourceSpans[0].scopeSpans[0].spans[2]",
    ]);
    expect(receipt.findings.map((finding) => finding.label)).toStrictEqual([
      "Material event could not be parsed",
      "Run termination is unknown",
    ]);
    expect(receipt.events).toHaveLength(1);
    expect(receipt.run.status).toBe("unknown");
    expect(receipt.copy.limitations).toHaveLength(2);
    expect(receipt.integrity.inputFormat).toBe("otlp-json-resource-spans.v1");
    expect(receipt.integrity.generationSource).toBe("deterministic_fallback");
    expectAllCopyCitationsResolve(receipt);
    expectSerializableExport(receipt);

    const exported = JSON.parse(serializeReceipt(receipt)) as Record<string, unknown>;
    expect(exported).not.toHaveProperty("rawDocument");
    expect(exported).not.toHaveProperty("bytes");
  });
});
