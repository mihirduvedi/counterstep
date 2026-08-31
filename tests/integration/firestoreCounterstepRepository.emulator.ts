import { Firestore } from "@google-cloud/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { verifyClosureReceipt } from "../../src/counterstep/closure.js";
import { FirestoreCounterstepRepository } from "../../src/counterstep/firestoreRepository.js";
import { buildFixtureRecoveryPlan } from "../../src/counterstep/fixturePlanner.js";
import { getSourceIncidentContext } from "../../src/counterstep/incident.js";
import type {
  AtomicWriteRequest,
  ToolExecutionName,
} from "../../src/counterstep/repository.js";
import {
  CounterstepService,
  deriveIdempotencyKey,
} from "../../src/counterstep/service.js";
import {
  SandboxResourceSchema,
  type SandboxResource,
} from "../../src/counterstep/schemas.js";

const PROJECT_ID = "demo-counterstep";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

if (!emulatorHost) {
  throw new Error(
    "Firestore integration tests must run through `npm run test:firestore`.",
  );
}

const db = new Firestore({
  projectId: PROJECT_ID,
  databaseId: "(default)",
  ignoreUndefinedProperties: true,
});

function harness(
  repository: FirestoreCounterstepRepository,
  prefix: string,
): CounterstepService {
  let milliseconds = Date.parse("2026-08-29T18:00:00.000Z");
  let idCounter = 0;
  return new CounterstepService(repository, {
    now: () => {
      const value = new Date(milliseconds);
      milliseconds += 1_000;
      return value;
    },
    id: (kind) => `${kind}-${prefix}-${++idCounter}`,
    appVersion: "firestore-emulator-test",
  });
}

async function clearEmulator(): Promise<void> {
  const response = await fetch(
    `http://${emulatorHost}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    throw new Error(
      `Could not clear the Firestore emulator: ${response.status} ${await response.text()}`,
    );
  }
}

class StaleInjectingFirestoreRepository extends FirestoreCounterstepRepository {
  private remainingInjections: number;

  constructor(
    firestore: Firestore,
    injectionCount: number,
    private readonly targetTool?: ToolExecutionName,
  ) {
    super(firestore);
    this.remainingInjections = injectionCount;
  }

  override async executeAtomicWrite(request: AtomicWriteRequest) {
    if (
      this.remainingInjections > 0 &&
      (!this.targetTool || request.tool === this.targetTool)
    ) {
      const run = await this.getRun(request.runId);
      if (!run) throw new Error("Run is missing before stale injection.");
      const resource = await this.getResource(run.demoId, request.resourceId);
      if (!resource) {
        throw new Error("Resource is missing before stale injection.");
      }
      const staleResource = SandboxResourceSchema.parse({
        ...resource,
        version: resource.version + 1,
        updatedAt: request.timestamp,
      });
      await db
        .collection("counterstep_demos")
        .doc(run.demoId)
        .collection("resources")
        .doc(request.resourceId)
        .set(staleResource, { merge: false });
      this.remainingInjections -= 1;
    }
    return super.executeAtomicWrite(request);
  }
}

async function prepareApprovedRun(
  repository: FirestoreCounterstepRepository,
  prefix: string,
) {
  const service = harness(repository, prefix);
  const demo = await service.resetDemo();
  const run = await service.createRun({
    demoId: demo.demo.demoId,
    sourceReceiptDigest: demo.demo.sourceReceiptDigest,
    generationSource: "deterministic_fixture",
    modelId: "gemini-3.5-flash-lite",
  });
  for (const resourceId of demo.demo.resourceIds) {
    const result = await service.inspectResource({ runId: run.runId, resourceId });
    expect(result.ok).toBe(true);
  }
  const source = await getSourceIncidentContext();
  const inspected = await service.getRunView(run.runId);
  if (!inspected) throw new Error("Run view is missing before planning.");
  const plan = buildFixtureRecoveryPlan({
    runId: run.runId,
    planId: `plan-${prefix}`,
    sourceReceiptDigest: run.sourceReceiptDigest,
    incidents: source.incidents,
    inspections: inspected.inspections,
  });
  const decision = await service.submitRecoveryPlan(run.runId, plan);
  if (decision.status !== "approved") throw new Error("Plan was rejected.");
  return { demo, run, service, decision };
}

describe("FirestoreCounterstepRepository against the local emulator", () => {
  beforeAll(async () => {
    await expect(
      new FirestoreCounterstepRepository(db).ping(),
    ).resolves.toBe(true);
  });

  beforeEach(async () => {
    await clearEmulator();
  });

  afterAll(async () => {
    await db.terminate();
  });

  it("persists the complete canonical recovery and verified closure", async () => {
    const repository = new FirestoreCounterstepRepository(db);
    const service = harness(repository, "canonical");
    const demo = await service.resetDemo();
    const run = await service.createRun({
      demoId: demo.demo.demoId,
      sourceReceiptDigest: demo.demo.sourceReceiptDigest,
      generationSource: "deterministic_fixture",
      modelId: "gemini-3.5-flash-lite",
    });

    const view = await service.runFixture(run.runId);

    expect(view.run).toMatchObject({ status: "repaired", writeCount: 2 });
    expect(view.events).toHaveLength(12);
    expect(view.approvedPlans).toHaveLength(1);
    expect(view.currentResources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "spreadsheet",
          accessState: "revoked",
          version: 4,
        }),
        expect.objectContaining({
          kind: "queued_message",
          deliveryState: "cancelled",
          version: 2,
        }),
      ]),
    );
    expect(view.closure?.outcome).toBe("repaired");
    expect(verifyClosureReceipt(view.closure).valid).toBe(true);

    const freshService = harness(
      new FirestoreCounterstepRepository(db),
      "fresh-reader",
    );
    const persisted = await freshService.getRunView(run.runId);
    expect(persisted).toStrictEqual(view);
  });

  it("creates a fresh isolated canonical demo on repeated reset", async () => {
    const repository = new FirestoreCounterstepRepository(db);
    const service = harness(repository, "reset");
    const firstDemo = await service.resetDemo();
    const run = await service.createRun({
      demoId: firstDemo.demo.demoId,
      sourceReceiptDigest: firstDemo.demo.sourceReceiptDigest,
      generationSource: "deterministic_fixture",
    });
    await service.runFixture(run.runId);

    const secondDemo = await service.resetDemo();

    expect(secondDemo.demo.demoId).not.toBe(firstDemo.demo.demoId);
    await expect(
      repository.listResources(secondDemo.demo.demoId),
    ).resolves.toStrictEqual(secondDemo.resources);
    await expect(
      repository.listResources(firstDemo.demo.demoId),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accessState: "revoked" }),
        expect.objectContaining({ deliveryState: "cancelled" }),
      ]),
    );
  });

  it(
    "applies concurrent duplicate execution exactly once",
    async () => {
      const repository = new FirestoreCounterstepRepository(db);
      const { run, decision } = await prepareApprovedRun(
        repository,
        "idempotency",
      );
      const step = decision.plan.steps.find(
        (candidate) => candidate.tool === "revoke_external_access",
      );
      if (!step || step.tool === "verify_closure") {
        throw new Error("Spreadsheet step is missing.");
      }
      const sequence = (await repository.listEvents(run.runId)).length + 1;
      const request: AtomicWriteRequest = {
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
        eventId: "event-idempotency-write",
        eventSequence: sequence,
        timestamp: "2026-08-29T18:02:00.000Z",
        attempt: 1,
      };

      const results = await Promise.all([
        repository.executeAtomicWrite(request),
        repository.executeAtomicWrite(request),
      ]);

      expect(results.map((result) => result.resultCode).sort()).toStrictEqual([
        "idempotent_replay",
        "succeeded",
      ]);
      expect(results.filter((result) => result.stateChanged)).toHaveLength(1);
      expect(
        results.find((result) => result.resultCode === "idempotent_replay"),
      ).toMatchObject({
        stateChanged: false,
        replayedEventId: request.eventId,
      });
      await expect(repository.getRun(run.runId)).resolves.toMatchObject({
        writeCount: 1,
      });
      await expect(
        repository.getResource("demo-idempotency-1", step.resourceId),
      ).resolves.toMatchObject({ accessState: "revoked", version: 4 });
    },
    30_000,
  );

  it(
    "admits executions under one transactional daily cap",
    async () => {
      const repository = new FirestoreCounterstepRepository(db);
      const service = harness(repository, "daily-limit");
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
        timestamp: "2026-08-29T18:05:00.000Z",
      } as const;

      await expect(
        Promise.all([
          repository.claimRunForExecution(firstRun.runId, admission),
          repository.claimRunForExecution(firstRun.runId, admission),
        ]),
      ).resolves.toEqual(
        expect.arrayContaining(["claimed", "already_started"]),
      );
      await expect(
        repository.claimRunForExecution(secondRun.runId, admission),
      ).resolves.toBe("claimed");
      await expect(
        repository.claimRunForExecution(thirdRun.runId, admission),
      ).resolves.toBe("daily_limit_exceeded");
      await expect(repository.getRun(thirdRun.runId)).resolves.toMatchObject({
        status: "created",
      });
    },
    30_000,
  );

  it("re-inspects, replans once, and preserves both approved plans after stale state", async () => {
    const repository = new StaleInjectingFirestoreRepository(
      db,
      1,
      "cancel_queued_delivery",
    );
    const service = harness(repository, "stale-once");
    const demo = await service.resetDemo();
    const run = await service.createRun({
      demoId: demo.demo.demoId,
      sourceReceiptDigest: demo.demo.sourceReceiptDigest,
      generationSource: "deterministic_fixture",
    });

    const view = await service.runFixture(run.runId);

    expect(view.run).toMatchObject({
      status: "repaired",
      writeCount: 2,
      replanCount: 1,
    });
    expect(view.approvedPlans).toHaveLength(2);
    expect(new Set(view.events.flatMap((event) => event.planId ?? []))).toEqual(
      new Set(view.approvedPlans.map((plan) => plan.planId)),
    );
    expect(view.currentResources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "spreadsheet",
          accessState: "revoked",
          version: 4,
        }),
        expect.objectContaining({
          kind: "queued_message",
          deliveryState: "cancelled",
          version: 3,
        }),
      ]),
    );
    expect(view.closure?.remediation.actionReceipt.verdict).toBe(
      "within_remediation_authority",
    );
    expect(verifyClosureReceipt(view.closure).valid).toBe(true);
  });

  it("blocks after a second stale write without a remediation mutation", async () => {
    const repository = new StaleInjectingFirestoreRepository(db, 2);
    const service = harness(repository, "stale-twice");
    const demo = await service.resetDemo();
    const run = await service.createRun({
      demoId: demo.demo.demoId,
      sourceReceiptDigest: demo.demo.sourceReceiptDigest,
      generationSource: "deterministic_fixture",
    });

    const view = await service.runFixture(run.runId);

    expect(view.run).toMatchObject({
      status: "blocked",
      terminalReasonCode: "stale_revision_replan_exhausted",
      writeCount: 0,
      replanCount: 1,
    });
    expect(view.approvedPlans).toHaveLength(2);
    expect(view.events.filter((event) => event.stateChange)).toHaveLength(0);
    expect(view.closure).toBeUndefined();
  });

  it("keeps a delivered message unresolved and records only the reversible write", async () => {
    const repository = new FirestoreCounterstepRepository(db);
    const service = harness(repository, "delivered");
    const demo = await service.resetDemo();
    const deliveredResources: SandboxResource[] = demo.resources.map((resource) =>
      resource.kind === "queued_message"
        ? SandboxResourceSchema.parse({
            ...resource,
            deliveryState: "delivered",
          })
        : resource,
    );
    const deliveredMessage = deliveredResources.find(
      (resource) => resource.kind === "queued_message",
    );
    if (!deliveredMessage) throw new Error("Delivered message fixture is missing.");
    await db
      .collection("counterstep_demos")
      .doc(demo.demo.demoId)
      .collection("resources")
      .doc(deliveredMessage.resourceId)
      .set(deliveredMessage, { merge: false });
    const run = await service.createRun({
      demoId: demo.demo.demoId,
      sourceReceiptDigest: demo.demo.sourceReceiptDigest,
      generationSource: "deterministic_fixture",
    });

    const view = await service.runFixture(run.runId);

    expect(view.run).toMatchObject({
      status: "partially_repaired",
      writeCount: 1,
    });
    expect(view.currentResources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "queued_message",
          deliveryState: "delivered",
          version: 1,
        }),
      ]),
    );
    expect(view.closure?.goalResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "unsatisfied" }),
      ]),
    );
    expect(view.closure?.limitations.join(" ")).toContain("unresolved");
  });
});
