import { describe, expect, it } from "vitest";

import {
  adaptOtlpGenAiTrace,
  OTLP_GENAI_ADAPTER_NAME,
  OTLP_GENAI_FORMAT,
  OtlpExportTraceServiceRequestSchema,
} from "../../src/adapters/otlpGenAi.js";
import { buildReceipt } from "../../src/core/receipt.js";
import {
  fixtureCIncomplete,
  otlpDemoAuthority,
  otlpGenAiFixture,
} from "../../src/fixtures/index.js";
import { resolveRawPointer } from "../../src/ui/receiptView.js";

function bytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

describe("narrow OTLP/JSON GenAI adapter", () => {
  it("validates the documented OTLP ExportTraceServiceRequest shape", () => {
    expect(OtlpExportTraceServiceRequestSchema.safeParse(otlpGenAiFixture).success).toBe(
      true,
    );
  });

  it("maps supported GenAI/action spans and accounts for every raw span", () => {
    const result = adaptOtlpGenAiTrace(otlpGenAiFixture);

    expect(result.adapter.format).toBe(OTLP_GENAI_FORMAT);
    expect(result.adapter.events).toHaveLength(2);
    expect(result.adapter.accounting).toHaveLength(3);
    expect(result.adapter.accounting.map((entry) => entry.status)).toEqual([
      "mapped",
      "mapped",
      "metadata-only",
    ]);
    expect(result.adapter.events[0]).toMatchObject({
      eventId: "evt-000001",
      sourceEventId: "eee19b7ec3c1b171",
      operation: "execute",
      destinationSystem: "us-south.ml.cloud.ibm.com",
      destinationBoundary: "internal",
      stateChange: false,
      status: "succeeded",
      dataCategories: [],
    });
    expect(result.adapter.events[1]).toMatchObject({
      eventId: "evt-000002",
      parentEventId: "evt-000001",
      operation: "create",
      toolName: "write_file",
      destinationSystem: "local-workspace",
      destinationBoundary: "local",
      resourceType: "summary-file",
      dataCategories: ["churn_score"],
      quantity: { value: 1, unit: "files" },
      stateChange: true,
    });
    expect(result.run).toMatchObject({
      traceId: "5b8efff798038103d269b633813fc60c",
      agent: { id: "crm-summary-agent", name: "crm-summary-agent" },
      status: "succeeded",
    });
  });

  it("keeps unsupported action semantics material and unparsed", () => {
    const incomplete = structuredClone(otlpGenAiFixture);
    const actionAttributes =
      incomplete.resourceSpans[0]?.scopeSpans[0]?.spans[1]?.attributes;
    expect(actionAttributes).toBeDefined();
    if (!actionAttributes) return;
    incomplete.resourceSpans[0]!.scopeSpans[0]!.spans[1]!.attributes =
      actionAttributes.filter(
        (attribute) =>
          attribute.key !== "agent.receipt.operation" &&
          attribute.key !== "agent.receipt.state_change",
      );

    const result = adaptOtlpGenAiTrace(incomplete);
    expect(result.adapter.events).toHaveLength(1);
    expect(result.adapter.accounting.map((entry) => entry.status)).toEqual([
      "mapped",
      "unparsed",
      "metadata-only",
    ]);
    expect(result.adapter.accounting[1]).toMatchObject({
      material: true,
      canonicalEventIds: [],
    });
    expect(result.adapter.warnings[0]?.pointer).toContain("spans[1]");
  });

  it("rejects multiple traces and duplicate span IDs instead of merging them", () => {
    const multipleTraces = structuredClone(otlpGenAiFixture);
    multipleTraces.resourceSpans[0]!.scopeSpans[0]!.spans[2]!.traceId =
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    expect(() => adaptOtlpGenAiTrace(multipleTraces)).toThrow(
      "exactly one trace ID",
    );

    const duplicateSpans = structuredClone(otlpGenAiFixture);
    duplicateSpans.resourceSpans[0]!.scopeSpans[0]!.spans[2]!.spanId =
      "EEE19B7EC3C1B171";
    expect(() => adaptOtlpGenAiTrace(duplicateSpans)).toThrow(
      "unique span IDs",
    );
  });

  it("builds and validates a complete receipt with OTLP adapter provenance", async () => {
    const result = await buildReceipt(
      { rawBytes: bytes(otlpGenAiFixture), authority: otlpDemoAuthority },
      { now: () => "2026-08-27T22:50:00.000Z" },
    );

    expect(result.ok, result.ok ? undefined : JSON.stringify(result.error)).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.verdict).toBe("within_declared_authority");
    expect(result.receipt.coverage).toEqual({
      rawEvents: 3,
      accountedRawEvents: 3,
      mapped: 2,
      metadataOnly: 1,
      unparsed: 0,
      canonicalEvents: 2,
    });
    expect(result.receipt.integrity).toMatchObject({
      inputFormat: OTLP_GENAI_FORMAT,
      adapterName: OTLP_GENAI_ADAPTER_NAME,
      adapterVersion: "1.0.0",
      schemaVersion:
        "opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest",
    });
    expect(result.retainedSource.trace).toBeUndefined();
    expect(
      resolveRawPointer(
        result.retainedSource.rawDocument,
        result.receipt.events[1]!.rawPointer,
      ),
    ).toEqual(otlpGenAiFixture.resourceSpans[0]!.scopeSpans[0]!.spans[1]);
  });

  it("forces an incomplete verdict when a material action span is unparsed", async () => {
    const result = await buildReceipt({
      rawBytes: bytes(fixtureCIncomplete),
      authority: otlpDemoAuthority,
    });
    expect(result.ok, result.ok ? undefined : JSON.stringify(result.error)).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.verdict).toBe("unable_to_assess_fully");
    expect(result.receipt.coverage.unparsed).toBe(1);
    expect(
      result.receipt.findings
        .filter((finding) => finding.ruleId === "AR-TRACE-001")
        .map((finding) => finding.label),
    ).toEqual([
      "Material event could not be parsed",
      "Run termination is unknown",
    ]);
  });
});
