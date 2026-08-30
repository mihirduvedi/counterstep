import {
  PlanDecisionSchema,
  RecoveryPlanSchema,
  type Incident,
  type InspectionRecord,
  type PlanDecision,
  type PlanRejectionCode,
  type RemediationAuthority,
  type RemediationRun,
} from "./schemas";

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function citationMatches(
  proposed: readonly string[],
  allowed: readonly string[],
): boolean {
  return proposed.length > 0 && proposed.every((id) => allowed.includes(id));
}

export function evaluateRecoveryPlan(input: {
  candidate: unknown;
  run: RemediationRun;
  authority: RemediationAuthority;
  incidents: readonly Incident[];
  inspections: readonly InspectionRecord[];
  existingDecision?: PlanDecision;
  decidedAt: string;
}): PlanDecision {
  const parsed = RecoveryPlanSchema.safeParse(input.candidate);
  if (!parsed.success) {
    return PlanDecisionSchema.parse({
      status: "rejected",
      reasonCodes: ["invalid_plan_contract"],
      detail: parsed.error.issues
        .slice(0, 3)
        .map((issue) => issue.message)
        .join(" ")
        .slice(0, 500),
      decidedAt: input.decidedAt,
    });
  }
  const plan = parsed.data;
  const reasons: PlanRejectionCode[] = [];
  const inspectionByResource = new Map(
    input.inspections.map((inspection) => [inspection.resourceId, inspection]),
  );

  if (!new Set(["planning", "authorizing"]).has(input.run.status)) {
    reasons.push("run_not_active");
  }
  if (
    Date.parse(input.decidedAt) >= Date.parse(input.authority.expiresAt)
  ) {
    reasons.push("authority_expired");
  }
  if (
    plan.runId !== input.run.runId ||
    plan.sourceReceiptDigest !== input.run.sourceReceiptDigest ||
    plan.sourceReceiptDigest !== input.authority.sourceReceiptDigest
  ) {
    reasons.push("receipt_mismatch");
  }
  if (
    plan.steps.length > input.authority.maxToolCalls ||
    input.run.toolCallCount + plan.steps.length > input.authority.maxToolCalls
  ) {
    reasons.push("step_limit_exceeded");
  }
  const writeSteps = plan.steps.filter(
    (step) => step.tool !== "verify_closure",
  );
  if (
    writeSteps.length > input.authority.maxWrites ||
    input.run.writeCount + writeSteps.length > input.authority.maxWrites
  ) {
    reasons.push("write_limit_exceeded");
  }
  if (plan.steps.at(-1)?.tool !== "verify_closure") {
    reasons.push("missing_final_verification");
  }
  if (input.existingDecision) {
    const replacementAllowed =
      input.run.terminalReasonCode === "stale_revision" &&
      input.run.replanCount < 1;
    if (!replacementAllowed) reasons.push("replacement_plan_not_allowed");
  }

  for (const step of writeSteps) {
    const incidents = step.incidentIds
      .map((incidentId) =>
        input.incidents.find((incident) => incident.incidentId === incidentId),
      )
      .filter((incident): incident is Incident => incident !== undefined);
    if (incidents.length !== step.incidentIds.length) {
      reasons.push("unknown_incident");
      continue;
    }
    const resourceIncident = incidents.find(
      (incident) => incident.resourceId === step.resourceId,
    );
    if (!resourceIncident) reasons.push("citation_mismatch");
    if (
      resourceIncident &&
      !citationMatches(step.findingIds, resourceIncident.findingIds)
    ) {
      const allKnown = step.findingIds.every((findingId) =>
        input.incidents.some((incident) =>
          incident.findingIds.includes(findingId),
        ),
      );
      reasons.push(allKnown ? "citation_mismatch" : "unknown_finding");
    }
    if (
      resourceIncident &&
      !citationMatches(step.eventIds, resourceIncident.eventIds)
    ) {
      const allKnown = step.eventIds.every((eventId) =>
        input.incidents.some((incident) => incident.eventIds.includes(eventId)),
      );
      reasons.push(allKnown ? "citation_mismatch" : "unknown_event");
    }

    const inspection = inspectionByResource.get(step.resourceId);
    if (!inspection) {
      reasons.push("resource_not_inspected");
    } else if (inspection.snapshot.version !== step.expectedVersion) {
      reasons.push("stale_plan_version");
    }
    if (!input.authority.readResourceIds.includes(step.resourceId)) {
      reasons.push("resource_not_authorized");
    }
    const permitted = input.authority.permittedActions.find(
      (action) =>
        action.tool === step.tool && action.resourceId === step.resourceId,
    );
    if (!permitted) {
      const resourceAllowed = input.authority.permittedActions.some(
        (action) => action.resourceId === step.resourceId,
      );
      reasons.push(
        resourceAllowed ? "tool_not_authorized" : "resource_not_authorized",
      );
      continue;
    }
    if (inspection) {
      const observedState =
        inspection.snapshot.kind === "spreadsheet"
          ? inspection.snapshot.accessState
          : inspection.snapshot.deliveryState;
      const alreadySafe = observedState === permitted.toState;
      if (observedState !== permitted.fromState && !alreadySafe) {
        reasons.push("transition_not_authorized");
      }
    }
  }

  const distinctReasons = unique(reasons);
  if (distinctReasons.length > 0) {
    return PlanDecisionSchema.parse({
      status: "rejected",
      plan,
      reasonCodes: distinctReasons,
      detail: `The deterministic plan gate rejected ${distinctReasons.join(", ")}.`,
      decidedAt: input.decidedAt,
    });
  }
  return PlanDecisionSchema.parse({
    status: "approved",
    plan,
    approvedStepIds: plan.steps.map((step) => step.stepId),
    decidedAt: input.decidedAt,
  });
}
