import { createHash } from "node:crypto";

export const CLOSURE_QUALIFIER =
  "Based on the supplied original trace, remediation authority, recorded tool results, and final sandbox snapshots.";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function digestObject(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export function computeClosureDigest(closure) {
  assert(closure && typeof closure === "object", "Closure receipt is missing.");
  assert(
    closure.integrity && typeof closure.integrity === "object",
    "Closure integrity metadata is missing.",
  );
  return digestObject({
    ...closure,
    integrity: { ...closure.integrity, digest: "0".repeat(64) },
  });
}

function assertEligibleGeminiModel(modelId) {
  assert(typeof modelId === "string", "Gemini model ID is missing.");
  const match = /^gemini-(\d+)(?:\.(\d+))?(?:-|$)/.exec(modelId);
  assert(match, `Model ${modelId} is not a recognized Gemini model ID.`);
  const major = Number(match[1]);
  const minor = Number(match[2] ?? 0);
  assert(
    major > 3 || (major === 3 && minor >= 5),
    `Model ${modelId} does not satisfy the Gemini 3.5+ requirement.`,
  );
}

export function assertLiveHealth(health, options = {}) {
  assert(health && typeof health === "object", "Health response is missing.");
  assert(health.ok === true, "Health response is not ready.");
  assert(
    health.agentMode === "gemini" && health.geminiConfigured === true,
    "Target is not running with a configured Gemini agent.",
  );
  assert(
    health.agentFramework === "google-adk-typescript",
    "Target is not using Google ADK for TypeScript.",
  );
  assertEligibleGeminiModel(health.modelId);
  if (options.requireCloud) {
    assert(
      health.deployment === "cloud-run",
      "Target does not identify as Cloud Run.",
    );
    assert(
      health.repository === "firestore" && health.repositoryReachable === true,
      "Target is not connected to reachable Firestore persistence.",
    );
  }
}

export function assertLocalProductionRehearsalHealth(health) {
  assertLiveHealth(health);
  assert(
    health.deployment === "local",
    "Rehearsal target must identify as local, never as Cloud Run.",
  );
  assert(
    health.repository === "firestore" && health.repositoryReachable === true,
    "Rehearsal target is not connected to reachable Firestore persistence.",
  );
}

export function assertLiveRunEvidence(view) {
  assert(view && typeof view === "object", "Final run view is missing.");
  const { run, authority, inspections, events, closure, approvedPlans } = view;
  assert(run && authority && closure, "Run, authority, or closure is missing.");
  assert(run.generationSource === "gemini", "Run provenance is not Gemini.");
  assertEligibleGeminiModel(run.modelId);
  assert(run.status === "repaired", `Run ended ${run.status}, not repaired.`);
  assert(run.writeCount === 2, `Run recorded ${run.writeCount} writes, not two.`);
  assert(
    Number.isInteger(run.toolCallCount) &&
      run.toolCallCount > 0 &&
      run.toolCallCount <= authority.maxToolCalls,
    "Run tool-call count is outside its remediation authority.",
  );
  assert(
    Array.isArray(approvedPlans) &&
      approvedPlans.length >= 1 &&
      approvedPlans.length <= 2,
    "Approved-plan history is missing or outside the one-replan bound.",
  );
  const inspectedResourceIds = new Set(
    (inspections ?? []).map((inspection) => inspection.resourceId),
  );
  assert(
    authority.readResourceIds.every((id) => inspectedResourceIds.has(id)),
    "Not every authorized resource has a recorded inspection.",
  );
  assert(
    Array.isArray(events) && events.length === run.toolCallCount * 2,
    "Tool-call and event-ledger counts do not reconcile.",
  );
  const eventIds = new Set();
  events.forEach((event, index) => {
    assert(event.runId === run.runId, "An event belongs to another run.");
    assert(event.sequence === index + 1, "Event sequence is not contiguous.");
    assert(!eventIds.has(event.eventId), "Event ID is duplicated.");
    eventIds.add(event.eventId);
  });
  const writes = events.filter((event) => event.stateChange === true);
  assert(writes.length === 2, "Event ledger does not contain two writes.");
  for (const write of writes) {
    assert(
      write.status === "succeeded" &&
        write.afterVersion === write.beforeVersion + 1 &&
        /^[a-f0-9]{64}$/.test(write.beforeDigest) &&
        /^[a-f0-9]{64}$/.test(write.afterDigest),
      `Write event ${write.eventId} lacks exact version or digest evidence.`,
    );
  }
  assert(closure.outcome === "repaired", "Closure outcome is not repaired.");
  assert(
    closure.qualifier === CLOSURE_QUALIFIER,
    "Closure qualifier does not preserve the evidence boundary.",
  );
  assert(
    closure.remediation.runId === run.runId &&
      closure.remediation.actionReceipt.verdict ===
        "within_remediation_authority",
    "Closure is not bound to an in-authority action receipt for this run.",
  );
  assert(
    closure.remediation.actionReceipt.coverage.successfulWrites === 2 &&
      closure.remediation.actionReceipt.coverage.recordedEvents ===
        events.length &&
      closure.remediation.actionReceipt.coverage.accountedEvents ===
        events.length,
    "Action-receipt coverage does not reconcile with the run ledger.",
  );
  assert(
    closure.remediation.eventIds.length === events.length &&
      closure.remediation.eventIds.every((eventId) => eventIds.has(eventId)),
    "Closure event citations do not cover the recorded event ledger.",
  );
  assert(
    closure.goalResults.length > 0 &&
      closure.goalResults.every(
        (result) =>
          result.status === "satisfied" &&
          Array.isArray(result.evidenceEventIds) &&
          result.evidenceEventIds.length > 0 &&
          result.evidenceEventIds.every((eventId) => eventIds.has(eventId)),
      ),
    "One or more closure goals lack satisfied, cited evidence.",
  );
  assert(
    closure.integrity.modelId === run.modelId &&
      closure.integrity.agentFramework === "google-adk-typescript",
    "Closure model/framework provenance does not match the run.",
  );
  const expectedDigest = computeClosureDigest(closure);
  assert(
    closure.integrity.digest === expectedDigest,
    "Closure receipt digest does not match its canonical content.",
  );
}

export function assertClosureAvailable(view) {
  assert(view && typeof view === "object", "Final run view is missing.");
  const run = view.run;
  assert(run && typeof run === "object", "Final run envelope is missing.");
  if (!view.closure) {
    const runId = typeof run.runId === "string" ? run.runId : "unknown";
    const status = typeof run.status === "string" ? run.status : "unknown";
    const reason =
      typeof run.terminalReasonCode === "string"
        ? run.terminalReasonCode
        : "unknown_reason";
    const writes = Number.isInteger(run.writeCount) ? run.writeCount : "unknown";
    throw new Error(
      `Live run ${runId} ended ${status} without a closure (${reason}); writes=${writes}.`,
    );
  }
}

export function assertDownloadedClosure(view, downloadedClosure) {
  assertLiveRunEvidence(view);
  assert(
    JSON.stringify(downloadedClosure) === JSON.stringify(view.closure),
    "Downloaded closure differs from the persisted final run view.",
  );
  assert(
    computeClosureDigest(downloadedClosure) ===
      downloadedClosure.integrity.digest,
    "Downloaded closure receipt digest is invalid.",
  );
}
