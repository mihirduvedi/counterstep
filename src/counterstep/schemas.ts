import { z } from "zod";

import { Rfc3339Schema } from "../core/schemas/index";

export const COUNTERSTEP_RESOURCE_SCHEMA_VERSION =
  "counterstep.resource.v1" as const;
export const COUNTERSTEP_AUTHORITY_SCHEMA_VERSION =
  "counterstep.authority.v1" as const;
export const COUNTERSTEP_PLAN_SCHEMA_VERSION =
  "counterstep.recovery-plan.v1" as const;
export const COUNTERSTEP_RUN_SCHEMA_VERSION =
  "counterstep.remediation-run.v1" as const;
export const COUNTERSTEP_EVENT_SCHEMA_VERSION =
  "counterstep.action-event.v1" as const;
export const COUNTERSTEP_CLOSURE_SCHEMA_VERSION =
  "counterstep.closure-receipt.v1" as const;
export const COUNTERSTEP_DAILY_RUN_COUNTER_SCHEMA_VERSION =
  "counterstep.daily-run-counter.v1" as const;

export const CLOSURE_QUALIFIER =
  "Based on the supplied original trace, remediation authority, recorded tool results, and final sandbox snapshots." as const;

const StrictIdSchema = z
  .string()
  .min(3)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const NonNegativeIntegerSchema = z.number().int().nonnegative();
const PositiveIntegerSchema = z.number().int().positive();
const DataCategoriesSchema = z.array(z.string().min(1).max(80)).max(20);
const UtcDateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const RunExecutionAdmissionSchema = z
  .object({
    dateKey: UtcDateKeySchema,
    maxRuns: PositiveIntegerSchema.max(10_000),
    timestamp: Rfc3339Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (new Date(value.timestamp).toISOString().slice(0, 10) !== value.dateKey) {
      context.addIssue({
        code: "custom",
        path: ["dateKey"],
        message: "Daily execution admission must use the timestamp's UTC date.",
      });
    }
  });
export type RunExecutionAdmission = z.infer<
  typeof RunExecutionAdmissionSchema
>;

export const DailyRunCounterSchema = z
  .object({
    schemaVersion: z.literal(COUNTERSTEP_DAILY_RUN_COUNTER_SCHEMA_VERSION),
    dateKey: UtcDateKeySchema,
    count: NonNegativeIntegerSchema,
    configuredLimit: PositiveIntegerSchema.max(10_000),
    updatedAt: Rfc3339Schema,
  })
  .strict();
export type DailyRunCounter = z.infer<typeof DailyRunCounterSchema>;

const ResourceBaseSchema = z.object({
  schemaVersion: z.literal(COUNTERSTEP_RESOURCE_SCHEMA_VERSION),
  demoId: StrictIdSchema,
  resourceId: StrictIdSchema,
  version: NonNegativeIntegerSchema,
  boundary: z.literal("external"),
  dataCategories: DataCategoriesSchema,
  updatedAt: Rfc3339Schema,
});

export const SpreadsheetResourceSchema = ResourceBaseSchema.extend({
  kind: z.literal("spreadsheet"),
  accessState: z.enum(["externally_shared", "revoked"]),
  recordCount: NonNegativeIntegerSchema,
  sourceActionKey: StrictIdSchema,
}).strict();

export const QueuedMessageResourceSchema = ResourceBaseSchema.extend({
  kind: z.literal("queued_message"),
  deliveryState: z.enum(["queued", "cancelled", "delivered"]),
  recipientCount: NonNegativeIntegerSchema,
  approvalRef: StrictIdSchema.optional(),
}).strict();

export const SandboxResourceSchema = z.discriminatedUnion("kind", [
  SpreadsheetResourceSchema,
  QueuedMessageResourceSchema,
]);
export type SandboxResource = z.infer<typeof SandboxResourceSchema>;
export type SpreadsheetResource = z.infer<typeof SpreadsheetResourceSchema>;
export type QueuedMessageResource = z.infer<
  typeof QueuedMessageResourceSchema
>;

export const IncidentSchema = z
  .object({
    incidentId: StrictIdSchema,
    resourceId: StrictIdSchema,
    title: z.string().min(1).max(140),
    summary: z.string().min(1).max(500),
    findingIds: z.array(StrictIdSchema).min(1).max(20),
    eventIds: z.array(StrictIdSchema).min(1).max(20),
    repairability: z.enum(["reversible_if_current", "unknown"]),
  })
  .strict();
export type Incident = z.infer<typeof IncidentSchema>;

const SpreadsheetClosurePredicateSchema = z
  .object({
    kind: z.literal("spreadsheet_access_is"),
    expected: z.literal("revoked"),
  })
  .strict();
const MessageClosurePredicateSchema = z
  .object({
    kind: z.literal("message_delivery_is"),
    expected: z.literal("cancelled"),
  })
  .strict();

export const ClosureGoalSchema = z
  .object({
    goalId: StrictIdSchema,
    incidentIds: z.array(StrictIdSchema).min(1).max(5),
    findingIds: z.array(StrictIdSchema).min(1).max(20),
    eventIds: z.array(StrictIdSchema).min(1).max(20),
    resourceId: StrictIdSchema,
    predicate: z.discriminatedUnion("kind", [
      SpreadsheetClosurePredicateSchema,
      MessageClosurePredicateSchema,
    ]),
  })
  .strict();
export type ClosureGoal = z.infer<typeof ClosureGoalSchema>;

export const PermittedActionSchema = z
  .object({
    incidentId: StrictIdSchema,
    tool: z.enum(["revoke_external_access", "cancel_queued_delivery"]),
    resourceId: StrictIdSchema,
    fromState: z.enum(["externally_shared", "queued"]),
    toState: z.enum(["revoked", "cancelled"]),
    maxUses: z.literal(1),
  })
  .strict()
  .superRefine((value, context) => {
    const validSpreadsheet =
      value.tool === "revoke_external_access" &&
      value.fromState === "externally_shared" &&
      value.toState === "revoked";
    const validMessage =
      value.tool === "cancel_queued_delivery" &&
      value.fromState === "queued" &&
      value.toState === "cancelled";
    if (!validSpreadsheet && !validMessage) {
      context.addIssue({
        code: "custom",
        message: "Tool and transition do not form a supported action.",
      });
    }
  });
export type PermittedAction = z.infer<typeof PermittedActionSchema>;

export const RemediationAuthoritySchema = z
  .object({
    schemaVersion: z.literal(COUNTERSTEP_AUTHORITY_SCHEMA_VERSION),
    authorityId: StrictIdSchema,
    runId: StrictIdSchema,
    sourceReceiptDigest: DigestSchema,
    issuedAt: Rfc3339Schema,
    expiresAt: Rfc3339Schema,
    permittedActions: z.array(PermittedActionSchema).min(1).max(4),
    readResourceIds: z.array(StrictIdSchema).min(1).max(8),
    maxToolCalls: z.number().int().min(1).max(20),
    maxWrites: z.number().int().min(0).max(4),
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Authority expiration must be after issuance.",
      });
    }
    const actionKeys = value.permittedActions.map(
      (action) => `${action.tool}:${action.resourceId}`,
    );
    if (new Set(actionKeys).size !== actionKeys.length) {
      context.addIssue({
        code: "custom",
        path: ["permittedActions"],
        message: "Permitted tool/resource pairs must be unique.",
      });
    }
    if (new Set(value.readResourceIds).size !== value.readResourceIds.length) {
      context.addIssue({
        code: "custom",
        path: ["readResourceIds"],
        message: "Read resource IDs must be unique.",
      });
    }
  });
export type RemediationAuthority = z.infer<
  typeof RemediationAuthoritySchema
>;

const RecoveryCitationSchema = z
  .object({
    incidentIds: z.array(StrictIdSchema).min(1).max(5),
    findingIds: z.array(StrictIdSchema).min(1).max(20),
    eventIds: z.array(StrictIdSchema).min(1).max(20),
  })
  .strict();

export const ConsequentialPlanStepSchema = RecoveryCitationSchema.extend({
  stepId: StrictIdSchema,
  tool: z.enum(["revoke_external_access", "cancel_queued_delivery"]),
  resourceId: StrictIdSchema,
  expectedVersion: NonNegativeIntegerSchema,
  intendedPostcondition: z.string().min(1).max(240),
}).strict();

export const VerifyPlanStepSchema = z
  .object({
    stepId: StrictIdSchema,
    tool: z.literal("verify_closure"),
    incidentIds: z.array(StrictIdSchema).min(1).max(8),
    findingIds: z.array(StrictIdSchema).min(1).max(30),
    eventIds: z.array(StrictIdSchema).min(1).max(30),
    intendedPostcondition: z.string().min(1).max(240),
  })
  .strict();

export const RecoveryPlanStepSchema = z.discriminatedUnion("tool", [
  ConsequentialPlanStepSchema,
  VerifyPlanStepSchema,
]);
export type RecoveryPlanStep = z.infer<typeof RecoveryPlanStepSchema>;

function validateRecoveryPlanSteps(
  value: { steps: RecoveryPlanStep[] },
  context: z.RefinementCtx,
) {
  const stepIds = value.steps.map((step) => step.stepId);
  if (new Set(stepIds).size !== stepIds.length) {
    context.addIssue({
      code: "custom",
      path: ["steps"],
      message: "Plan step IDs must be unique.",
    });
  }
  if (value.steps.at(-1)?.tool !== "verify_closure") {
    context.addIssue({
      code: "custom",
      path: ["steps"],
      message: "The final plan step must verify closure.",
    });
  }
  const writeCount = value.steps.filter(
    (step) => step.tool !== "verify_closure",
  ).length;
  if (writeCount > 2) {
    context.addIssue({
      code: "custom",
      path: ["steps"],
      message: "A plan can contain at most two consequential steps.",
    });
  }
}

const RecoveryPlanModelFields = {
  schemaVersion: z.literal(COUNTERSTEP_PLAN_SCHEMA_VERSION),
  planId: StrictIdSchema,
  sourceReceiptDigest: DigestSchema,
  rationaleSummary: z.string().min(1).max(400),
  steps: z.array(RecoveryPlanStepSchema).min(1).max(5),
} as const;

export const RecoveryPlanToolInputSchema = z
  .object(RecoveryPlanModelFields)
  .strict()
  .superRefine(validateRecoveryPlanSteps);

export const RecoveryPlanSchema = z
  .object({
    ...RecoveryPlanModelFields,
    runId: StrictIdSchema,
  })
  .strict()
  .superRefine(validateRecoveryPlanSteps);
export type RecoveryPlan = z.infer<typeof RecoveryPlanSchema>;

export const PlanRejectionCodeSchema = z.enum([
  "receipt_mismatch",
  "unknown_incident",
  "unknown_finding",
  "unknown_event",
  "citation_mismatch",
  "resource_not_inspected",
  "resource_not_authorized",
  "tool_not_authorized",
  "transition_not_authorized",
  "stale_plan_version",
  "step_limit_exceeded",
  "write_limit_exceeded",
  "missing_final_verification",
  "invalid_plan_contract",
  "run_not_active",
  "authority_expired",
  "replacement_plan_not_allowed",
]);
export type PlanRejectionCode = z.infer<typeof PlanRejectionCodeSchema>;

export const PlanDecisionSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("approved"),
      plan: RecoveryPlanSchema,
      approvedStepIds: z.array(StrictIdSchema).min(1).max(5),
      decidedAt: Rfc3339Schema,
    })
    .strict(),
  z
    .object({
      status: z.literal("rejected"),
      plan: RecoveryPlanSchema.optional(),
      reasonCodes: z.array(PlanRejectionCodeSchema).min(1).max(20),
      detail: z.string().min(1).max(500),
      decidedAt: Rfc3339Schema,
    })
    .strict(),
]);
export type PlanDecision = z.infer<typeof PlanDecisionSchema>;

export const InspectionRecordSchema = z
  .object({
    runId: StrictIdSchema,
    resourceId: StrictIdSchema,
    snapshot: SandboxResourceSchema,
    stateDigest: DigestSchema,
    inspectedAt: Rfc3339Schema,
    eventId: StrictIdSchema,
  })
  .strict();
export type InspectionRecord = z.infer<typeof InspectionRecordSchema>;

export const RemediationRunStatusSchema = z.enum([
  "created",
  "inspecting",
  "planning",
  "authorizing",
  "executing",
  "verifying",
  "repaired",
  "partially_repaired",
  "blocked",
  "unable_to_verify",
  "failed",
]);
export type RemediationRunStatus = z.infer<
  typeof RemediationRunStatusSchema
>;

export const GenerationSourceSchema = z.enum([
  "gemini",
  "deterministic_fixture",
  "deterministic_no_execution",
]);
export type GenerationSource = z.infer<typeof GenerationSourceSchema>;

export const RemediationRunSchema = z
  .object({
    schemaVersion: z.literal(COUNTERSTEP_RUN_SCHEMA_VERSION),
    runId: StrictIdSchema,
    demoId: StrictIdSchema,
    sourceReceiptDigest: DigestSchema,
    status: RemediationRunStatusSchema,
    generationSource: GenerationSourceSchema,
    modelId: z.string().min(1).max(160).optional(),
    agentFramework: z.literal("google-adk-typescript"),
    authorityId: StrictIdSchema,
    closureGoals: z.array(ClosureGoalSchema).min(1).max(8),
    activePlanId: StrictIdSchema.optional(),
    toolCallCount: NonNegativeIntegerSchema,
    writeCount: NonNegativeIntegerSchema,
    replanCount: NonNegativeIntegerSchema,
    startedAt: Rfc3339Schema,
    completedAt: Rfc3339Schema.optional(),
    terminalReasonCode: StrictIdSchema.optional(),
  })
  .strict();
export type RemediationRun = z.infer<typeof RemediationRunSchema>;

export const ActionEventStatusSchema = z.enum([
  "started",
  "succeeded",
  "failed",
  "cancelled",
  "unknown",
]);

export const ActionEventSchema = z
  .object({
    schemaVersion: z.literal(COUNTERSTEP_EVENT_SCHEMA_VERSION),
    eventId: StrictIdSchema,
    runId: StrictIdSchema,
    sequence: PositiveIntegerSchema,
    timestamp: Rfc3339Schema,
    phase: RemediationRunStatusSchema,
    toolName: z.enum([
      "inspect_resource",
      "submit_recovery_plan",
      "revoke_external_access",
      "cancel_queued_delivery",
      "verify_closure",
      "system",
    ]),
    operation: z.enum(["read", "update", "approve", "execute"]),
    resourceId: StrictIdSchema.optional(),
    stateChange: z.boolean(),
    status: ActionEventStatusSchema,
    attempt: PositiveIntegerSchema,
    actionKey: StrictIdSchema,
    planId: StrictIdSchema.optional(),
    stepId: StrictIdSchema.optional(),
    beforeVersion: NonNegativeIntegerSchema.optional(),
    afterVersion: NonNegativeIntegerSchema.optional(),
    beforeDigest: DigestSchema.optional(),
    afterDigest: DigestSchema.optional(),
    resultCode: StrictIdSchema,
    detail: z.string().min(1).max(500),
    latencyMs: NonNegativeIntegerSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.stateChange) return;
    if (
      value.status !== "succeeded" ||
      value.beforeVersion === undefined ||
      value.afterVersion === undefined ||
      value.afterVersion !== value.beforeVersion + 1
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A state-changing event must be successful and increment version exactly once.",
      });
    }
  });
export type ActionEvent = z.infer<typeof ActionEventSchema>;

export const WriteResultCodeSchema = z.enum([
  "succeeded",
  "idempotent_replay",
  "already_safe",
  "stale_revision",
  "not_reversible",
  "resource_not_found",
  "run_not_active",
  "authority_expired",
  "receipt_mismatch",
  "plan_not_approved",
  "step_not_approved",
  "tool_not_authorized",
  "resource_not_authorized",
  "transition_not_authorized",
  "write_limit_exceeded",
]);
export type WriteResultCode = z.infer<typeof WriteResultCodeSchema>;

export const AtomicWriteResultSchema = z
  .object({
    resultCode: WriteResultCodeSchema,
    stateChanged: z.boolean(),
    before: SandboxResourceSchema.optional(),
    after: SandboxResourceSchema.optional(),
    event: ActionEventSchema.optional(),
    replayedEventId: StrictIdSchema.optional(),
  })
  .strict();
export type AtomicWriteResult = z.infer<typeof AtomicWriteResultSchema>;

export const GoalResultSchema = z
  .object({
    goal: ClosureGoalSchema,
    status: z.enum(["satisfied", "unsatisfied", "blocked", "unknown"]),
    beforeSnapshot: SandboxResourceSchema.optional(),
    afterSnapshot: SandboxResourceSchema.optional(),
    evidenceEventIds: z.array(StrictIdSchema).max(30),
    detail: z.string().min(1).max(500),
  })
  .strict();
export type GoalResult = z.infer<typeof GoalResultSchema>;

export const ActionReceiptSchema = z
  .object({
    schemaVersion: z.literal("counterstep.action-receipt.v1"),
    runId: StrictIdSchema,
    authorityId: StrictIdSchema,
    verdict: z.enum(["within_remediation_authority", "deviations_found"]),
    qualifier: z.literal(
      "Based on the recorded remediation events and declared remediation authority.",
    ),
    eventIds: z.array(StrictIdSchema).min(1),
    coverage: z
      .object({
        recordedEvents: NonNegativeIntegerSchema,
        accountedEvents: NonNegativeIntegerSchema,
        successfulWrites: NonNegativeIntegerSchema,
      })
      .strict(),
    violations: z.array(z.string().min(1).max(300)).max(20),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.coverage.recordedEvents !== value.coverage.accountedEvents ||
      (value.verdict === "within_remediation_authority" &&
        value.violations.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Action-receipt coverage and verdict are inconsistent.",
      });
    }
  });
export type ActionReceipt = z.infer<typeof ActionReceiptSchema>;

export const ClosureOutcomeSchema = z.enum([
  "repaired",
  "partially_repaired",
  "blocked",
  "unable_to_verify",
  "failed",
]);
export type ClosureOutcome = z.infer<typeof ClosureOutcomeSchema>;

export const ClosureReceiptSchema = z
  .object({
    schemaVersion: z.literal(COUNTERSTEP_CLOSURE_SCHEMA_VERSION),
    qualifier: z.literal(CLOSURE_QUALIFIER),
    source: z
      .object({
        originalReceiptSchemaVersion: z.literal("agent-receipt.receipt.v1"),
        originalReceiptDigest: DigestSchema,
        originalTraceId: StrictIdSchema,
        originalVerdict: z.literal("material_deviations_found"),
      })
      .strict(),
    remediation: z
      .object({
        runId: StrictIdSchema,
        authority: RemediationAuthoritySchema,
        approvedPlan: RecoveryPlanSchema,
        approvedPlans: z.array(RecoveryPlanSchema).min(1).max(2),
        actionReceipt: ActionReceiptSchema,
        eventIds: z.array(StrictIdSchema).min(1),
      })
      .strict(),
    goalResults: z.array(GoalResultSchema).min(1).max(8),
    outcome: ClosureOutcomeSchema,
    limitations: z.array(z.string().min(1).max(500)).max(20),
    integrity: z
      .object({
        digestAlgorithm: z.literal("SHA-256"),
        digest: DigestSchema,
        generatedAt: Rfc3339Schema,
        appVersion: z.string().min(1).max(80),
        modelId: z.string().min(1).max(160).optional(),
        agentFramework: z.literal("google-adk-typescript"),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.source.originalReceiptDigest !==
      value.remediation.authority.sourceReceiptDigest
    ) {
      context.addIssue({
        code: "custom",
        message: "Closure source and remediation authority do not match.",
      });
    }
    if (
      value.remediation.runId !== value.remediation.authority.runId ||
      value.remediation.runId !== value.remediation.approvedPlan.runId ||
      value.remediation.approvedPlans.some(
        (plan) => plan.runId !== value.remediation.runId,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Closure remediation records do not belong to one run.",
      });
    }
    const approvedPlanIds = value.remediation.approvedPlans.map(
      (plan) => plan.planId,
    );
    if (
      new Set(approvedPlanIds).size !== approvedPlanIds.length ||
      approvedPlanIds.at(-1) !== value.remediation.approvedPlan.planId
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Closure approved-plan history must be unique and end with the active plan.",
      });
    }
    if (
      value.outcome === "repaired" &&
      (value.goalResults.some((result) => result.status !== "satisfied") ||
        value.remediation.actionReceipt.verdict !==
          "within_remediation_authority")
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Repaired requires every goal satisfied and an in-authority action receipt.",
      });
    }
  });
export type ClosureReceipt = z.infer<typeof ClosureReceiptSchema>;

export const DemoRecordSchema = z
  .object({
    demoId: StrictIdSchema,
    sourceReceiptDigest: DigestSchema,
    createdAt: Rfc3339Schema,
    resourceIds: z.array(StrictIdSchema).length(2),
    latestRunId: StrictIdSchema.optional(),
  })
  .strict();
export type DemoRecord = z.infer<typeof DemoRecordSchema>;

export const PublicIncidentViewSchema = z
  .object({
    task: z.string().min(1).max(1000),
    traceId: StrictIdSchema,
    sourceReceiptDigest: DigestSchema,
    verdict: z.literal("material_deviations_found"),
    verdictLabel: z.string().min(1).max(120),
    coverage: z
      .object({
        rawEvents: NonNegativeIntegerSchema,
        accountedRawEvents: NonNegativeIntegerSchema,
        findings: NonNegativeIntegerSchema,
      })
      .strict(),
    incidents: z.array(IncidentSchema).length(2),
    closureGoals: z.array(ClosureGoalSchema).length(2),
  })
  .strict();
export type PublicIncidentView = z.infer<typeof PublicIncidentViewSchema>;

export const PublicDemoViewSchema = z
  .object({
    demo: DemoRecordSchema,
    incident: PublicIncidentViewSchema,
    resources: z.array(SandboxResourceSchema).length(2),
  })
  .strict();
export type PublicDemoView = z.infer<typeof PublicDemoViewSchema>;

export const PublicRunViewSchema = z
  .object({
    run: RemediationRunSchema,
    authority: RemediationAuthoritySchema,
    planDecision: PlanDecisionSchema.optional(),
    approvedPlans: z.array(RecoveryPlanSchema).max(2),
    inspections: z.array(InspectionRecordSchema).max(20),
    events: z.array(ActionEventSchema).max(100),
    currentResources: z.array(SandboxResourceSchema).max(8),
    closure: ClosureReceiptSchema.optional(),
  })
  .strict();
export type PublicRunView = z.infer<typeof PublicRunViewSchema>;

export const ResetDemoRequestSchema = z.object({}).strict();
export const StartRunRequestSchema = z
  .object({
    demoId: StrictIdSchema,
    sourceReceiptDigest: DigestSchema,
  })
  .strict();

export const HealthResponseSchema = z
  .object({
    ok: z.boolean(),
    appVersion: z.string().min(1),
    deployment: z.enum(["local", "cloud-run"]),
    repository: z.enum(["memory", "firestore"]),
    repositoryReachable: z.boolean(),
    geminiConfigured: z.boolean(),
    agentMode: z.enum(["gemini", "fixture", "no_execution"]),
    modelId: z.string().min(1),
    agentFramework: z.literal("google-adk-typescript"),
  })
  .strict();
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
