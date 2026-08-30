import { z } from "zod";

import type {
  AdapterResult,
  CanonicalEvent,
  CanonicalOperation,
  ReceiptRun,
} from "../core/schemas/index";
import { CANONICAL_EVENT_SCHEMA_VERSION } from "../core/schemas/index";

export const OTLP_GENAI_ADAPTER_NAME = "otlpGenAi";
export const OTLP_GENAI_ADAPTER_VERSION = "1.0.0";
export const OTLP_GENAI_FORMAT = "otlp-json-resource-spans.v1";
export const OTLP_TRACE_SCHEMA_VERSION =
  "opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest";

type OtlpAnyValue =
  | { stringValue: string }
  | { boolValue: boolean }
  | { intValue: string | number }
  | { doubleValue: number | string }
  | { bytesValue: string }
  | { arrayValue: { values: OtlpAnyValue[] } }
  | { kvlistValue: { values: Array<{ key: string; value: OtlpAnyValue }> } };

const OtlpAnyValueSchema: z.ZodType<OtlpAnyValue> = z.lazy(() =>
  z.union([
    z.object({ stringValue: z.string() }).strict(),
    z.object({ boolValue: z.boolean() }).strict(),
    z.object({ intValue: z.union([z.string().regex(/^-?\d+$/), z.number().int()]) }).strict(),
    z.object({ doubleValue: z.union([z.number(), z.enum(["NaN", "Infinity", "-Infinity"])]) }).strict(),
    z.object({ bytesValue: z.string() }).strict(),
    z.object({ arrayValue: z.object({ values: z.array(OtlpAnyValueSchema) }).strict() }).strict(),
    z.object({
      kvlistValue: z.object({
        values: z.array(
          z.object({ key: z.string().min(1), value: OtlpAnyValueSchema }).strict(),
        ),
      }).strict(),
    }).strict(),
  ]),
);

const OtlpKeyValueSchema = z
  .object({
    key: z.string().min(1),
    value: OtlpAnyValueSchema,
  })
  .strict();

const OtlpSpanSchema = z
  .object({
    traceId: z.string().regex(/^[0-9a-fA-F]{32}$/),
    spanId: z.string().regex(/^[0-9a-fA-F]{16}$/),
    parentSpanId: z.string().regex(/^[0-9a-fA-F]{16}$/).optional(),
    name: z.string().min(1),
    kind: z.number().int().min(0).max(5),
    startTimeUnixNano: z.string().regex(/^\d+$/),
    endTimeUnixNano: z.string().regex(/^\d+$/),
    attributes: z.array(OtlpKeyValueSchema),
    status: z
      .object({
        message: z.string().optional(),
        code: z.number().int().min(0).max(2),
      })
      .strict()
      .optional(),
    droppedAttributesCount: z.number().int().nonnegative().optional(),
    droppedEventsCount: z.number().int().nonnegative().optional(),
    droppedLinksCount: z.number().int().nonnegative().optional(),
    flags: z.number().int().nonnegative().optional(),
    traceState: z.string().optional(),
    events: z.array(z.unknown()).optional(),
    links: z.array(z.unknown()).optional(),
  })
  .strict();

const OtlpScopeSpansSchema = z
  .object({
    scope: z
      .object({
        name: z.string().optional(),
        version: z.string().optional(),
        attributes: z.array(OtlpKeyValueSchema).optional(),
        droppedAttributesCount: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    spans: z.array(OtlpSpanSchema),
    schemaUrl: z.string().optional(),
  })
  .strict();

const OtlpResourceSpansSchema = z
  .object({
    resource: z
      .object({
        attributes: z.array(OtlpKeyValueSchema),
        droppedAttributesCount: z.number().int().nonnegative().optional(),
      })
      .strict(),
    scopeSpans: z.array(OtlpScopeSpansSchema),
    schemaUrl: z.string().optional(),
  })
  .strict();

export const OtlpExportTraceServiceRequestSchema = z
  .object({
    resourceSpans: z.array(OtlpResourceSpansSchema).min(1),
  })
  .strict();

export type OtlpExportTraceServiceRequest = z.infer<
  typeof OtlpExportTraceServiceRequestSchema
>;

export type OtlpGenAiAdaptedTrace = {
  adapter: AdapterResult;
  run: ReceiptRun;
  rawSpanCount: number;
  schemaVersion: typeof OTLP_TRACE_SCHEMA_VERSION;
  adapterName: typeof OTLP_GENAI_ADAPTER_NAME;
};

type FlattenedSpan = {
  span: z.infer<typeof OtlpSpanSchema>;
  rawPointer: string;
  originalIndex: number;
  resourceAttributes: Map<string, unknown>;
};

const INFERENCE_OPERATIONS = new Set([
  "chat",
  "generate_content",
  "text_completion",
  "embeddings",
  "retrieval",
]);

export function adaptOtlpGenAiTrace(
  document: OtlpExportTraceServiceRequest,
): OtlpGenAiAdaptedTrace {
  const flattened: FlattenedSpan[] = [];
  let originalIndex = 0;

  document.resourceSpans.forEach((resourceSpans, resourceIndex) => {
    const resourceAttributes = decodeAttributes(resourceSpans.resource.attributes);
    resourceSpans.scopeSpans.forEach((scopeSpans, scopeIndex) => {
      scopeSpans.spans.forEach((span, spanIndex) => {
        flattened.push({
          span,
          rawPointer: `resourceSpans[${resourceIndex}].scopeSpans[${scopeIndex}].spans[${spanIndex}]`,
          originalIndex,
          resourceAttributes,
        });
        originalIndex += 1;
      });
    });
  });

  if (flattened.length === 0) {
    throw new Error("The supported OTLP/JSON export must contain at least one span");
  }

  const traceIds = new Set(flattened.map(({ span }) => span.traceId.toLowerCase()));
  if (traceIds.size !== 1) {
    throw new Error("The supported OTLP/JSON shape must contain exactly one trace ID");
  }

  const duplicateSpanIds = duplicates(
    flattened.map(({ span }) => span.spanId.toLowerCase()),
  );
  if (duplicateSpanIds.size > 0) {
    throw new Error("The supported OTLP/JSON shape requires unique span IDs");
  }

  const sorted = [...flattened].sort((left, right) => {
    const leftStart = BigInt(left.span.startTimeUnixNano);
    const rightStart = BigInt(right.span.startTimeUnixNano);
    if (leftStart < rightStart) return -1;
    if (leftStart > rightStart) return 1;
    return left.originalIndex - right.originalIndex;
  });

  const events: CanonicalEvent[] = [];
  const accounting: AdapterResult["accounting"] = [];
  const warnings: AdapterResult["warnings"] = [];
  const canonicalIdBySpanId = new Map<string, string>();
  let sequence = 0;

  for (const item of sorted) {
    const attributes = decodeAttributes(item.span.attributes);
    const genAiOperation = stringAttribute(attributes, "gen_ai.operation.name");
    const explicitOperation = stringAttribute(
      attributes,
      "agent.receipt.operation",
    );
    const isGenAiSpan = genAiOperation !== undefined;

    if (!isGenAiSpan && explicitOperation === undefined) {
      accounting.push({
        rawPointer: item.rawPointer,
        sourceEventId: item.span.spanId.toLowerCase(),
        status: "metadata-only",
        canonicalEventIds: [],
        reason: "Span has no gen_ai.operation.name or agent.receipt.operation attribute.",
        material: false,
      });
      continue;
    }

    const operation = resolveCanonicalOperation(
      explicitOperation,
      genAiOperation,
    );
    const stateChange = resolveStateChange(attributes, genAiOperation);
    if (!operation || stateChange === undefined) {
      accounting.push({
        rawPointer: item.rawPointer,
        sourceEventId: item.span.spanId.toLowerCase(),
        status: "unparsed",
        canonicalEventIds: [],
        reason:
          "Action span needs a supported agent.receipt.operation and an explicit agent.receipt.state_change value unless it is a supported read-only GenAI inference span.",
        material: true,
      });
      continue;
    }

    const timestamp = unixNanoToRfc3339(item.span.startTimeUnixNano);
    if (!timestamp) {
      accounting.push({
        rawPointer: item.rawPointer,
        sourceEventId: item.span.spanId.toLowerCase(),
        status: "unparsed",
        canonicalEventIds: [],
        reason: "Span startTimeUnixNano is outside the supported JavaScript date range.",
        material: true,
      });
      continue;
    }

    sequence += 1;
    const eventId = `evt-${String(sequence).padStart(6, "0")}`;
    canonicalIdBySpanId.set(item.span.spanId.toLowerCase(), eventId);
    const destinationBoundary = boundaryAttribute(attributes);
    const dataCategories = stringArrayAttribute(
      attributes,
      "agent.receipt.data.categories",
    );
    const quantity = quantityAttribute(attributes);
    const actorId =
      stringAttribute(attributes, "gen_ai.agent.name") ??
      stringAttribute(attributes, "agent.receipt.actor.id") ??
      stringAttribute(item.resourceAttributes, "service.name") ??
      "unknown-otel-service";
    const actorType = actorTypeAttribute(attributes);
    const adapterWarnings: string[] = [
      "OTLP nanosecond timestamp was normalized to RFC 3339 millisecond precision.",
    ];
    if (destinationBoundary === "unknown") {
      adapterWarnings.push(
        "Destination boundary was not supplied; canonical value remains unknown.",
      );
    }
    if (dataCategories.length === 0) {
      adapterWarnings.push(
        "Data categories were not supplied; no category was inferred from prompt or output content.",
      );
    }

    events.push({
      schemaVersion: CANONICAL_EVENT_SCHEMA_VERSION,
      eventId,
      sourceEventId: item.span.spanId.toLowerCase(),
      traceId: item.span.traceId.toLowerCase(),
      sequence,
      timestamp,
      actorType,
      actorId,
      operation,
      toolName: stringAttribute(attributes, "gen_ai.tool.name"),
      sourceSystem: stringAttribute(attributes, "agent.receipt.source.system"),
      destinationSystem:
        stringAttribute(attributes, "agent.receipt.destination.system") ??
        stringAttribute(attributes, "server.address"),
      destinationBoundary,
      resourceType:
        stringAttribute(attributes, "agent.receipt.resource.type") ??
        (genAiOperation && INFERENCE_OPERATIONS.has(genAiOperation)
          ? "gen-ai-inference"
          : undefined),
      dataCategories,
      quantity,
      stateChange,
      status: statusFromSpan(item.span, attributes),
      approvalRef: stringAttribute(attributes, "agent.receipt.approval.ref"),
      actionKey: stringAttribute(attributes, "agent.receipt.action.key"),
      attempt: integerAttribute(attributes, "agent.receipt.attempt"),
      rawPointer: item.rawPointer,
      adapterWarnings,
      riskTags: ["otlp-genai"],
    });
    accounting.push({
      rawPointer: item.rawPointer,
      sourceEventId: item.span.spanId.toLowerCase(),
      status: "mapped",
      canonicalEventIds: [eventId],
      material: true,
    });
  }

  for (const event of events) {
    const source = flattened.find(
      ({ span }) => span.spanId.toLowerCase() === event.sourceEventId,
    );
    const parentSpanId = source?.span.parentSpanId?.toLowerCase();
    if (!parentSpanId) continue;
    const parentEventId = canonicalIdBySpanId.get(parentSpanId);
    if (parentEventId) {
      event.parentEventId = parentEventId;
    } else {
      event.adapterWarnings.push(
        "Parent span was not mapped to a canonical event; parentEventId remains unknown.",
      );
    }
  }

  for (const entry of accounting) {
    if (entry.status === "unparsed") {
      warnings.push({
        pointer: entry.rawPointer,
        message: entry.reason ?? "OTLP span could not be mapped.",
      });
    }
  }

  const startTime = minimumNano(flattened.map(({ span }) => span.startTimeUnixNano));
  const endTime = maximumNano(flattened.map(({ span }) => span.endTimeUnixNano));
  const startedAt = unixNanoToRfc3339(startTime);
  const completedAt = unixNanoToRfc3339(endTime);
  if (!startedAt || !completedAt) {
    throw new Error("OTLP run timestamps are outside the supported date range");
  }
  const serviceNames = unique(
    flattened
      .map(({ resourceAttributes }) =>
        stringAttribute(resourceAttributes, "service.name"),
      )
      .filter((value): value is string => value !== undefined),
  );
  const statusCodes = flattened.map(({ span }) => span.status?.code ?? 0);
  const runStatus: ReceiptRun["status"] = statusCodes.some((code) => code === 2)
    ? "failed"
    : statusCodes.every((code) => code === 1)
      ? "succeeded"
      : "unknown";

  return {
    adapter: {
      format: OTLP_GENAI_FORMAT,
      adapterVersion: OTLP_GENAI_ADAPTER_VERSION,
      events,
      accounting,
      warnings,
    },
    run: {
      traceId: [...traceIds][0] ?? "unknown-otel-trace",
      agent: {
        id: serviceNames[0] ?? "unknown-otel-service",
        ...(serviceNames[0] ? { name: serviceNames[0] } : {}),
      },
      startedAt,
      completedAt,
      status: runStatus,
    },
    rawSpanCount: flattened.length,
    schemaVersion: OTLP_TRACE_SCHEMA_VERSION,
    adapterName: OTLP_GENAI_ADAPTER_NAME,
  };
}

function decodeAttributes(
  attributes: Array<z.infer<typeof OtlpKeyValueSchema>>,
): Map<string, unknown> {
  const decoded = new Map<string, unknown>();
  for (const attribute of attributes) {
    if (decoded.has(attribute.key)) {
      decoded.set(attribute.key, undefined);
      continue;
    }
    decoded.set(attribute.key, decodeAnyValue(attribute.value));
  }
  return decoded;
}

function decodeAnyValue(value: OtlpAnyValue): unknown {
  if ("stringValue" in value) return value.stringValue;
  if ("boolValue" in value) return value.boolValue;
  if ("intValue" in value) {
    const numeric = Number(value.intValue);
    return Number.isSafeInteger(numeric) ? numeric : String(value.intValue);
  }
  if ("doubleValue" in value) return value.doubleValue;
  if ("bytesValue" in value) return value.bytesValue;
  if ("arrayValue" in value) {
    return value.arrayValue.values.map(decodeAnyValue);
  }
  return Object.fromEntries(
    value.kvlistValue.values.map((entry) => [
      entry.key,
      decodeAnyValue(entry.value),
    ]),
  );
}

function stringAttribute(
  attributes: Map<string, unknown>,
  key: string,
): string | undefined {
  const value = attributes.get(key);
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function integerAttribute(
  attributes: Map<string, unknown>,
  key: string,
): number | undefined {
  const value = attributes.get(key);
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function stringArrayAttribute(
  attributes: Map<string, unknown>,
  key: string,
): string[] {
  const value = attributes.get(key);
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
}

function boundaryAttribute(
  attributes: Map<string, unknown>,
): CanonicalEvent["destinationBoundary"] {
  const value = stringAttribute(
    attributes,
    "agent.receipt.destination.boundary",
  );
  return value === "local" ||
    value === "internal" ||
    value === "external" ||
    value === "unknown"
    ? value
    : "unknown";
}

function actorTypeAttribute(
  attributes: Map<string, unknown>,
): CanonicalEvent["actorType"] {
  const value = stringAttribute(attributes, "agent.receipt.actor.type");
  return value === "agent" ||
    value === "workflow" ||
    value === "tool" ||
    value === "human"
    ? value
    : "agent";
}

function resolveCanonicalOperation(
  explicitOperation: string | undefined,
  genAiOperation: string | undefined,
): CanonicalOperation | undefined {
  const allowed: CanonicalOperation[] = [
    "read",
    "retrieve",
    "create",
    "update",
    "delete",
    "send",
    "execute",
    "approve",
    "error",
    "unknown",
  ];
  if (explicitOperation && allowed.includes(explicitOperation as CanonicalOperation)) {
    return explicitOperation as CanonicalOperation;
  }
  if (genAiOperation && INFERENCE_OPERATIONS.has(genAiOperation)) return "execute";
  return undefined;
}

function resolveStateChange(
  attributes: Map<string, unknown>,
  genAiOperation: string | undefined,
): boolean | undefined {
  const explicit = attributes.get("agent.receipt.state_change");
  if (typeof explicit === "boolean") return explicit;
  if (genAiOperation && INFERENCE_OPERATIONS.has(genAiOperation)) return false;
  return undefined;
}

function quantityAttribute(
  attributes: Map<string, unknown>,
): CanonicalEvent["quantity"] {
  const value = integerAttribute(attributes, "agent.receipt.quantity.value");
  const unit = stringAttribute(attributes, "agent.receipt.quantity.unit");
  if (
    value === undefined ||
    (unit !== "records" &&
      unit !== "messages" &&
      unit !== "bytes" &&
      unit !== "files")
  ) {
    return undefined;
  }
  return { value, unit };
}

function statusFromSpan(
  span: z.infer<typeof OtlpSpanSchema>,
  attributes: Map<string, unknown>,
): CanonicalEvent["status"] {
  if (stringAttribute(attributes, "error.type") || span.status?.code === 2) {
    return "failed";
  }
  if (span.status?.code === 1) return "succeeded";
  return "unknown";
}

function unixNanoToRfc3339(value: string): string | null {
  try {
    const milliseconds = BigInt(value) / 1_000_000n;
    if (milliseconds > 8_640_000_000_000_000n) return null;
    return new Date(Number(milliseconds)).toISOString();
  } catch {
    return null;
  }
}

function minimumNano(values: string[]): string {
  return values.reduce((minimum, value) =>
    BigInt(value) < BigInt(minimum) ? value : minimum,
  );
}

function maximumNano(values: string[]): string {
  return values.reduce((maximum, value) =>
    BigInt(value) > BigInt(maximum) ? value : maximum,
  );
}

function duplicates(values: string[]): Set<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return repeated;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
