import { digestObject } from "./digest";
import {
  ActionReceiptSchema,
  CLOSURE_QUALIFIER,
  COUNTERSTEP_CLOSURE_SCHEMA_VERSION,
  ClosureReceiptSchema,
  GoalResultSchema,
  type ActionEvent,
  type ActionReceipt,
  type ClosureGoal,
  type ClosureOutcome,
  type ClosureReceipt,
  type GoalResult,
  type InspectionRecord,
  type RecoveryPlan,
  type RemediationAuthority,
  type RemediationRun,
  type SandboxResource,
} from "./schemas";

const ACTION_RECEIPT_QUALIFIER =
  "Based on the recorded remediation events and declared remediation authority." as const;

export function buildActionReceipt(input: {
  run: RemediationRun;
  authority: RemediationAuthority;
  approvedPlans: readonly RecoveryPlan[];
  events: readonly ActionEvent[];
}): ActionReceipt {
  const violations: string[] = [];
  const sequenceSet = new Set<number>();
  const idSet = new Set<string>();
  let successfulWrites = 0;

  for (const event of input.events) {
    if (event.runId !== input.run.runId) {
      violations.push(`Event ${event.eventId} belongs to another run.`);
    }
    if (sequenceSet.has(event.sequence)) {
      violations.push(`Event sequence ${event.sequence} is duplicated.`);
    }
    if (idSet.has(event.eventId)) {
      violations.push(`Event ID ${event.eventId} is duplicated.`);
    }
    sequenceSet.add(event.sequence);
    idSet.add(event.eventId);
    if (!event.stateChange) continue;
    successfulWrites += 1;
    if (!event.resourceId || !event.stepId || !event.planId) {
      violations.push(`State-changing event ${event.eventId} lacks plan binding.`);
      continue;
    }
    const approvedPlan = input.approvedPlans.find(
      (candidate) => candidate.planId === event.planId,
    );
    const step = approvedPlan?.steps.find(
      (candidate) => candidate.stepId === event.stepId,
    );
    const allowed = input.authority.permittedActions.find(
      (action) =>
        action.tool === event.toolName &&
        action.resourceId === event.resourceId,
    );
    if (
      !approvedPlan ||
      !step ||
      step.tool === "verify_closure" ||
      step.tool !== event.toolName ||
      step.resourceId !== event.resourceId
    ) {
      violations.push(`Event ${event.eventId} does not map to an approved step.`);
    }
    if (!allowed) {
      violations.push(`Event ${event.eventId} is outside remediation authority.`);
    }
    if (
      event.status !== "succeeded" ||
      event.beforeVersion === undefined ||
      event.afterVersion !== event.beforeVersion + 1 ||
      !event.beforeDigest ||
      !event.afterDigest
    ) {
      violations.push(`Event ${event.eventId} has inconsistent write evidence.`);
    }
  }
  if (successfulWrites !== input.run.writeCount) {
    violations.push(
      `Run write count ${input.run.writeCount} does not match ${successfulWrites} recorded writes.`,
    );
  }
  const orderedSequences = [...sequenceSet].sort((left, right) => left - right);
  if (
    orderedSequences.some((sequence, index) => sequence !== index + 1)
  ) {
    violations.push("Action event sequence is not contiguous from one.");
  }

  return ActionReceiptSchema.parse({
    schemaVersion: "counterstep.action-receipt.v1",
    runId: input.run.runId,
    authorityId: input.authority.authorityId,
    verdict:
      violations.length === 0
        ? "within_remediation_authority"
        : "deviations_found",
    qualifier: ACTION_RECEIPT_QUALIFIER,
    eventIds: input.events.map((event) => event.eventId),
    coverage: {
      recordedEvents: input.events.length,
      accountedEvents: input.events.length,
      successfulWrites,
    },
    violations,
  });
}

function goalResult(input: {
  goal: ClosureGoal;
  inspection?: InspectionRecord;
  current?: SandboxResource;
  events: readonly ActionEvent[];
}): GoalResult {
  const evidenceEventIds = input.events
    .filter(
      (event) =>
        event.resourceId === input.goal.resourceId ||
        event.toolName === "verify_closure",
    )
    .map((event) => event.eventId);
  if (!input.inspection || !input.current) {
    return GoalResultSchema.parse({
      goal: input.goal,
      status: "unknown",
      beforeSnapshot: input.inspection?.snapshot,
      afterSnapshot: input.current,
      evidenceEventIds,
      detail: "A required before or final resource snapshot is unavailable.",
    });
  }

  if (input.goal.predicate.kind === "spreadsheet_access_is") {
    if (input.current.kind !== "spreadsheet") {
      return GoalResultSchema.parse({
        goal: input.goal,
        status: "unknown",
        beforeSnapshot: input.inspection.snapshot,
        afterSnapshot: input.current,
        evidenceEventIds,
        detail: "The final resource kind does not match the closure goal.",
      });
    }
    const satisfied = input.current.accessState === "revoked";
    return GoalResultSchema.parse({
      goal: input.goal,
      status: satisfied ? "satisfied" : "unsatisfied",
      beforeSnapshot: input.inspection.snapshot,
      afterSnapshot: input.current,
      evidenceEventIds,
      detail: satisfied
        ? `External access is revoked at version ${input.current.version}.`
        : `External access remains ${input.current.accessState} at version ${input.current.version}.`,
    });
  }

  if (input.current.kind !== "queued_message") {
    return GoalResultSchema.parse({
      goal: input.goal,
      status: "unknown",
      beforeSnapshot: input.inspection.snapshot,
      afterSnapshot: input.current,
      evidenceEventIds,
      detail: "The final resource kind does not match the closure goal.",
    });
  }
  const satisfied = input.current.deliveryState === "cancelled";
  return GoalResultSchema.parse({
    goal: input.goal,
    status: satisfied ? "satisfied" : "unsatisfied",
    beforeSnapshot: input.inspection.snapshot,
    afterSnapshot: input.current,
    evidenceEventIds,
    detail: satisfied
      ? `Queued delivery is cancelled at version ${input.current.version}.`
      : input.current.deliveryState === "delivered"
        ? "The message is already delivered and Counterstep did not claim recall."
        : `Delivery remains ${input.current.deliveryState} at version ${input.current.version}.`,
  });
}

function determineOutcome(
  results: readonly GoalResult[],
  actionReceipt: ActionReceipt,
): ClosureOutcome {
  if (actionReceipt.verdict !== "within_remediation_authority") return "blocked";
  if (results.some((result) => result.status === "unknown")) {
    return "unable_to_verify";
  }
  if (results.every((result) => result.status === "satisfied")) {
    return "repaired";
  }
  if (results.some((result) => result.status === "satisfied")) {
    return "partially_repaired";
  }
  return "blocked";
}

function closureDigestInput(receipt: ClosureReceipt): ClosureReceipt {
  return {
    ...receipt,
    integrity: { ...receipt.integrity, digest: "0".repeat(64) },
  };
}

export function buildClosureReceipt(input: {
  run: RemediationRun;
  authority: RemediationAuthority;
  plan: RecoveryPlan;
  approvedPlans: readonly RecoveryPlan[];
  events: readonly ActionEvent[];
  inspections: readonly InspectionRecord[];
  currentResources: readonly SandboxResource[];
  originalTraceId: string;
  generatedAt: string;
  appVersion: string;
}): ClosureReceipt {
  const inspectionByResource = new Map<string, InspectionRecord>();
  for (const inspection of input.inspections) {
    if (!inspectionByResource.has(inspection.resourceId)) {
      inspectionByResource.set(inspection.resourceId, inspection);
    }
  }
  const currentByResource = new Map(
    input.currentResources.map((resource) => [resource.resourceId, resource]),
  );
  const goalResults = input.run.closureGoals.map((goal) =>
    goalResult({
      goal,
      inspection: inspectionByResource.get(goal.resourceId),
      current: currentByResource.get(goal.resourceId),
      events: input.events,
    }),
  );
  const actionReceipt = buildActionReceipt({
    run: input.run,
    authority: input.authority,
    approvedPlans: input.approvedPlans,
    events: input.events,
  });
  const outcome = determineOutcome(goalResults, actionReceipt);
  const limitations = [
    "The demo uses synthetic sandbox resources rather than production Gmail, Drive, CRM, or spreadsheet systems.",
    "Counterstep proves only the declared closure goals; it does not certify legal compliance or universal agent safety.",
  ];
  if (goalResults.some((result) => result.status !== "satisfied")) {
    limitations.push(
      "One or more declared effects remain unresolved or could not be freshly verified.",
    );
  }

  const unsigned = ClosureReceiptSchema.parse({
    schemaVersion: COUNTERSTEP_CLOSURE_SCHEMA_VERSION,
    qualifier: CLOSURE_QUALIFIER,
    source: {
      originalReceiptSchemaVersion: "agent-receipt.receipt.v1",
      originalReceiptDigest: input.run.sourceReceiptDigest,
      originalTraceId: input.originalTraceId,
      originalVerdict: "material_deviations_found",
    },
    remediation: {
      runId: input.run.runId,
      authority: input.authority,
      approvedPlan: input.plan,
      approvedPlans: input.approvedPlans,
      actionReceipt,
      eventIds: input.events.map((event) => event.eventId),
    },
    goalResults,
    outcome,
    limitations,
    integrity: {
      digestAlgorithm: "SHA-256",
      digest: "0".repeat(64),
      generatedAt: input.generatedAt,
      appVersion: input.appVersion,
      modelId: input.run.modelId,
      agentFramework: "google-adk-typescript",
    },
  });
  return ClosureReceiptSchema.parse({
    ...unsigned,
    integrity: {
      ...unsigned.integrity,
      digest: digestObject(closureDigestInput(unsigned)),
    },
  });
}

export function verifyClosureReceipt(receipt: unknown): {
  valid: boolean;
  errors: string[];
  receipt?: ClosureReceipt;
} {
  const parsed = ClosureReceiptSchema.safeParse(receipt);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => issue.message),
    };
  }
  const expected = digestObject(closureDigestInput(parsed.data));
  if (expected !== parsed.data.integrity.digest) {
    return { valid: false, errors: ["Closure receipt digest does not match."] };
  }
  return { valid: true, errors: [], receipt: parsed.data };
}

export function serializeClosureReceipt(receipt: ClosureReceipt): string {
  const verified = verifyClosureReceipt(receipt);
  if (!verified.valid || !verified.receipt) {
    throw new Error(verified.errors.join(" "));
  }
  return `${JSON.stringify(verified.receipt, null, 2)}\n`;
}
