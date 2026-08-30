import {
  adaptGenericJson,
  displaySemanticValue,
  resolveJsonPointer,
  semanticValueKey,
} from "../adapters/genericJson";
import type { GenericJsonInspection } from "../adapters/genericJson";
import {
  CanonicalOperationSchema,
  GenericJsonMappingSchema,
} from "../core/schemas/index";
import type {
  CanonicalOperation,
  GenericJsonMapping,
} from "../core/schemas/index";

type EventStatus = "started" | "succeeded" | "failed" | "cancelled" | "unknown";
type RunStatus = "succeeded" | "failed" | "cancelled" | "unknown";
type ActorType = "agent" | "workflow" | "tool" | "human";
type Boundary = "local" | "internal" | "external" | "unknown";
type TimestampFormat =
  | "rfc3339"
  | "unix-seconds"
  | "unix-milliseconds"
  | "unix-nanoseconds";
type QuantityUnit = "records" | "messages" | "bytes" | "files";

export type GenericJsonMappingDraft = {
  recordsPointer: string;
  run: {
    traceId: string;
    agentId: string;
    agentName: string;
    agentVersion: string;
    startedAt: string;
    completedAt: string;
    status: RunStatus | "";
  };
  fields: {
    sourceEventId: string;
    parentEventId: string;
    timestamp: string;
    timestampFormat: TimestampFormat;
    actorIdMode: "path" | "constant";
    actorId: string;
    actorTypeMode: "path" | "constant";
    actorType: string;
    operation: string;
    toolName: string;
    sourceSystem: string;
    destinationSystem: string;
    destinationBoundary: string;
    resourceType: string;
    dataCategories: string;
    quantityValue: string;
    quantityUnit: QuantityUnit | "";
    stateChange: string;
    status: string;
    approvalRef: string;
    actionKey: string;
    attempt: string;
  };
  values: {
    operations: Record<string, CanonicalOperation | "">;
    statuses: Record<string, EventStatus | "">;
    stateChanges: Record<string, boolean | "">;
    actorTypes: Record<string, ActorType | "">;
    boundaries: Record<string, Boundary | "">;
  };
};

export type GenericSemanticValue = {
  key: string;
  label: string;
  count: number;
};

export type GenericMappingValidation =
  | {
      ok: true;
      mapping: GenericJsonMapping;
      preview: {
        rawRecords: number;
        mapped: number;
        unparsed: number;
        reasons: string[];
      };
    }
  | { ok: false; issues: Array<{ path: string; message: string }> };

const FIELD_ALIASES: Record<
  Exclude<
    keyof GenericJsonMappingDraft["fields"],
    | "timestampFormat"
    | "actorIdMode"
    | "actorTypeMode"
    | "quantityUnit"
  >,
  string[]
> = {
  sourceEventId: ["eventid", "eventuid", "recorduid", "sourceeventid", "spanid", "recordid", "uid", "id"],
  parentEventId: ["parenteventid", "parentspanid", "parentid"],
  timestamp: ["eventtimestamp", "eventat", "recordat", "createdat", "startedat", "eventtime", "timestamp", "time", "ts", "at"],
  actorId: ["actorid", "executorid", "principalid", "agentid", "userid", "serviceid"],
  actorType: ["actortype", "executortype", "principalkind", "agenttype", "originkind"],
  operation: ["operation", "operationname", "actionname", "eventaction", "action", "eventtype"],
  toolName: ["toolname", "toolid", "functionname", "tool"],
  sourceSystem: ["sourcesystem", "originsystem", "fromsystem", "from"],
  destinationSystem: ["destinationsystem", "targetsystem", "tosystem"],
  destinationBoundary: ["destinationboundary", "targetboundary", "boundary"],
  resourceType: ["resourcetype", "targettype", "objecttype", "objectkind"],
  dataCategories: ["datacategories", "objectcategories", "categories", "datatypes"],
  quantityValue: ["quantityvalue", "recordcount", "itemcount", "quantity", "count"],
  stateChange: ["statechange", "mutates", "mutation", "write", "sideeffect"],
  status: ["eventstatus", "outcome", "resultcode", "resultstatus", "status", "result"],
  approvalRef: ["approvalref", "approvallink", "approvalid", "authorizationref"],
  actionKey: ["actionkey", "correlationkey", "correlationid", "requestid"],
  attempt: ["attempt", "retrynumber", "retrycount", "try"],
};

export function createGenericJsonMappingDraft(
  document: unknown,
  inspection: GenericJsonInspection,
): GenericJsonMappingDraft {
  const selected = inspection.recordSets[0];
  const fields = selected?.fieldPointers ?? [];
  const draft: GenericJsonMappingDraft = {
    recordsPointer: selected?.pointer ?? "",
    run: {
      traceId: "",
      agentId: "",
      agentName: "",
      agentVersion: "",
      startedAt: "",
      completedAt: "",
      status: "",
    },
    fields: {
      sourceEventId: suggestField(fields, FIELD_ALIASES.sourceEventId),
      parentEventId: "",
      timestamp: suggestField(fields, FIELD_ALIASES.timestamp),
      timestampFormat: "rfc3339",
      actorIdMode: "path",
      actorId: suggestField(fields, FIELD_ALIASES.actorId),
      actorTypeMode: "constant",
      actorType: "",
      operation: suggestField(fields, FIELD_ALIASES.operation),
      toolName: "",
      sourceSystem: "",
      destinationSystem: "",
      destinationBoundary: "",
      resourceType: "",
      dataCategories: "",
      quantityValue: "",
      quantityUnit: "",
      stateChange: suggestField(fields, FIELD_ALIASES.stateChange),
      status: suggestField(fields, FIELD_ALIASES.status),
      approvalRef: "",
      actionKey: "",
      attempt: "",
    },
    values: {
      operations: {},
      statuses: {},
      stateChanges: {},
      actorTypes: {},
      boundaries: {},
    },
  };
  return refreshGenericValueMaps(document, draft);
}

export function changeGenericRecordSet(
  document: unknown,
  inspection: GenericJsonInspection,
  draft: GenericJsonMappingDraft,
  recordsPointer: string,
): GenericJsonMappingDraft {
  const selected = inspection.recordSets.find(
    (recordSet) => recordSet.pointer === recordsPointer,
  );
  const fields = selected?.fieldPointers ?? [];
  const next = structuredClone(draft);
  next.recordsPointer = recordsPointer;
  next.fields.sourceEventId = suggestField(
    fields,
    FIELD_ALIASES.sourceEventId,
  );
  next.fields.timestamp = suggestField(fields, FIELD_ALIASES.timestamp);
  next.fields.actorId =
    next.fields.actorIdMode === "path"
      ? suggestField(fields, FIELD_ALIASES.actorId)
      : "";
  next.fields.actorType =
    next.fields.actorTypeMode === "path"
      ? suggestField(fields, FIELD_ALIASES.actorType)
      : "";
  next.fields.operation = suggestField(fields, FIELD_ALIASES.operation);
  next.fields.stateChange = suggestField(fields, FIELD_ALIASES.stateChange);
  next.fields.status = suggestField(fields, FIELD_ALIASES.status);
  next.fields.parentEventId = "";
  next.fields.toolName = "";
  next.fields.sourceSystem = "";
  next.fields.destinationSystem = "";
  next.fields.destinationBoundary = "";
  next.fields.resourceType = "";
  next.fields.dataCategories = "";
  next.fields.quantityValue = "";
  next.fields.quantityUnit = "";
  next.fields.approvalRef = "";
  next.fields.actionKey = "";
  next.fields.attempt = "";
  next.values = {
    operations: {},
    statuses: {},
    stateChanges: {},
    actorTypes: {},
    boundaries: {},
  };
  return refreshGenericValueMaps(document, next);
}

export function refreshGenericValueMaps(
  document: unknown,
  draft: GenericJsonMappingDraft,
): GenericJsonMappingDraft {
  const next = structuredClone(draft);
  next.values.operations = refreshMap(
    collectGenericSemanticValues(
      document,
      draft.recordsPointer,
      draft.fields.operation,
    ),
    draft.values.operations,
    (value) =>
      typeof value === "string" &&
      CanonicalOperationSchema.options.includes(value as CanonicalOperation)
        ? (value as CanonicalOperation)
        : "",
  );
  next.values.statuses = refreshMap(
    collectGenericSemanticValues(
      document,
      draft.recordsPointer,
      draft.fields.status,
    ),
    draft.values.statuses,
    (value) =>
      typeof value === "string" &&
      ["started", "succeeded", "failed", "cancelled", "unknown"].includes(
        value,
      )
        ? (value as EventStatus)
        : "",
  );
  next.values.stateChanges = refreshMap(
    collectGenericSemanticValues(
      document,
      draft.recordsPointer,
      draft.fields.stateChange,
    ),
    draft.values.stateChanges,
    (value) => (typeof value === "boolean" ? value : ""),
  );
  next.values.actorTypes = refreshMap(
    draft.fields.actorTypeMode === "path"
      ? collectGenericSemanticValues(
          document,
          draft.recordsPointer,
          draft.fields.actorType,
        )
      : [],
    draft.values.actorTypes,
    (value) =>
      typeof value === "string" &&
      ["agent", "workflow", "tool", "human"].includes(value)
        ? (value as ActorType)
        : "",
  );
  next.values.boundaries = refreshMap(
    collectGenericSemanticValues(
      document,
      draft.recordsPointer,
      draft.fields.destinationBoundary,
    ),
    draft.values.boundaries,
    (value) =>
      typeof value === "string" &&
      ["local", "internal", "external", "unknown"].includes(value)
        ? (value as Boundary)
        : "",
  );
  return next;
}

export function collectGenericSemanticValues(
  document: unknown,
  recordsPointer: string,
  fieldPointer: string,
): GenericSemanticValue[] {
  if (fieldPointer === "") return [];
  const records = resolveJsonPointer(document, recordsPointer);
  if (!Array.isArray(records)) return [];
  const counts = new Map<string, { value: unknown; count: number }>();
  for (const record of records) {
    const value = resolveJsonPointer(record, fieldPointer);
    const key = semanticValueKey(value);
    if (key === undefined) continue;
    const current = counts.get(key);
    counts.set(key, { value, count: (current?.count ?? 0) + 1 });
  }
  return [...counts.entries()]
    .map(([key, item]) => ({
      key,
      label: displaySemanticValue(item.value),
      count: item.count,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function validateGenericJsonMappingDraft(
  document: unknown,
  draft: GenericJsonMappingDraft,
): GenericMappingValidation {
  const candidate = {
    schemaVersion: "agent-receipt.generic-json-mapping.v1",
    recordsPointer: draft.recordsPointer,
    run: {
      traceId: draft.run.traceId,
      agent: {
        id: draft.run.agentId,
        ...(draft.run.agentName.trim() === ""
          ? {}
          : { name: draft.run.agentName }),
        ...(draft.run.agentVersion.trim() === ""
          ? {}
          : { version: draft.run.agentVersion }),
      },
      startedAt: draft.run.startedAt,
      ...(draft.run.completedAt.trim() === ""
        ? {}
        : { completedAt: draft.run.completedAt }),
      status: draft.run.status,
    },
    fields: {
      ...(draft.fields.sourceEventId === ""
        ? {}
        : { sourceEventId: draft.fields.sourceEventId }),
      ...(draft.fields.parentEventId === ""
        ? {}
        : { parentEventId: draft.fields.parentEventId }),
      timestamp: {
        pointer: draft.fields.timestamp,
        format: draft.fields.timestampFormat,
      },
      actorId:
        draft.fields.actorIdMode === "path"
          ? { kind: "path", pointer: draft.fields.actorId }
          : { kind: "constant", value: draft.fields.actorId },
      actorType:
        draft.fields.actorTypeMode === "path"
          ? { kind: "path", pointer: draft.fields.actorType }
          : { kind: "constant", value: draft.fields.actorType },
      operation: draft.fields.operation,
      ...optionalFields(draft),
      stateChange: draft.fields.stateChange,
      status: draft.fields.status,
    },
    values: {
      operations: definedMap(draft.values.operations),
      statuses: definedMap(draft.values.statuses),
      stateChanges: definedMap(draft.values.stateChanges),
      actorTypes: definedMap(draft.values.actorTypes),
      boundaries: definedMap(draft.values.boundaries),
    },
  };

  const parsed = GenericJsonMappingSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.length > 0 ? issue.path.join(".") : "mapping",
        message: issue.message,
      })),
    };
  }
  try {
    const adapted = adaptGenericJson(document, parsed.data);
    const mapped = adapted.adapter.accounting.filter(
      (entry) => entry.status === "mapped",
    ).length;
    const unparsed = adapted.adapter.accounting.filter(
      (entry) => entry.status === "unparsed",
    );
    if (mapped === 0) {
      return {
        ok: false,
        issues: [
          {
            path: "values",
            message:
              "Map the observed operation, outcome, state-change, and actor values so at least one record becomes evidence.",
          },
          ...unparsed.slice(0, 4).map((entry) => ({
            path: entry.rawPointer,
            message: entry.reason ?? "Record remains unparsed.",
          })),
        ],
      };
    }
    return {
      ok: true,
      mapping: parsed.data,
      preview: {
        rawRecords: adapted.rawRecordCount,
        mapped,
        unparsed: unparsed.length,
        reasons: unparsed
          .map((entry) => entry.reason)
          .filter((reason): reason is string => reason !== undefined)
          .slice(0, 5),
      },
    };
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          path: "recordsPointer",
          message:
            error instanceof Error
              ? error.message
              : "The selected records could not be previewed.",
        },
      ],
    };
  }
}

function optionalFields(draft: GenericJsonMappingDraft): Record<string, string> {
  const result: Record<string, string> = {};
  const optional: Array<[
    keyof GenericJsonMappingDraft["fields"],
    string,
  ]> = [
    ["toolName", draft.fields.toolName],
    ["sourceSystem", draft.fields.sourceSystem],
    ["destinationSystem", draft.fields.destinationSystem],
    ["destinationBoundary", draft.fields.destinationBoundary],
    ["resourceType", draft.fields.resourceType],
    ["dataCategories", draft.fields.dataCategories],
    ["approvalRef", draft.fields.approvalRef],
    ["actionKey", draft.fields.actionKey],
    ["attempt", draft.fields.attempt],
  ];
  for (const [key, value] of optional) {
    if (value !== "") result[key] = value;
  }
  if (draft.fields.quantityValue !== "" && draft.fields.quantityUnit !== "") {
    result.quantityValue = draft.fields.quantityValue;
    result.quantityUnit = draft.fields.quantityUnit;
  }
  return result;
}

function definedMap<T>(source: Record<string, T | "">): Record<string, T> {
  return Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, T] => entry[1] !== ""),
  );
}

function refreshMap<T>(
  values: GenericSemanticValue[],
  current: Record<string, T | "">,
  exactDefault: (value: unknown) => T | "",
): Record<string, T | ""> {
  return Object.fromEntries(
    values.map((item) => {
      const rawValue = semanticValueFromKey(item.key);
      return [
        item.key,
        Object.prototype.hasOwnProperty.call(current, item.key)
          ? (current[item.key] ?? "")
          : exactDefault(rawValue),
      ];
    }),
  );
}

function semanticValueFromKey(key: string): unknown {
  const separator = key.indexOf(":");
  const type = key.slice(0, separator);
  const value = key.slice(separator + 1);
  if (type === "string") return value;
  if (type === "boolean") return value === "true";
  if (type === "number") return Number(value);
  if (type === "null") return null;
  return undefined;
}

function suggestField(fields: string[], aliases: string[]): string {
  for (const alias of aliases) {
    const match = fields.find((field) => normalizeFieldPath(field) === alias);
    if (match) return match;
  }
  return "";
}

function normalizeFieldPath(pointer: string): string {
  return pointer
    .replace(/~1/g, "/")
    .replace(/~0/g, "~")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
