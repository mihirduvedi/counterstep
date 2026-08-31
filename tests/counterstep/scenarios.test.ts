import { describe, expect, it } from "vitest";

import { InMemoryCounterstepRepository } from "../../src/counterstep/memoryRepository.js";
import {
  createScenarioResources,
  getDemoScenario,
  listDemoScenarios,
} from "../../src/counterstep/scenarios.js";
import { CounterstepService } from "../../src/counterstep/service.js";
import {
  EmptyJsonRequestSchema,
  ResetDemoRequestSchema,
  ScenarioCatalogResponseSchema,
} from "../../src/counterstep/schemas.js";

function harness() {
  let id = 0;
  let timestamp = Date.parse("2026-08-30T20:00:00.000Z");
  const repository = new InMemoryCounterstepRepository();
  const service = new CounterstepService(repository, {
    id: (prefix) => `${prefix}-scenario-${++id}`,
    now: () => {
      const value = new Date(timestamp);
      timestamp += 500;
      return value;
    },
    appVersion: "scenario-test",
  });
  return { repository, service };
}

describe("Recovery Test Rack scenarios", () => {
  it("publishes four unique, strict scenario contracts", () => {
    const scenarios = listDemoScenarios();
    expect(ScenarioCatalogResponseSchema.parse({ scenarios }).scenarios).toHaveLength(4);
    expect(new Set(scenarios.map((scenario) => scenario.scenarioId)).size).toBe(4);
    expect(scenarios.map((scenario) => scenario.code)).toStrictEqual([
      "E1",
      "E2",
      "E3",
      "E4",
    ]);
    expect(
      ResetDemoRequestSchema.safeParse({ scenarioId: "invented_case" }).success,
    ).toBe(false);
    expect(
      EmptyJsonRequestSchema.safeParse({ scenarioId: "canonical_recovery" })
        .success,
    ).toBe(false);
  });

  it("creates exact safe and irreversible starting snapshots", () => {
    const now = "2026-08-30T20:00:00.000Z";
    const safe = createScenarioResources("demo-safe", now, "already_safe");
    const delivered = createScenarioResources(
      "demo-delivered",
      now,
      "delivered_boundary",
    );
    expect(safe).toMatchObject([
      { kind: "spreadsheet", accessState: "revoked", version: 4 },
      { kind: "queued_message", deliveryState: "cancelled", version: 2 },
    ]);
    expect(delivered[1]).toMatchObject({
      kind: "queued_message",
      deliveryState: "delivered",
      version: 2,
    });
  });

  it("applies the disclosed stale version bump once without recording an agent write", async () => {
    const { repository, service } = harness();
    const demo = await service.resetDemo("stale_replan");
    const request = {
      demoId: demo.demo.demoId,
      resourceId: "sheet-churn-export-001",
      expectedVersion: 3,
      timestamp: "2026-08-30T20:01:00.000Z",
    } as const;

    await expect(repository.applyStaleScenarioMutation(request)).resolves.toMatchObject({
      status: "applied",
      resource: { version: 4, accessState: "externally_shared" },
    });
    await expect(repository.applyStaleScenarioMutation(request)).resolves.toMatchObject({
      status: "already_applied",
      resource: { version: 4 },
    });
    await expect(repository.getDemo(demo.demo.demoId)).resolves.toMatchObject({
      scenarioId: "stale_replan",
      scenarioMutationAppliedAt: request.timestamp,
    });
  });

  it("refuses to apply the stale-scenario mutation to another governed resource", async () => {
    const { repository, service } = harness();
    const demo = await service.resetDemo("stale_replan");
    await expect(
      repository.applyStaleScenarioMutation({
        demoId: demo.demo.demoId,
        resourceId: "message-retention-001",
        expectedVersion: 1,
        timestamp: "2026-08-30T20:01:00.000Z",
      }),
    ).resolves.toStrictEqual({ status: "not_applicable" });
    await expect(
      repository.getResource(demo.demo.demoId, "message-retention-001"),
    ).resolves.toMatchObject({ version: 1, deliveryState: "queued" });
  });

  it.each(listDemoScenarios())(
    "$code $label reaches its predeclared terminal contract",
    async (scenario) => {
      const { service } = harness();
      const demo = await service.resetDemo(scenario.scenarioId);
      expect(demo.scenario).toStrictEqual(getDemoScenario(scenario.scenarioId));
      const run = await service.createRun({
        demoId: demo.demo.demoId,
        sourceReceiptDigest: demo.demo.sourceReceiptDigest,
        generationSource: "deterministic_fixture",
      });
      const result = await service.runFixture(run.runId);

      expect(result.scenarioAssessment).toMatchObject({
        scenarioId: scenario.scenarioId,
        status: "matched",
        expected: scenario.expected,
        observed: scenario.expected,
        mismatches: [],
      });
    },
  );
});
