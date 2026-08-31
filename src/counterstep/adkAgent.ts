import "server-only";

import {
  FunctionTool,
  InMemoryRunner,
  LlmAgent,
  type Event,
} from "@google/adk";
import { z } from "zod";

import { getSourceIncidentContext } from "./incident";
import type { CounterstepService } from "./service";
import { deriveIdempotencyKey } from "./service";
import {
  RecoveryPlanToolInputSchema,
  type PublicRunView,
  type RemediationAuthority,
  type RemediationRun,
} from "./schemas";

const TERMINAL_RUN_STATUSES = new Set([
  "repaired",
  "partially_repaired",
  "blocked",
  "unable_to_verify",
  "failed",
]);

type AdkInvocation = (input: {
  runner: InMemoryRunner;
  userId: string;
  sessionId: string;
  message: string;
  maxLlmCalls: number;
  abortSignal: AbortSignal;
}) => Promise<void>;

const StrictToolIdSchema = z
  .string()
  .min(3)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const InspectInputSchema = z
  .object({
    resourceId: StrictToolIdSchema,
  })
  .strict();

const WriteInputSchema = z
  .object({
    planId: StrictToolIdSchema,
    stepId: StrictToolIdSchema,
    resourceId: StrictToolIdSchema,
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();

const VerifyInputSchema = z
  .object({
    planId: StrictToolIdSchema,
  })
  .strict();

export function createCounterstepTools(input: {
  service: CounterstepService;
  runId: string;
}) {
  let toolQueue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = toolQueue.then(operation, operation);
    toolQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const inspectResource = new FunctionTool({
    name: "inspect_resource",
    description:
      "Read the current sandbox state and version of one resource authorized for this remediation run. Inspect every authorized resource before planning.",
    parameters: InspectInputSchema,
    execute: async (toolInput) =>
      serialize(() =>
        input.service.inspectResource({
          runId: input.runId,
          resourceId: toolInput.resourceId,
        }),
      ),
  });
  const submitRecoveryPlan = new FunctionTool({
    name: "submit_recovery_plan",
    description:
      "Submit one strict, source-cited recovery plan to Counterstep's deterministic authorization gate. The last step must be verify_closure. A rejected plan is not executable.",
    parameters: RecoveryPlanToolInputSchema,
    execute: async (plan) =>
      serialize(() =>
        input.service.submitRecoveryPlan(input.runId, {
          ...plan,
          runId: input.runId,
        }),
      ),
  });
  const revokeExternalAccess = new FunctionTool({
    name: "revoke_external_access",
    description:
      "Execute the already approved spreadsheet-access revocation step. The deterministic service rechecks plan, authority, resource, version, limits, and idempotency atomically.",
    parameters: WriteInputSchema,
    execute: async (toolInput) =>
      serialize(() =>
        input.service.executePlanStep({
          ...toolInput,
          runId: input.runId,
          tool: "revoke_external_access",
          idempotencyKey: deriveIdempotencyKey({
            ...toolInput,
            runId: input.runId,
            tool: "revoke_external_access",
          }),
        }),
      ),
  });
  const cancelQueuedDelivery = new FunctionTool({
    name: "cancel_queued_delivery",
    description:
      "Execute the already approved queued-message cancellation step. Delivered messages are reported as not reversible and are never described as recalled.",
    parameters: WriteInputSchema,
    execute: async (toolInput) =>
      serialize(() =>
        input.service.executePlanStep({
          ...toolInput,
          runId: input.runId,
          tool: "cancel_queued_delivery",
          idempotencyKey: deriveIdempotencyKey({
            ...toolInput,
            runId: input.runId,
            tool: "cancel_queued_delivery",
          }),
        }),
      ),
  });
  const verifyClosure = new FunctionTool({
    name: "verify_closure",
    description:
      "Perform fresh final resource reads, evaluate every declared closure goal, and produce the integrity-bound closure receipt for the active approved plan.",
    parameters: VerifyInputSchema,
    execute: async (toolInput) =>
      serialize(() =>
        input.service.verifyClosure(input.runId, toolInput.planId),
      ),
  });
  return [
    inspectResource,
    submitRecoveryPlan,
    revokeExternalAccess,
    cancelQueuedDelivery,
    verifyClosure,
  ] as const;
}

function buildAgentInstruction(input: {
  run: RemediationRun;
  authority: RemediationAuthority;
  sourceContext: Awaited<ReturnType<typeof getSourceIncidentContext>>;
}): string {
  return `You are Counterstep, a bounded remediation agent operating on a synthetic sandbox incident.

Your job is to close the declared incident goals, not to chat about them. Use tools for every observation and action. Never invent resource state, citations, approval, success, or reversibility.

Required sequence:
1. Call inspect_resource once for every resourceId in authority.readResourceIds.
2. Construct one RecoveryPlan matching the strict tool schema. Cite only incidentIds, findingIds, and eventIds supplied below. Include only writes still required by inspected state. The final step must call verify_closure.
3. Call submit_recovery_plan. Stop if rejected. You may submit exactly one replacement plan only after a write returns stale_revision.
4. For each approved consequential step, call its matching write tool with the exact planId, stepId, resourceId, and expectedVersion. Counterstep binds the run ID and derives the idempotency key server-side; never invent either value.
5. If a write returns stale_revision, do not retry it. Re-inspect every resourceId in authority.readResourceIds, submit one replacement plan using only the newest inspection for each resource, and execute only the still-required approved steps. If any later write is stale, stop.
6. Call verify_closure with the active planId.
7. End with a one-sentence factual status. Do not claim more than the tool result.

You are not finished merely because every write succeeded. The run is complete only after verify_closure returns a terminal result.

Run envelope:
${JSON.stringify(input.run)}

Remediation authority:
${JSON.stringify(input.authority)}

Source incident and closure goals:
${JSON.stringify(input.sourceContext.publicView)}

The deterministic gate and transactional write layer are authoritative. Never route around a tool error; stale_revision has only the bounded replacement-plan procedure above.`;
}

export async function createCounterstepAgent(input: {
  service: CounterstepService;
  run: RemediationRun;
  authority: RemediationAuthority;
  modelId: string;
}): Promise<LlmAgent> {
  const sourceContext = await getSourceIncidentContext();
  return new LlmAgent({
    name: "counterstep_recovery_agent",
    description:
      "An evidence-bound agent that inspects, plans, executes authorized repairs, and verifies closure.",
    model: input.modelId,
    instruction: buildAgentInstruction({
      run: input.run,
      authority: input.authority,
      sourceContext,
    }),
    tools: [
      ...createCounterstepTools({
        service: input.service,
        runId: input.run.runId,
      }),
    ],
    includeContents: "none",
    disallowTransferToParent: true,
    disallowTransferToPeers: true,
    generateContentConfig: {
      temperature: 0.1,
    },
  });
}

export function buildBoundedContinuationMessage(
  view: PublicRunView,
): string | undefined {
  if (
    view.closure ||
    TERMINAL_RUN_STATUSES.has(view.run.status) ||
    view.run.status !== "executing" ||
    !view.run.activePlanId ||
    view.planDecision?.status !== "approved" ||
    view.planDecision.plan.planId !== view.run.activePlanId
  ) {
    return undefined;
  }
  const activePlan = view.approvedPlans.find(
    (plan) => plan.planId === view.run.activePlanId,
  );
  if (!activePlan) return undefined;

  const completedResultCodes = new Set([
    "succeeded",
    "idempotent_replay",
    "already_safe",
    "not_reversible",
  ]);
  const completedStepIds = new Set(
    view.events
      .filter(
        (event) =>
          event.planId === activePlan.planId &&
          event.stepId &&
          completedResultCodes.has(event.resultCode),
      )
      .map((event) => event.stepId as string),
  );
  const unsafeFailedStep = view.events.some(
    (event) =>
      event.planId === activePlan.planId &&
      event.stepId &&
      event.status === "failed" &&
      event.resultCode !== "not_reversible",
  );
  if (unsafeFailedStep) return undefined;

  const consequentialSteps = activePlan.steps.filter(
    (step) => step.tool !== "verify_closure",
  );
  const remainingSteps = consequentialSteps
    .filter((step) => !completedStepIds.has(step.stepId))
    .map((step) => ({
      planId: activePlan.planId,
      stepId: step.stepId,
      tool: step.tool,
      resourceId: step.resourceId,
      expectedVersion: step.expectedVersion,
    }));
  const remainingToolCalls =
    view.authority.maxToolCalls - view.run.toolCallCount;
  if (remainingToolCalls < remainingSteps.length + 1) return undefined;

  const envelope = {
    schemaVersion: "counterstep.adk-continuation.v1",
    runId: view.run.runId,
    activePlanId: activePlan.planId,
    runStatus: view.run.status,
    counters: {
      toolCallsUsed: view.run.toolCallCount,
      toolCallsRemaining: remainingToolCalls,
      writesUsed: view.run.writeCount,
      maxWrites: view.authority.maxWrites,
      replansUsed: view.run.replanCount,
      replacementPlanAvailable: view.run.replanCount === 0,
    },
    completedStepIds: [...completedStepIds].sort(),
    remainingSteps,
    requiredFinalCall: {
      tool: "verify_closure",
      planId: activePlan.planId,
    },
  };
  return `A prior ADK invocation for this same run ended naturally before Counterstep reached a terminal closure. This is the only bounded continuation.

Resume the existing approved plan; do not create or submit another plan unless a newly attempted remaining write returns stale_revision and the original bounded replacement-plan procedure permits it. Never repeat a completed step. Execute only the exact remaining steps below, in order, using their exact arguments. Then call verify_closure with the exact active planId. Do not stop after a successful write.

The deterministic gate and transactional tools remain authoritative. If any tool rejects an action, obey that result and do not route around it. Missing fields remain unknown.

Continuation envelope:
${JSON.stringify(envelope)}`;
}

async function invokeAdk(input: {
  runner: InMemoryRunner;
  userId: string;
  sessionId: string;
  message: string;
  maxLlmCalls: number;
  abortSignal: AbortSignal;
}): Promise<void> {
  const stream = input.runner.runAsync({
    userId: input.userId,
    sessionId: input.sessionId,
    newMessage: {
      role: "user",
      parts: [{ text: input.message }],
    },
    runConfig: {
      maxLlmCalls: input.maxLlmCalls,
    },
    abortSignal: input.abortSignal,
  });
  for await (const event of stream as AsyncGenerator<Event>) {
    // ADK events are persisted in its ephemeral session. Counterstep persists
    // only validated domain tool events, so model narration cannot become proof.
    void event;
  }
}

export async function runGeminiRecovery(input: {
  service: CounterstepService;
  runId: string;
  modelId: string;
  timeoutMs?: number;
  invokeAdk?: AdkInvocation;
}): Promise<PublicRunView> {
  const run = await input.service.repository.getRun(input.runId);
  const authority = await input.service.repository.getAuthority(input.runId);
  if (!run || !authority) throw new Error("Run envelope is incomplete.");
  const agent = await createCounterstepAgent({
    service: input.service,
    run,
    authority,
    modelId: input.modelId,
  });
  const runner = new InMemoryRunner({
    agent,
    appName: "counterstep",
  });
  const userId = `counterstep-user-${input.runId}`;
  const sessionId = `counterstep-session-${input.runId}`;
  await runner.sessionService.createSession({
    appName: runner.appName,
    userId,
    sessionId,
  });
  const invoke = input.invokeAdk ?? invokeAdk;
  const invokeWithTimeout = async (message: string, maxLlmCalls: number) => {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error("Counterstep agent timeout.")),
      input.timeoutMs ?? 30_000,
    );
    try {
      await invoke({
        runner,
        userId,
        sessionId,
        message,
        maxLlmCalls,
        abortSignal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  };
  try {
    await invokeWithTimeout(
      `Start the bounded remediation run ${input.runId}. Execute the required tool sequence now.`,
      8,
    );
    let completed = await input.service.getRunView(input.runId);
    if (!completed) throw new Error("Run disappeared after agent execution.");
    if (TERMINAL_RUN_STATUSES.has(completed.run.status)) {
      return completed;
    }
    const continuationMessage = buildBoundedContinuationMessage(completed);
    if (continuationMessage) {
      await invokeWithTimeout(continuationMessage, 6);
      completed = await input.service.getRunView(input.runId);
      if (!completed) {
        throw new Error("Run disappeared after bounded continuation.");
      }
      if (TERMINAL_RUN_STATUSES.has(completed.run.status)) return completed;
      await input.service.markIncompleteAgentRun(
        input.runId,
        "agent_stopped_after_bounded_continuation",
        "The ADK run used its one bounded continuation but still ended before producing a terminal closure result.",
      );
    } else {
      await input.service.markIncompleteAgentRun(
        input.runId,
        "agent_stopped_without_closure",
        "The ADK run ended before producing a terminal closure result, and its persisted state was not eligible for bounded continuation.",
      );
    }
  } catch (error) {
    const current = await input.service.getRunView(input.runId);
    if (!current) throw error;
    if (TERMINAL_RUN_STATUSES.has(current.run.status)) {
      return current;
    }
    const detail =
      error instanceof Error
        ? `Gemini/ADK execution stopped: ${error.message}`
        : "Gemini/ADK execution stopped for an unknown reason.";
    if (current.run.writeCount === 0) {
      return input.service.failClosedWithoutExecution(
        input.runId,
        "agent_execution_failed",
        detail,
      );
    }
    await input.service.markIncompleteAgentRun(
      input.runId,
      "agent_execution_failed_after_write",
      detail,
    );
  }
  const finalView = await input.service.getRunView(input.runId);
  if (!finalView) throw new Error("Run disappeared after finalization.");
  return finalView;
}

export function expectedWriteIdempotencyKey(input: {
  runId: string;
  planId: string;
  stepId: string;
  tool: "revoke_external_access" | "cancel_queued_delivery";
  resourceId: string;
}): string {
  return deriveIdempotencyKey(input);
}
