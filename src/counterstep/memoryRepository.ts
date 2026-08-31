import { digestObject, digestText } from "./digest";
import type {
  AtomicWriteRequest,
  CounterstepRepository,
  StaleScenarioMutationRequest,
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
  ScenarioMutationResultSchema,
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

function copy<T>(value: T): T {
  return structuredClone(value);
}

function resourceKey(demoId: string, resourceId: string): string {
  return `${demoId}:${resourceId}`;
}

function idempotencyKey(runId: string, rawKey: string): string {
  return `${runId}:${digestText(rawKey)}`;
}

export class InMemoryCounterstepRepository implements CounterstepRepository {
  readonly kind = "memory" as const;

  private readonly demos = new Map<string, DemoRecord>();
  private readonly resources = new Map<string, SandboxResource>();
  private readonly runs = new Map<string, RemediationRun>();
  private readonly authorities = new Map<string, RemediationAuthority>();
  private readonly events = new Map<string, Map<string, ActionEvent>>();
  private readonly inspections = new Map<
    string,
    Map<string, InspectionRecord>
  >();
  private readonly decisions = new Map<string, PlanDecision>();
  private readonly approvedPlans = new Map<string, RecoveryPlan[]>();
  private readonly closures = new Map<string, ClosureReceipt>();
  private readonly idempotency = new Map<string, AtomicWriteResult>();
  private readonly dailyRunCounters = new Map<string, DailyRunCounter>();

  async ping(): Promise<boolean> {
    return true;
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
    this.demos.set(parsedDemo.demoId, copy(parsedDemo));
    for (const resource of parsedResources) {
      this.resources.set(
        resourceKey(resource.demoId, resource.resourceId),
        copy(resource),
      );
    }
  }

  async getDemo(demoId: string): Promise<DemoRecord | undefined> {
    const demo = this.demos.get(demoId);
    return demo ? copy(demo) : undefined;
  }

  async listResources(demoId: string): Promise<SandboxResource[]> {
    const demo = this.demos.get(demoId);
    if (!demo) return [];
    return demo.resourceIds
      .map((resourceId) =>
        this.resources.get(resourceKey(demoId, resourceId)),
      )
      .filter((resource): resource is SandboxResource => resource !== undefined)
      .map(copy);
  }

  async getResource(
    demoId: string,
    resourceId: string,
  ): Promise<SandboxResource | undefined> {
    const resource = this.resources.get(resourceKey(demoId, resourceId));
    return resource ? copy(resource) : undefined;
  }

  async applyStaleScenarioMutation(
    request: StaleScenarioMutationRequest,
  ) {
    const demo = this.demos.get(request.demoId);
    if (
      !demo ||
      demo.scenarioId !== "stale_replan" ||
      request.resourceId !== "sheet-churn-export-001"
    ) {
      return ScenarioMutationResultSchema.parse({ status: "not_applicable" });
    }
    const key = resourceKey(request.demoId, request.resourceId);
    const resource = this.resources.get(key);
    if (demo.scenarioMutationAppliedAt) {
      return ScenarioMutationResultSchema.parse({
        status: "already_applied",
        resource,
      });
    }
    if (
      !resource ||
      resource.kind !== "spreadsheet" ||
      resource.version !== request.expectedVersion
    ) {
      return ScenarioMutationResultSchema.parse({ status: "not_applicable" });
    }
    const nextResource = SandboxResourceSchema.parse({
      ...resource,
      version: resource.version + 1,
      updatedAt: request.timestamp,
    });
    this.resources.set(key, copy(nextResource));
    this.demos.set(
      request.demoId,
      DemoRecordSchema.parse({
        ...demo,
        scenarioMutationAppliedAt: request.timestamp,
      }),
    );
    return ScenarioMutationResultSchema.parse({
      status: "applied",
      resource: nextResource,
    });
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
    if (this.runs.has(parsedRun.runId)) {
      throw new Error("Run already exists.");
    }
    const demo = this.demos.get(parsedRun.demoId);
    if (!demo) throw new Error("Demo does not exist.");
    this.runs.set(parsedRun.runId, copy(parsedRun));
    this.authorities.set(parsedRun.runId, copy(parsedAuthority));
    this.events.set(parsedRun.runId, new Map());
    this.inspections.set(parsedRun.runId, new Map());
    this.approvedPlans.set(parsedRun.runId, []);
    this.demos.set(parsedRun.demoId, { ...demo, latestRunId: parsedRun.runId });
  }

  async getRun(runId: string): Promise<RemediationRun | undefined> {
    const run = this.runs.get(runId);
    return run ? copy(run) : undefined;
  }

  async getAuthority(
    runId: string,
  ): Promise<RemediationAuthority | undefined> {
    const authority = this.authorities.get(runId);
    return authority ? copy(authority) : undefined;
  }

  async claimRunForExecution(
    runId: string,
    admission: RunExecutionAdmission,
  ) {
    const parsedAdmission = RunExecutionAdmissionSchema.parse(admission);
    const run = this.runs.get(runId);
    if (!run || run.status !== "created") return "already_started" as const;
    const current = this.dailyRunCounters.get(parsedAdmission.dateKey);
    if ((current?.count ?? 0) >= parsedAdmission.maxRuns) {
      return "daily_limit_exceeded" as const;
    }
    this.runs.set(
      runId,
      RemediationRunSchema.parse({ ...run, status: "inspecting" }),
    );
    this.dailyRunCounters.set(
      parsedAdmission.dateKey,
      DailyRunCounterSchema.parse({
        schemaVersion: COUNTERSTEP_DAILY_RUN_COUNTER_SCHEMA_VERSION,
        dateKey: parsedAdmission.dateKey,
        count: (current?.count ?? 0) + 1,
        configuredLimit: parsedAdmission.maxRuns,
        updatedAt: parsedAdmission.timestamp,
      }),
    );
    return "claimed" as const;
  }

  async saveRun(run: RemediationRun): Promise<void> {
    const parsed = RemediationRunSchema.parse(run);
    if (!this.runs.has(parsed.runId)) throw new Error("Run does not exist.");
    this.runs.set(parsed.runId, copy(parsed));
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
    const runEvents = this.events.get(parsedRun.runId);
    if (!runEvents) throw new Error("Run does not exist.");
    if (runEvents.has(parsedEvent.eventId)) {
      throw new Error("Action event already exists.");
    }
    if (
      [...runEvents.values()].some(
        (candidate) => candidate.sequence === parsedEvent.sequence,
      )
    ) {
      throw new Error("Action event sequence already exists.");
    }
    runEvents.set(parsedEvent.eventId, copy(parsedEvent));
    this.runs.set(parsedRun.runId, copy(parsedRun));
  }

  async listEvents(runId: string): Promise<ActionEvent[]> {
    return [...(this.events.get(runId)?.values() ?? [])]
      .sort((left, right) => left.sequence - right.sequence)
      .map(copy);
  }

  async saveInspection(inspection: InspectionRecord): Promise<void> {
    const parsed = InspectionRecordSchema.parse(inspection);
    const runInspections = this.inspections.get(parsed.runId);
    if (!runInspections) throw new Error("Run does not exist.");
    runInspections.set(parsed.eventId, copy(parsed));
  }

  async listInspections(runId: string): Promise<InspectionRecord[]> {
    return [...(this.inspections.get(runId)?.values() ?? [])]
      .sort((left, right) =>
        left.inspectedAt === right.inspectedAt
          ? left.eventId.localeCompare(right.eventId)
          : left.inspectedAt.localeCompare(right.inspectedAt),
      )
      .map(copy);
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
    if (parsedDecision.status === "approved") {
      const plans = this.approvedPlans.get(parsedRun.runId);
      if (!plans) throw new Error("Run does not exist.");
      if (
        plans.some(
          (candidate) => candidate.planId === parsedDecision.plan.planId,
        )
      ) {
        throw new Error("Approved plan already exists.");
      }
      plans.push(copy(parsedDecision.plan));
    }
    this.runs.set(parsedRun.runId, copy(parsedRun));
    this.decisions.set(parsedRun.runId, copy(parsedDecision));
  }

  async getPlanDecision(runId: string): Promise<PlanDecision | undefined> {
    const decision = this.decisions.get(runId);
    return decision ? copy(decision) : undefined;
  }

  async getApprovedPlan(runId: string): Promise<RecoveryPlan | undefined> {
    const decision = this.decisions.get(runId);
    if (decision?.status !== "approved") return undefined;
    return RecoveryPlanSchema.parse(copy(decision.plan));
  }

  async listApprovedPlans(runId: string): Promise<RecoveryPlan[]> {
    return (this.approvedPlans.get(runId) ?? []).map((plan) =>
      RecoveryPlanSchema.parse(copy(plan)),
    );
  }

  async executeAtomicWrite(
    request: AtomicWriteRequest,
  ): Promise<AtomicWriteResult> {
    const replayKey = idempotencyKey(request.runId, request.idempotencyKey);
    const replay = this.idempotency.get(replayKey);
    if (replay) {
      const { event, ...recordedResult } = copy(replay);
      return AtomicWriteResultSchema.parse({
        ...recordedResult,
        resultCode: "idempotent_replay",
        stateChanged: false,
        replayedEventId: event?.eventId,
      });
    }

    const run = this.runs.get(request.runId);
    const authority = this.authorities.get(request.runId);
    const decision = this.decisions.get(request.runId);
    if (!run || !authority || decision?.status !== "approved") {
      return AtomicWriteResultSchema.parse({
        resultCode: decision?.status === "approved" ? "run_not_active" : "plan_not_approved",
        stateChanged: false,
      });
    }
    if (!new Set(["executing"]).has(run.status)) {
      return AtomicWriteResultSchema.parse({
        resultCode: "run_not_active",
        stateChanged: false,
      });
    }
    if (Date.parse(request.timestamp) >= Date.parse(authority.expiresAt)) {
      return AtomicWriteResultSchema.parse({
        resultCode: "authority_expired",
        stateChanged: false,
      });
    }
    if (authority.sourceReceiptDigest !== run.sourceReceiptDigest) {
      return AtomicWriteResultSchema.parse({
        resultCode: "receipt_mismatch",
        stateChanged: false,
      });
    }
    if (
      decision.plan.planId !== request.planId ||
      run.activePlanId !== request.planId
    ) {
      return AtomicWriteResultSchema.parse({
        resultCode: "plan_not_approved",
        stateChanged: false,
      });
    }
    const step = decision.plan.steps.find(
      (candidate) => candidate.stepId === request.stepId,
    );
    if (
      !step ||
      step.tool === "verify_closure" ||
      step.tool !== request.tool
    ) {
      return AtomicWriteResultSchema.parse({
        resultCode: "step_not_approved",
        stateChanged: false,
      });
    }
    if (step.resourceId !== request.resourceId) {
      return AtomicWriteResultSchema.parse({
        resultCode: "resource_not_authorized",
        stateChanged: false,
      });
    }
    const permitted = authority.permittedActions.find(
      (action) =>
        action.tool === request.tool &&
        action.resourceId === request.resourceId,
    );
    if (!permitted) {
      return AtomicWriteResultSchema.parse({
        resultCode: "tool_not_authorized",
        stateChanged: false,
      });
    }
    if (run.writeCount >= authority.maxWrites) {
      return AtomicWriteResultSchema.parse({
        resultCode: "write_limit_exceeded",
        stateChanged: false,
      });
    }

    const key = resourceKey(run.demoId, request.resourceId);
    const resource = this.resources.get(key);
    if (!resource) {
      return AtomicWriteResultSchema.parse({
        resultCode: "resource_not_found",
        stateChanged: false,
      });
    }
    const before = copy(resource);
    if (resource.version !== request.expectedVersion) {
      return AtomicWriteResultSchema.parse({
        resultCode: "stale_revision",
        stateChanged: false,
        before,
        after: before,
      });
    }

    let after: SandboxResource;
    if (request.tool === "revoke_external_access") {
      if (resource.kind !== "spreadsheet") {
        return AtomicWriteResultSchema.parse({
          resultCode: "transition_not_authorized",
          stateChanged: false,
          before,
          after: before,
        });
      }
      if (resource.accessState === "revoked") {
        const result = AtomicWriteResultSchema.parse({
          resultCode: "already_safe",
          stateChanged: false,
          before,
          after: before,
        });
        this.idempotency.set(replayKey, copy(result));
        return result;
      }
      after = SandboxResourceSchema.parse({
        ...resource,
        accessState: "revoked",
        version: resource.version + 1,
        updatedAt: request.timestamp,
      });
    } else {
      if (resource.kind !== "queued_message") {
        return AtomicWriteResultSchema.parse({
          resultCode: "transition_not_authorized",
          stateChanged: false,
          before,
          after: before,
        });
      }
      if (resource.deliveryState === "delivered") {
        return AtomicWriteResultSchema.parse({
          resultCode: "not_reversible",
          stateChanged: false,
          before,
          after: before,
        });
      }
      if (resource.deliveryState === "cancelled") {
        const result = AtomicWriteResultSchema.parse({
          resultCode: "already_safe",
          stateChanged: false,
          before,
          after: before,
        });
        this.idempotency.set(replayKey, copy(result));
        return result;
      }
      after = SandboxResourceSchema.parse({
        ...resource,
        deliveryState: "cancelled",
        version: resource.version + 1,
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
    const runEvents = this.events.get(request.runId);
    if (!runEvents) throw new Error("Run event ledger is missing.");
    if (runEvents.has(event.eventId)) {
      throw new Error("Atomic action event already exists.");
    }

    this.resources.set(key, copy(after));
    runEvents.set(event.eventId, copy(event));
    this.runs.set(request.runId, copy(updatedRun));
    const result = AtomicWriteResultSchema.parse({
      resultCode: "succeeded",
      stateChanged: true,
      before,
      after,
      event,
    });
    this.idempotency.set(replayKey, copy(result));
    return result;
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
    this.runs.set(parsedRun.runId, copy(parsedRun));
    this.closures.set(parsedRun.runId, copy(parsedClosure));
  }

  async getClosure(runId: string): Promise<ClosureReceipt | undefined> {
    const closure = this.closures.get(runId);
    return closure ? copy(closure) : undefined;
  }
}
