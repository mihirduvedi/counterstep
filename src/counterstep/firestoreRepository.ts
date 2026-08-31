import "server-only";

import { Firestore } from "@google-cloud/firestore";

import { digestObject, digestText } from "./digest";
import type {
  AtomicWriteRequest,
  CounterstepRepository,
} from "./repository";
import {
  ActionEventSchema,
  AtomicWriteResultSchema,
  ClosureReceiptSchema,
  COUNTERSTEP_DAILY_RUN_COUNTER_SCHEMA_VERSION,
  DailyRunCounterSchema,
  DemoRecordSchema,
  InspectionRecordSchema,
  PlanDecisionSchema,
  RecoveryPlanSchema,
  RemediationAuthoritySchema,
  RemediationRunSchema,
  RunExecutionAdmissionSchema,
  SandboxResourceSchema,
  type ActionEvent,
  type AtomicWriteResult,
  type ClosureReceipt,
  type DailyRunCounter,
  type DemoRecord,
  type InspectionRecord,
  type PlanDecision,
  type RecoveryPlan,
  type RemediationAuthority,
  type RemediationRun,
  type RunExecutionAdmission,
  type SandboxResource,
} from "./schemas";

function parseOptional<T>(
  exists: boolean,
  data: unknown,
  parse: (value: unknown) => T,
): T | undefined {
  return exists ? parse(data) : undefined;
}

function failure(
  resultCode: Exclude<AtomicWriteResult["resultCode"], "succeeded">,
  before?: SandboxResource,
): AtomicWriteResult {
  return AtomicWriteResultSchema.parse({
    resultCode,
    stateChanged: false,
    before,
    after: before,
  });
}

export class FirestoreCounterstepRepository
  implements CounterstepRepository
{
  readonly kind = "firestore" as const;

  private readonly db: Firestore;

  constructor(db?: Firestore) {
    this.db =
      db ??
      new Firestore({
        projectId: process.env.GOOGLE_CLOUD_PROJECT,
        databaseId: process.env.FIRESTORE_DATABASE_ID || "(default)",
        ignoreUndefinedProperties: true,
      });
  }

  async ping(): Promise<boolean> {
    try {
      await this.db.collection("counterstep_health").limit(1).get();
      return true;
    } catch {
      return false;
    }
  }

  async resetDemo(
    demo: DemoRecord,
    resources: readonly SandboxResource[],
  ): Promise<void> {
    const parsedDemo = DemoRecordSchema.parse(demo);
    const parsedResources = resources.map((resource) =>
      SandboxResourceSchema.parse(resource),
    );
    if (
      parsedResources.length !== parsedDemo.resourceIds.length ||
      parsedResources.some(
        (resource) =>
          resource.demoId !== parsedDemo.demoId ||
          !parsedDemo.resourceIds.includes(resource.resourceId),
      )
    ) {
      throw new Error("Demo resources do not match the reset record.");
    }
    const batch = this.db.batch();
    const demoRef = this.demoRef(parsedDemo.demoId);
    batch.create(demoRef, parsedDemo);
    for (const resource of parsedResources) {
      batch.create(this.resourceRef(parsedDemo.demoId, resource.resourceId), resource);
    }
    await batch.commit();
  }

  async getDemo(demoId: string): Promise<DemoRecord | undefined> {
    const snapshot = await this.demoRef(demoId).get();
    return parseOptional(snapshot.exists, snapshot.data(), (value) =>
      DemoRecordSchema.parse(value),
    );
  }

  async listResources(demoId: string): Promise<SandboxResource[]> {
    const demo = await this.getDemo(demoId);
    if (!demo) return [];
    const snapshots = await Promise.all(
      demo.resourceIds.map((resourceId) =>
        this.resourceRef(demoId, resourceId).get(),
      ),
    );
    return snapshots
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => SandboxResourceSchema.parse(snapshot.data()));
  }

  async getResource(
    demoId: string,
    resourceId: string,
  ): Promise<SandboxResource | undefined> {
    const snapshot = await this.resourceRef(demoId, resourceId).get();
    return parseOptional(snapshot.exists, snapshot.data(), (value) =>
      SandboxResourceSchema.parse(value),
    );
  }

  async createRun(
    run: RemediationRun,
    authority: RemediationAuthority,
  ): Promise<void> {
    const parsedRun = RemediationRunSchema.parse(run);
    const parsedAuthority = RemediationAuthoritySchema.parse(authority);
    if (
      parsedAuthority.runId !== parsedRun.runId ||
      parsedAuthority.authorityId !== parsedRun.authorityId
    ) {
      throw new Error("Run and remediation authority do not match.");
    }
    await this.db.runTransaction(async (transaction) => {
      const runRef = this.runRef(parsedRun.runId);
      const demoRef = this.demoRef(parsedRun.demoId);
      const [runSnapshot, demoSnapshot] = await Promise.all([
        transaction.get(runRef),
        transaction.get(demoRef),
      ]);
      if (runSnapshot.exists) throw new Error("Run already exists.");
      if (!demoSnapshot.exists) throw new Error("Demo does not exist.");
      const demo = DemoRecordSchema.parse(demoSnapshot.data());
      transaction.create(runRef, parsedRun);
      transaction.create(this.authorityRef(parsedRun.runId), parsedAuthority);
      transaction.update(demoRef, { ...demo, latestRunId: parsedRun.runId });
    });
  }

  async getRun(runId: string): Promise<RemediationRun | undefined> {
    const snapshot = await this.runRef(runId).get();
    return parseOptional(snapshot.exists, snapshot.data(), (value) =>
      RemediationRunSchema.parse(value),
    );
  }

  async getAuthority(
    runId: string,
  ): Promise<RemediationAuthority | undefined> {
    const snapshot = await this.authorityRef(runId).get();
    return parseOptional(snapshot.exists, snapshot.data(), (value) =>
      RemediationAuthoritySchema.parse(value),
    );
  }

  async claimRunForExecution(
    runId: string,
    admission: RunExecutionAdmission,
  ) {
    const parsedAdmission = RunExecutionAdmissionSchema.parse(admission);
    return this.db.runTransaction(async (transaction) => {
      const runRef = this.runRef(runId);
      const limitRef = this.dailyLimitRef(parsedAdmission.dateKey);
      const [runSnapshot, limitSnapshot] = await Promise.all([
        transaction.get(runRef),
        transaction.get(limitRef),
      ]);
      if (!runSnapshot.exists) return "already_started" as const;
      const run = RemediationRunSchema.parse(runSnapshot.data());
      if (run.status !== "created") return "already_started" as const;
      const current = parseOptional(
        limitSnapshot.exists,
        limitSnapshot.data(),
        (value) => DailyRunCounterSchema.parse(value),
      );
      if ((current?.count ?? 0) >= parsedAdmission.maxRuns) {
        return "daily_limit_exceeded" as const;
      }
      transaction.set(
        runRef,
        RemediationRunSchema.parse({ ...run, status: "inspecting" }),
        { merge: false },
      );
      const nextCounter: DailyRunCounter = DailyRunCounterSchema.parse({
        schemaVersion: COUNTERSTEP_DAILY_RUN_COUNTER_SCHEMA_VERSION,
        dateKey: parsedAdmission.dateKey,
        count: (current?.count ?? 0) + 1,
        configuredLimit: parsedAdmission.maxRuns,
        updatedAt: parsedAdmission.timestamp,
      });
      transaction.set(limitRef, nextCounter, { merge: false });
      return "claimed" as const;
    });
  }

  async saveRun(run: RemediationRun): Promise<void> {
    const parsed = RemediationRunSchema.parse(run);
    await this.runRef(parsed.runId).set(parsed, { merge: false });
  }

  async saveEventAndRun(
    event: ActionEvent,
    run: RemediationRun,
  ): Promise<void> {
    const parsedEvent = ActionEventSchema.parse(event);
    const parsedRun = RemediationRunSchema.parse(run);
    if (parsedEvent.runId !== parsedRun.runId) {
      throw new Error("Action event does not belong to the supplied run.");
    }
    await this.db.runTransaction(async (transaction) => {
      const runRef = this.runRef(parsedRun.runId);
      const eventRef = this.eventRef(parsedRun.runId, parsedEvent.eventId);
      const [runSnapshot, eventSnapshot, sequenceSnapshot] = await Promise.all([
        transaction.get(runRef),
        transaction.get(eventRef),
        transaction.get(
          this.eventsRef(parsedRun.runId)
            .where("sequence", "==", parsedEvent.sequence)
            .limit(1),
        ),
      ]);
      if (!runSnapshot.exists) throw new Error("Run does not exist.");
      if (eventSnapshot.exists || !sequenceSnapshot.empty) {
        throw new Error("Action event or sequence already exists.");
      }
      transaction.create(eventRef, parsedEvent);
      transaction.set(runRef, parsedRun, { merge: false });
    });
  }

  async listEvents(runId: string): Promise<ActionEvent[]> {
    const snapshot = await this.eventsRef(runId).orderBy("sequence", "asc").get();
    return snapshot.docs.map((doc) => ActionEventSchema.parse(doc.data()));
  }

  async saveInspection(inspection: InspectionRecord): Promise<void> {
    const parsed = InspectionRecordSchema.parse(inspection);
    await this.inspectionsRef(parsed.runId).doc(parsed.eventId).set(parsed);
  }

  async listInspections(runId: string): Promise<InspectionRecord[]> {
    const snapshot = await this.inspectionsRef(runId).orderBy("inspectedAt", "asc").get();
    return snapshot.docs
      .map((doc) => InspectionRecordSchema.parse(doc.data()))
      .sort((left, right) =>
        left.inspectedAt === right.inspectedAt
          ? left.eventId.localeCompare(right.eventId)
          : left.inspectedAt.localeCompare(right.inspectedAt),
      );
  }

  async savePlanDecision(
    run: RemediationRun,
    decision: PlanDecision,
  ): Promise<void> {
    const parsedRun = RemediationRunSchema.parse(run);
    const parsedDecision = PlanDecisionSchema.parse(decision);
    if (
      parsedDecision.plan &&
      parsedDecision.plan.runId !== parsedRun.runId
    ) {
      throw new Error("Plan decision does not belong to the supplied run.");
    }
    const batch = this.db.batch();
    batch.set(this.runRef(parsedRun.runId), parsedRun, { merge: false });
    batch.set(this.decisionRef(parsedRun.runId), parsedDecision, { merge: false });
    if (parsedDecision.status === "approved") {
      batch.create(
        this.planRef(parsedRun.runId, parsedDecision.plan.planId),
        parsedDecision,
      );
    }
    await batch.commit();
  }

  async getPlanDecision(runId: string): Promise<PlanDecision | undefined> {
    const snapshot = await this.decisionRef(runId).get();
    return parseOptional(snapshot.exists, snapshot.data(), (value) =>
      PlanDecisionSchema.parse(value),
    );
  }

  async getApprovedPlan(runId: string): Promise<RecoveryPlan | undefined> {
    const decision = await this.getPlanDecision(runId);
    return decision?.status === "approved"
      ? RecoveryPlanSchema.parse(decision.plan)
      : undefined;
  }

  async listApprovedPlans(runId: string): Promise<RecoveryPlan[]> {
    const snapshot = await this.plansRef(runId).orderBy("decidedAt", "asc").get();
    return snapshot.docs
      .map((doc) => PlanDecisionSchema.parse(doc.data()))
      .filter(
        (decision): decision is Extract<PlanDecision, { status: "approved" }> =>
          decision.status === "approved",
      )
      .map((decision) => RecoveryPlanSchema.parse(decision.plan));
  }

  async executeAtomicWrite(
    request: AtomicWriteRequest,
  ): Promise<AtomicWriteResult> {
    return this.db.runTransaction(async (transaction) => {
      const runRef = this.runRef(request.runId);
      const authorityRef = this.authorityRef(request.runId);
      const decisionRef = this.decisionRef(request.runId);
      const replayRef = this.idempotencyRef(
        request.runId,
        request.idempotencyKey,
      );
      const [runSnapshot, authoritySnapshot, decisionSnapshot, replaySnapshot] =
        await Promise.all([
          transaction.get(runRef),
          transaction.get(authorityRef),
          transaction.get(decisionRef),
          transaction.get(replayRef),
        ]);
      if (replaySnapshot.exists) {
        const replay = AtomicWriteResultSchema.parse(replaySnapshot.data());
        const { event, ...recordedResult } = replay;
        return AtomicWriteResultSchema.parse({
          ...recordedResult,
          resultCode: "idempotent_replay",
          stateChanged: false,
          replayedEventId: event?.eventId,
        });
      }
      const run = parseOptional(runSnapshot.exists, runSnapshot.data(), (value) =>
        RemediationRunSchema.parse(value),
      );
      const authority = parseOptional(
        authoritySnapshot.exists,
        authoritySnapshot.data(),
        (value) => RemediationAuthoritySchema.parse(value),
      );
      const decision = parseOptional(
        decisionSnapshot.exists,
        decisionSnapshot.data(),
        (value) => PlanDecisionSchema.parse(value),
      );
      if (!run || !authority || decision?.status !== "approved") {
        return failure(
          decision?.status === "approved" ? "run_not_active" : "plan_not_approved",
        );
      }
      const resourceRef = this.resourceRef(run.demoId, request.resourceId);
      const resourceSnapshot = await transaction.get(resourceRef);
      if (run.status !== "executing") return failure("run_not_active");
      if (Date.parse(request.timestamp) >= Date.parse(authority.expiresAt)) {
        return failure("authority_expired");
      }
      if (authority.sourceReceiptDigest !== run.sourceReceiptDigest) {
        return failure("receipt_mismatch");
      }
      if (
        decision.plan.planId !== request.planId ||
        run.activePlanId !== request.planId
      ) {
        return failure("plan_not_approved");
      }
      const step = decision.plan.steps.find(
        (candidate) => candidate.stepId === request.stepId,
      );
      if (!step || step.tool === "verify_closure" || step.tool !== request.tool) {
        return failure("step_not_approved");
      }
      if (step.resourceId !== request.resourceId) {
        return failure("resource_not_authorized");
      }
      const permitted = authority.permittedActions.find(
        (action) =>
          action.tool === request.tool && action.resourceId === request.resourceId,
      );
      if (!permitted) return failure("tool_not_authorized");
      if (run.writeCount >= authority.maxWrites) {
        return failure("write_limit_exceeded");
      }
      if (!resourceSnapshot.exists) return failure("resource_not_found");
      const before = SandboxResourceSchema.parse(resourceSnapshot.data());
      if (before.version !== request.expectedVersion) {
        return failure("stale_revision", before);
      }

      let after: SandboxResource;
      if (request.tool === "revoke_external_access") {
        if (before.kind !== "spreadsheet") {
          return failure("transition_not_authorized", before);
        }
        if (before.accessState === "revoked") {
          const result = failure("already_safe", before);
          transaction.create(replayRef, result);
          return result;
        }
        after = SandboxResourceSchema.parse({
          ...before,
          accessState: "revoked",
          version: before.version + 1,
          updatedAt: request.timestamp,
        });
      } else {
        if (before.kind !== "queued_message") {
          return failure("transition_not_authorized", before);
        }
        if (before.deliveryState === "delivered") {
          return failure("not_reversible", before);
        }
        if (before.deliveryState === "cancelled") {
          const result = failure("already_safe", before);
          transaction.create(replayRef, result);
          return result;
        }
        after = SandboxResourceSchema.parse({
          ...before,
          deliveryState: "cancelled",
          version: before.version + 1,
          updatedAt: request.timestamp,
        });
      }

      const event = ActionEventSchema.parse({
        schemaVersion: "counterstep.action-event.v1",
        eventId: request.eventId,
        runId: request.runId,
        sequence: request.eventSequence,
        timestamp: request.timestamp,
        phase: "executing",
        toolName: request.tool,
        operation: "update",
        resourceId: request.resourceId,
        stateChange: true,
        status: "succeeded",
        attempt: request.attempt,
        actionKey: `${request.planId}:${request.stepId}`,
        planId: request.planId,
        stepId: request.stepId,
        beforeVersion: before.version,
        afterVersion: after.version,
        beforeDigest: digestObject(before),
        afterDigest: digestObject(after),
        resultCode: "succeeded",
        detail:
          request.tool === "revoke_external_access"
            ? "External spreadsheet access was revoked."
            : "Queued customer delivery was cancelled.",
        latencyMs: request.latencyMs,
      });
      const updatedRun = RemediationRunSchema.parse({
        ...run,
        writeCount: run.writeCount + 1,
        status: "executing",
      });
      const result = AtomicWriteResultSchema.parse({
        resultCode: "succeeded",
        stateChanged: true,
        before,
        after,
        event,
      });
      transaction.set(resourceRef, after, { merge: false });
      transaction.create(this.eventRef(request.runId, event.eventId), event);
      transaction.set(runRef, updatedRun, { merge: false });
      transaction.create(replayRef, result);
      return result;
    });
  }

  async saveClosure(
    run: RemediationRun,
    closure: ClosureReceipt,
  ): Promise<void> {
    const parsedRun = RemediationRunSchema.parse(run);
    const parsedClosure = ClosureReceiptSchema.parse(closure);
    if (parsedClosure.remediation.runId !== parsedRun.runId) {
      throw new Error("Closure does not belong to the supplied run.");
    }
    const batch = this.db.batch();
    batch.set(this.runRef(parsedRun.runId), parsedRun, { merge: false });
    batch.set(this.closureRef(parsedRun.runId), parsedClosure, { merge: false });
    await batch.commit();
  }

  async getClosure(runId: string): Promise<ClosureReceipt | undefined> {
    const snapshot = await this.closureRef(runId).get();
    return parseOptional(snapshot.exists, snapshot.data(), (value) =>
      ClosureReceiptSchema.parse(value),
    );
  }

  private demoRef(demoId: string) {
    return this.db.collection("counterstep_demos").doc(demoId);
  }

  private resourceRef(demoId: string, resourceId: string) {
    return this.demoRef(demoId).collection("resources").doc(resourceId);
  }

  private runRef(runId: string) {
    return this.db.collection("counterstep_runs").doc(runId);
  }

  private authorityRef(runId: string) {
    return this.runRef(runId).collection("control").doc("authority");
  }

  private eventsRef(runId: string) {
    return this.runRef(runId).collection("events");
  }

  private eventRef(runId: string, eventId: string) {
    return this.eventsRef(runId).doc(eventId);
  }

  private inspectionsRef(runId: string) {
    return this.runRef(runId).collection("inspections");
  }

  private decisionRef(runId: string) {
    return this.runRef(runId).collection("control").doc("plan-decision");
  }

  private plansRef(runId: string) {
    return this.runRef(runId).collection("plans");
  }

  private planRef(runId: string, planId: string) {
    return this.plansRef(runId).doc(planId);
  }

  private closureRef(runId: string) {
    return this.runRef(runId).collection("receipts").doc("closure");
  }

  private idempotencyRef(runId: string, rawKey: string) {
    return this.runRef(runId)
      .collection("idempotency")
      .doc(digestText(rawKey));
  }

  private dailyLimitRef(dateKey: string) {
    return this.db.collection("counterstepLimits").doc(dateKey);
  }
}
