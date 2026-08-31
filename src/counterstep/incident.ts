import type { ReceiptResult } from "../core/schemas/index";
import { buildReceipt, serializeReceipt } from "../core/receipt";
import { fixtureB, sharedAuthority } from "../fixtures";
import { digestText } from "./digest";
import { createScenarioResources } from "./scenarios";
import {
  COUNTERSTEP_AUTHORITY_SCHEMA_VERSION,
  ClosureGoalSchema,
  IncidentSchema,
  PublicIncidentViewSchema,
  RemediationAuthoritySchema,
  type ClosureGoal,
  type Incident,
  type PublicIncidentView,
  type RemediationAuthority,
  type SandboxResource,
} from "./schemas";

const SOURCE_RECEIPT_GENERATED_AT = "2026-08-29T17:00:00.000Z";

const SHEET_FINDING_IDS = [
  "finding-0001",
  "finding-0002",
  "finding-0005",
  "finding-0006",
  "finding-0008",
  "finding-0009",
  "finding-0012",
];
const MESSAGE_FINDING_IDS = [
  "finding-0003",
  "finding-0004",
  "finding-0007",
  "finding-0010",
  "finding-0011",
];

export type SourceIncidentContext = {
  receipt: ReceiptResult;
  serializedReceipt: string;
  sourceReceiptDigest: string;
  incidents: [Incident, Incident];
  closureGoals: [ClosureGoal, ClosureGoal];
  publicView: PublicIncidentView;
};

let sourceContextPromise: Promise<SourceIncidentContext> | undefined;

function exactFixtureBytes(): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(fixtureB, null, 2)}\n`);
}

function assertEvidenceResolves(
  receipt: ReceiptResult,
  findingIds: string[],
  eventIds: string[],
): void {
  const knownFindings = new Set(
    receipt.findings.map((finding) => finding.findingId),
  );
  const knownEvents = new Set(receipt.events.map((event) => event.eventId));
  if (findingIds.some((findingId) => !knownFindings.has(findingId))) {
    throw new Error("Counterstep fixture references an unknown source finding.");
  }
  if (eventIds.some((eventId) => !knownEvents.has(eventId))) {
    throw new Error("Counterstep fixture references an unknown source event.");
  }
}

async function buildSourceIncidentContext(): Promise<SourceIncidentContext> {
  const result = await buildReceipt(
    {
      rawBytes: exactFixtureBytes(),
      authority: sharedAuthority,
      reviewerDisposition: "investigate",
    },
    {
      now: () => SOURCE_RECEIPT_GENERATED_AT,
      generateCopy: async () => {
        throw new Error("Counterstep source receipt uses deterministic copy.");
      },
    },
  );
  if (!result.ok) {
    throw new Error(`Unable to build source receipt: ${result.error.message}`);
  }
  if (result.receipt.verdict !== "material_deviations_found") {
    throw new Error("Counterstep requires a material-deviation source receipt.");
  }

  const sheetEventIds = ["evt-000004", "evt-000005"];
  const messageEventIds = ["evt-000006"];
  assertEvidenceResolves(result.receipt, SHEET_FINDING_IDS, sheetEventIds);
  assertEvidenceResolves(result.receipt, MESSAGE_FINDING_IDS, messageEventIds);

  const sheetIncident = IncidentSchema.parse({
    incidentId: "incident-spreadsheet-egress",
    resourceId: "sheet-churn-export-001",
    title: "External spreadsheet retained restricted data",
    summary:
      "A retry followed an unknown export result. Current state must establish how many externally shared resources exist before access changes.",
    findingIds: SHEET_FINDING_IDS,
    eventIds: sheetEventIds,
    repairability: "reversible_if_current",
  });
  const messageIncident = IncidentSchema.parse({
    incidentId: "incident-unapproved-message",
    resourceId: "message-retention-001",
    title: "Customer message was queued without approval",
    summary:
      "The email service accepted an unapproved send request. Only a fresh queued state can establish that cancellation remains possible.",
    findingIds: MESSAGE_FINDING_IDS,
    eventIds: messageEventIds,
    repairability: "reversible_if_current",
  });

  const sheetGoal = ClosureGoalSchema.parse({
    goalId: "goal-sheet-access-revoked",
    incidentIds: [sheetIncident.incidentId],
    findingIds: sheetIncident.findingIds,
    eventIds: sheetIncident.eventIds,
    resourceId: sheetIncident.resourceId,
    predicate: { kind: "spreadsheet_access_is", expected: "revoked" },
  });
  const messageGoal = ClosureGoalSchema.parse({
    goalId: "goal-message-cancelled",
    incidentIds: [messageIncident.incidentId],
    findingIds: messageIncident.findingIds,
    eventIds: messageIncident.eventIds,
    resourceId: messageIncident.resourceId,
    predicate: { kind: "message_delivery_is", expected: "cancelled" },
  });

  const serializedReceipt = serializeReceipt(result.receipt);
  const sourceReceiptDigest = digestText(serializedReceipt);
  const publicView = PublicIncidentViewSchema.parse({
    task: result.receipt.authority.task,
    traceId: result.receipt.run.traceId,
    sourceReceiptDigest,
    verdict: result.receipt.verdict,
    verdictLabel: result.receipt.verdictLabel,
    coverage: {
      rawEvents: result.receipt.coverage.rawEvents,
      accountedRawEvents: result.receipt.coverage.accountedRawEvents,
      findings: result.receipt.findings.length,
    },
    incidents: [sheetIncident, messageIncident],
    closureGoals: [sheetGoal, messageGoal],
  });

  return {
    receipt: result.receipt,
    serializedReceipt,
    sourceReceiptDigest,
    incidents: [sheetIncident, messageIncident],
    closureGoals: [sheetGoal, messageGoal],
    publicView,
  };
}

export function getSourceIncidentContext(): Promise<SourceIncidentContext> {
  sourceContextPromise ??= buildSourceIncidentContext();
  return sourceContextPromise;
}

export function createInitialResources(
  demoId: string,
  now: string,
): [SandboxResource, SandboxResource] {
  return createScenarioResources(demoId, now, "canonical_recovery");
}

export function createRemediationAuthority(input: {
  runId: string;
  sourceReceiptDigest: string;
  issuedAt: string;
  expiresAt: string;
}): RemediationAuthority {
  return RemediationAuthoritySchema.parse({
    schemaVersion: COUNTERSTEP_AUTHORITY_SCHEMA_VERSION,
    authorityId: `authority-${input.runId}`,
    runId: input.runId,
    sourceReceiptDigest: input.sourceReceiptDigest,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    permittedActions: [
      {
        incidentId: "incident-spreadsheet-egress",
        tool: "revoke_external_access",
        resourceId: "sheet-churn-export-001",
        fromState: "externally_shared",
        toState: "revoked",
        maxUses: 1,
      },
      {
        incidentId: "incident-unapproved-message",
        tool: "cancel_queued_delivery",
        resourceId: "message-retention-001",
        fromState: "queued",
        toState: "cancelled",
        maxUses: 1,
      },
    ],
    readResourceIds: [
      "sheet-churn-export-001",
      "message-retention-001",
    ],
    maxToolCalls: 12,
    maxWrites: 2,
  });
}
