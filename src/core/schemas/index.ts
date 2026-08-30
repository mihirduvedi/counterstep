import { z } from "zod";
import { isRfc3339WithTz } from "../timestamps";

export const NATIVE_TRACE_SCHEMA_VERSION =
  "agent-receipt.native-trace.v1" as const;
export const AUTHORITY_SCHEMA_VERSION =
  "agent-receipt.authority.v1" as const;
export const CANONICAL_EVENT_SCHEMA_VERSION =
  "agent-receipt.canonical-event.v1" as const;
export const RECEIPT_SCHEMA_VERSION = "agent-receipt.receipt.v1" as const;
export const GENERIC_JSON_MAPPING_SCHEMA_VERSION =
  "agent-receipt.generic-json-mapping.v1" as const;
export const VERDICT_QUALIFIER =
  "Based on the supplied trace and authority envelope." as const;

// ─── Shared primitives ────────────────────────────────────────────────────────

/**
 * Zod schema for a timestamp string that must be RFC 3339 with an explicit
 * timezone (Z or ±HH:MM). The original string is preserved verbatim.
 */
export const Rfc3339Schema = z
  .string()
  .refine(isRfc3339WithTz, {
    message:
      "Use an RFC 3339 timestamp with an explicit timezone, such as 2024-01-01T00:00:00Z or 2024-01-01T00:00:00+05:30.",
  });

export const NonBlankStringSchema = z.string().refine(
  (value) => value.trim().length > 0,
  { message: "Enter a value." },
);

const NormalizedDataCategorySchema = NonBlankStringSchema
  .transform((value) =>
    value.trim().toLowerCase().replace(/[\s_-]+/g, "_"),
  )
  .pipe(
    z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/, {
      message: "Use a lowercase slug such as customer_email.",
    }),
  );

export const CanonicalOperationSchema = z.enum([
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
]);
export type CanonicalOperation = z.infer<typeof CanonicalOperationSchema>;

// ─── Explicit generic JSON mapping v1 ───────────────────────────────────────

/**
 * RFC 6901 JSON Pointer syntax. The empty string addresses the root document;
 * field pointers below deliberately require at least one path segment.
 */
export const JsonPointerSchema = z.string().refine(
  (value) =>
    value === "" || /^(?:\/(?:[^~/]|~0|~1)*)+$/.test(value),
  { message: "Use an RFC 6901 JSON Pointer such as /records or /event/id." },
);

const GenericFieldPointerSchema = JsonPointerSchema.refine(
  (value) => value !== "",
  { message: "Choose a field inside each source record." },
);

const GenericStringSourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("path"),
      pointer: GenericFieldPointerSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("constant"),
      value: NonBlankStringSchema,
    })
    .strict(),
]);

const GenericActorTypeSourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("path"),
      pointer: GenericFieldPointerSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("constant"),
      value: z.enum(["agent", "workflow", "tool", "human"]),
    })
    .strict(),
]);

export const GenericJsonMappingSchema = z
  .object({
    schemaVersion: z.literal(GENERIC_JSON_MAPPING_SCHEMA_VERSION),
    recordsPointer: JsonPointerSchema,
    run: z
      .object({
        traceId: NonBlankStringSchema,
        agent: z
          .object({
            id: NonBlankStringSchema,
            name: NonBlankStringSchema.optional(),
            version: NonBlankStringSchema.optional(),
          })
          .strict(),
        startedAt: Rfc3339Schema,
        completedAt: Rfc3339Schema.optional(),
        status: z.enum(["succeeded", "failed", "cancelled", "unknown"]),
      })
      .strict(),
    fields: z
      .object({
        sourceEventId: GenericFieldPointerSchema.optional(),
        parentEventId: GenericFieldPointerSchema.optional(),
        timestamp: z
          .object({
            pointer: GenericFieldPointerSchema,
            format: z.enum([
              "rfc3339",
              "unix-seconds",
              "unix-milliseconds",
              "unix-nanoseconds",
            ]),
          })
          .strict(),
        actorId: GenericStringSourceSchema,
        actorType: GenericActorTypeSourceSchema,
        operation: GenericFieldPointerSchema,
        toolName: GenericFieldPointerSchema.optional(),
        sourceSystem: GenericFieldPointerSchema.optional(),
        destinationSystem: GenericFieldPointerSchema.optional(),
        destinationBoundary: GenericFieldPointerSchema.optional(),
        resourceType: GenericFieldPointerSchema.optional(),
        dataCategories: GenericFieldPointerSchema.optional(),
        quantityValue: GenericFieldPointerSchema.optional(),
        quantityUnit: z
          .enum(["records", "messages", "bytes", "files"])
          .optional(),
        stateChange: GenericFieldPointerSchema,
        status: GenericFieldPointerSchema,
        approvalRef: GenericFieldPointerSchema.optional(),
        actionKey: GenericFieldPointerSchema.optional(),
        attempt: GenericFieldPointerSchema.optional(),
      })
      .strict()
      .superRefine((fields, context) => {
        if ((fields.quantityValue === undefined) !== (fields.quantityUnit === undefined)) {
          context.addIssue({
            code: "custom",
            path: ["quantityValue"],
            message: "Quantity value and unit must be supplied together.",
          });
        }
      }),
    values: z
      .object({
        operations: z.record(z.string(), CanonicalOperationSchema),
        statuses: z.record(
          z.string(),
          z.enum(["started", "succeeded", "failed", "cancelled", "unknown"]),
        ),
        stateChanges: z.record(z.string(), z.boolean()),
        actorTypes: z.record(
          z.string(),
          z.enum(["agent", "workflow", "tool", "human"]),
        ),
        boundaries: z.record(
          z.string(),
          z.enum(["local", "internal", "external", "unknown"]),
        ),
      })
      .strict(),
  })
  .strict();
export type GenericJsonMapping = z.infer<typeof GenericJsonMappingSchema>;

// ─── Native trace v1 ─────────────────────────────────────────────────────────

export const NativeEventV1Schema = z.object({
  id: NonBlankStringSchema,
  parentId: NonBlankStringSchema.optional(),
  timestamp: Rfc3339Schema,
  actor: z.object({
    type: z.enum(["agent", "workflow", "tool", "human"]),
    id: NonBlankStringSchema,
  }),
  operation: CanonicalOperationSchema,
  toolName: NonBlankStringSchema.optional(),
  sourceSystem: NonBlankStringSchema.optional(),
  destinationSystem: NonBlankStringSchema.optional(),
  destinationBoundary: z
    .enum(["local", "internal", "external", "unknown"])
    .optional(),
  resourceType: NonBlankStringSchema.optional(),
  dataCategories: z.array(NormalizedDataCategorySchema).optional(),
  quantity: z
    .object({
      value: z.number().int().nonnegative().safe(),
      unit: z.enum(["records", "messages", "bytes", "files"]),
    })
    .optional(),
  stateChange: z.boolean(),
  status: z.enum(["started", "succeeded", "failed", "cancelled", "unknown"]),
  approvalRef: NonBlankStringSchema.optional(),
  actionKey: NonBlankStringSchema.optional(),
  attempt: z.number().int().nonnegative().safe().optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  error: z
    .object({ code: z.string().optional(), message: z.string().optional() })
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type NativeEventV1 = z.infer<typeof NativeEventV1Schema>;

export const NativeTraceV1Schema = z.object({
  schemaVersion: z.literal(NATIVE_TRACE_SCHEMA_VERSION),
  traceId: NonBlankStringSchema,
  agent: z.object({
    id: NonBlankStringSchema,
    name: NonBlankStringSchema.optional(),
    version: NonBlankStringSchema.optional(),
  }),
  startedAt: Rfc3339Schema,
  completedAt: Rfc3339Schema.optional(),
  status: z.enum(["succeeded", "failed", "cancelled", "unknown"]),
  events: z.array(NativeEventV1Schema),
});
export type NativeTraceV1 = z.infer<typeof NativeTraceV1Schema>;

// ─── Authority envelope v1 ────────────────────────────────────────────────────

export const AuthorityEnvelopeV1Schema = z.object({
  schemaVersion: z.literal(AUTHORITY_SCHEMA_VERSION),
  policyId: NonBlankStringSchema,
  task: NonBlankStringSchema,
  permittedSystems: z.array(
    z.object({
      systemId: NonBlankStringSchema,
      boundary: z.enum(["local", "internal", "external"]),
    }),
  ),
  permittedOperations: z.array(CanonicalOperationSchema),
  prohibitedDataCategories: z.array(NormalizedDataCategorySchema),
  externalEgressAllowed: z.boolean(),
  maxRecordsRead: z.number().int().nonnegative().safe().optional(),
  approvalRequiredFor: z.array(CanonicalOperationSchema),
});
export type AuthorityEnvelopeV1 = z.infer<typeof AuthorityEnvelopeV1Schema>;

// ─── Canonical event v1 ───────────────────────────────────────────────────────

export const CanonicalEventSchema = z.object({
  schemaVersion: z.literal(CANONICAL_EVENT_SCHEMA_VERSION),
  eventId: NonBlankStringSchema,
  sourceEventId: NonBlankStringSchema.optional(),
  traceId: NonBlankStringSchema,
  parentEventId: NonBlankStringSchema.optional(),
  sequence: z.number().int().positive().safe(),
  timestamp: Rfc3339Schema,
  actorType: z.enum(["agent", "workflow", "tool", "human"]),
  actorId: NonBlankStringSchema,
  operation: CanonicalOperationSchema,
  toolName: NonBlankStringSchema.optional(),
  sourceSystem: NonBlankStringSchema.optional(),
  destinationSystem: NonBlankStringSchema.optional(),
  destinationBoundary: z.enum(["local", "internal", "external", "unknown"]),
  resourceType: NonBlankStringSchema.optional(),
  dataCategories: z.array(NormalizedDataCategorySchema),
  quantity: z
    .object({
      value: z.number().int().nonnegative().safe(),
      unit: z.enum(["records", "messages", "bytes", "files"]),
    })
    .optional(),
  stateChange: z.boolean(),
  status: z.enum(["started", "succeeded", "failed", "cancelled", "unknown"]),
  approvalRef: NonBlankStringSchema.optional(),
  actionKey: NonBlankStringSchema.optional(),
  attempt: z.number().int().nonnegative().safe().optional(),
  rawPointer: NonBlankStringSchema,
  adapterWarnings: z.array(z.string()),
  riskTags: z.array(z.string()),
});
export type CanonicalEvent = z.infer<typeof CanonicalEventSchema>;

// ─── Adapter result and accounting ───────────────────────────────────────────

export const ParseWarningSchema = z.object({
  pointer: NonBlankStringSchema,
  message: NonBlankStringSchema,
});
export type ParseWarning = z.infer<typeof ParseWarningSchema>;

export const RawEventAccountingSchema = z.object({
  rawPointer: NonBlankStringSchema,
  sourceEventId: NonBlankStringSchema.optional(),
  status: z.enum(["mapped", "metadata-only", "unparsed"]),
  canonicalEventIds: z.array(NonBlankStringSchema),
  reason: NonBlankStringSchema.optional(),
  material: z.boolean(),
});
export type RawEventAccounting = z.infer<typeof RawEventAccountingSchema>;

export const AdapterResultSchema = z.object({
  format: z.string(),
  adapterVersion: z.string(),
  events: z.array(CanonicalEventSchema),
  accounting: z.array(RawEventAccountingSchema),
  warnings: z.array(ParseWarningSchema),
});
export type AdapterResult = z.infer<typeof AdapterResultSchema>;

// ─── Finding ─────────────────────────────────────────────────────────────────

export const FindingSchema = z.object({
  findingId: NonBlankStringSchema,
  ruleId: NonBlankStringSchema,
  severity: z.enum(["low", "medium", "high"]),
  label: NonBlankStringSchema,
  description: NonBlankStringSchema,
  eventIds: z.array(NonBlankStringSchema),
  policyPath: NonBlankStringSchema.optional(),
  observedValue: z.unknown().optional(),
  expectedValue: z.unknown().optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

// ─── Verdict ──────────────────────────────────────────────────────────────────

export const VerdictSchema = z.enum([
  "within_declared_authority",
  "review_recommended",
  "material_deviations_found",
  "unable_to_assess_fully",
]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const VERDICT_LABELS: Record<Verdict, string> = {
  within_declared_authority: "Within declared authority",
  review_recommended: "Manager review recommended",
  material_deviations_found: "Material deviations found",
  unable_to_assess_fully: "Authority assessment incomplete",
};

// ─── Receipt primitives ──────────────────────────────────────────────────────

const IntegrityMetadataBaseSchema = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  byteLength: z.number().int().nonnegative().safe(),
  inputFormat: NonBlankStringSchema,
  schemaVersion: NonBlankStringSchema,
  adapterName: NonBlankStringSchema,
  adapterVersion: NonBlankStringSchema,
  authoritySchemaVersion: z.literal(AUTHORITY_SCHEMA_VERSION),
  policyId: NonBlankStringSchema,
  canonicalEventSchemaVersion: z.literal(CANONICAL_EVENT_SCHEMA_VERSION),
  receiptSchemaVersion: z.literal(RECEIPT_SCHEMA_VERSION),
  generatedAt: Rfc3339Schema,
  genericJsonMapping: GenericJsonMappingSchema.optional(),
});

export const IntegrityMetadataSchema = z.discriminatedUnion(
  "generationSource",
  [
    IntegrityMetadataBaseSchema.extend({
      generationSource: z.literal("granite"),
      modelId: NonBlankStringSchema,
      modelApiVersion: NonBlankStringSchema,
    }).strict(),
    IntegrityMetadataBaseSchema.extend({
      generationSource: z.literal("deterministic_fallback"),
    }).strict(),
  ],
);
export type IntegrityMetadata = z.infer<typeof IntegrityMetadataSchema>;

export const ReviewDispositionSchema = z.enum([
  "accepted",
  "investigate",
  "rejected",
  "unreviewed",
]);
export type ReviewDisposition = z.infer<typeof ReviewDispositionSchema>;

export const CoverageSummarySchema = z
  .object({
    rawEvents: z.number().int().nonnegative().safe(),
    accountedRawEvents: z.number().int().nonnegative().safe(),
    mapped: z.number().int().nonnegative().safe(),
    metadataOnly: z.number().int().nonnegative().safe(),
    unparsed: z.number().int().nonnegative().safe(),
    canonicalEvents: z.number().int().nonnegative().safe(),
  })
  .strict()
  .superRefine((coverage, context) => {
    const statusTotal =
      coverage.mapped + coverage.metadataOnly + coverage.unparsed;
    if (statusTotal !== coverage.accountedRawEvents) {
      context.addIssue({
        code: "custom",
        path: ["accountedRawEvents"],
        message:
          "accountedRawEvents must equal mapped + metadataOnly + unparsed",
      });
    }
    if (coverage.accountedRawEvents > coverage.rawEvents) {
      context.addIssue({
        code: "custom",
        path: ["accountedRawEvents"],
        message: "accountedRawEvents cannot exceed rawEvents",
      });
    }
  });
export type CoverageSummary = z.infer<typeof CoverageSummarySchema>;

export const ReceiptRunSchema = z
  .object({
    traceId: NonBlankStringSchema,
    agent: z
      .object({
        id: NonBlankStringSchema,
        name: NonBlankStringSchema.optional(),
        version: NonBlankStringSchema.optional(),
      })
      .strict(),
    startedAt: Rfc3339Schema,
    completedAt: Rfc3339Schema.optional(),
    status: z.enum(["succeeded", "failed", "cancelled", "unknown"]),
  })
  .strict();
export type ReceiptRun = z.infer<typeof ReceiptRunSchema>;

// ─── UI length limits (P0 constants) ─────────────────────────────────────────

export const UI_LIMITS = {
  HEADLINE_MAX: 200,
  OUTCOME_MAX: 500,
  NOTABLE_ACTION_MAX: 300,
  LIMITATION_MAX: 300,
} as const;

// ─── Generated receipt copy (Granite output contract) ─────────────────────────

/**
 * The output schema Granite must produce. Strict objects reject unknown fields
 * from model-generated JSON. All text fields require non-whitespace content.
 * limitations items intentionally have no findingIds — matches PRD § 9 exactly.
 */
export const GeneratedReceiptCopySchema = z.object({
  headline: z.object({
    text: NonBlankStringSchema,
    eventIds: z.array(NonBlankStringSchema),
    findingIds: z.array(NonBlankStringSchema),
  }).strict(),
  outcome: z.object({
    text: NonBlankStringSchema,
    eventIds: z.array(NonBlankStringSchema),
  }).strict(),
  notableActions: z.array(
    z.object({
      text: NonBlankStringSchema,
      eventIds: z.array(NonBlankStringSchema),
      findingIds: z.array(NonBlankStringSchema),
    }).strict(),
  ),
  limitations: z.array(
    z.object({
      text: NonBlankStringSchema,
      eventIds: z.array(NonBlankStringSchema),
    }).strict(),
  ),
}).strict();
export type GeneratedReceiptCopy = z.infer<typeof GeneratedReceiptCopySchema>;

// ─── Receipt-copy request/response boundaries ───────────────────────────────

export const ReceiptCopyRequestSchema = z
  .object({
    rawEventCount: z.number().int().positive().safe(),
    events: z.array(CanonicalEventSchema).min(1),
    accounting: z.array(RawEventAccountingSchema).min(1),
    authority: AuthorityEnvelopeV1Schema,
    traceCompletionStatus: z.enum([
      "succeeded",
      "failed",
      "cancelled",
      "unknown",
    ]),
  })
  .strict()
  .superRefine(({ rawEventCount, events, accounting }, context) => {
    if (accounting.length !== rawEventCount) {
      context.addIssue({
        code: "custom",
        path: ["rawEventCount"],
        message: "rawEventCount must equal the number of accounting records",
      });
    }

    const eventIds = new Set<string>();
    const eventsById = new Map<string, CanonicalEvent>();
    events.forEach((event, index) => {
      if (eventIds.has(event.eventId)) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "eventId"],
          message: `Duplicate canonical eventId "${event.eventId}"`,
        });
      }
      eventIds.add(event.eventId);
      eventsById.set(event.eventId, event);
    });

    const rawPointers = new Set<string>();
    const accountingCounts = new Map<string, number>();
    accounting.forEach((entry, index) => {
      if (rawPointers.has(entry.rawPointer)) {
        context.addIssue({
          code: "custom",
          path: ["accounting", index, "rawPointer"],
          message: `Duplicate raw-event accounting pointer "${entry.rawPointer}"`,
        });
      }
      rawPointers.add(entry.rawPointer);

      if (entry.status === "mapped" && entry.canonicalEventIds.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["accounting", index, "canonicalEventIds"],
          message: "Mapped accounting records must reference a canonical event",
        });
      }
      if (
        entry.status !== "mapped" &&
        entry.canonicalEventIds.length > 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["accounting", index, "canonicalEventIds"],
          message:
            "Metadata-only and unparsed accounting records cannot reference canonical events",
        });
      }
      if (entry.status !== "mapped" && !entry.reason) {
        context.addIssue({
          code: "custom",
          path: ["accounting", index, "reason"],
          message:
            "Metadata-only and unparsed accounting records require a reason",
        });
      }

      entry.canonicalEventIds.forEach((eventId) => {
        if (!eventIds.has(eventId)) {
          context.addIssue({
            code: "custom",
            path: ["accounting", index, "canonicalEventIds"],
            message: `Accounting references unknown canonical eventId "${eventId}"`,
          });
        }
        accountingCounts.set(
          eventId,
          (accountingCounts.get(eventId) ?? 0) + 1,
        );
        const event = eventsById.get(eventId);
        if (event && event.rawPointer !== entry.rawPointer) {
          context.addIssue({
            code: "custom",
            path: ["accounting", index, "rawPointer"],
            message: `Accounting rawPointer does not match canonical eventId "${eventId}"`,
          });
        }
        if (event && event.sourceEventId !== entry.sourceEventId) {
          context.addIssue({
            code: "custom",
            path: ["accounting", index, "sourceEventId"],
            message: `Accounting sourceEventId does not match canonical eventId "${eventId}"`,
          });
        }
      });
    });

    events.forEach((event, index) => {
      if (accountingCounts.get(event.eventId) !== 1) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "eventId"],
          message: `Canonical eventId "${event.eventId}" must appear in exactly one accounting record`,
        });
      }
    });
  });
export type ReceiptCopyRequest = z.infer<typeof ReceiptCopyRequestSchema>;

export const ReceiptCopyGenerationResultSchema = z.discriminatedUnion(
  "generationSource",
  [
    z
      .object({
        generationSource: z.literal("granite"),
        copy: GeneratedReceiptCopySchema,
        modelId: NonBlankStringSchema,
        modelApiVersion: NonBlankStringSchema,
      })
      .strict(),
    z
      .object({
        generationSource: z.literal("deterministic_fallback"),
        copy: GeneratedReceiptCopySchema,
      })
      .strict(),
  ],
);
export type ReceiptCopyGenerationResult = z.infer<
  typeof ReceiptCopyGenerationResultSchema
>;

// ─── Complete receipt/export contract ───────────────────────────────────────

export const ReceiptExportSchema = z
  .object({
    schemaVersion: z.literal(RECEIPT_SCHEMA_VERSION),
    run: ReceiptRunSchema,
    authority: AuthorityEnvelopeV1Schema,
    verdict: VerdictSchema,
    verdictLabel: NonBlankStringSchema,
    verdictQualifier: z.string().refine(
      (value) => value.endsWith(VERDICT_QUALIFIER),
      { message: `verdictQualifier must end with "${VERDICT_QUALIFIER}"` },
    ),
    findings: z.array(FindingSchema),
    events: z.array(CanonicalEventSchema),
    accounting: z.array(RawEventAccountingSchema),
    warnings: z.array(ParseWarningSchema),
    coverage: CoverageSummarySchema,
    copy: GeneratedReceiptCopySchema,
    reviewerDisposition: ReviewDispositionSchema,
    integrity: IntegrityMetadataSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    if (receipt.verdictLabel !== VERDICT_LABELS[receipt.verdict]) {
      context.addIssue({
        code: "custom",
        path: ["verdictLabel"],
        message: "verdictLabel must match the deterministic verdict code",
      });
    }
    if (
      receipt.verdictQualifier !==
      `${VERDICT_LABELS[receipt.verdict]}. ${VERDICT_QUALIFIER}`
    ) {
      context.addIssue({
        code: "custom",
        path: ["verdictQualifier"],
        message: "verdictQualifier must match the deterministic verdict code",
      });
    }
    if (receipt.integrity.policyId !== receipt.authority.policyId) {
      context.addIssue({
        code: "custom",
        path: ["integrity", "policyId"],
        message: "Integrity policyId must match the authority envelope",
      });
    }
    const inputContractMatches =
      (receipt.integrity.inputFormat === NATIVE_TRACE_SCHEMA_VERSION &&
        receipt.integrity.schemaVersion === NATIVE_TRACE_SCHEMA_VERSION) ||
      (receipt.integrity.inputFormat === "otlp-json-resource-spans.v1" &&
        receipt.integrity.schemaVersion ===
          "opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest") ||
      (receipt.integrity.inputFormat === "generic-json-records.v1" &&
        receipt.integrity.schemaVersion === "unversioned-json" &&
        receipt.integrity.genericJsonMapping !== undefined);
    if (!inputContractMatches) {
      context.addIssue({
        code: "custom",
        path: ["integrity", "schemaVersion"],
        message: "Input schemaVersion must match the selected adapter format",
      });
    }

    const expectedCoverage = {
      accountedRawEvents: receipt.accounting.length,
      mapped: receipt.accounting.filter((entry) => entry.status === "mapped")
        .length,
      metadataOnly: receipt.accounting.filter(
        (entry) => entry.status === "metadata-only",
      ).length,
      unparsed: receipt.accounting.filter(
        (entry) => entry.status === "unparsed",
      ).length,
      canonicalEvents: receipt.events.length,
    };
    for (const [key, expected] of Object.entries(expectedCoverage)) {
      const coverageKey = key as keyof typeof expectedCoverage;
      if (receipt.coverage[coverageKey] !== expected) {
        context.addIssue({
          code: "custom",
          path: ["coverage", coverageKey],
          message: `Coverage value must equal ${expected}`,
        });
      }
    }
    if (receipt.coverage.rawEvents !== receipt.accounting.length) {
      context.addIssue({
        code: "custom",
        path: ["coverage", "rawEvents"],
        message: "Every raw event must have exactly one accounting record",
      });
    }

    const eventIds = new Set<string>();
    const eventsById = new Map<string, CanonicalEvent>();
    receipt.events.forEach((event, index) => {
      if (eventIds.has(event.eventId)) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "eventId"],
          message: `Duplicate canonical eventId "${event.eventId}"`,
        });
      }
      eventIds.add(event.eventId);
      eventsById.set(event.eventId, event);
      if (event.traceId !== receipt.run.traceId) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "traceId"],
          message: "Canonical event traceId must match receipt run traceId",
        });
      }
    });

    const findingIds = new Set<string>();
    receipt.findings.forEach((finding, findingIndex) => {
      if (findingIds.has(finding.findingId)) {
        context.addIssue({
          code: "custom",
          path: ["findings", findingIndex, "findingId"],
          message: `Duplicate findingId "${finding.findingId}"`,
        });
      }
      findingIds.add(finding.findingId);
      finding.eventIds.forEach((eventId) => {
        if (!eventIds.has(eventId)) {
          context.addIssue({
            code: "custom",
            path: ["findings", findingIndex, "eventIds"],
            message: `Finding references unknown canonical eventId "${eventId}"`,
          });
        }
      });
    });

    const rawPointers = new Set<string>();
    const accountedEventCounts = new Map<string, number>();
    receipt.accounting.forEach((entry, accountingIndex) => {
      if (rawPointers.has(entry.rawPointer)) {
        context.addIssue({
          code: "custom",
          path: ["accounting", accountingIndex, "rawPointer"],
          message: `Duplicate accounting rawPointer "${entry.rawPointer}"`,
        });
      }
      rawPointers.add(entry.rawPointer);

      if (entry.status === "mapped" && entry.canonicalEventIds.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["accounting", accountingIndex, "canonicalEventIds"],
          message: "Mapped accounting records must reference a canonical event",
        });
      }
      if (
        entry.status !== "mapped" &&
        entry.canonicalEventIds.length > 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["accounting", accountingIndex, "canonicalEventIds"],
          message:
            "Metadata-only and unparsed accounting records cannot reference canonical events",
        });
      }
      if (entry.status !== "mapped" && !entry.reason) {
        context.addIssue({
          code: "custom",
          path: ["accounting", accountingIndex, "reason"],
          message:
            "Metadata-only and unparsed accounting records require a reason",
        });
      }

      entry.canonicalEventIds.forEach((eventId) => {
        if (!eventIds.has(eventId)) {
          context.addIssue({
            code: "custom",
            path: ["accounting", accountingIndex, "canonicalEventIds"],
            message: `Accounting references unknown eventId "${eventId}"`,
          });
        }
        accountedEventCounts.set(
          eventId,
          (accountedEventCounts.get(eventId) ?? 0) + 1,
        );
        const event = eventsById.get(eventId);
        if (event && event.rawPointer !== entry.rawPointer) {
          context.addIssue({
            code: "custom",
            path: ["accounting", accountingIndex, "rawPointer"],
            message: `Accounting rawPointer does not match canonical eventId "${eventId}"`,
          });
        }
        if (event && event.sourceEventId !== entry.sourceEventId) {
          context.addIssue({
            code: "custom",
            path: ["accounting", accountingIndex, "sourceEventId"],
            message: `Accounting sourceEventId does not match canonical eventId "${eventId}"`,
          });
        }
      });
    });
    receipt.events.forEach((event, eventIndex) => {
      if (accountedEventCounts.get(event.eventId) !== 1) {
        context.addIssue({
          code: "custom",
          path: ["events", eventIndex, "eventId"],
          message: `Canonical eventId "${event.eventId}" must appear in exactly one accounting record`,
        });
      }
    });

    const checkEventIds = (ids: string[], path: (string | number)[]) => {
      ids.forEach((eventId) => {
        if (!eventIds.has(eventId)) {
          context.addIssue({
            code: "custom",
            path,
            message: `Copy references unknown canonical eventId "${eventId}"`,
          });
        }
      });
    };
    const checkFindingIds = (ids: string[], path: (string | number)[]) => {
      ids.forEach((findingId) => {
        if (!findingIds.has(findingId)) {
          context.addIssue({
            code: "custom",
            path,
            message: `Copy references unknown findingId "${findingId}"`,
          });
        }
      });
    };
    const checkFindingEventRelationships = (
      citedEventIds: string[],
      citedFindingIds: string[],
      path: (string | number)[],
    ) => {
      if (citedEventIds.length === 0 || citedFindingIds.length === 0) return;
      const citedEvents = new Set(citedEventIds);
      const citedFindings = receipt.findings.filter((finding) =>
        citedFindingIds.includes(finding.findingId),
      );

      for (const finding of citedFindings) {
        if (!finding.eventIds.some((eventId) => citedEvents.has(eventId))) {
          context.addIssue({
            code: "custom",
            path,
            message: `Finding "${finding.findingId}" is unrelated to cited events`,
          });
        }
      }
      for (const eventId of citedEvents) {
        if (
          !citedFindings.some((finding) =>
            finding.eventIds.includes(eventId),
          )
        ) {
          context.addIssue({
            code: "custom",
            path,
            message: `Event "${eventId}" is unrelated to cited findings`,
          });
        }
      }
    };

    if (
      receipt.copy.headline.eventIds.length === 0 &&
      receipt.copy.headline.findingIds.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["copy", "headline"],
        message: "Headline must cite at least one event or finding",
      });
    }
    if (receipt.copy.outcome.eventIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["copy", "outcome", "eventIds"],
        message: "Outcome must cite at least one event",
      });
    }

    checkEventIds(receipt.copy.headline.eventIds, [
      "copy",
      "headline",
      "eventIds",
    ]);
    checkFindingIds(receipt.copy.headline.findingIds, [
      "copy",
      "headline",
      "findingIds",
    ]);
    checkFindingEventRelationships(
      receipt.copy.headline.eventIds,
      receipt.copy.headline.findingIds,
      ["copy", "headline"],
    );
    checkEventIds(receipt.copy.outcome.eventIds, [
      "copy",
      "outcome",
      "eventIds",
    ]);
    receipt.copy.notableActions.forEach((action, index) => {
      if (action.eventIds.length === 0 && action.findingIds.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["copy", "notableActions", index],
          message: "Notable actions must cite at least one event or finding",
        });
      }
      checkEventIds(action.eventIds, [
        "copy",
        "notableActions",
        index,
        "eventIds",
      ]);
      checkFindingIds(action.findingIds, [
        "copy",
        "notableActions",
        index,
        "findingIds",
      ]);
      checkFindingEventRelationships(
        action.eventIds,
        action.findingIds,
        ["copy", "notableActions", index],
      );
    });
    receipt.copy.limitations.forEach((limitation, index) => {
      checkEventIds(limitation.eventIds, [
        "copy",
        "limitations",
        index,
        "eventIds",
      ]);
    });
  });

export const ReceiptResultSchema = ReceiptExportSchema;
export type ReceiptResult = z.infer<typeof ReceiptResultSchema>;
