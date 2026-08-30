import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createCounterstepAgent,
  createCounterstepTools,
  expectedWriteIdempotencyKey,
} from "../../src/counterstep/adkAgent.js";
import { InMemoryCounterstepRepository } from "../../src/counterstep/memoryRepository.js";
import { CounterstepService } from "../../src/counterstep/service.js";

describe("Google ADK recovery agent", () => {
  it("exposes the five bounded domain tools with generated schemas", () => {
    const service = new CounterstepService(
      new InMemoryCounterstepRepository(),
    );
    const declarations = createCounterstepTools(service).map((tool) =>
      tool._getDeclaration(),
    );
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
