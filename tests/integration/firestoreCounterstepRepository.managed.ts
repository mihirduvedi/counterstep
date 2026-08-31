import { Firestore } from "@google-cloud/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
  DailyRunCounterSchema,
  SandboxResourceSchema,
  type SandboxResource,
} from "../../src/counterstep/schemas.js";
import { parseManagedFirestoreEvidenceConfig } from "../helpers/managedFirestore.js";

const config = parseManagedFirestoreEvidenceConfig(process.env);
const db = new Firestore({
  projectId: config.projectId,
  databaseId: config.databaseId,
  ignoreUndefinedProperties: true,
});
const suiteStartedAt = Date.now();

type EvidenceCase = {
  caseId: string;
  runIds: string[];
  outcome: string;
  writes?: number;
  closureDigest?: string;
};

const evidenceCases: EvidenceCase[] = [];

function harness(
  repository: FirestoreCounterstepRepository,
  caseId: string,
): CounterstepService {
  let milliseconds = suiteStartedAt;
  let idCounter = 0;
  return new CounterstepService(repository, {
    now: () => {
      const value = new Date(milliseconds);
      milliseconds += 1_000;
      return value;
    },
    id: (kind) =>
      `${kind}-${config.runLabel}-${caseId}-${++idCounter}`,
    appVersion: "managed-firestore-evidence",
  });
}

class StaleInjectingManagedRepository extends FirestoreCounterstepRepository {
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
  caseId: string,
) {
  const service = harness(repository, caseId);
  const demo = await service.resetDemo();
  const run = await service.createRun({
    demoId: demo.demo.demoId,
    sourceReceiptDigest: demo.demo.sourceReceiptDigest,
    generationSource: "deterministic_fixture",
    modelId: "gemini-3.5-flash-lite",
  });
  for (const resourceId of demo.demo.resourceIds) {
    const result = await service.inspectResource({
      runId: run.runId,
      resourceId,
    });
    expect(result.ok).toBe(true);
  }
  const source = await getSourceIncidentContext();
  const inspected = await service.getRunView(run.runId);
  if (!inspected) throw new Error("Run view is missing before planning.");
  const plan = buildFixtureRecoveryPlan({
    runId: run.runId,
    planId: `plan-${config.runLabel}-${caseId}`,
    sourceReceiptDigest: run.sourceReceiptDigest,
    incidents: source.incidents,
    inspections: inspected.inspections,
  });
  const decision = await service.submitRecoveryPlan(run.runId, plan);
  if (decision.status !== "approved") throw new Error("Plan was rejected.");
  return { demo, run, service, decision };
}

describe("FirestoreCounterstepRepository against managed Firestore", () => {
  beforeAll(async () => {
    const repository = new FirestoreCounterstepRepository(db);
    await expect(repository.ping()).resolves.toBe(true);
    const sentinelId = `demo-${config.runLabel}-canonical-1`;
    const sentinel = await db
      .collection("counterstep_demos")
      .doc(sentinelId)
      .get();
    if (sentinel.exists) {
      throw new Error(
        `Managed Firestore run label ${config.runLabel} was already used. Choose a new label; existing evidence is never overwritten.`,
      );
    }
  });

  afterAll(async () => {
    console.log(
      `COUNTERSTEP_MANAGED_FIRESTORE_EVIDENCE ${JSON.stringify({
        projectId: config.projectId,
        databaseId: config.databaseId,
        runLabel: config.runLabel,
        retainedSyntheticEvidence: true,
        cases: evidenceCases,
      })}`,
    );
    await db.terminate();
  });

  it("persists canonical recovery and a digest-valid closure for a fresh reader", async () => {
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

    const freshReader = harness(
      new FirestoreCounterstepRepository(db),
      "canonical-reader",
    );
    await expect(freshReader.getRunView(run.runId)).resolves.toStrictEqual(
      view,
    );
    evidenceCases.push({
      caseId: "canonical",
      runIds: [run.runId],
      outcome: view.run.status,
      writes: view.run.writeCount,
      closureDigest: view.closure?.integrity.digest,
    });
  });

  it("applies one managed write for concurrent duplicate idempotency keys", async () => {
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
      eventId: `event-${config.runLabel}-idempotency-write`,
      eventSequence: (await repository.listEvents(run.runId)).length + 1,
      timestamp: new Date(suiteStartedAt + 120_000).toISOString(),
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
    await expect(repository.getRun(run.runId)).resolves.toMatchObject({
      writeCount: 1,
    });
    evidenceCases.push({
      caseId: "idempotency",
      runIds: [run.runId],
      outcome: "one_write_one_replay",
      writes: 1,
    });
  });

  it("serializes concurrent run admission under a retained synthetic date", async () => {
    const repository = new FirestoreCounterstepRepository(db);
    const service = harness(repository, "admission");
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
    const dateKey = "1970-01-01";
    const counterRef = db.collection("counterstepLimits").doc(dateKey);
    const currentCounterSnapshot = await counterRef.get();
    const currentCount = currentCounterSnapshot.exists
      ? DailyRunCounterSchema.parse(currentCounterSnapshot.data()).count
      : 0;
    if (currentCount > 9_998) {
      throw new Error("Managed admission evidence counter is exhausted.");
    }
    const admission = {
      dateKey,
      maxRuns: currentCount + 2,
      timestamp: "1970-01-01T00:00:00.000Z",
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
    const persistedCounter = DailyRunCounterSchema.parse(
      (await counterRef.get()).data(),
    );
    expect(persistedCounter.count).toBe(currentCount + 2);
    evidenceCases.push({
      caseId: "admission",
      runIds: [firstRun.runId, secondRun.runId, thirdRun.runId],
      outcome: "two_claimed_one_limited",
    });
  });

  it("re-inspects and admits one replacement plan after managed stale state", async () => {
    const repository = new StaleInjectingManagedRepository(
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
    expect(view.closure?.remediation.actionReceipt.verdict).toBe(
      "within_remediation_authority",
    );
    expect(verifyClosureReceipt(view.closure).valid).toBe(true);
    evidenceCases.push({
      caseId: "stale-once",
      runIds: [run.runId],
      outcome: view.run.status,
      writes: view.run.writeCount,
      closureDigest: view.closure?.integrity.digest,
    });
  });

  it("blocks a second managed stale write without a remediation mutation", async () => {
    const repository = new StaleInjectingManagedRepository(db, 2);
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
    expect(view.events.filter((event) => event.stateChange)).toHaveLength(0);
    expect(view.closure).toBeUndefined();
    evidenceCases.push({
      caseId: "stale-twice",
      runIds: [run.runId],
      outcome: view.run.status,
      writes: view.run.writeCount,
    });
  });

  it("retains delivered state and records only the reversible managed write", async () => {
    const repository = new FirestoreCounterstepRepository(db);
    const service = harness(repository, "delivered");
    const demo = await service.resetDemo();
    const deliveredResources: SandboxResource[] = demo.resources.map(
      (resource) =>
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
    if (!deliveredMessage) {
      throw new Error("Delivered message fixture is missing.");
    }
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
    expect(verifyClosureReceipt(view.closure).valid).toBe(true);
    evidenceCases.push({
      caseId: "delivered",
      runIds: [run.runId],
      outcome: view.run.status,
      writes: view.run.writeCount,
      closureDigest: view.closure?.integrity.digest,
    });
  });
});
