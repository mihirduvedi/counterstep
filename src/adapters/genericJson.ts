import type {
  AdapterResult,
  CanonicalEvent,
  GenericJsonMapping,
  ReceiptRun,
} from "../core/schemas/index";
import {
  CANONICAL_EVENT_SCHEMA_VERSION,
  CanonicalEventSchema,
  GenericJsonMappingSchema,
  Rfc3339Schema,
} from "../core/schemas/index";
import { compareInstants } from "../core/timestamps";

export const GENERIC_JSON_ADAPTER_NAME = "genericJsonExplicitMapping";
export const GENERIC_JSON_ADAPTER_VERSION = "1.0.0";
export const GENERIC_JSON_FORMAT = "generic-json-records.v1";
export const GENERIC_JSON_INPUT_SCHEMA_VERSION = "unversioned-json";

export type GenericJsonRecordSet = {
  pointer: string;
  label: string;
  recordCount: number;
  fieldPointers: string[];
};

export type GenericJsonInspection = {
  recordSets: GenericJsonRecordSet[];
};

export type GenericJsonAdaptedTrace = {
  adapter: AdapterResult;
  run: ReceiptRun;
  rawRecordCount: number;
  schemaVersion: typeof GENERIC_JSON_INPUT_SCHEMA_VERSION;
  adapterName: typeof GENERIC_JSON_ADAPTER_NAME;
  mapping: GenericJsonMapping;
};

type EventDraft = Omit<CanonicalEvent, "eventId" | "sequence"> & {
  originalIndex: number;
};

type RecordResult =
  | { ok: true; draft: EventDraft }
  | { ok: false; reason: string; sourceEventId?: string };

/** Find non-empty arrays of JSON objects that a reviewer can treat as records. */
export function inspectGenericJson(document: unknown): GenericJsonInspection {
  const recordSets: GenericJsonRecordSet[] = [];
  const seen = new Set<string>();

  function visit(value: unknown, pointer: string, depth: number): void {
    if (Array.isArray(value)) {
      if (value.length > 0 && value.some(isRecord)) {
        if (!seen.has(pointer)) {
          seen.add(pointer);
          recordSets.push({
            pointer,
            label: pointer === "" ? "Root array" : displayJsonPointer(pointer),
            recordCount: value.length,
            fieldPointers: discoverFieldPointers(value),
          });
        }
        return;
      }
      return;
    }
    if (!isRecord(value) || depth >= 4) return;
    for (const [key, child] of Object.entries(value)) {
      visit(child, appendJsonPointer(pointer, key), depth + 1);
    }
  }

  visit(document, "", 0);
  return { recordSets };
}

/**
 * Adapt one explicitly selected record array. Structural and semantic choices
 * come only from the validated mapping manifest; the adapter never guesses.
 */
export function adaptGenericJson(
  document: unknown,
  inputMapping: unknown,
): GenericJsonAdaptedTrace {
  const mapping = GenericJsonMappingSchema.parse(inputMapping);
  const rawRecords = resolveJsonPointer(document, mapping.recordsPointer);
  if (!Array.isArray(rawRecords) || rawRecords.length === 0) {
    throw new Error(
      "The selected generic JSON record path must resolve to a non-empty array.",
    );
  }

  const duplicateSourceIds = findDuplicateSourceIds(rawRecords, mapping);
  const results: RecordResult[] = rawRecords.map((record, originalIndex) => {
    const rawPointer = appendJsonPointer(mapping.recordsPointer, String(originalIndex));
    if (!isRecord(record)) {
      return {
        ok: false,
        reason: "The selected array item is not a JSON object.",
      };
    }
    const sourceEventIdResult = optionalScalarString(
      record,
      mapping.fields.sourceEventId,
    );
    if (!sourceEventIdResult.ok) {
      return { ok: false, reason: sourceEventIdResult.reason };
    }
    if (
      sourceEventIdResult.value !== undefined &&
      duplicateSourceIds.has(sourceEventIdResult.value)
    ) {
      return {
        ok: false,
        sourceEventId: sourceEventIdResult.value,
        reason: `Duplicate source event ID "${sourceEventIdResult.value}" cannot be linked unambiguously.`,
      };
    }
    return mapRecord(
      record,
      originalIndex,
      rawPointer,
      sourceEventIdResult.value,
      mapping,
    );
  });

  const sortedDrafts = results
    .filter((result): result is Extract<RecordResult, { ok: true }> => result.ok)
    .map((result) => result.draft)
    .sort((left, right) => {
      const timestampOrder = compareInstants(left.timestamp, right.timestamp);
      return timestampOrder !== 0
        ? timestampOrder
        : left.originalIndex - right.originalIndex;
    });

  const events: CanonicalEvent[] = [];
  const canonicalIdByRawPointer = new Map<string, string>();
  const schemaFailureByRawPointer = new Map<string, string>();

  for (const draft of sortedDrafts) {
    const eventId = `evt-${String(events.length + 1).padStart(6, "0")}`;
    const { originalIndex, ...eventFields } = draft;
    void originalIndex;
    const parsed = CanonicalEventSchema.safeParse({
      ...eventFields,
      eventId,
      sequence: events.length + 1,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      schemaFailureByRawPointer.set(
        draft.rawPointer,
        issue
          ? `Mapped canonical field ${issue.path.join(".") || "event"} is invalid: ${issue.message}`
          : "Mapped canonical event is invalid.",
      );
      continue;
    }
    events.push(parsed.data);
    canonicalIdByRawPointer.set(draft.rawPointer, parsed.data.eventId);
  }

  const accounting: AdapterResult["accounting"] = results.map(
    (result, originalIndex) => {
      const rawPointer = appendJsonPointer(
        mapping.recordsPointer,
        String(originalIndex),
      );
      if (!result.ok) {
        return {
          rawPointer,
          ...(result.sourceEventId === undefined
            ? {}
            : { sourceEventId: result.sourceEventId }),
          status: "unparsed" as const,
          canonicalEventIds: [],
          reason: result.reason,
          material: true,
        };
      }
      const schemaFailure = schemaFailureByRawPointer.get(rawPointer);
      if (schemaFailure) {
        return {
          rawPointer,
          ...(result.draft.sourceEventId === undefined
            ? {}
            : { sourceEventId: result.draft.sourceEventId }),
          status: "unparsed" as const,
          canonicalEventIds: [],
          reason: schemaFailure,
          material: true,
        };
      }
      const eventId = canonicalIdByRawPointer.get(rawPointer);
      if (!eventId) {
        throw new Error("Generic JSON adapter lost a mapped canonical event.");
      }
      return {
        rawPointer,
        ...(result.draft.sourceEventId === undefined
          ? {}
          : { sourceEventId: result.draft.sourceEventId }),
        status: "mapped" as const,
        canonicalEventIds: [eventId],
        material: true,
      };
    },
  );

  return {
    adapter: {
      format: GENERIC_JSON_FORMAT,
      adapterVersion: GENERIC_JSON_ADAPTER_VERSION,
      events,
      accounting,
      warnings: [
        {
          pointer: mapping.recordsPointer || "/",
          message:
            "Generic JSON was interpreted only through the reviewer-confirmed mapping manifest retained in this receipt.",
        },
      ],
    },
    run: mapping.run,
    rawRecordCount: rawRecords.length,
    schemaVersion: GENERIC_JSON_INPUT_SCHEMA_VERSION,
    adapterName: GENERIC_JSON_ADAPTER_NAME,
    mapping,
  };
}

function mapRecord(
  record: Record<string, unknown>,
  originalIndex: number,
  rawPointer: string,
  sourceEventId: string | undefined,
  mapping: GenericJsonMapping,
): RecordResult {
  const timestampResult = normalizeTimestamp(
    resolveJsonPointer(record, mapping.fields.timestamp.pointer),
    mapping.fields.timestamp.format,
  );
  if (!timestampResult.ok) {
    return { ok: false, sourceEventId, reason: timestampResult.reason };
  }

  const actorIdResult = resolveStringSource(record, mapping.fields.actorId);
  if (!actorIdResult.ok) {
    return { ok: false, sourceEventId, reason: actorIdResult.reason };
  }

  const actorTypeResult = resolveActorType(record, mapping);
  if (!actorTypeResult.ok) {
    return { ok: false, sourceEventId, reason: actorTypeResult.reason };
  }

  const operationResult = mappedValue(
    record,
    mapping.fields.operation,
    mapping.values.operations,
    "operation",
  );
  if (!operationResult.ok) {
    return { ok: false, sourceEventId, reason: operationResult.reason };
  }

  const statusResult = mappedValue(
    record,
    mapping.fields.status,
    mapping.values.statuses,
    "status",
  );
  if (!statusResult.ok) {
    return { ok: false, sourceEventId, reason: statusResult.reason };
  }

  const stateChangeResult = mappedValue(
    record,
    mapping.fields.stateChange,
    mapping.values.stateChanges,
    "state-change",
  );
  if (!stateChangeResult.ok) {
    return { ok: false, sourceEventId, reason: stateChangeResult.reason };
  }

  const optionalStrings = {
    parentEventId: optionalScalarString(record, mapping.fields.parentEventId),
    toolName: optionalScalarString(record, mapping.fields.toolName),
    sourceSystem: optionalScalarString(record, mapping.fields.sourceSystem),
    destinationSystem: optionalScalarString(
      record,
      mapping.fields.destinationSystem,
    ),
    resourceType: optionalScalarString(record, mapping.fields.resourceType),
    approvalRef: optionalScalarString(record, mapping.fields.approvalRef),
    actionKey: optionalScalarString(record, mapping.fields.actionKey),
  };
  for (const [field, result] of Object.entries(optionalStrings)) {
    if (!result.ok) {
      return {
        ok: false,
        sourceEventId,
        reason: `${field}: ${result.reason}`,
      };
    }
  }
  const parentEventId = optionalStringValue(optionalStrings.parentEventId);
  const toolName = optionalStringValue(optionalStrings.toolName);
  const sourceSystem = optionalStringValue(optionalStrings.sourceSystem);
  const destinationSystem = optionalStringValue(
    optionalStrings.destinationSystem,
  );
  const resourceType = optionalStringValue(optionalStrings.resourceType);
  const approvalRef = optionalStringValue(optionalStrings.approvalRef);
  const actionKey = optionalStringValue(optionalStrings.actionKey);

  const categoriesResult = resolveDataCategories(
    record,
    mapping.fields.dataCategories,
  );
  if (!categoriesResult.ok) {
    return { ok: false, sourceEventId, reason: categoriesResult.reason };
  }

  const quantityResult = resolveQuantity(record, mapping);
  if (!quantityResult.ok) {
    return { ok: false, sourceEventId, reason: quantityResult.reason };
  }

  const attemptResult = optionalNonnegativeInteger(
    record,
    mapping.fields.attempt,
  );
  if (!attemptResult.ok) {
    return { ok: false, sourceEventId, reason: attemptResult.reason };
  }

  const adapterWarnings = [
    "Mapped from generic JSON using reviewer-confirmed field and value translations.",
    ...timestampResult.warnings,
  ];
  const destinationBoundary = resolveBoundary(record, mapping, adapterWarnings);
  if (categoriesResult.value.length === 0) {
    adapterWarnings.push(
      "Data categories were not supplied; no category was inferred from record content.",
    );
  }

  return {
    ok: true,
    draft: {
      schemaVersion: CANONICAL_EVENT_SCHEMA_VERSION,
      ...(sourceEventId === undefined ? {} : { sourceEventId }),
      traceId: mapping.run.traceId,
      ...(parentEventId === undefined ? {} : { parentEventId }),
      timestamp: timestampResult.value,
      actorType: actorTypeResult.value,
      actorId: actorIdResult.value,
      operation: operationResult.value,
      ...(toolName === undefined ? {} : { toolName }),
      ...(sourceSystem === undefined ? {} : { sourceSystem }),
      ...(destinationSystem === undefined ? {} : { destinationSystem }),
      destinationBoundary,
      ...(resourceType === undefined ? {} : { resourceType }),
      dataCategories: categoriesResult.value,
      ...(quantityResult.value === undefined
        ? {}
        : { quantity: quantityResult.value }),
      stateChange: stateChangeResult.value,
      status: statusResult.value,
      ...(approvalRef === undefined ? {} : { approvalRef }),
      ...(actionKey === undefined ? {} : { actionKey }),
      ...(attemptResult.value === undefined
        ? {}
        : { attempt: attemptResult.value }),
      rawPointer,
      adapterWarnings,
      riskTags: [],
      originalIndex,
    },
  };
}

function resolveActorType(
  record: Record<string, unknown>,
  mapping: GenericJsonMapping,
):
  | { ok: true; value: CanonicalEvent["actorType"] }
  | { ok: false; reason: string } {
  if (mapping.fields.actorType.kind === "constant") {
    return { ok: true, value: mapping.fields.actorType.value };
  }
  return mappedValue(
    record,
    mapping.fields.actorType.pointer,
    mapping.values.actorTypes,
    "actor type",
  );
}

function resolveBoundary(
  record: Record<string, unknown>,
  mapping: GenericJsonMapping,
  warnings: string[],
): CanonicalEvent["destinationBoundary"] {
  const pointer = mapping.fields.destinationBoundary;
  if (pointer === undefined) {
    warnings.push(
      "Destination boundary was not mapped; canonical value remains unknown.",
    );
    return "unknown";
  }
  const rawValue = resolveJsonPointer(record, pointer);
  const key = semanticValueKey(rawValue);
  if (
    key === undefined ||
    !Object.prototype.hasOwnProperty.call(mapping.values.boundaries, key)
  ) {
    warnings.push(
      `Destination boundary value ${displaySemanticValue(rawValue)} was not mapped; canonical value remains unknown.`,
    );
    return "unknown";
  }
  return mapping.values.boundaries[key] ?? "unknown";
}

function mappedValue<T>(
  record: Record<string, unknown>,
  pointer: string,
  valueMap: Record<string, T>,
  label: string,
): { ok: true; value: T } | { ok: false; reason: string } {
  const rawValue = resolveJsonPointer(record, pointer);
  const key = semanticValueKey(rawValue);
  if (
    key === undefined ||
    !Object.prototype.hasOwnProperty.call(valueMap, key)
  ) {
    return {
      ok: false,
      reason: `No reviewer-confirmed ${label} mapping exists for ${displaySemanticValue(rawValue)}.`,
    };
  }
  const value = valueMap[key];
  if (value === undefined) {
    return {
      ok: false,
      reason: `No reviewer-confirmed ${label} mapping exists for ${displaySemanticValue(rawValue)}.`,
    };
  }
  return { ok: true, value };
}

function resolveStringSource(
  record: Record<string, unknown>,
  source: GenericJsonMapping["fields"]["actorId"],
): { ok: true; value: string } | { ok: false; reason: string } {
  if (source.kind === "constant") return { ok: true, value: source.value };
  const value = scalarString(resolveJsonPointer(record, source.pointer));
  return value === undefined
    ? {
        ok: false,
        reason: `Actor ID at ${displayJsonPointer(source.pointer)} must be a non-empty string or finite number.`,
      }
    : { ok: true, value };
}

function optionalScalarString(
  record: Record<string, unknown>,
  pointer: string | undefined,
):
  | { ok: true; value: string | undefined }
  | { ok: false; reason: string } {
  if (pointer === undefined) return { ok: true, value: undefined };
  const rawValue = resolveJsonPointer(record, pointer);
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return { ok: true, value: undefined };
  }
  const value = scalarString(rawValue);
  return value === undefined
    ? {
        ok: false,
        reason: `${displayJsonPointer(pointer)} must be a string or finite number when present.`,
      }
    : { ok: true, value };
}

function optionalStringValue(
  result:
    | { ok: true; value: string | undefined }
    | { ok: false; reason: string },
): string | undefined {
  return result.ok ? result.value : undefined;
}

function resolveDataCategories(
  record: Record<string, unknown>,
  pointer: string | undefined,
): { ok: true; value: string[] } | { ok: false; reason: string } {
  if (pointer === undefined) return { ok: true, value: [] };
  const rawValue = resolveJsonPointer(record, pointer);
  if (rawValue === undefined || rawValue === null) return { ok: true, value: [] };
  if (typeof rawValue === "string") return { ok: true, value: [rawValue] };
  if (
    Array.isArray(rawValue) &&
    rawValue.every((value) => typeof value === "string")
  ) {
    return { ok: true, value: rawValue };
  }
  return {
    ok: false,
    reason: `${displayJsonPointer(pointer)} must be a string or an array of strings when present.`,
  };
}

function resolveQuantity(
  record: Record<string, unknown>,
  mapping: GenericJsonMapping,
):
  | { ok: true; value: CanonicalEvent["quantity"] | undefined }
  | { ok: false; reason: string } {
  const pointer = mapping.fields.quantityValue;
  const unit = mapping.fields.quantityUnit;
  if (pointer === undefined || unit === undefined) {
    return { ok: true, value: undefined };
  }
  const rawValue = resolveJsonPointer(record, pointer);
  if (
    typeof rawValue !== "number" ||
    !Number.isSafeInteger(rawValue) ||
    rawValue < 0
  ) {
    return {
      ok: false,
      reason: `${displayJsonPointer(pointer)} must be a nonnegative safe integer.`,
    };
  }
  return { ok: true, value: { value: rawValue, unit } };
}

function optionalNonnegativeInteger(
  record: Record<string, unknown>,
  pointer: string | undefined,
):
  | { ok: true; value: number | undefined }
  | { ok: false; reason: string } {
  if (pointer === undefined) return { ok: true, value: undefined };
  const rawValue = resolveJsonPointer(record, pointer);
  if (rawValue === undefined || rawValue === null) {
    return { ok: true, value: undefined };
  }
  if (
    typeof rawValue !== "number" ||
    !Number.isSafeInteger(rawValue) ||
    rawValue < 0
  ) {
    return {
      ok: false,
      reason: `${displayJsonPointer(pointer)} must be a nonnegative safe integer when present.`,
    };
  }
  return { ok: true, value: rawValue };
}

function normalizeTimestamp(
  rawValue: unknown,
  format: GenericJsonMapping["fields"]["timestamp"]["format"],
):
  | { ok: true; value: string; warnings: string[] }
  | { ok: false; reason: string } {
  if (format === "rfc3339") {
    const parsed = Rfc3339Schema.safeParse(rawValue);
    return parsed.success
      ? { ok: true, value: parsed.data, warnings: [] }
      : {
          ok: false,
          reason:
            "Mapped timestamp must be RFC 3339 with an explicit timezone.",
        };
  }

  const integer = parseInteger(rawValue);
  if (integer === undefined) {
    return {
      ok: false,
      reason: `Mapped ${format} timestamp must be an integer number or integer string.`,
    };
  }
  const milliseconds =
    format === "unix-seconds"
      ? integer * 1_000n
      : format === "unix-milliseconds"
        ? integer
        : integer / 1_000_000n;
  const numericMilliseconds = Number(milliseconds);
  if (!Number.isSafeInteger(numericMilliseconds)) {
    return { ok: false, reason: `Mapped ${format} timestamp is out of range.` };
  }
  const date = new Date(numericMilliseconds);
  if (Number.isNaN(date.getTime())) {
    return { ok: false, reason: `Mapped ${format} timestamp is out of range.` };
  }
  return {
    ok: true,
    value: date.toISOString(),
    warnings: [
      `Mapped ${format} timestamp was normalized to RFC 3339 millisecond precision.`,
    ],
  };
}

function parseInteger(value: unknown): bigint | undefined {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? BigInt(value) : undefined;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    try {
      return BigInt(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function findDuplicateSourceIds(
  records: unknown[],
  mapping: GenericJsonMapping,
): Set<string> {
  const counts = new Map<string, number>();
  if (mapping.fields.sourceEventId === undefined) return new Set();
  for (const record of records) {
    if (!isRecord(record)) continue;
    const value = scalarString(
      resolveJsonPointer(record, mapping.fields.sourceEventId),
    );
    if (value !== undefined) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([value]) => value),
  );
}

export function semanticValueKey(value: unknown): string | undefined {
  if (value === null) return "null:null";
  if (typeof value === "string") return `string:${value}`;
  if (typeof value === "boolean") return `boolean:${String(value)}`;
  if (typeof value === "number" && Number.isFinite(value)) {
    return `number:${String(value)}`;
  }
  return undefined;
}

export function displaySemanticValue(value: unknown): string {
  if (value === undefined) return "a missing value";
  const serialized = JSON.stringify(value);
  return serialized === undefined ? "an unsupported value" : serialized;
}

export function resolveJsonPointer(document: unknown, pointer: string): unknown {
  if (pointer === "") return document;
  if (!pointer.startsWith("/")) return undefined;
  let current = document;
  for (const encodedToken of pointer.slice(1).split("/")) {
    const token = encodedToken.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(token)) return undefined;
      current = current[Number(token)];
      continue;
    }
    if (
      !isRecord(current) ||
      !Object.prototype.hasOwnProperty.call(current, token)
    ) {
      return undefined;
    }
    current = current[token];
  }
  return current;
}

export function appendJsonPointer(pointer: string, token: string): string {
  const escaped = token.replace(/~/g, "~0").replace(/\//g, "~1");
  return `${pointer}/${escaped}`;
}

export function displayJsonPointer(pointer: string): string {
  return pointer === "" ? "Root array" : pointer;
}

function discoverFieldPointers(records: unknown[]): string[] {
  const fields = new Set<string>();

  function visit(value: unknown, pointer: string, depth: number): void {
    if (depth > 5) return;
    if (Array.isArray(value) || value === null || typeof value !== "object") {
      if (pointer !== "") fields.add(pointer);
      return;
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0 && pointer !== "") fields.add(pointer);
    for (const [key, child] of entries) {
      visit(child, appendJsonPointer(pointer, key), depth + 1);
    }
  }

  for (const record of records.filter(isRecord).slice(0, 50)) {
    visit(record, "", 0);
  }
  return [...fields].sort((left, right) => left.localeCompare(right));
}

function scalarString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim().length > 0 ? value : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
