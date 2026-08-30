import { adaptNativeTrace, NATIVE_ADAPTER_NAME } from "../adapters/nativeTrace";
import {
  adaptOtlpGenAiTrace,
  OtlpExportTraceServiceRequestSchema,
} from "../adapters/otlpGenAi";
import { adaptGenericJson } from "../adapters/genericJson";
import { buildFactBundle } from "../ai/factBundle";
import { deterministicFallback } from "../ai/deterministicFallback";
import { validateClaims } from "../ai/validateClaims";
import { computeCoverage } from "./coverage";
import { sha256HexPortable } from "./portableDigest";
import { runPolicyEngine } from "./policyEngine";
import type { PolicyDecisionLedger } from "./policyLedger";
import { qualifyVerdict, VERDICT_LABELS } from "./product";
import {
  AdapterResultSchema,
  AUTHORITY_SCHEMA_VERSION,
  AuthorityEnvelopeV1Schema,
  CANONICAL_EVENT_SCHEMA_VERSION,
  GenericJsonMappingSchema,
  NATIVE_TRACE_SCHEMA_VERSION,
  NativeTraceV1Schema,
  RECEIPT_SCHEMA_VERSION,
  ReceiptCopyGenerationResultSchema,
  ReceiptCopyRequestSchema,
  ReceiptResultSchema,
  ReviewDispositionSchema,
} from "./schemas/index";
import type {
  AdapterResult,
  CoverageSummary,
  Finding,
  NativeTraceV1,
  ReceiptCopyGenerationResult,
  ReceiptCopyRequest,
  ReceiptResult,
  ReceiptRun,
  ReviewDisposition,
} from "./schemas/index";

export const MAX_TRACE_BYTES = 2 * 1024 * 1024;
export const COPY_GENERATION_TIMEOUT_MS = 8_000;

export type ReceiptBuildIssue = {
  path: string;
  message: string;
};

export type ReceiptBuildErrorCode =
  | "input_too_large"
  | "invalid_utf8"
  | "invalid_json"
  | "unsupported_format"
  | "invalid_trace"
  | "invalid_mapping"
  | "invalid_authority"
  | "invalid_disposition"
  | "internal_contract";

export type RetainedReceiptSource = {
  /** A snapshot made before hashing or parsing. It is never exported. */
  bytes: Uint8Array;
  sha256?: string;
  rawDocument?: unknown;
  trace?: NativeTraceV1;
};

export type DeterministicReceiptEvidence = {
  adapter: AdapterResult;
  findings: Finding[];
  coverage: CoverageSummary;
  policyLedger: PolicyDecisionLedger;
};

export type BuildReceiptInput = {
  rawBytes: Uint8Array;
  authority: unknown;
  genericJsonMapping?: unknown;
  reviewerDisposition?: unknown;
};

export type ReceiptCopyGenerator = (
  request: ReceiptCopyRequest,
  options: { signal: AbortSignal },
) => Promise<unknown>;

export type BuildReceiptDependencies = {
  /** Optional prose boundary, normally implemented with POST /api/receipt-copy. */
  generateCopy?: ReceiptCopyGenerator;
  now?: () => string;
  copyTimeoutMs?: number;
};

export type BuildReceiptResult =
  | {
      ok: true;
      receipt: ReceiptResult;
      policyLedger: PolicyDecisionLedger;
      retainedSource: RetainedReceiptSource & {
        sha256: string;
        rawDocument: unknown;
      };
    }
  | {
      ok: false;
      error: {
        code: ReceiptBuildErrorCode;
        message: string;
        issues?: ReceiptBuildIssue[];
      };
      retainedSource: RetainedReceiptSource;
      deterministicEvidence?: DeterministicReceiptEvidence;
    };

/**
 * Build a complete receipt from exact source bytes. Deterministic evidence is
 * always computed locally; the optional generator can change prose only.
 */
export async function buildReceipt(
  input: BuildReceiptInput,
  dependencies: BuildReceiptDependencies = {},
): Promise<BuildReceiptResult> {
  const exactBytes = Uint8Array.from(input.rawBytes);
  const retainedSource: RetainedReceiptSource = { bytes: exactBytes };

  // The limit is checked before decoding or JSON parsing.
  if (exactBytes.byteLength > MAX_TRACE_BYTES) {
    return failure(
      "input_too_large",
      `This trace is larger than the 2 MiB limit (${MAX_TRACE_BYTES} bytes).`,
      retainedSource,
    );
  }

  // Snapshot caller-owned configuration before the first await so later
  // mutations cannot change the authority used for this receipt.
  const authorityResult = AuthorityEnvelopeV1Schema.safeParse(input.authority);
  const genericMappingResult =
    input.genericJsonMapping === undefined
      ? undefined
      : GenericJsonMappingSchema.safeParse(input.genericJsonMapping);
  const dispositionResult = ReviewDispositionSchema.safeParse(
    input.reviewerDisposition ?? "unreviewed",
  );
  const generateCopy = dependencies.generateCopy;
  const now = dependencies.now;
  const copyTimeoutMs =
    dependencies.copyTimeoutMs ?? COPY_GENERATION_TIMEOUT_MS;

  let sha256: string;
  try {
    // Hash the exact snapshot before any decoding, parsing, or normalization.
    sha256 = await sha256HexPortable(exactBytes);
    retainedSource.sha256 = sha256;
  } catch {
    return failure(
      "internal_contract",
      "The trace digest could not be computed.",
      retainedSource,
    );
  }

  let sourceText: string;
  try {
    sourceText = new TextDecoder("utf-8", { fatal: true }).decode(exactBytes);
  } catch {
    return failure(
      "invalid_utf8",
      "Use UTF-8 JSON for the trace.",
      retainedSource,
    );
  }

  let rawDocument: unknown;
  try {
    rawDocument = JSON.parse(sourceText) as unknown;
    retainedSource.rawDocument = rawDocument;
  } catch (error) {
    return failure(
      "invalid_json",
      formatJsonError(error, sourceText),
      retainedSource,
    );
  }

  if (!isRecord(rawDocument) && !Array.isArray(rawDocument)) {
    return failure(
      "unsupported_format",
      `This schema is not supported. Agent Receipt accepts ${NATIVE_TRACE_SCHEMA_VERSION}, one documented OTLP/JSON resourceSpans shape, or a JSON record array with an explicit mapping.`,
      retainedSource,
    );
  }

  let adapter: AdapterResult;
  let run: ReceiptRun;
  let rawEventCount: number;
  let inputSchemaVersion: string;
  let adapterName: string;
  let nativeTrace: NativeTraceV1 | undefined;
  let genericJsonMapping: ReturnType<typeof GenericJsonMappingSchema.parse> | undefined;

  if (
    isRecord(rawDocument) &&
    rawDocument["schemaVersion"] === NATIVE_TRACE_SCHEMA_VERSION
  ) {
    const traceResult = NativeTraceV1Schema.safeParse(rawDocument);
    if (!traceResult.success) {
      return failure(
        "invalid_trace",
        "Some trace fields are invalid. Review the fields listed below.",
        retainedSource,
        zodIssues(traceResult.error.issues),
      );
    }
    const trace = traceResult.data;
    nativeTrace = trace;
    retainedSource.trace = trace;

    const duplicateEventIds = findDuplicates(trace.events.map((event) => event.id));
    if (duplicateEventIds.length > 0) {
      return failure(
        "invalid_trace",
        "Trace validation failed because native event IDs must be unique.",
        retainedSource,
        duplicateEventIds.map((eventId) => ({
          path: "events",
          message: `Duplicate native event ID "${eventId}"`,
        })),
      );
    }
    if (trace.events.length === 0) {
      return failure(
        "invalid_trace",
        "At least one native event is required for evidence-cited receipt copy.",
        retainedSource,
        [{ path: "events", message: "Add at least one event so every receipt note can cite evidence." }],
      );
    }

    adapter = adaptNativeTrace(trace);
    run = {
      traceId: trace.traceId,
      agent: trace.agent,
      startedAt: trace.startedAt,
      ...(trace.completedAt === undefined
        ? {}
        : { completedAt: trace.completedAt }),
      status: trace.status,
    };
    rawEventCount = trace.events.length;
    inputSchemaVersion = trace.schemaVersion;
    adapterName = NATIVE_ADAPTER_NAME;
  } else if (isRecord(rawDocument) && "resourceSpans" in rawDocument) {
    const otlpResult = OtlpExportTraceServiceRequestSchema.safeParse(rawDocument);
    if (!otlpResult.success) {
      return failure(
        "invalid_trace",
        "The OTLP/JSON export does not match the supported resourceSpans shape.",
        retainedSource,
        zodIssues(otlpResult.error.issues),
      );
    }
    try {
      const adapted = adaptOtlpGenAiTrace(otlpResult.data);
      adapter = adapted.adapter;
      run = adapted.run;
      rawEventCount = adapted.rawSpanCount;
      inputSchemaVersion = adapted.schemaVersion;
      adapterName = adapted.adapterName;
    } catch (error) {
      return failure(
        "invalid_trace",
        error instanceof Error
          ? error.message
          : "The OTLP/JSON export could not be adapted.",
        retainedSource,
      );
    }
  } else if (genericMappingResult !== undefined) {
    if (!genericMappingResult.success) {
      return failure(
        "invalid_mapping",
        "The generic JSON mapping is incomplete or invalid.",
        retainedSource,
        zodIssues(genericMappingResult.error.issues),
      );
    }
    try {
      const adapted = adaptGenericJson(rawDocument, genericMappingResult.data);
      adapter = adapted.adapter;
      run = adapted.run;
      rawEventCount = adapted.rawRecordCount;
      inputSchemaVersion = adapted.schemaVersion;
      adapterName = adapted.adapterName;
      genericJsonMapping = adapted.mapping;
    } catch (error) {
      return failure(
        "invalid_mapping",
        error instanceof Error
          ? error.message
          : "The generic JSON records could not be mapped.",
        retainedSource,
      );
    }
  } else {
    return failure(
      "unsupported_format",
      `This schema is not supported automatically. Use ${NATIVE_TRACE_SCHEMA_VERSION}, the documented OTLP/JSON resourceSpans shape, or confirm an explicit mapping for a JSON record array.`,
      retainedSource,
    );
  }

  if (!authorityResult.success) {
    return failure(
      "invalid_authority",
      "Authority envelope validation failed.",
      retainedSource,
      zodIssues(authorityResult.error.issues),
    );
  }
  const authority = authorityResult.data;

  if (!dispositionResult.success) {
    return failure(
      "invalid_disposition",
      "Reviewer disposition validation failed.",
      retainedSource,
      zodIssues(dispositionResult.error.issues),
    );
  }

  let coverage: CoverageSummary;
  try {
    adapter = AdapterResultSchema.parse(adapter);
    if (adapter.events.length === 0) {
      return failure(
        "invalid_trace",
        "At least one source record must map to a canonical event for evidence-cited receipt copy.",
        retainedSource,
        adapter.accounting.map((entry) => ({
          path: entry.rawPointer,
          message: entry.reason ?? "Source record did not map to a canonical event.",
        })),
      );
    }
    coverage = computeCoverage({
      rawEventCount,
      events: adapter.events,
      accounting: adapter.accounting,
    });
  } catch {
    return failure(
      "internal_contract",
      "Adapter output failed receipt coverage checks.",
      retainedSource,
    );
  }

  const policy = runPolicyEngine({
    events: adapter.events,
    accounting: adapter.accounting,
    authority,
    traceCompletionStatus: run.status,
  });
  const deterministicEvidence: DeterministicReceiptEvidence = {
    adapter,
    findings: policy.findings,
    coverage,
    policyLedger: policy.policyLedger,
  };

  let bundle: ReturnType<typeof buildFactBundle>;
  let fallbackGeneration: ReceiptCopyGenerationResult;
  try {
    bundle = buildFactBundle({
      events: adapter.events,
      findings: policy.findings,
      accounting: adapter.accounting,
      verdict: policy.verdict,
      authority,
      hasAssessmentLimitation: policy.hasAssessmentLimitation,
      coverage,
    });
    const copy = deterministicFallback(bundle);
    const claims = validateClaims(copy, bundle);
    if (!claims.valid) {
      throw new Error("Fallback copy failed claim validation");
    }
    fallbackGeneration = ReceiptCopyGenerationResultSchema.parse({
      generationSource: "deterministic_fallback",
      copy,
    });
  } catch {
    return failure(
      "internal_contract",
      "Deterministic receipt copy failed its internal contract.",
      retainedSource,
      undefined,
      deterministicEvidence,
    );
  }

  const requestResult = ReceiptCopyRequestSchema.safeParse({
    rawEventCount,
    events: adapter.events,
    accounting: adapter.accounting,
    authority,
    traceCompletionStatus: run.status,
  });
  if (!requestResult.success) {
    return failure(
      "internal_contract",
      "Receipt-copy request failed its internal contract.",
      retainedSource,
      zodIssues(requestResult.error.issues),
      deterministicEvidence,
    );
  }

  const generation = generateCopy
    ? await chooseGeneratedCopy(
        requestResult.data,
        bundle,
        fallbackGeneration,
        generateCopy,
        copyTimeoutMs,
      )
    : fallbackGeneration;

  let generatedAt: string;
  try {
    generatedAt = (now ?? (() => new Date().toISOString()))();
  } catch {
    return failure(
      "internal_contract",
      "Receipt generation time could not be recorded.",
      retainedSource,
      undefined,
      deterministicEvidence,
    );
  }
  const receiptCandidate = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    run,
    authority,
    verdict: policy.verdict,
    verdictLabel: VERDICT_LABELS[policy.verdict],
    verdictQualifier: qualifyVerdict(policy.verdict),
    findings: policy.findings,
    events: adapter.events,
    accounting: adapter.accounting,
    warnings: adapter.warnings,
    coverage,
    copy: generation.copy,
    reviewerDisposition: dispositionResult.data,
    integrity: {
      sha256,
      byteLength: exactBytes.byteLength,
      inputFormat: adapter.format,
      schemaVersion: inputSchemaVersion,
      adapterName,
      adapterVersion: adapter.adapterVersion,
      authoritySchemaVersion: AUTHORITY_SCHEMA_VERSION,
      policyId: authority.policyId,
      canonicalEventSchemaVersion: CANONICAL_EVENT_SCHEMA_VERSION,
      receiptSchemaVersion: RECEIPT_SCHEMA_VERSION,
      generatedAt,
      ...(genericJsonMapping === undefined ? {} : { genericJsonMapping }),
      generationSource: generation.generationSource,
      ...(generation.generationSource === "granite"
        ? {
            modelId: generation.modelId,
            modelApiVersion: generation.modelApiVersion,
          }
        : {}),
    },
  };
  const receiptResult = ReceiptResultSchema.safeParse(receiptCandidate);
  if (!receiptResult.success) {
    return failure(
      "internal_contract",
      "Complete receipt failed its internal contract.",
      retainedSource,
      zodIssues(receiptResult.error.issues),
      deterministicEvidence,
    );
  }

  return {
    ok: true,
    receipt: receiptResult.data,
    policyLedger: policy.policyLedger,
    retainedSource: {
      bytes: exactBytes,
      sha256,
      rawDocument,
      ...(nativeTrace ? { trace: nativeTrace } : {}),
    },
  };
}

/** Update human review state without recomputing or relabeling the verdict. */
export function withReviewerDisposition(
  receipt: ReceiptResult,
  reviewerDisposition: unknown,
): ReceiptResult {
  const disposition = ReviewDispositionSchema.parse(reviewerDisposition);
  const updated = ReceiptResultSchema.parse({
    ...receipt,
    reviewerDisposition: disposition,
  });
  validateDeterministicReceiptFields(updated);
  validateReceiptCopyClaims(updated);
  return updated;
}

/** Validate immediately before creating the JSON download payload. */
export function serializeReceipt(receipt: ReceiptResult): string {
  const parsed = ReceiptResultSchema.parse(receipt);
  validateDeterministicReceiptFields(parsed);
  validateReceiptCopyClaims(parsed);
  return JSON.stringify(parsed, null, 2);
}

function validateDeterministicReceiptFields(receipt: ReceiptResult): void {
  const recomputed = runPolicyEngine({
    events: receipt.events,
    accounting: receipt.accounting,
    authority: receipt.authority,
    traceCompletionStatus: receipt.run.status,
  });
  if (
    receipt.verdict !== recomputed.verdict ||
    JSON.stringify(receipt.findings) !== JSON.stringify(recomputed.findings)
  ) {
    throw new Error("Receipt deterministic evidence failed validation");
  }
}

function validateReceiptCopyClaims(receipt: ReceiptResult): void {
  const bundle = buildFactBundle({
    events: receipt.events,
    findings: receipt.findings,
    accounting: receipt.accounting,
    verdict: receipt.verdict,
    authority: receipt.authority,
    hasAssessmentLimitation: receipt.findings.some(
      (finding) => finding.ruleId === "AR-TRACE-001",
    ),
    coverage: receipt.coverage,
  });
  const claims = validateClaims(receipt.copy, bundle);
  if (!claims.valid) {
    throw new Error("Receipt copy failed claim validation");
  }
}

async function chooseGeneratedCopy(
  request: ReceiptCopyRequest,
  bundle: ReturnType<typeof buildFactBundle>,
  fallback: ReceiptCopyGenerationResult,
  generator: ReceiptCopyGenerator,
  timeoutMs: number,
): Promise<ReceiptCopyGenerationResult> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return fallback;

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("Receipt-copy generation timed out"));
    }, timeoutMs);
  });

  try {
    const candidate = await Promise.race([
      generator(request, { signal: controller.signal }),
      timeoutPromise,
    ]);
    if (controller.signal.aborted) return fallback;
    const parsed = ReceiptCopyGenerationResultSchema.safeParse(candidate);
    if (!parsed.success) return fallback;
    if (parsed.data.generationSource === "deterministic_fallback") {
      // Fallback provenance always means the copy was produced by this local,
      // deterministic implementation—not supplied by an external generator.
      return fallback;
    }

    const claims = validateClaims(parsed.data.copy, bundle);
    return claims.valid ? parsed.data : fallback;
  } catch {
    return fallback;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function failure(
  code: ReceiptBuildErrorCode,
  message: string,
  retainedSource: RetainedReceiptSource,
  issues?: ReceiptBuildIssue[],
  deterministicEvidence?: DeterministicReceiptEvidence,
): BuildReceiptResult {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(issues === undefined ? {} : { issues }),
    },
    retainedSource,
    ...(deterministicEvidence === undefined ? {} : { deterministicEvidence }),
  };
}

function zodIssues(
  issues: Array<{ path: PropertyKey[]; message: string }>,
): ReceiptBuildIssue[] {
  return issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatJsonError(error: unknown, sourceText: string): string {
  const message = error instanceof Error ? error.message : "";
  const lineColumn = message.match(/line\s+(\d+)\s+column\s+(\d+)/i);
  if (lineColumn) {
    return `The trace is not valid JSON near line ${lineColumn[1]}, column ${lineColumn[2]}.`;
  }

  const positionMatch = message.match(/position\s+(\d+)/i);
  if (positionMatch) {
    const position = Number(positionMatch[1]);
    const prefix = sourceText.slice(0, position);
    const line = prefix.split("\n").length;
    const lastNewline = prefix.lastIndexOf("\n");
    const column = position - lastNewline;
    return `The trace is not valid JSON near line ${line}, column ${column}.`;
  }

  return "The trace is not valid JSON. Check the syntax and try again.";
}

export type { ReviewDisposition };
