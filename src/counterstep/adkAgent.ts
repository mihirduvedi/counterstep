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
  RecoveryPlanSchema,
  type PublicRunView,
  type RemediationAuthority,
  type RemediationRun,
} from "./schemas";

const StrictToolIdSchema = z
  .string()
  .min(3)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const InspectInputSchema = z
  .object({
    runId: StrictToolIdSchema,
    resourceId: StrictToolIdSchema,
  })
  .strict();

const WriteInputSchema = z
  .object({
    runId: StrictToolIdSchema,
    planId: StrictToolIdSchema,
    stepId: StrictToolIdSchema,
    resourceId: StrictToolIdSchema,
    expectedVersion: z.number().int().nonnegative(),
    idempotencyKey: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

const VerifyInputSchema = z
  .object({
    runId: StrictToolIdSchema,
    planId: StrictToolIdSchema,
  })
  .strict();

export function createCounterstepTools(service: CounterstepService) {
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
    execute: async (input) => serialize(() => service.inspectResource(input)),
  });
  const submitRecoveryPlan = new FunctionTool({
    name: "submit_recovery_plan",
    description:
      "Submit one strict, source-cited recovery plan to Counterstep's deterministic authorization gate. The last step must be verify_closure. A rejected plan is not executable.",
    parameters: RecoveryPlanSchema,
    execute: async (plan) =>
      serialize(() => service.submitRecoveryPlan(plan.runId, plan)),
  });
  const revokeExternalAccess = new FunctionTool({
    name: "revoke_external_access",
    description:
      "Execute the already approved spreadsheet-access revocation step. The deterministic service rechecks plan, authority, resource, version, limits, and idempotency atomically.",
    parameters: WriteInputSchema,
    execute: async (input) =>
      serialize(() =>
        service.executePlanStep({
          ...input,
          tool: "revoke_external_access",
        }),
      ),
  });
  const cancelQueuedDelivery = new FunctionTool({
    name: "cancel_queued_delivery",
    description:
      "Execute the already approved queued-message cancellation step. Delivered messages are reported as not reversible and are never described as recalled.",
    parameters: WriteInputSchema,
    execute: async (input) =>
      serialize(() =>
        service.executePlanStep({
          ...input,
          tool: "cancel_queued_delivery",
        }),
      ),
  });
  const verifyClosure = new FunctionTool({
    name: "verify_closure",
    description:
      "Perform fresh final resource reads, evaluate every declared closure goal, and produce the integrity-bound closure receipt for the active approved plan.",
    parameters: VerifyInputSchema,
    execute: async (input) =>
      serialize(() => service.verifyClosure(input.runId, input.planId)),
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
4. For each approved consequential step, call its matching write tool with the exact planId, stepId, resourceId, and expectedVersion. Compute idempotencyKey as SHA-256 of "runId:planId:stepId:tool:resourceId" in lowercase hex.
5. If a write returns stale_revision, do not retry it. Re-inspect every resourceId in authority.readResourceIds, submit one replacement plan using only the newest inspection for each resource, and execute only the still-required approved steps. If any later write is stale, stop.
6. Call verify_closure with the active planId.
7. End with a one-sentence factual status. Do not claim more than the tool result.

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
    tools: [...createCounterstepTools(input.service)],
    includeContents: "none",
    disallowTransferToParent: true,
    disallowTransferToPeers: true,
    generateContentConfig: {
      temperature: 0.1,
    },
  });
}

export async function runGeminiRecovery(input: {
  service: CounterstepService;
  runId: string;
  modelId: string;
  timeoutMs?: number;
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
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("Counterstep agent timeout.")),
    input.timeoutMs ?? 30_000,
  );
  try {
    const stream = runner.runAsync({
      userId,
      sessionId,
      newMessage: {
        role: "user",
        parts: [
          {
            text: `Start the bounded remediation run ${input.runId}. Execute the required tool sequence now.`,
          },
        ],
      },
      runConfig: {
        maxLlmCalls: 8,
      },
      abortSignal: controller.signal,
    });
    for await (const event of stream as AsyncGenerator<Event>) {
      // ADK events are persisted in its ephemeral session. Counterstep persists
      // only validated domain tool events, so model narration cannot become proof.
      void event;
    }
    const completed = await input.service.getRunView(input.runId);
    if (!completed) throw new Error("Run disappeared after agent execution.");
    if (
      new Set([
        "repaired",
        "partially_repaired",
        "blocked",
        "unable_to_verify",
        "failed",
      ]).has(completed.run.status)
    ) {
      return completed;
    }
    await input.service.markIncompleteAgentRun(
      input.runId,
      "agent_stopped_without_closure",
      "The ADK run ended before producing a terminal closure result.",
    );
  } catch (error) {
    const current = await input.service.getRunView(input.runId);
    if (!current) throw error;
    if (
      new Set([
        "repaired",
        "partially_repaired",
        "blocked",
        "unable_to_verify",
        "failed",
      ]).has(current.run.status)
    ) {
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
  } finally {
    clearTimeout(timeout);
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
