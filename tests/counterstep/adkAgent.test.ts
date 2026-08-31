import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildBoundedContinuationMessage,
  createCounterstepAgent,
  createCounterstepTools,
  expectedWriteIdempotencyKey,
  runGeminiRecovery,
} from "../../src/counterstep/adkAgent.js";
import { buildFixtureRecoveryPlan } from "../../src/counterstep/fixturePlanner.js";
import { getSourceIncidentContext } from "../../src/counterstep/incident.js";
import { InMemoryCounterstepRepository } from "../../src/counterstep/memoryRepository.js";
import { CounterstepService } from "../../src/counterstep/service.js";
import type {
  DemoRecord,
  RecoveryPlan,
  RemediationRun,
} from "../../src/counterstep/schemas.js";

async function inspectAndApprovePlan(input: {
  service: CounterstepService;
  run: RemediationRun;
  demo: DemoRecord;
  planId: string;
}): Promise<RecoveryPlan> {
  for (const resourceId of input.demo.resourceIds) {
    await input.service.inspectResource({
      runId: input.run.runId,
      resourceId,
    });
  }
  const source = await getSourceIncidentContext();
  const inspected = await input.service.getRunView(input.run.runId);
  if (!inspected) throw new Error("Inspected run view is missing.");
  const plan = buildFixtureRecoveryPlan({
    runId: input.run.runId,
    planId: input.planId,
    sourceReceiptDigest: input.run.sourceReceiptDigest,
    incidents: source.incidents,
    inspections: inspected.inspections,
  });
  const decision = await input.service.submitRecoveryPlan(
    input.run.runId,
    plan,
  );
  if (decision.status !== "approved") {
    throw new Error("Test recovery plan was not approved.");
  }
  return plan;
}

async function executePlanWrite(input: {
  service: CounterstepService;
  runId: string;
  plan: RecoveryPlan;
  index: number;
}) {
  const steps = input.plan.steps.filter(
    (step) => step.tool !== "verify_closure",
  );
  const step = steps[input.index];
  if (!step) {
    throw new Error(`Write step ${input.index} is missing.`);
  }
  return input.service.executePlanStep({
    runId: input.runId,
    planId: input.plan.planId,
    stepId: step.stepId,
    tool: step.tool,
    resourceId: step.resourceId,
    expectedVersion: step.expectedVersion,
    idempotencyKey: expectedWriteIdempotencyKey({
      runId: input.runId,
      planId: input.plan.planId,
      stepId: step.stepId,
      tool: step.tool,
      resourceId: step.resourceId,
    }),
  });
}

describe("Google ADK recovery agent", () => {
  it("exposes the five bounded domain tools with generated schemas", () => {
    const service = new CounterstepService(
      new InMemoryCounterstepRepository(),
    );
    const declarations = createCounterstepTools({
      service,
      runId: "run-adk-schema",
    }).map((tool) => tool._getDeclaration());
    expect(declarations.map((declaration) => declaration.name)).toStrictEqual([
      "inspect_resource",
      "submit_recovery_plan",
      "revoke_external_access",
      "cancel_queued_delivery",
      "verify_closure",
    ]);
    expect(
      declarations.every(
        (declaration) =>
          declaration.parameters || declaration.parametersJsonSchema,
      ),
    ).toBe(true);
    const declarationsJson = JSON.stringify(declarations);
    expect(declarationsJson).not.toContain('"runId"');
    expect(declarationsJson).not.toContain('"idempotencyKey"');
  });

  it("binds model tools to one run and derives write idempotency server-side", async () => {
    let id = 0;
    const repository = new InMemoryCounterstepRepository();
    const service = new CounterstepService(repository, {
      id: (prefix) => `${prefix}-bound-${++id}`,
    });
    const demo = await service.resetDemo();
    const run = await service.createRun({
      demoId: demo.demo.demoId,
      sourceReceiptDigest: demo.demo.sourceReceiptDigest,
      generationSource: "gemini",
      modelId: "gemini-3.5-flash-lite",
    });
    const tools = createCounterstepTools({ service, runId: run.runId });
    const getTool = (name: string) => {
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`Missing tool ${name}.`);
      return tool;
    };
    const runTool = (name: string, args: Record<string, unknown>) =>
      getTool(name).runAsync({ args, toolContext: undefined as never });

    await expect(
      runTool("inspect_resource", {
        runId: "run-model-supplied",
        resourceId: demo.demo.resourceIds[0],
      }),
    ).rejects.toThrow("Unrecognized key");
    for (const resourceId of demo.demo.resourceIds) {
      await expect(
        runTool("inspect_resource", { resourceId }),
      ).resolves.toMatchObject({
        ok: true,
        result: { runId: run.runId, resourceId },
      });
    }
    const source = await getSourceIncidentContext();
    const inspected = await service.getRunView(run.runId);
    if (!inspected) throw new Error("Run view is missing.");
    const plan = buildFixtureRecoveryPlan({
      runId: run.runId,
      planId: "plan-bound-tools",
      sourceReceiptDigest: run.sourceReceiptDigest,
      incidents: source.incidents,
      inspections: inspected.inspections,
    });
    const modelPlan = {
      schemaVersion: plan.schemaVersion,
      planId: plan.planId,
      sourceReceiptDigest: plan.sourceReceiptDigest,
      rationaleSummary: plan.rationaleSummary,
      steps: plan.steps,
    };
    await expect(
      runTool("submit_recovery_plan", modelPlan),
    ).resolves.toMatchObject({ status: "approved" });
    const step = plan.steps.find(
      (candidate) => candidate.tool === "revoke_external_access",
    );
    if (!step || step.tool === "verify_closure") {
      throw new Error("Spreadsheet step is missing.");
    }
    await expect(
      runTool("revoke_external_access", {
        planId: plan.planId,
        stepId: step.stepId,
        resourceId: step.resourceId,
        expectedVersion: step.expectedVersion,
      }),
    ).resolves.toMatchObject({
      ok: true,
      result: { resultCode: "succeeded", stateChanged: true },
    });
    await expect(repository.getRun(run.runId)).resolves.toMatchObject({
      writeCount: 1,
    });
  });

  it("constructs a Gemini agent without invoking a model", async () => {
    let id = 0;
    const repository = new InMemoryCounterstepRepository();
    const service = new CounterstepService(repository, {
      id: (prefix) => `${prefix}-adk-${++id}`,
    });
    const demo = await service.resetDemo();
    const run = await service.createRun({
      demoId: demo.demo.demoId,
      sourceReceiptDigest: demo.demo.sourceReceiptDigest,
      generationSource: "gemini",
      modelId: "gemini-3.5-flash-lite",
    });
    const authority = await repository.getAuthority(run.runId);
    if (!authority) throw new Error("Authority is missing.");
    const agent = await createCounterstepAgent({
      service,
      run,
      authority,
      modelId: "gemini-3.5-flash-lite",
    });
    expect(agent.model).toBe("gemini-3.5-flash-lite");
    expect(agent.includeContents).toBe("none");
    expect(agent.tools).toHaveLength(5);
    expect(agent.instruction).toContain("The deterministic gate");
    expect(agent.instruction).toContain(
      "Re-inspect every resourceId in authority.readResourceIds",
    );
    expect(agent.instruction).toContain("exactly one replacement plan");
    expect(agent.instruction).toContain(
      "complete only after verify_closure returns a terminal result",
    );
  });

  it("uses one bounded continuation to finish an approved partially executed plan", async () => {
    let id = 0;
    const repository = new InMemoryCounterstepRepository();
    const service = new CounterstepService(repository, {
      id: (prefix) => `${prefix}-continue-${++id}`,
    });
    const demo = await service.resetDemo();
    const run = await service.createRun({
      demoId: demo.demo.demoId,
      sourceReceiptDigest: demo.demo.sourceReceiptDigest,
      generationSource: "gemini",
      modelId: "gemini-3.5-flash-lite",
    });
    let plan: RecoveryPlan | undefined;
    let invocation = 0;
    const invokeAdk = vi.fn(
      async (input: { message: string; maxLlmCalls: number }) => {
        invocation += 1;
        if (invocation === 1) {
          expect(input.maxLlmCalls).toBe(8);
          plan = await inspectAndApprovePlan({
            service,
            run,
            demo: demo.demo,
            planId: "plan-bounded-continuation",
          });
          await executePlanWrite({
            service,
            runId: run.runId,
            plan,
            index: 0,
          });
          return;
        }
        expect(input.maxLlmCalls).toBe(6);
        expect(plan).toBeDefined();
        const envelopeText = input.message.split("Continuation envelope:\n")[1];
        const envelope = JSON.parse(envelopeText) as {
          activePlanId: string;
          completedStepIds: string[];
          remainingSteps: Array<{ stepId: string }>;
          requiredFinalCall: { tool: string; planId: string };
        };
        const writeSteps = plan!.steps.filter(
          (step) => step.tool !== "verify_closure",
        );
        expect(envelope).toMatchObject({
          activePlanId: plan!.planId,
          completedStepIds: [writeSteps[0].stepId],
          remainingSteps: [{ stepId: writeSteps[1].stepId }],
          requiredFinalCall: {
            tool: "verify_closure",
            planId: plan!.planId,
          },
        });
        await executePlanWrite({
          service,
          runId: run.runId,
          plan: plan!,
          index: 1,
        });
        await service.verifyClosure(run.runId, plan!.planId);
      },
    );

    const result = await runGeminiRecovery({
      service,
      runId: run.runId,
      modelId: "gemini-3.5-flash-lite",
      invokeAdk,
    });

    expect(invokeAdk).toHaveBeenCalledTimes(2);
    expect(result.run).toMatchObject({
      status: "repaired",
      toolCallCount: 6,
      writeCount: 2,
    });
    expect(result.closure).toBeDefined();
  });

  it("never grants more than one continuation when the agent stops again", async () => {
    let id = 0;
    const repository = new InMemoryCounterstepRepository();
    const service = new CounterstepService(repository, {
      id: (prefix) => `${prefix}-bounded-stop-${++id}`,
    });
    const demo = await service.resetDemo();
    const run = await service.createRun({
      demoId: demo.demo.demoId,
      sourceReceiptDigest: demo.demo.sourceReceiptDigest,
      generationSource: "gemini",
      modelId: "gemini-3.5-flash-lite",
    });
    let invocation = 0;
    const invokeAdk = vi.fn(async () => {
      invocation += 1;
      if (invocation !== 1) return;
      const plan = await inspectAndApprovePlan({
        service,
        run,
        demo: demo.demo,
        planId: "plan-bounded-stop",
      });
      await executePlanWrite({ service, runId: run.runId, plan, index: 0 });
      await executePlanWrite({ service, runId: run.runId, plan, index: 1 });
    });

    const result = await runGeminiRecovery({
      service,
      runId: run.runId,
      modelId: "gemini-3.5-flash-lite",
      invokeAdk,
    });

    expect(invokeAdk).toHaveBeenCalledTimes(2);
    expect(result.run).toMatchObject({
      status: "failed",
      writeCount: 2,
      terminalReasonCode: "agent_stopped_after_bounded_continuation",
    });
    expect(result.closure).toBeUndefined();
  });

  it("does not offer continuation without an approved active plan", async () => {
    let id = 0;
    const repository = new InMemoryCounterstepRepository();
    const service = new CounterstepService(repository, {
      id: (prefix) => `${prefix}-no-plan-${++id}`,
    });
    const demo = await service.resetDemo();
    const run = await service.createRun({
      demoId: demo.demo.demoId,
      sourceReceiptDigest: demo.demo.sourceReceiptDigest,
      generationSource: "gemini",
      modelId: "gemini-3.5-flash-lite",
    });
    const view = await service.getRunView(run.runId);
    if (!view) throw new Error("Run view is missing.");
    expect(buildBoundedContinuationMessage(view)).toBeUndefined();
  });

  it("derives the write idempotency key from the complete action envelope", () => {
    expect(
      expectedWriteIdempotencyKey({
        runId: "run-adk-test",
        planId: "plan-adk-test",
        stepId: "step-adk-test",
        tool: "revoke_external_access",
        resourceId: "sheet-churn-export-001",
      }),
    ).toMatch(/^[a-f0-9]{64}$/);
  });
});
