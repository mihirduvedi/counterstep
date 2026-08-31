import { describe, expect, it } from "vitest";

import {
  serializeClosureReceipt,
  verifyClosureReceipt,
} from "../../src/counterstep/closure.js";
import { buildFixtureRecoveryPlan } from "../../src/counterstep/fixturePlanner.js";
import { getSourceIncidentContext } from "../../src/counterstep/incident.js";
import { InMemoryCounterstepRepository } from "../../src/counterstep/memoryRepository.js";
import {
  CounterstepService,
  deriveIdempotencyKey,
} from "../../src/counterstep/service.js";
import { SandboxResourceSchema } from "../../src/counterstep/schemas.js";

function harness() {
  let milliseconds = Date.parse("2026-08-29T18:00:00.000Z");
  let idCounter = 0;
  const repository = new InMemoryCounterstepRepository();
  const service = new CounterstepService(repository, {
    now: () => {
      const value = new Date(milliseconds);
      milliseconds += 1_000;
      return value;
    },
    id: (prefix) => `${prefix}-test-${++idCounter}`,
    appVersion: "test",
  });
  return { repository, service };
}

describe("Counterstep end-to-end deterministic contract", () => {
  it("repairs the canonical incident and issues a verified closure receipt", async () => {
    const { service } = harness();
    const demo = await service.resetDemo();
    const run = await service.createRun({
      demoId: demo.demo.demoId,
      sourceReceiptDigest: demo.demo.sourceReceiptDigest,
      generationSource: "deterministic_fixture",
      modelId: "gemini-3.5-flash-lite",
    });
    const view = await service.runFixture(run.runId);

    expect(view.run.status).toBe("repaired");
    expect(view.run.writeCount).toBe(2);
    expect(view.run.toolCallCount).toBe(6);
    expect(view.events).toHaveLength(12);
    expect(view.events.map((event) => event.sequence)).toStrictEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    );
    const sheet = view.currentResources.find(
      (resource) => resource.kind === "spreadsheet",
    );
    const message = view.currentResources.find(
      (resource) => resource.kind === "queued_message",
    );
    expect(sheet).toMatchObject({ accessState: "revoked", version: 4 });
    expect(message).toMatchObject({ deliveryState: "cancelled", version: 2 });
    expect(view.closure?.outcome).toBe("repaired");
    expect(view.closure?.remediation.actionReceipt.verdict).toBe(
      "within_remediation_authority",
    );
    expect(verifyClosureReceipt(view.closure).valid).toBe(true);
    expect(serializeClosureReceipt(view.closure!)).toContain(
      '"schemaVersion": "counterstep.closure-receipt.v1"',
    );
  });

  it("returns a prior idempotent result without incrementing twice", async () => {
    const { service } = harness();
    const demo = await service.resetDemo();
    const run = await service.createRun({
      demoId: demo.demo.demoId,
      sourceReceiptDigest: demo.demo.sourceReceiptDigest,
      generationSource: "deterministic_fixture",
      modelId: "gemini-3.5-flash-lite",
    });
    const source = await getSourceIncidentContext();
    for (const resourceId of [
      "sheet-churn-export-001",
      "message-retention-001",
    ]) {
      const result = await service.inspectResource({
        runId: run.runId,
        resourceId,
      });
      expect(result.ok).toBe(true);
    }
    const beforePlan = await service.getRunView(run.runId);
    const plan = buildFixtureRecoveryPlan({
      runId: run.runId,
      planId: "plan-idempotency",
      sourceReceiptDigest: run.sourceReceiptDigest,
      incidents: source.incidents,
      inspections: beforePlan!.inspections,
    });
    const decision = await service.submitRecoveryPlan(run.runId, plan);
    expect(decision.status).toBe("approved");
    if (decision.status !== "approved") throw new Error("Plan was rejected.");
    const step = decision.plan.steps.find(
      (candidate) => candidate.tool === "revoke_external_access",
    );
    if (!step || step.tool === "verify_closure") {
      throw new Error("Spreadsheet step is missing.");
    }
    const input = {
      runId: run.runId,
      planId: decision.plan.planId,
      stepId: step.stepId,
      tool: step.tool,
      resourceId: step.resourceId,
      expectedVersion: step.expectedVersion,
      idempotencyKey: deriveIdempotencyKey({
        runId: run.runId,
        planId: decision.plan.planId,
        stepId: step.stepId,
        tool: step.tool,
        resourceId: step.resourceId,
      }),
    } as const;
    const first = await service.executePlanStep(input);
    const second = await service.executePlanStep(input);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(second.detail);
    expect(second.result.resultCode).toBe("idempotent_replay");
    expect(second.result.stateChanged).toBe(false);
    expect(second.result.event).toBeUndefined();
    const view = await service.getRunView(run.runId);
    if (!view) throw new Error("Run view is missing.");
    expect(view?.run.writeCount).toBe(1);
    expect(view.events.map((event) => event.sequence)).toStrictEqual(
      Array.from({ length: view.events.length }, (_, index) => index + 1),
    );
    expect(view.events.at(-1)).toMatchObject({
      resultCode: "idempotent_replay",
      stateChange: false,
    });
    expect(
      view?.currentResources.find(
        (resource) => resource.kind === "spreadsheet",
      ),
    ).toMatchObject({ version: 4, accessState: "revoked" });
  });

  it("reports partial repair when a message is already delivered", async () => {
    const { repository, service } = harness();
    const demo = await service.resetDemo();
    const resources = demo.resources.map((resource) =>
      resource.kind === "queued_message"
        ? SandboxResourceSchema.parse({
            ...resource,
            deliveryState: "delivered",
          })
        : resource,
    );
    await repository.resetDemo(demo.demo, resources);
    const run = await service.createRun({
      demoId: demo.demo.demoId,
      sourceReceiptDigest: demo.demo.sourceReceiptDigest,
      generationSource: "deterministic_fixture",
      modelId: "gemini-3.5-flash-lite",
    });
    const view = await service.runFixture(run.runId);
    expect(view.run.status).toBe("partially_repaired");
    expect(view.run.writeCount).toBe(1);
    expect(view.closure?.goalResults.map((result) => result.status)).toContain(
      "unsatisfied",
    );
    expect(view.closure?.limitations.join(" ")).toContain("unresolved");
  });

  it("fails closed without Gemini and performs no writes", async () => {
    const { service } = harness();
    const demo = await service.resetDemo();
    const run = await service.createRun({
      demoId: demo.demo.demoId,
      sourceReceiptDigest: demo.demo.sourceReceiptDigest,
      generationSource: "deterministic_no_execution",
    });
    const view = await service.failClosedWithoutExecution(
      run.runId,
      "gemini_not_configured",
      "Gemini is not configured; no recovery action was executed.",
    );
    expect(view.run.status).toBe("failed");
    expect(view.run.writeCount).toBe(0);
    expect(view.currentResources).toStrictEqual(demo.resources);
  });

  it("claims an API run once before executing it", async () => {
    const { repository, service } = harness();
    const demo = await service.resetDemo();
    const run = await service.createRun({
      demoId: demo.demo.demoId,
      sourceReceiptDigest: demo.demo.sourceReceiptDigest,
      generationSource: "deterministic_fixture",
    });
    const admission = {
      dateKey: "2026-08-29",
      maxRuns: 200,
      timestamp: "2026-08-29T18:00:00.000Z",
    } as const;
    await expect(
      repository.claimRunForExecution(run.runId, admission),
    ).resolves.toBe("claimed");
    await expect(
      repository.claimRunForExecution(run.runId, admission),
    ).resolves.toBe("already_started");
    const view = await service.runFixture(run.runId);
    expect(view.run.status).toBe("repaired");
  });

  it("atomically caps executions per UTC day without consuming a slot twice", async () => {
    const { repository, service } = harness();
    const demo = await service.resetDemo();
    const createRun = () =>
      service.createRun({
        demoId: demo.demo.demoId,
        sourceReceiptDigest: demo.demo.sourceReceiptDigest,
        generationSource: "deterministic_fixture",
      });
    const [firstRun, secondRun, thirdRun] = await Promise.all([
      createRun(),
      createRun(),
      createRun(),
    ]);
    const admission = {
      dateKey: "2026-08-29",
      maxRuns: 2,
      timestamp: "2026-08-29T18:00:00.000Z",
    } as const;

    await expect(
      Promise.all([
        repository.claimRunForExecution(firstRun.runId, admission),
        repository.claimRunForExecution(firstRun.runId, admission),
      ]),
    ).resolves.toEqual(expect.arrayContaining(["claimed", "already_started"]));
    await expect(
      repository.claimRunForExecution(secondRun.runId, admission),
    ).resolves.toBe("claimed");
    await expect(
      repository.claimRunForExecution(thirdRun.runId, admission),
    ).resolves.toBe("daily_limit_exceeded");
    await expect(repository.getRun(thirdRun.runId)).resolves.toMatchObject({
      status: "created",
    });
    await expect(
      repository.claimRunForExecution(thirdRun.runId, {
        ...admission,
        dateKey: "2026-08-30",
        timestamp: "2026-08-30T00:00:00.000Z",
      }),
    ).resolves.toBe("claimed");
  });
});
