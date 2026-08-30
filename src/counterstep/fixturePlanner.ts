import {
  COUNTERSTEP_PLAN_SCHEMA_VERSION,
  RecoveryPlanSchema,
  type Incident,
  type InspectionRecord,
  type RecoveryPlan,
} from "./schemas";

export function buildFixtureRecoveryPlan(input: {
  runId: string;
  planId: string;
  sourceReceiptDigest: string;
  incidents: readonly Incident[];
  inspections: readonly InspectionRecord[];
}): RecoveryPlan {
  const steps: RecoveryPlan["steps"] = [];
  const latestInspectionByResource = new Map<string, InspectionRecord>();
  for (const inspection of input.inspections) {
    const current = latestInspectionByResource.get(inspection.resourceId);
    if (
      !current ||
      inspection.inspectedAt > current.inspectedAt ||
      (inspection.inspectedAt === current.inspectedAt &&
        inspection.eventId > current.eventId)
    ) {
      latestInspectionByResource.set(inspection.resourceId, inspection);
    }
  }
  for (const inspection of latestInspectionByResource.values()) {
    const incident = input.incidents.find(
      (candidate) => candidate.resourceId === inspection.resourceId,
    );
    if (!incident) continue;
    if (
      inspection.snapshot.kind === "spreadsheet" &&
      inspection.snapshot.accessState === "externally_shared"
    ) {
      steps.push({
        stepId: "step-revoke-spreadsheet-access",
        tool: "revoke_external_access",
        resourceId: inspection.resourceId,
        expectedVersion: inspection.snapshot.version,
        incidentIds: [incident.incidentId],
        findingIds: incident.findingIds,
        eventIds: incident.eventIds,
        intendedPostcondition: "Spreadsheet external access is revoked.",
      });
    }
    if (
      inspection.snapshot.kind === "queued_message" &&
      inspection.snapshot.deliveryState === "queued"
    ) {
      steps.push({
        stepId: "step-cancel-queued-message",
        tool: "cancel_queued_delivery",
        resourceId: inspection.resourceId,
        expectedVersion: inspection.snapshot.version,
        incidentIds: [incident.incidentId],
        findingIds: incident.findingIds,
        eventIds: incident.eventIds,
        intendedPostcondition: "Queued customer delivery is cancelled.",
      });
    }
  }
  steps.push({
    stepId: "step-verify-closure",
    tool: "verify_closure",
    incidentIds: input.incidents.map((incident) => incident.incidentId),
    findingIds: input.incidents.flatMap((incident) => incident.findingIds),
    eventIds: input.incidents.flatMap((incident) => incident.eventIds),
    intendedPostcondition:
      "Fresh resource reads satisfy every declared closure goal.",
  });
  return RecoveryPlanSchema.parse({
    schemaVersion: COUNTERSTEP_PLAN_SCHEMA_VERSION,
    planId: input.planId,
    runId: input.runId,
    sourceReceiptDigest: input.sourceReceiptDigest,
    rationaleSummary:
      "Inspect current state, apply only the two cited reversible repairs still needed, then verify both closure goals from fresh reads.",
    steps,
  });
}
