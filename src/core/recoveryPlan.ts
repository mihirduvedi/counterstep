import { z } from "zod";

import { sha256HexPortable } from "./portableDigest";
import { serializeReceipt } from "./receipt";
import {
  AuthorityEnvelopeV1Schema,
  CanonicalEventSchema,
  FindingSchema,
  NonBlankStringSchema,
  RECEIPT_SCHEMA_VERSION,
  ReceiptResultSchema,
  ReviewDispositionSchema,
  Rfc3339Schema,
  VerdictSchema,
} from "./schemas/index";
import type { ReceiptResult } from "./schemas/index";

export const RECOVERY_PLAN_SCHEMA_VERSION =
  "agent-receipt.recovery-plan.v1" as const;

export const RECOVERY_PLAN_QUALIFIER =
  "Based only on the supplied trace and authority envelope. Proposed actions are not approvals, executions, or proof of current external state." as const;

const EventStatusSchema = z.enum([
  "started",
  "succeeded",
  "failed",
  "cancelled",
  "unknown",
]);

const UniqueStringsSchema = z
  .array(NonBlankStringSchema)
  .refine((values) => new Set(values).size === values.length, {
    message: "Values must be unique.",
  });

export const RecoveryIncidentSchema = z
  .object({
    incidentId: NonBlankStringSchema,
    title: NonBlankStringSchema,
    summary: NonBlankStringSchema,
    severity: z.enum(["low", "medium", "high"]),
    eventIds: UniqueStringsSchema,
    findingIds: UniqueStringsSchema.min(1),
    findingCount: z.number().int().positive().safe(),
    statuses: z.array(EventStatusSchema),
    systems: UniqueStringsSchema,
    dataCategories: UniqueStringsSchema,
  })
  .strict()
  .superRefine((incident, context) => {
    if (incident.findingCount !== incident.findingIds.length) {
      context.addIssue({
        code: "custom",
        path: ["findingCount"],
        message: "findingCount must equal the number of cited findings.",
      });
    }
  });
export type RecoveryIncident = z.infer<typeof RecoveryIncidentSchema>;

export const RecoveryActionSchema = z
  .object({
    actionId: NonBlankStringSchema,
    incidentId: NonBlankStringSchema,
    title: NonBlankStringSchema,
    description: NonBlankStringSchema,
    eventIds: UniqueStringsSchema,
    findingIds: UniqueStringsSchema.min(1),
    authorityRequired: NonBlankStringSchema,
    reversibility: NonBlankStringSchema,
    status: z.literal("proposed"),
  })
  .strict();
export type RecoveryAction = z.infer<typeof RecoveryActionSchema>;

export const RecoveryPlanExportSchema = z
  .object({
    schemaVersion: z.literal(RECOVERY_PLAN_SCHEMA_VERSION),
    qualifier: z.literal(RECOVERY_PLAN_QUALIFIER),
    sourceReceipt: z
      .object({
        schemaVersion: z.literal(RECEIPT_SCHEMA_VERSION),
        digestAlgorithm: z.literal("SHA-256"),
        receiptDigest: z.string().regex(/^[0-9a-f]{64}$/),
        traceId: NonBlankStringSchema,
        inputSha256: z.string().regex(/^[0-9a-f]{64}$/),
        policyId: NonBlankStringSchema,
        verdict: VerdictSchema,
        reviewerDisposition: ReviewDispositionSchema,
        generatedAt: Rfc3339Schema,
      })
      .strict(),
    authority: AuthorityEnvelopeV1Schema,
    executionBoundary: z
      .object({
        status: z.literal("not_executed"),
        currentExternalState: z.literal("unknown"),
        executionAuthority: z.literal("not_granted"),
        approval: z.literal("required"),
        note: z.literal(
          "Re-probe current state, verify rollback and idempotency, and obtain approval for an exact change before any external action.",
        ),
      })
      .strict(),
    incidents: z.array(RecoveryIncidentSchema),
    actions: z.array(RecoveryActionSchema),
    evidence: z
      .object({
        events: z.array(CanonicalEventSchema),
        findings: z.array(FindingSchema),
      })
      .strict(),
  })
  .strict()
  .superRefine((plan, context) => {
    if (plan.sourceReceipt.policyId !== plan.authority.policyId) {
      context.addIssue({
        code: "custom",
        path: ["sourceReceipt", "policyId"],
        message: "Source receipt policyId must match the authority envelope.",
      });
    }

    const eventsById = uniqueIndex(
      plan.evidence.events,
      (event) => event.eventId,
      ["evidence", "events"],
      context,
    );
    const findingsById = uniqueIndex(
      plan.evidence.findings,
      (finding) => finding.findingId,
      ["evidence", "findings"],
      context,
    );
    const incidentsById = uniqueIndex(
      plan.incidents,
      (incident) => incident.incidentId,
      ["incidents"],
      context,
    );
    uniqueIndex(
      plan.actions,
      (action) => action.actionId,
      ["actions"],
      context,
    );

    plan.evidence.events.forEach((event, index) => {
      if (event.traceId !== plan.sourceReceipt.traceId) {
        context.addIssue({
          code: "custom",
          path: ["evidence", "events", index, "traceId"],
          message: "Evidence event traceId must match the source receipt.",
        });
      }
    });

    plan.evidence.findings.forEach((finding, index) => {
      for (const eventId of finding.eventIds) {
        if (!eventsById.has(eventId)) {
          context.addIssue({
            code: "custom",
            path: ["evidence", "findings", index, "eventIds"],
            message: `Finding references unavailable evidence event "${eventId}".`,
          });
        }
      }
    });

    plan.incidents.forEach((incident, index) => {
      validateCitations(
        incident.eventIds,
        incident.findingIds,
        eventsById,
        findingsById,
        ["incidents", index],
        context,
      );
    });

    plan.actions.forEach((action, index) => {
      const incident = incidentsById.get(action.incidentId);
      if (!incident) {
        context.addIssue({
          code: "custom",
          path: ["actions", index, "incidentId"],
          message: `Action references unknown incident "${action.incidentId}".`,
        });
      } else {
        const incidentEvents = new Set(incident.eventIds);
        const incidentFindings = new Set(incident.findingIds);
        if (action.eventIds.some((eventId) => !incidentEvents.has(eventId))) {
          context.addIssue({
            code: "custom",
            path: ["actions", index, "eventIds"],
            message: "Action event citations must belong to its incident.",
          });
        }
        if (
          action.findingIds.some(
            (findingId) => !incidentFindings.has(findingId),
          )
        ) {
          context.addIssue({
            code: "custom",
            path: ["actions", index, "findingIds"],
            message: "Action finding citations must belong to its incident.",
          });
        }
      }
      validateCitations(
        action.eventIds,
        action.findingIds,
        eventsById,
        findingsById,
        ["actions", index],
        context,
      );
    });

    const citedEventIds = new Set(
      plan.incidents.flatMap((incident) => incident.eventIds),
    );
    const citedFindingIds = new Set(
      plan.incidents.flatMap((incident) => incident.findingIds),
    );
    for (const eventId of eventsById.keys()) {
      if (!citedEventIds.has(eventId)) {
        context.addIssue({
          code: "custom",
          path: ["evidence", "events"],
          message: `Evidence event "${eventId}" is not cited by an incident.`,
        });
      }
    }
    for (const findingId of findingsById.keys()) {
      if (!citedFindingIds.has(findingId)) {
        context.addIssue({
          code: "custom",
          path: ["evidence", "findings"],
          message: `Evidence finding "${findingId}" is not cited by an incident.`,
        });
      }
    }
  });
export type RecoveryPlanExport = z.infer<typeof RecoveryPlanExportSchema>;

export type BuildRecoveryPlanExportInput = {
  receipt: ReceiptResult;
  incidents: RecoveryIncident[];
  actions: RecoveryAction[];
};

/**
 * Build a standalone, citation-closed recovery proposal bound to the exact
 * validated receipt export. The plan intentionally contains no execution
 * credential, mutation handler, or assertion about current external state.
 */
export async function buildRecoveryPlanExport(
  input: BuildRecoveryPlanExportInput,
): Promise<RecoveryPlanExport> {
  const receipt = ReceiptResultSchema.parse(input.receipt);
  const incidents = input.incidents.map((incident) =>
    RecoveryIncidentSchema.parse(incident),
  );
  const actions = input.actions.map((action) =>
    RecoveryActionSchema.parse(action),
  );
  const serializedReceipt = serializeReceipt(receipt);
  const receiptDigest = await sha256HexPortable(
    new TextEncoder().encode(serializedReceipt),
  );
  const eventIds = new Set(
    incidents.flatMap((incident) => incident.eventIds),
  );
  const findingIds = new Set(
    incidents.flatMap((incident) => incident.findingIds),
  );

  return RecoveryPlanExportSchema.parse({
    schemaVersion: RECOVERY_PLAN_SCHEMA_VERSION,
    qualifier: RECOVERY_PLAN_QUALIFIER,
    sourceReceipt: {
      schemaVersion: receipt.schemaVersion,
      digestAlgorithm: "SHA-256",
      receiptDigest,
      traceId: receipt.run.traceId,
      inputSha256: receipt.integrity.sha256,
      policyId: receipt.authority.policyId,
      verdict: receipt.verdict,
      reviewerDisposition: receipt.reviewerDisposition,
      generatedAt: receipt.integrity.generatedAt,
    },
    authority: receipt.authority,
    executionBoundary: {
      status: "not_executed",
      currentExternalState: "unknown",
      executionAuthority: "not_granted",
      approval: "required",
      note: "Re-probe current state, verify rollback and idempotency, and obtain approval for an exact change before any external action.",
    },
    incidents,
    actions,
    evidence: {
      events: receipt.events.filter((event) => eventIds.has(event.eventId)),
      findings: receipt.findings.filter((finding) =>
        findingIds.has(finding.findingId),
      ),
    },
  });
}

export async function serializeRecoveryPlan(
  input: BuildRecoveryPlanExportInput,
): Promise<string> {
  const plan = await buildRecoveryPlanExport(input);
  return JSON.stringify(plan, null, 2);
}

function uniqueIndex<T>(
  values: T[],
  id: (value: T) => string,
  path: (string | number)[],
  context: z.RefinementCtx,
): Map<string, T> {
  const index = new Map<string, T>();
  values.forEach((value, valueIndex) => {
    const valueId = id(value);
    if (index.has(valueId)) {
      context.addIssue({
        code: "custom",
        path: [...path, valueIndex],
        message: `Duplicate ID "${valueId}".`,
      });
    }
    index.set(valueId, value);
  });
  return index;
}

function validateCitations(
  eventIds: string[],
  findingIds: string[],
  eventsById: Map<string, unknown>,
  findingsById: Map<string, z.infer<typeof FindingSchema>>,
  path: (string | number)[],
  context: z.RefinementCtx,
): void {
  if (eventIds.length === 0 && findingIds.length === 0) {
    context.addIssue({
      code: "custom",
      path,
      message: "Recovery items must cite at least one event or finding.",
    });
  }
  for (const eventId of eventIds) {
    if (!eventsById.has(eventId)) {
      context.addIssue({
        code: "custom",
        path: [...path, "eventIds"],
        message: `Unknown evidence event "${eventId}".`,
      });
    }
  }
  for (const findingId of findingIds) {
    if (!findingsById.has(findingId)) {
      context.addIssue({
        code: "custom",
        path: [...path, "findingIds"],
        message: `Unknown evidence finding "${findingId}".`,
      });
    }
  }

  const relatedEventIds = new Set(
    findingIds.flatMap(
      (findingId) => findingsById.get(findingId)?.eventIds ?? [],
    ),
  );
  if (
    eventIds.length > 0 &&
    findingIds.length > 0 &&
    eventIds.some((eventId) => !relatedEventIds.has(eventId))
  ) {
    context.addIssue({
      code: "custom",
      path,
      message: "Event and finding citations must describe the same evidence.",
    });
  }
}
