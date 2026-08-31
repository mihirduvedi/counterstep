import { describe, expect, it } from "vitest";

import type { AtomicWriteRequest } from "../../src/counterstep/repository.js";
import { InMemoryCounterstepRepository } from "../../src/counterstep/memoryRepository.js";
import { CounterstepService } from "../../src/counterstep/service.js";
import { SandboxResourceSchema } from "../../src/counterstep/schemas.js";

class InjectedStaleRepository extends InMemoryCounterstepRepository {
  private writeAttempt = 0;

  constructor(private readonly staleAttempts: ReadonlySet<number>) {
    super();
  }

  override async executeAtomicWrite(request: AtomicWriteRequest) {
    this.writeAttempt += 1;
    if (this.staleAttempts.has(this.writeAttempt)) {
      const run = await this.getRun(request.runId);
      if (!run) throw new Error("Run is missing before stale injection.");
      const demo = await this.getDemo(run.demoId);
      if (!demo) throw new Error("Demo is missing before stale injection.");
      const resources = await this.listResources(run.demoId);
      await this.resetDemo(
        demo,
        resources.map((resource) =>
          resource.resourceId === request.resourceId
            ? SandboxResourceSchema.parse({
                ...resource,
                version: resource.version + 1,
                updatedAt: request.timestamp,
              })
            : resource,
        ),
      );
    }
    return super.executeAtomicWrite(request);
  }
}

function createEvaluationService() {
  let id = 0;
  let timestamp = Date.parse("2026-08-29T19:00:00.000Z");
  const repository = new InMemoryCounterstepRepository();
  const service = new CounterstepService(repository, {
    id: (prefix) => `${prefix}-evaluation-${++id}`,
    now: () => {
      const value = new Date(timestamp);
      timestamp += 500;
      return value;
    },
    appVersion: "evaluation",
  });
  return { repository, service };
}

function createStaleEvaluationService(staleAttempts = new Set([2])) {
  let id = 0;
  let timestamp = Date.parse("2026-08-29T20:00:00.000Z");
  const repository = new InjectedStaleRepository(staleAttempts);
  const service = new CounterstepService(repository, {
    id: (prefix) => `${prefix}-stale-evaluation-${++id}`,
    now: () => {
      const value = new Date(timestamp);
      timestamp += 500;
      return value;
    },
    appVersion: "evaluation",
  });
  return { repository, service };
}

describe("Counterstep deterministic evaluation set", () => {
  it("E1 canonical happy path repairs both declared goals", async () => {
    const { service } = createEvaluationService();
    const demo = await service.resetDemo();
    const run = await service.createRun({
      demoId: demo.demo.demoId,
      sourceReceiptDigest: demo.demo.sourceReceiptDigest,
      generationSource: "deterministic_fixture",
      modelId: "gemini-3.5-flash-lite",
    });
    const result = await service.runFixture(run.runId);
    expect(result.run.status).toBe("repaired");
    expect(result.closure?.goalResults.every((goal) => goal.status === "satisfied"))
      .toBe(true);
  });

  it("E2 already-safe state verifies with zero writes", async () => {
    const { service } = createEvaluationService();
    const demo = await service.resetDemo("already_safe");
    const run = await service.createRun({
      demoId: demo.demo.demoId,
      sourceReceiptDigest: demo.demo.sourceReceiptDigest,
      generationSource: "deterministic_fixture",
      modelId: "gemini-3.5-flash-lite",
    });
    const result = await service.runFixture(run.runId);
    expect(result.run.status).toBe("repaired");
    expect(result.run.writeCount).toBe(0);
    expect(result.scenarioAssessment.status).toBe("matched");
  });

  it("E3 delivered message stays unresolved instead of being recalled", async () => {
    const { service } = createEvaluationService();
    const demo = await service.resetDemo("delivered_boundary");
    const run = await service.createRun({
      demoId: demo.demo.demoId,
      sourceReceiptDigest: demo.demo.sourceReceiptDigest,
      generationSource: "deterministic_fixture",
      modelId: "gemini-3.5-flash-lite",
    });
    const result = await service.runFixture(run.runId);
    expect(result.run.status).toBe("partially_repaired");
    expect(
      result.currentResources.find(
        (resource) => resource.kind === "queued_message",
      ),
    ).toMatchObject({ deliveryState: "delivered" });
    expect(result.scenarioAssessment.status).toBe("matched");
  });

  it("E4 re-inspects and replans once without overwriting a stale resource", async () => {
    const { service } = createEvaluationService();
    const demo = await service.resetDemo("stale_replan");
    const run = await service.createRun({
      demoId: demo.demo.demoId,
      sourceReceiptDigest: demo.demo.sourceReceiptDigest,
      generationSource: "deterministic_fixture",
      modelId: "gemini-3.5-flash-lite",
    });

    const result = await service.runFixture(run.runId);

    expect(result.run.status).toBe("repaired");
    expect(result.run.replanCount).toBe(1);
    expect(result.run.writeCount).toBe(2);
    expect(result.run.toolCallCount).toBe(10);
    expect(result.approvedPlans).toHaveLength(2);
    expect(result.events.some((event) => event.resultCode === "stale_revision"))
      .toBe(true);
    expect(
      result.events.filter((event) => event.resultCode === "inspected"),
    ).toHaveLength(4);
    const writePlanIds = result.events
      .filter((event) => event.stateChange)
      .map((event) => event.planId);
    expect(new Set(writePlanIds)).toStrictEqual(
      new Set([result.approvedPlans.at(-1)?.planId]),
    );
    expect(result.closure?.remediation.approvedPlans).toStrictEqual(
      result.approvedPlans,
    );
    expect(result.closure?.remediation.actionReceipt.verdict).toBe(
      "within_remediation_authority",
    );
    expect(result.closure?.outcome).toBe("repaired");
    expect(result.scenarioAssessment.status).toBe("matched");

  });

  it("blocks after a second stale write without applying either stale action", async () => {
    const { service } = createStaleEvaluationService(new Set([1, 2]));
    const demo = await service.resetDemo();
    const run = await service.createRun({
      demoId: demo.demo.demoId,
      sourceReceiptDigest: demo.demo.sourceReceiptDigest,
      generationSource: "deterministic_fixture",
      modelId: "gemini-3.5-flash-lite",
    });

    const result = await service.runFixture(run.runId);

    expect(result.run.status).toBe("blocked");
    expect(result.run.terminalReasonCode).toBe(
      "stale_revision_replan_exhausted",
    );
    expect(result.run.replanCount).toBe(1);
    expect(result.run.writeCount).toBe(0);
    expect(result.approvedPlans).toHaveLength(2);
    expect(
      result.events.filter((event) => event.resultCode === "stale_revision"),
    ).toHaveLength(2);
    expect(result.events.filter((event) => event.stateChange)).toHaveLength(0);
    expect(result.closure).toBeUndefined();
  });
});
