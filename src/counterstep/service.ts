import { randomUUID } from "node:crypto";

import {
  buildClosureReceipt,
  serializeClosureReceipt,
} from "./closure";
import { digestObject, digestText } from "./digest";
import { buildFixtureRecoveryPlan } from "./fixturePlanner";
import { evaluateRecoveryPlan } from "./gate";
import {
  createRemediationAuthority,
  getSourceIncidentContext,
} from "./incident";
import type {
  CounterstepRepository,
  ToolExecutionName,
} from "./repository";
import {
  assessScenarioRun,
  createScenarioResources,
  getDemoScenario,
} from "./scenarios";
import {
  ActionEventSchema,
  COUNTERSTEP_EVENT_SCHEMA_VERSION,
  COUNTERSTEP_RUN_SCHEMA_VERSION,
  DemoRecordSchema,
  InspectionRecordSchema,
  PublicDemoViewSchema,
  PublicRunViewSchema,
  RemediationRunSchema,
  type ActionEvent,
  type AtomicWriteResult,
  type ClosureReceipt,
  type DemoScenarioId,
  type GenerationSource,
  type InspectionRecord,
  type PlanDecision,
  type PublicDemoView,
  type PublicRunView,
  type RemediationRun,
  type RemediationRunStatus,
  type SandboxResource,
} from "./schemas";

export type CounterstepServiceOptions = {
  now?: () => Date;
  id?: (prefix: string) => string;
  appVersion?: string;
};

type StartedTool = {
  run: RemediationRun;
  event: ActionEvent;
};

type ToolResult<T> =
  | { ok: true; result: T }
  | { ok: false; code: string; detail: string };

const TERMINAL_STATUSES = new Set<RemediationRunStatus>([
  "repaired",
  "partially_repaired",
  "blocked",
  "unable_to_verify",
  "failed",
]);

export function deriveIdempotencyKey(input: {
  runId: string;
  planId: string;
  stepId: string;
  tool: ToolExecutionName;
  resourceId: string;
}): string {
  return digestText(
    [
      input.runId,
      input.planId,
      input.stepId,
      input.tool,
      input.resourceId,
    ].join(":"),
  );
}

export class CounterstepService {
  readonly repository: CounterstepRepository;

  private readonly now: () => Date;
  private readonly id: (prefix: string) => string;
  private readonly appVersion: string;

  constructor(
    repository: CounterstepRepository,
    options: CounterstepServiceOptions = {},
  ) {
    this.repository = repository;
    this.now = options.now ?? (() => new Date());
    this.id =
      options.id ?? ((prefix: string) => `${prefix}-${randomUUID()}`);
    this.appVersion = options.appVersion ?? "0.1.0";
  }

  async resetDemo(
    scenarioId: DemoScenarioId = "canonical_recovery",
  ): Promise<PublicDemoView> {
    const source = await getSourceIncidentContext();
    const timestamp = this.isoNow();
    const demoId = this.id("demo");
    const scenario = getDemoScenario(scenarioId);
    const resources = createScenarioResources(demoId, timestamp, scenarioId);
    const demo = DemoRecordSchema.parse({
      demoId,
      scenarioId,
      sourceReceiptDigest: source.sourceReceiptDigest,
      createdAt: timestamp,
      resourceIds: resources.map((resource) => resource.resourceId),
    });
    await this.repository.resetDemo(demo, resources);
    return PublicDemoViewSchema.parse({
      demo,
      scenario,
      incident: source.publicView,
      resources,
    });
  }

  async getDemoView(demoId: string): Promise<PublicDemoView | undefined> {
    const [demo, source] = await Promise.all([
      this.repository.getDemo(demoId),
      getSourceIncidentContext(),
    ]);
    if (!demo) return undefined;
    const resources = await this.repository.listResources(demoId);
    if (
      demo.sourceReceiptDigest !== source.sourceReceiptDigest ||
      resources.length !== demo.resourceIds.length
    ) {
      throw new Error("Persisted demo is not bound to the source incident.");
    }
    return PublicDemoViewSchema.parse({
      demo,
      scenario: getDemoScenario(demo.scenarioId),
      incident: source.publicView,
      resources,
    });
  }

  async createRun(input: {
    demoId: string;
    sourceReceiptDigest: string;
    generationSource: GenerationSource;
    modelId?: string;
  }): Promise<RemediationRun> {
    const [demo, source] = await Promise.all([
      this.repository.getDemo(input.demoId),
      getSourceIncidentContext(),
    ]);
    if (!demo) throw new Error("Demo not found.");
    if (
      input.sourceReceiptDigest !== demo.sourceReceiptDigest ||
      input.sourceReceiptDigest !== source.sourceReceiptDigest
    ) {
      throw new Error("Source receipt digest does not match the demo.");
    }
    const startedAt = this.isoNow();
    const expiresAt = new Date(
      Date.parse(startedAt) + 15 * 60 * 1000,
    ).toISOString();
    const runId = this.id("run");
    const authority = createRemediationAuthority({
      runId,
      sourceReceiptDigest: source.sourceReceiptDigest,
      issuedAt: startedAt,
      expiresAt,
    });
    const run = RemediationRunSchema.parse({
      schemaVersion: COUNTERSTEP_RUN_SCHEMA_VERSION,
      runId,
      demoId: input.demoId,
      sourceReceiptDigest: source.sourceReceiptDigest,
      status: "created",
      generationSource: input.generationSource,
      modelId: input.modelId,
      agentFramework: "google-adk-typescript",
      authorityId: authority.authorityId,
      closureGoals: source.closureGoals,
      toolCallCount: 0,
      writeCount: 0,
      replanCount: 0,
      startedAt,
    });
    await this.repository.createRun(run, authority);
    return run;
  }

  async getRunView(runId: string): Promise<PublicRunView | undefined> {
    const run = await this.repository.getRun(runId);
    if (!run) return undefined;
    const [
      authority,
      planDecision,
      approvedPlans,
      inspections,
      events,
      resources,
      closure,
      demo,
    ] =
      await Promise.all([
        this.repository.getAuthority(runId),
        this.repository.getPlanDecision(runId),
        this.repository.listApprovedPlans(runId),
        this.repository.listInspections(runId),
        this.repository.listEvents(runId),
        this.repository.listResources(run.demoId),
        this.repository.getClosure(runId),
        this.repository.getDemo(run.demoId),
      ]);
    if (!authority) throw new Error("Remediation authority is missing.");
    if (!demo) throw new Error("Demo record is missing.");
    return PublicRunViewSchema.parse({
      run,
      authority,
      planDecision,
      approvedPlans,
      inspections,
      events,
      currentResources: resources,
      closure,
      scenarioAssessment: assessScenarioRun({
        scenarioId: demo.scenarioId,
        run,
        approvedPlanCount: approvedPlans.length,
      }),
    });
  }

  async inspectResource(input: {
    runId: string;
    resourceId: string;
  }): Promise<ToolResult<InspectionRecord>> {
    const started = await this.beginTool({
      runId: input.runId,
      phase: "inspecting",
      toolName: "inspect_resource",
      operation: "read",
      resourceId: input.resourceId,
      detail: `Inspecting current state for ${input.resourceId}.`,
    });
    const authority = await this.requireAuthority(input.runId);
    if (!authority.readResourceIds.includes(input.resourceId)) {
      await this.finishTool({
        started,
        status: "failed",
        resultCode: "resource_not_authorized",
        detail: "The resource is outside the remediation read authority.",
        nextStatus: "blocked",
        terminalReasonCode: "resource_not_authorized",
      });
      return {
        ok: false,
        code: "resource_not_authorized",
        detail: "The resource is outside the remediation read authority.",
      };
    }
    const resource = await this.repository.getResource(
      started.run.demoId,
      input.resourceId,
    );
    if (!resource) {
      await this.finishTool({
        started,
        status: "failed",
        resultCode: "resource_not_found",
        detail: "Current resource state is unavailable; Counterstep did not guess.",
        nextStatus: "unable_to_verify",
        terminalReasonCode: "resource_not_found",
      });
      return {
        ok: false,
        code: "resource_not_found",
        detail: "Current resource state is unavailable; Counterstep did not guess.",
      };
    }
    const completion = this.makeCompletionEvent({
      started,
      status: "succeeded",
      resultCode: "inspected",
      detail: `Observed ${resource.kind} version ${resource.version}.`,
      nextPhase: "inspecting",
      resourceId: resource.resourceId,
    });
    const inspection = InspectionRecordSchema.parse({
      runId: input.runId,
      resourceId: resource.resourceId,
      snapshot: resource,
      stateDigest: digestObject(resource),
      inspectedAt: completion.timestamp,
      eventId: completion.eventId,
    });
    await this.repository.saveInspection(inspection);
    await this.repository.saveEventAndRun(completion, started.run);
    return { ok: true, result: inspection };
  }

  async submitRecoveryPlan(
    runId: string,
    candidate: unknown,
  ): Promise<PlanDecision> {
    const [source, authority, existingDecision] = await Promise.all([
      getSourceIncidentContext(),
      this.requireAuthority(runId),
      this.repository.getPlanDecision(runId),
    ]);
    const started = await this.beginTool({
      runId,
      phase: "planning",
      toolName: "submit_recovery_plan",
      operation: "approve",
      detail: "Submitting a cited recovery plan to the deterministic gate.",
    });
    const authorizingRun = RemediationRunSchema.parse({
      ...started.run,
      status: "authorizing",
    });
    await this.repository.saveRun(authorizingRun);
    await this.applyStaleScenarioMutationIfNeeded({
      run: authorizingRun,
      existingDecision,
    });
    const inspections = await this.repository.listInspections(runId);
    const decidedAt = this.isoNow();
    const decision = evaluateRecoveryPlan({
      candidate,
      run: authorizingRun,
      authority,
      incidents: source.incidents,
      inspections,
      existingDecision,
      decidedAt,
    });
    const nextRun = RemediationRunSchema.parse({
      ...authorizingRun,
      status: decision.status === "approved" ? "executing" : "blocked",
      activePlanId:
        decision.status === "approved" ? decision.plan.planId : undefined,
      replanCount:
        decision.status === "approved" && existingDecision
          ? authorizingRun.replanCount + 1
          : authorizingRun.replanCount,
      completedAt: decision.status === "rejected" ? decidedAt : undefined,
      terminalReasonCode:
        decision.status === "rejected"
          ? decision.reasonCodes[0]
          : undefined,
    });
    await this.repository.savePlanDecision(nextRun, decision);
    const event = this.makeCompletionEvent({
      started: { ...started, run: nextRun },
      status: decision.status === "approved" ? "succeeded" : "failed",
      resultCode:
        decision.status === "approved"
          ? "plan_approved"
          : decision.reasonCodes[0],
      detail:
        decision.status === "approved"
          ? `Plan ${decision.plan.planId} passed citation, authority, version, transition, and budget checks.`
          : decision.detail,
      nextPhase: decision.status === "approved" ? "authorizing" : "blocked",
      planId: decision.plan?.planId,
    });
    await this.repository.saveEventAndRun(event, nextRun);
    return decision;
  }

  async executePlanStep(input: {
    runId: string;
    planId: string;
    stepId: string;
    tool: ToolExecutionName;
    resourceId: string;
    expectedVersion: number;
    idempotencyKey: string;
  }): Promise<ToolResult<AtomicWriteResult>> {
    const expectedIdempotencyKey = deriveIdempotencyKey(input);
    const started = await this.beginTool({
      runId: input.runId,
      phase: "executing",
      toolName: input.tool,
      operation: "update",
      resourceId: input.resourceId,
      planId: input.planId,
      stepId: input.stepId,
      detail: `${input.tool} requested for ${input.resourceId} at version ${input.expectedVersion}.`,
    });
    if (input.idempotencyKey !== expectedIdempotencyKey) {
      await this.finishTool({
        started,
        status: "failed",
        resultCode: "invalid_idempotency_key",
        detail: "The idempotency key does not match the approved action envelope.",
        nextStatus: "blocked",
        terminalReasonCode: "invalid_idempotency_key",
      });
      return {
        ok: false,
        code: "invalid_idempotency_key",
        detail: "The idempotency key does not match the approved action envelope.",
      };
    }
    const eventSequence = await this.nextEventSequence(input.runId);
    const result = await this.repository.executeAtomicWrite({
      ...input,
      eventId: this.id("event"),
      eventSequence,
      timestamp: this.isoNow(),
      attempt: 1,
    });
    if (result.resultCode === "succeeded" && result.event) {
      return { ok: true, result };
    }

    const isKnownNoop =
      result.resultCode === "already_safe" ||
      result.resultCode === "idempotent_replay";
    const isReversibleBoundary = result.resultCode === "not_reversible";
    const isStale = result.resultCode === "stale_revision";
    const replanAvailable = isStale && started.run.replanCount < 1;
    const terminal =
      !isKnownNoop && !isReversibleBoundary && !isStale
        ? "blocked"
        : replanAvailable
          ? "inspecting"
          : isStale
            ? "blocked"
          : "executing";
    await this.finishTool({
      started,
      status: isKnownNoop ? "succeeded" : "failed",
      resultCode: result.resultCode,
      detail:
        isStale && !replanAvailable
          ? "The resource changed again after the one permitted replacement plan. Counterstep blocked the run without overwriting it."
          : this.writeResultDetail(result.resultCode),
      nextStatus: terminal,
      terminalReasonCode: isStale
        ? replanAvailable
          ? "stale_revision"
          : "stale_revision_replan_exhausted"
        : terminal === "blocked"
          ? result.resultCode
          : undefined,
      before: result.before,
      after: result.after,
    });
    return isKnownNoop
      ? { ok: true, result }
      : {
          ok: false,
          code: result.resultCode,
          detail: this.writeResultDetail(result.resultCode),
        };
  }

  async verifyClosure(runId: string, planId: string): Promise<
    ToolResult<ClosureReceipt>
  > {
    const started = await this.beginTool({
      runId,
      phase: "verifying",
      toolName: "verify_closure",
      operation: "execute",
      planId,
      stepId: "step-verify-closure",
      detail: "Freshly reading every resource named in the closure goals.",
    });
    const [
      source,
      authority,
      plan,
      approvedPlans,
      inspections,
      currentResources,
    ] =
      await Promise.all([
        getSourceIncidentContext(),
        this.requireAuthority(runId),
        this.repository.getApprovedPlan(runId),
        this.repository.listApprovedPlans(runId),
        this.repository.listInspections(runId),
        this.repository.listResources(started.run.demoId),
      ]);
    if (!plan || plan.planId !== planId) {
      await this.finishTool({
        started,
        status: "failed",
        resultCode: "plan_not_approved",
        detail: "Closure verification requires the active approved plan.",
        nextStatus: "blocked",
        terminalReasonCode: "plan_not_approved",
      });
      return {
        ok: false,
        code: "plan_not_approved",
        detail: "Closure verification requires the active approved plan.",
      };
    }

    const verificationEvent = this.makeCompletionEvent({
      started,
      status: "succeeded",
      resultCode: "verification_completed",
      detail: "Fresh final snapshots were recorded for deterministic closure evaluation.",
      nextPhase: "verifying",
      planId,
      stepId: "step-verify-closure",
    });
    await this.repository.saveEventAndRun(verificationEvent, started.run);
    const [events, latestRun] = await Promise.all([
      this.repository.listEvents(runId),
      this.requireRun(runId),
    ]);
    const generatedAt = this.isoNow();
    const closure = buildClosureReceipt({
      run: latestRun,
      authority,
      plan,
      approvedPlans,
      events,
      inspections,
      currentResources,
      originalTraceId: source.receipt.run.traceId,
      generatedAt,
      appVersion: this.appVersion,
    });
    serializeClosureReceipt(closure);
    const terminalRun = RemediationRunSchema.parse({
      ...latestRun,
      status: closure.outcome,
      completedAt: generatedAt,
      terminalReasonCode:
        closure.outcome === "repaired" ? undefined : closure.outcome,
    });
    await this.repository.saveClosure(terminalRun, closure);
    return { ok: true, result: closure };
  }

  async runFixture(runId: string): Promise<PublicRunView> {
    const [source, authority] = await Promise.all([
      getSourceIncidentContext(),
      this.requireAuthority(runId),
    ]);
    for (const resourceId of authority.readResourceIds) {
      const inspected = await this.inspectResource({ runId, resourceId });
      if (!inspected.ok) return this.requireRunView(runId);
    }
    let activeDecision: Extract<PlanDecision, { status: "approved" }>;
    while (true) {
      const inspections = await this.repository.listInspections(runId);
      const run = await this.requireRun(runId);
      const plan = buildFixtureRecoveryPlan({
        runId,
        planId: this.id("plan"),
        sourceReceiptDigest: run.sourceReceiptDigest,
        incidents: source.incidents,
        inspections,
      });
      const decision = await this.submitRecoveryPlan(runId, plan);
      if (decision.status !== "approved") return this.requireRunView(runId);
      activeDecision = decision;

      let needsReplacementPlan = false;
      for (const step of activeDecision.plan.steps) {
        if (step.tool === "verify_closure") continue;
        const result = await this.executePlanStep({
          runId,
          planId: activeDecision.plan.planId,
          stepId: step.stepId,
          tool: step.tool,
          resourceId: step.resourceId,
          expectedVersion: step.expectedVersion,
          idempotencyKey: deriveIdempotencyKey({
            runId,
            planId: activeDecision.plan.planId,
            stepId: step.stepId,
            tool: step.tool,
            resourceId: step.resourceId,
          }),
        });
        const currentRun = await this.requireRun(runId);
        if (TERMINAL_STATUSES.has(currentRun.status)) {
          return this.requireRunView(runId);
        }
        if (!result.ok && result.code === "stale_revision") {
          for (const resourceId of authority.readResourceIds) {
            const inspected = await this.inspectResource({ runId, resourceId });
            if (!inspected.ok) return this.requireRunView(runId);
          }
          needsReplacementPlan = true;
          break;
        }
      }
      if (!needsReplacementPlan) break;
    }
    await this.verifyClosure(runId, activeDecision.plan.planId);
    return this.requireRunView(runId);
  }

  private async applyStaleScenarioMutationIfNeeded(input: {
    run: RemediationRun;
    existingDecision: PlanDecision | undefined;
  }): Promise<void> {
    if (input.existingDecision) return;
    const demo = await this.repository.getDemo(input.run.demoId);
    if (!demo || demo.scenarioId !== "stale_replan") return;
    const inspections = await this.repository.listInspections(input.run.runId);
    if (
      new Set(inspections.map((inspection) => inspection.resourceId)).size !==
      demo.resourceIds.length
    ) {
      return;
    }
    const spreadsheetInspection = inspections
      .filter(
        (inspection) =>
          inspection.resourceId === "sheet-churn-export-001" &&
          inspection.snapshot.kind === "spreadsheet",
      )
      .at(-1);
    if (!spreadsheetInspection) return;
    await this.repository.applyStaleScenarioMutation({
      demoId: demo.demoId,
      resourceId: spreadsheetInspection.resourceId,
      expectedVersion: spreadsheetInspection.snapshot.version,
      timestamp: this.isoNow(),
    });
  }

  async failClosedWithoutExecution(
    runId: string,
    reasonCode: string,
    detail: string,
  ): Promise<PublicRunView> {
    const run = await this.requireRun(runId);
    if (run.writeCount !== 0) {
      throw new Error("No-execution fallback cannot close a run after writes.");
    }
    const event = ActionEventSchema.parse({
      schemaVersion: COUNTERSTEP_EVENT_SCHEMA_VERSION,
      eventId: this.id("event"),
      runId,
      sequence: await this.nextEventSequence(runId),
      timestamp: this.isoNow(),
      phase: "failed",
      toolName: "system",
      operation: "execute",
      stateChange: false,
      status: "failed",
      attempt: 1,
      actionKey: `system:${reasonCode}`,
      resultCode: reasonCode,
      detail,
    });
    const terminalRun = RemediationRunSchema.parse({
      ...run,
      status: "failed",
      completedAt: event.timestamp,
      terminalReasonCode: reasonCode,
    });
    await this.repository.saveEventAndRun(event, terminalRun);
    return this.requireRunView(runId);
  }

  async markIncompleteAgentRun(
    runId: string,
    reasonCode: string,
    detail: string,
  ): Promise<void> {
    const run = await this.requireRun(runId);
    if (TERMINAL_STATUSES.has(run.status)) return;
    const event = ActionEventSchema.parse({
      schemaVersion: COUNTERSTEP_EVENT_SCHEMA_VERSION,
      eventId: this.id("event"),
      runId,
      sequence: await this.nextEventSequence(runId),
      timestamp: this.isoNow(),
      phase: "failed",
      toolName: "system",
      operation: "execute",
      stateChange: false,
      status: "failed",
      attempt: 1,
      actionKey: `system:${reasonCode}`,
      resultCode: reasonCode,
      detail,
    });
    const terminalRun = RemediationRunSchema.parse({
      ...run,
      status: "failed",
      completedAt: event.timestamp,
      terminalReasonCode: reasonCode,
    });
    await this.repository.saveEventAndRun(event, terminalRun);
  }

  private async beginTool(input: {
    runId: string;
    phase: RemediationRunStatus;
    toolName: ActionEvent["toolName"];
    operation: ActionEvent["operation"];
    resourceId?: string;
    planId?: string;
    stepId?: string;
    detail: string;
  }): Promise<StartedTool> {
    const [run, authority] = await Promise.all([
      this.requireRun(input.runId),
      this.requireAuthority(input.runId),
    ]);
    if (TERMINAL_STATUSES.has(run.status)) {
      throw new Error(`Run is already terminal: ${run.status}.`);
    }
    if (run.toolCallCount >= authority.maxToolCalls) {
      await this.markIncompleteAgentRun(
        input.runId,
        "tool_call_limit_exceeded",
        "The bounded run reached its maximum tool-call count.",
      );
      throw new Error("Tool-call limit exceeded.");
    }
    const event = ActionEventSchema.parse({
      schemaVersion: COUNTERSTEP_EVENT_SCHEMA_VERSION,
      eventId: this.id("event"),
      runId: input.runId,
      sequence: await this.nextEventSequence(input.runId),
      timestamp: this.isoNow(),
      phase: input.phase,
      toolName: input.toolName,
      operation: input.operation,
      resourceId: input.resourceId,
      stateChange: false,
      status: "started",
      attempt: 1,
      actionKey:
        input.stepId && input.planId
          ? `${input.planId}:${input.stepId}`
          : `${input.toolName}:${input.resourceId ?? input.runId}`,
      planId: input.planId,
      stepId: input.stepId,
      resultCode: "started",
      detail: input.detail,
    });
    const nextRun = RemediationRunSchema.parse({
      ...run,
      status: input.phase,
      toolCallCount: run.toolCallCount + 1,
      terminalReasonCode:
        run.terminalReasonCode === "stale_revision" &&
        new Set<RemediationRunStatus>([
          "inspecting",
          "planning",
          "authorizing",
        ]).has(input.phase)
          ? "stale_revision"
          : undefined,
    });
    await this.repository.saveEventAndRun(event, nextRun);
    return { run: nextRun, event };
  }

  private async finishTool(input: {
    started: StartedTool;
    status: "succeeded" | "failed";
    resultCode: string;
    detail: string;
    nextStatus: RemediationRunStatus;
    terminalReasonCode?: string;
    before?: SandboxResource;
    after?: SandboxResource;
  }): Promise<ActionEvent> {
    const terminal = TERMINAL_STATUSES.has(input.nextStatus);
    const nextRun = RemediationRunSchema.parse({
      ...input.started.run,
      status: input.nextStatus,
      completedAt: terminal ? this.isoNow() : undefined,
      terminalReasonCode: input.terminalReasonCode,
    });
    const event = this.makeCompletionEvent({
      started: { ...input.started, run: nextRun },
      status: input.status,
      resultCode: input.resultCode,
      detail: input.detail,
      nextPhase: input.nextStatus,
      resourceId: input.before?.resourceId ?? input.after?.resourceId,
      beforeVersion: input.before?.version,
      afterVersion: input.after?.version,
      beforeDigest: input.before ? digestObject(input.before) : undefined,
      afterDigest: input.after ? digestObject(input.after) : undefined,
    });
    await this.repository.saveEventAndRun(event, nextRun);
    return event;
  }

  private makeCompletionEvent(input: {
    started: StartedTool;
    status: "succeeded" | "failed";
    resultCode: string;
    detail: string;
    nextPhase: RemediationRunStatus;
    resourceId?: string;
    planId?: string;
    stepId?: string;
    beforeVersion?: number;
    afterVersion?: number;
    beforeDigest?: string;
    afterDigest?: string;
  }): ActionEvent {
    return ActionEventSchema.parse({
      schemaVersion: COUNTERSTEP_EVENT_SCHEMA_VERSION,
      eventId: this.id("event"),
      runId: input.started.run.runId,
      sequence: input.started.event.sequence + 1,
      timestamp: this.isoNow(),
      phase: input.nextPhase,
      toolName: input.started.event.toolName,
      operation: input.started.event.operation,
      resourceId:
        input.resourceId ?? input.started.event.resourceId,
      stateChange: false,
      status: input.status,
      attempt: input.started.event.attempt,
      actionKey: input.started.event.actionKey,
      planId: input.planId ?? input.started.event.planId,
      stepId: input.stepId ?? input.started.event.stepId,
      beforeVersion: input.beforeVersion,
      afterVersion: input.afterVersion,
      beforeDigest: input.beforeDigest,
      afterDigest: input.afterDigest,
      resultCode: input.resultCode,
      detail: input.detail,
    });
  }

  private async requireRun(runId: string): Promise<RemediationRun> {
    const run = await this.repository.getRun(runId);
    if (!run) throw new Error("Run not found.");
    return run;
  }

  private async requireAuthority(runId: string) {
    const authority = await this.repository.getAuthority(runId);
    if (!authority) throw new Error("Remediation authority not found.");
    return authority;
  }

  private async requireRunView(runId: string): Promise<PublicRunView> {
    const view = await this.getRunView(runId);
    if (!view) throw new Error("Run not found.");
    return view;
  }

  private async nextEventSequence(runId: string): Promise<number> {
    const events = await this.repository.listEvents(runId);
    return events.length + 1;
  }

  private isoNow(): string {
    return this.now().toISOString();
  }

  private writeResultDetail(resultCode: string): string {
    const details: Record<string, string> = {
      idempotent_replay:
        "The recorded idempotent result was returned without another state change.",
      already_safe:
        "The resource already satisfied the permitted postcondition; no version changed.",
      stale_revision:
        "The resource version changed after inspection. Counterstep did not overwrite it.",
      not_reversible:
        "The message is already delivered; Counterstep did not claim that it was recalled.",
      resource_not_found:
        "The target resource is unavailable and no state was inferred.",
      run_not_active: "The remediation run is not active.",
      authority_expired: "The remediation authority expired before execution.",
      receipt_mismatch:
        "The run and remediation authority reference different source receipts.",
      plan_not_approved: "The action has no active approved plan.",
      step_not_approved: "The action does not match an approved plan step.",
      tool_not_authorized: "The tool is outside remediation authority.",
      resource_not_authorized: "The resource is outside remediation authority.",
      transition_not_authorized: "The requested state transition is not allowed.",
      write_limit_exceeded: "The bounded run reached its maximum write count.",
    };
    return details[resultCode] ?? `The action returned ${resultCode}.`;
  }
}
