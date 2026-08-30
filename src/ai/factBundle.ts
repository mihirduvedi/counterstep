import { z } from "zod";
import type {
  AuthorityEnvelopeV1,
  CanonicalEvent,
  CoverageSummary,
  Finding,
  RawEventAccounting,
  Verdict,
} from "../core/schemas/index";
import { UI_LIMITS, VerdictSchema } from "../core/schemas/index";
import { qualifyVerdict } from "../core/product";
import { redactForModel } from "./redact";

// ─── Module-private reduced types ────────────────────────────────────────────

/**
 * CanonicalEvent with rawPointer, input, output, and metadata stripped.
 * Only nonsecret metadata fields survive.
 */
type ReducedCanonicalEvent = {
  eventId: string;
  sequence: number;
  timestamp: string;
  actorType: "agent" | "workflow" | "tool" | "human";
  actorId: string;
  operation: CanonicalEvent["operation"];
  toolName?: string;
  sourceSystem?: string;
  destinationSystem?: string;
  destinationBoundary: "local" | "internal" | "external" | "unknown";
  resourceType?: string;
  dataCategories: string[];
  quantity?: { value: number; unit: "records" | "messages" | "bytes" | "files" };
  stateChange: boolean;
  status: "started" | "succeeded" | "failed" | "cancelled" | "unknown";
  actionKey?: string;
  adapterWarnings: string[];
  riskTags: string[];
};

/**
 * Finding with observedValue, expectedValue, and policyPath stripped.
 */
type ReducedFinding = {
  findingId: string;
  ruleId: string;
  severity: "low" | "medium" | "high";
  label: string;
  description: string;
  eventIds: string[];
};

// ─── Exported types ───────────────────────────────────────────────────────────

/** Internal fact used for AR-TRACE-001 limitations. findingIds is for citation lookup only. */
export type LimitationFact = {
  text: string;
  eventIds: string[];
  findingIds: string[];
};

/** The complete bundle passed (after redaction) to the model. */
export type GraniteFactBundle = {
  instructions: string;
  verdictCode: Verdict;
  verdictQualifier: string;
  task: string;
  events: ReducedCanonicalEvent[];
  findings: ReducedFinding[];
  coverageCounts: {
    total: number;
    mapped: number;
    metadataOnly: number;
    unparsed: number;
  };
  limitations: LimitationFact[];
  allowedEventIds: string[];
  allowedFindingIds: string[];
};

export type BuildFactBundleInput = {
  events: CanonicalEvent[];
  findings: Finding[];
  accounting: RawEventAccounting[];
  verdict: Verdict;
  authority: AuthorityEnvelopeV1;
  hasAssessmentLimitation: boolean;
  coverage?: CoverageSummary;
};

// ─── Zod schema ───────────────────────────────────────────────────────────────

const ReducedCanonicalEventSchema = z.object({
  eventId: z.string(),
  sequence: z.number(),
  timestamp: z.string(),
  actorType: z.enum(["agent", "workflow", "tool", "human"]),
  actorId: z.string(),
  operation: z.enum([
    "read", "retrieve", "create", "update", "delete",
    "send", "execute", "approve", "error", "unknown",
  ]),
  toolName: z.string().optional(),
  sourceSystem: z.string().optional(),
  destinationSystem: z.string().optional(),
  destinationBoundary: z.enum(["local", "internal", "external", "unknown"]),
  resourceType: z.string().optional(),
  dataCategories: z.array(z.string()),
  quantity: z.object({
    value: z.number(),
    unit: z.enum(["records", "messages", "bytes", "files"]),
  }).optional(),
  stateChange: z.boolean(),
  status: z.enum(["started", "succeeded", "failed", "cancelled", "unknown"]),
  actionKey: z.string().optional(),
  adapterWarnings: z.array(z.string()),
  riskTags: z.array(z.string()),
}).strict();

const ReducedFindingSchema = z.object({
  findingId: z.string(),
  ruleId: z.string(),
  severity: z.enum(["low", "medium", "high"]),
  label: z.string(),
  description: z.string(),
  eventIds: z.array(z.string()),
}).strict();

const LimitationFactSchema = z.object({
  text: z.string(),
  eventIds: z.array(z.string()),
  findingIds: z.array(z.string()),
}).strict();

/** Zod schema validating the complete redacted bundle before serialization. */
export const GraniteFactBundleSchema = z.object({
  instructions: z.string(),
  verdictCode: VerdictSchema,
  verdictQualifier: z.string(),
  task: z.string(),
  events: z.array(ReducedCanonicalEventSchema),
  findings: z.array(ReducedFindingSchema),
  coverageCounts: z.object({
    total: z.number(),
    mapped: z.number(),
    metadataOnly: z.number(),
    unparsed: z.number(),
  }).strict(),
  limitations: z.array(LimitationFactSchema),
  allowedEventIds: z.array(z.string()),
  allowedFindingIds: z.array(z.string()),
}).strict();

// ─── Instructions constant ────────────────────────────────────────────────────

const INSTRUCTIONS =
  "You are a receipt-copy generator for an AI operations manager. " +
  "Translate the verified structured facts in this bundle into concise, manager-readable language. " +
  "Cite only event IDs and finding IDs that appear in the allowedEventIds and allowedFindingIds lists. " +
  "Produce a single valid JSON object matching the required output schema — no Markdown, no prose outside JSON. " +
  "Do not infer, classify, or assert any fact not present in this bundle. " +
  "Do not claim compliance, certification, or safety beyond what the evidence shows. " +
  "Copy the deterministic verdict headline and verdictQualifier exactly into the headline and outcome. " +
  "Notable actions may select and reorder findings but must copy each selected finding as label: description with its exact citations. " +
  "Copy every limitation text and event citation exactly and in order. " +
  "Qualify all conclusions as based on the supplied trace and authority envelope.";

// ─── Builder ──────────────────────────────────────────────────────────────────

export function buildFactBundle(input: BuildFactBundleInput): GraniteFactBundle {
  const { events, findings, accounting, verdict, authority } = input;

  // 1. Partition findings: AR-TRACE-001 → limitations; others → bundle.findings
  const normalFindings = findings.filter((f) => f.ruleId !== "AR-TRACE-001");
  const traceFindings = findings.filter((f) => f.ruleId === "AR-TRACE-001");
  if (input.hasAssessmentLimitation !== (traceFindings.length > 0)) {
    throw new Error(
      "GraniteFactBundle limitation flag does not match AR-TRACE-001 findings",
    );
  }

  // 2. Reduce canonical events (strip rawPointer, input, output, metadata)
  const reducedEvents: ReducedCanonicalEvent[] = events.map((ev) => ({
    eventId: ev.eventId,
    sequence: ev.sequence,
    timestamp: ev.timestamp,
    actorType: ev.actorType,
    actorId: ev.actorId,
    operation: ev.operation,
    ...(ev.toolName !== undefined ? { toolName: ev.toolName } : {}),
    ...(ev.sourceSystem !== undefined ? { sourceSystem: ev.sourceSystem } : {}),
    ...(ev.destinationSystem !== undefined ? { destinationSystem: ev.destinationSystem } : {}),
    destinationBoundary: ev.destinationBoundary,
    ...(ev.resourceType !== undefined ? { resourceType: ev.resourceType } : {}),
    dataCategories: ev.dataCategories,
    ...(ev.quantity !== undefined ? { quantity: ev.quantity } : {}),
    stateChange: ev.stateChange,
    status: ev.status,
    ...(ev.actionKey !== undefined ? { actionKey: ev.actionKey } : {}),
    adapterWarnings: ev.adapterWarnings,
    riskTags: ev.riskTags,
  }));

  // 3. Reduce findings (strip observedValue, expectedValue, policyPath)
  const reducedFindings: ReducedFinding[] = normalFindings.map((f) => ({
    findingId: f.findingId,
    ruleId: f.ruleId,
    severity: f.severity,
    label: f.label,
    description: f.description,
    eventIds: f.eventIds,
  }));

  // 4. Build limitations from AR-TRACE-001 findings
  const limitations: LimitationFact[] = traceFindings.map((f) => ({
    text: f.description,
    eventIds: f.eventIds,
    findingIds: [f.findingId],
  }));

  // 5. Coverage counts
  const coverageCounts = {
    total: input.coverage?.rawEvents ?? accounting.length,
    mapped:
      input.coverage?.mapped ??
      accounting.filter((a) => a.status === "mapped").length,
    metadataOnly:
      input.coverage?.metadataOnly ??
      accounting.filter((a) => a.status === "metadata-only").length,
    unparsed:
      input.coverage?.unparsed ??
      accounting.filter((a) => a.status === "unparsed").length,
  };

  // 6. allowedEventIds = all canonical event IDs
  const allowedEventIds = events.map((e) => e.eventId);

  // 7. allowedFindingIds = normal finding IDs ∪ limitation finding IDs
  const allowedFindingIds = [
    ...normalFindings.map((f) => f.findingId),
    ...traceFindings.map((f) => f.findingId),
  ];

  const bundle: GraniteFactBundle = {
    instructions: INSTRUCTIONS,
    verdictCode: verdict,
    verdictQualifier: qualifyVerdict(verdict),
    task: authority.task,
    events: reducedEvents,
    findings: reducedFindings,
    coverageCounts,
    limitations,
    allowedEventIds,
    allowedFindingIds,
  };

  // 8. Apply redactForModel
  const redacted = redactForModel(bundle) as GraniteFactBundle;
  const projected: GraniteFactBundle = {
    ...redacted,
    limitations: redacted.limitations.map((limitation) => ({
      ...limitation,
      text: limitation.text.slice(0, UI_LIMITS.LIMITATION_MAX),
    })),
  };

  // 9. Validate with GraniteFactBundleSchema; throw on failure (internal contract error)
  const parsed = GraniteFactBundleSchema.safeParse(projected);
  if (!parsed.success) {
    throw new Error(
      `GraniteFactBundle internal contract error: ${JSON.stringify(parsed.error.issues)}`,
    );
  }

  return parsed.data as GraniteFactBundle;
}
