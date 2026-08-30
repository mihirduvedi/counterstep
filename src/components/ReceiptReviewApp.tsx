"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent } from "react";

import { formatCoverageSummary } from "../core/coverage";
import {
  buildReceipt,
  MAX_TRACE_BYTES,
  serializeReceipt,
  withReviewerDisposition,
} from "../core/receipt";
import { serializeRecoveryPlan } from "../core/recoveryPlan";
import {
  serializeEvidencePacket,
  verifyPortableArtifact,
} from "../core/evidencePacket";
import type {
  BuildReceiptResult,
  ReceiptCopyGenerator,
} from "../core/receipt";
import type {
  AuthorityEnvelopeV1,
  CanonicalEvent,
  CanonicalOperation,
  Finding,
  GenericJsonMapping,
  ReceiptResult,
  ReviewDisposition,
} from "../core/schemas/index";
import {
  fixtureA,
  fixtureB,
  fixtureCIncomplete,
  otlpDemoAuthority,
  sharedAuthority,
} from "../fixtures";
import {
  buildEvidenceGapView,
  type EvidenceGapView,
} from "../ui/evidenceGapView";
import {
  buildGraniteBoundaryView,
  type GraniteBoundaryView,
} from "../ui/graniteBoundaryView";
import {
  buildReceiptVerificationView,
  type ReceiptVerificationView,
} from "../ui/verificationView";
import {
  ALL_OPERATIONS,
  authorityToDraft,
  blankAuthorityDraft,
  buildHumanActionSummary,
  buildManagerIncidentBrief,
  buildRecoveryPlan,
  buildSystemEdges,
  exactFixtureBytes,
  formatCountLabel,
  formatTraceSourceLabel,
  groupSystemsByBoundary,
  resolveRawPointer,
  summarizeReceipt,
  validateAuthorityDraft,
  validateTraceBytes,
} from "../ui/receiptView";
import type {
  AuthorityDraft,
  HumanActionSummary,
  IncidentBrief,
  RecoveryAction,
  TraceSourceKind,
} from "../ui/receiptView";
import type {
  PolicyDecisionLedger,
  PolicyDecisionStatus,
} from "../core/policyLedger";
import type { GenericJsonInspection } from "../adapters/genericJson";
import {
  createGenericJsonMappingDraft,
  refreshGenericValueMaps,
  validateGenericJsonMappingDraft,
} from "../ui/genericMappingView";
import type {
  GenericJsonMappingDraft,
  GenericMappingValidation,
} from "../ui/genericMappingView";
import { GenericMappingStep } from "./GenericMappingStep";

type Step = "intake" | "mapping" | "authority" | "receipt";

type TraceSource = {
  bytes: Uint8Array;
  label: string;
  kind: TraceSourceKind;
  format: "native" | "otlp" | "generic";
  genericJsonMapping?: GenericJsonMapping;
};

type GenericIntake = {
  rawDocument: unknown;
  inspection: GenericJsonInspection;
};

type SuccessfulBuild = Extract<BuildReceiptResult, { ok: true }>;

type EvidenceRequest = {
  title: string;
  eventIds: string[];
  findingIds: string[];
  rawPointers: string[];
  trigger: HTMLButtonElement;
};

const requestGeneratedCopy: ReceiptCopyGenerator = async (
  request,
  options,
) => {
  const response = await fetch("/api/receipt-copy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal: options.signal,
  });
  if (!response.ok) throw new Error("Receipt copy request failed");
  return response.json();
};

const DISPOSITIONS: Array<{
  value: ReviewDisposition;
  label: string;
  description: string;
}> = [
  {
    value: "unreviewed",
    label: "Unreviewed",
    description: "No decision yet.",
  },
  {
    value: "accepted",
    label: "Accepted",
    description: "I reviewed the receipt and accept the run output.",
  },
  {
    value: "investigate",
    label: "Investigate",
    description: "I need more evidence or follow-up before deciding.",
  },
  {
    value: "rejected",
    label: "Rejected",
    description: "I reviewed the receipt and reject the run output.",
  },
];

export function ReceiptReviewApp(props: {
  initialIntakeMode?: "trace" | "verify";
  initialVerificationView?: ReceiptVerificationView;
  initialVerificationSource?: string;
}) {
  const [step, setStep] = useState<Step>("intake");
  const [source, setSource] = useState<TraceSource | null>(null);
  const [genericIntake, setGenericIntake] = useState<GenericIntake | null>(null);
  const [genericDraft, setGenericDraft] =
    useState<GenericJsonMappingDraft | null>(null);
  const [pasteValue, setPasteValue] = useState("");
  const [authorityDraft, setAuthorityDraft] = useState<AuthorityDraft>(
    blankAuthorityDraft,
  );
  const [intakeError, setIntakeError] = useState<{
    message: string;
    issues?: Array<{ path: string; message: string }>;
  } | null>(null);
  const [buildError, setBuildError] = useState<{
    message: string;
    issues?: Array<{ path: string; message: string }>;
  } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<SuccessfulBuild | null>(null);
  const [evidence, setEvidence] = useState<EvidenceRequest | null>(null);
  const [exportStatus, setExportStatus] = useState("");
  const [recoveryExportStatus, setRecoveryExportStatus] = useState("");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const authorityValidation = useMemo(
    () => validateAuthorityDraft(authorityDraft),
    [authorityDraft],
  );
  const genericValidation = useMemo<GenericMappingValidation | null>(() => {
    if (!genericIntake || !genericDraft) return null;
    return validateGenericJsonMappingDraft(
      genericIntake.rawDocument,
      genericDraft,
    );
  }, [genericDraft, genericIntake]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      // Temporarily override the global smooth-scroll style so a newly
      // rendered step cannot remain parked mid-screen during the transition.
      const previousScrollBehavior = document.documentElement.style.scrollBehavior;
      document.documentElement.style.scrollBehavior = "auto";
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      document.documentElement.style.scrollBehavior = previousScrollBehavior;
    });
    return () => cancelAnimationFrame(frame);
  }, [step]);

  useEffect(() => {
    if (!evidence) return;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        const trigger = evidence.trigger;
        setEvidence(null);
        requestAnimationFrame(() => trigger.focus());
        return;
      }
      if (event.key !== "Tab") return;
      const drawer = closeButtonRef.current?.closest("[role='dialog']");
      if (!drawer) return;
      const focusable = Array.from(
        drawer.querySelectorAll<HTMLElement>(
          "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = priorOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [evidence]);

  function beginWithSource(
    bytes: Uint8Array,
    label: string,
    kind: TraceSourceKind,
    presetAuthority?: AuthorityEnvelopeV1,
  ) {
    const validation = validateTraceBytes(bytes, MAX_TRACE_BYTES);
    if (!validation.ok) {
      setIntakeError({
        message: validation.message,
        issues: validation.issues,
      });
      return;
    }
    setIntakeError(null);
    setBuildError(null);
    setExportStatus("");
    setRecoveryExportStatus("");
    setSource({
      bytes: Uint8Array.from(bytes),
      label,
      kind,
      format: validation.format,
    });
    if (validation.format === "generic") {
      setGenericIntake({
        rawDocument: validation.rawDocument,
        inspection: validation.inspection,
      });
      setGenericDraft(
        createGenericJsonMappingDraft(
          validation.rawDocument,
          validation.inspection,
        ),
      );
      setAuthorityDraft(blankAuthorityDraft());
      setResult(null);
      setStep("mapping");
      return;
    }
    setGenericIntake(null);
    setGenericDraft(null);
    setAuthorityDraft(
      presetAuthority ? authorityToDraft(presetAuthority) : blankAuthorityDraft(),
    );
    setResult(null);
    setStep("authority");
  }

  function updateGenericDraft(next: GenericJsonMappingDraft) {
    if (!genericIntake) return;
    setGenericDraft(
      refreshGenericValueMaps(genericIntake.rawDocument, next),
    );
  }

  function confirmGenericMapping() {
    if (!source || !genericValidation?.ok) return;
    setSource({
      ...source,
      format: "generic",
      genericJsonMapping: genericValidation.mapping,
    });
    setAuthorityDraft(blankAuthorityDraft());
    setBuildError(null);
    setStep("authority");
  }

  function selectSample(kind: "expected" | "overreaching" | "incomplete") {
    if (kind === "incomplete") {
      beginWithSource(
        new TextEncoder().encode(
          `${JSON.stringify(fixtureCIncomplete, null, 2)}\n`,
        ),
        "Incomplete OTLP run",
        "synthetic",
        otlpDemoAuthority,
      );
      return;
    }
    const trace = kind === "expected" ? fixtureA : fixtureB;
    beginWithSource(
      exactFixtureBytes(trace),
      kind === "expected" ? "Expected run" : "Overreaching run",
      "synthetic",
      sharedAuthority,
    );
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (
      file.type !== "application/json" &&
      !file.name.toLowerCase().endsWith(".json")
    ) {
      setIntakeError({
        message: "Choose a UTF-8 .json file. Agent Receipt does not accept JSONL, ZIP, YAML, or binary input.",
      });
      return;
    }
    if (file.size > MAX_TRACE_BYTES) {
      setIntakeError({
        message: "This file is larger than the 2 MiB trace limit.",
      });
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    beginWithSource(bytes, file.name, "upload");
  }

  function usePastedTrace() {
    if (pasteValue.trim().length === 0) {
      setIntakeError({
        message:
          "Paste one Native Trace v1, supported OTLP/JSON object, or JSON record array first.",
      });
      return;
    }
    beginWithSource(
      new TextEncoder().encode(pasteValue),
      "Pasted trace",
      "paste",
    );
  }

  async function analyzeTrace() {
    if (!source || !authorityValidation.ok || analyzing) return;
    setAnalyzing(true);
    setBuildError(null);
    setExportStatus("");
    setRecoveryExportStatus("");
    try {
      const build = await buildReceipt(
        {
          rawBytes: source.bytes,
          authority: authorityValidation.authority,
          ...(source.genericJsonMapping === undefined
            ? {}
            : { genericJsonMapping: source.genericJsonMapping }),
        },
        { generateCopy: requestGeneratedCopy },
      );
      if (!build.ok) {
        setBuildError({
          message: build.error.message,
          issues: build.error.issues,
        });
        return;
      }
      setResult(build);
      setStep("receipt");
    } catch {
      setBuildError({
        message: "We could not build the receipt. Your trace and authority entries are still here.",
      });
    } finally {
      setAnalyzing(false);
    }
  }

  function closeEvidence() {
    if (!evidence) return;
    const trigger = evidence.trigger;
    setEvidence(null);
    requestAnimationFrame(() => trigger.focus());
  }

  function openEvidence(
    event: ReactKeyboardEvent<HTMLButtonElement> | React.MouseEvent<HTMLButtonElement>,
    title: string,
    eventIds: string[],
    findingIds: string[] = [],
    rawPointers: string[] = [],
  ) {
    setEvidence({
      title,
      eventIds: [...new Set(eventIds)],
      findingIds: [...new Set(findingIds)],
      rawPointers: [...new Set(rawPointers)],
      trigger: event.currentTarget,
    });
  }

  function changeDisposition(disposition: ReviewDisposition) {
    if (!result) return;
    try {
      const receipt = withReviewerDisposition(result.receipt, disposition);
      setResult({ ...result, receipt });
      setExportStatus(`Decision saved for this browser session: ${disposition}.`);
      setRecoveryExportStatus("");
    } catch {
      setExportStatus("This decision did not pass validation, so it was not saved.");
    }
  }

  function downloadReceipt() {
    if (!result) return;
    try {
      const serialized = serializeReceipt(result.receipt);
      const blob = new Blob([serialized], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const safeTraceId = result.receipt.run.traceId.replace(/[^a-z0-9_-]+/gi, "-");
      anchor.href = url;
      anchor.download = `agent-receipt-${safeTraceId}.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setExportStatus("Receipt downloaded. The file passed schema validation and excludes the source trace.");
    } catch {
      setExportStatus("Export stopped because the receipt failed validation.");
    }
  }

  async function downloadEvidencePacket() {
    if (!result) return;
    const incidents = buildManagerIncidentBrief(result.receipt);
    const actions = buildRecoveryPlan(result.receipt, incidents);
    try {
      const serialized = await serializeEvidencePacket({
        receipt: result.receipt,
        incidents,
        actions,
      });
      const blob = new Blob([serialized], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const safeTraceId = result.receipt.run.traceId.replace(/[^a-z0-9_-]+/gi, "-");
      anchor.href = url;
      anchor.download = `agent-receipt-evidence-${safeTraceId}.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setExportStatus(
        "Evidence packet downloaded. Its receipt, decision brief, and recovery plan passed strict validation and received independent manifest digests.",
      );
    } catch {
      setExportStatus(
        "Export stopped because the evidence packet failed validation.",
      );
    }
  }

  async function downloadRecoveryPlan() {
    if (!result) return;
    const incidents = buildManagerIncidentBrief(result.receipt);
    const actions = buildRecoveryPlan(result.receipt, incidents);
    try {
      const serialized = await serializeRecoveryPlan({
        receipt: result.receipt,
        incidents,
        actions,
      });
      const blob = new Blob([serialized], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const safeTraceId = result.receipt.run.traceId.replace(/[^a-z0-9_-]+/gi, "-");
      anchor.href = url;
      anchor.download = `agent-receipt-recovery-${safeTraceId}.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setRecoveryExportStatus(
        actions.length === 0
          ? "Empty recovery plan downloaded. The receipt has no findings or proposed actions."
          : "Recovery plan downloaded. It passed citation validation and is bound to this exact receipt by SHA-256.",
      );
    } catch {
      setRecoveryExportStatus(
        "Export stopped because the recovery plan failed validation.",
      );
    }
  }

  function startAgain() {
    setStep("intake");
    setResult(null);
    setSource(null);
    setGenericIntake(null);
    setGenericDraft(null);
    setBuildError(null);
    setIntakeError(null);
    setExportStatus("");
    setRecoveryExportStatus("");
    setPasteValue("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const progressSteps: Step[] =
    source?.format === "generic"
      ? ["intake", "mapping", "authority", "receipt"]
      : ["intake", "authority", "receipt"];

  return (
    <>
      <header className="app-header">
        <a className="brand" href="#top" aria-label="Agent Receipt home">
          <span aria-hidden="true" className="brand-mark">AR</span>
          <span>
            <strong>Agent Receipt</strong>
            <small>Review completed runs</small>
          </span>
        </a>
        <ol className="step-list" aria-label="Review progress">
          {progressSteps.map((item, index) => {
            const currentIndex = progressSteps.indexOf(step);
            return (
              <li
                key={item}
                className={
                  item === step ? "is-current" : index < currentIndex ? "is-complete" : ""
                }
                aria-current={item === step ? "step" : undefined}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                {item === "intake"
                  ? "Trace"
                  : item === "mapping"
                    ? "Map"
                    : item === "authority"
                      ? "Authority"
                      : "Receipt"}
              </li>
            );
          })}
        </ol>
        {step !== "intake" ? (
          <button className="text-button" type="button" onClick={startAgain}>
            New review
          </button>
        ) : (
          <span className="fallback-chip">No model required</span>
        )}
      </header>

      <main id="top" className={`app-main step-${step}`}>
        {step === "intake" ? (
          <IntakeStep
            initialMode={props.initialIntakeMode ?? "trace"}
            initialVerificationView={props.initialVerificationView}
            initialVerificationSource={props.initialVerificationSource}
            error={intakeError}
            pasteValue={pasteValue}
            fileInputRef={fileInputRef}
            onPasteChange={setPasteValue}
            onSelectSample={selectSample}
            onFile={handleFile}
            onUsePaste={usePastedTrace}
          />
        ) : null}

        {step === "mapping" && source && genericIntake && genericDraft && genericValidation ? (
          <GenericMappingStep
            source={source}
            document={genericIntake.rawDocument}
            inspection={genericIntake.inspection}
            draft={genericDraft}
            validation={genericValidation}
            onDraftChange={updateGenericDraft}
            onBack={() => setStep("intake")}
            onContinue={confirmGenericMapping}
          />
        ) : null}

        {step === "authority" && source ? (
          <AuthorityStep
            source={source}
            draft={authorityDraft}
            validation={authorityValidation}
            analyzing={analyzing}
            buildError={buildError}
            onDraftChange={setAuthorityDraft}
            onBack={() => setStep(source.format === "generic" ? "mapping" : "intake")}
            onAnalyze={analyzeTrace}
          />
        ) : null}

        {step === "receipt" && result && source ? (
          <ReceiptStep
            build={result}
            source={source}
            exportStatus={exportStatus}
            recoveryExportStatus={recoveryExportStatus}
            onOpenEvidence={openEvidence}
            onDisposition={changeDisposition}
            onDownload={downloadReceipt}
            onDownloadEvidence={downloadEvidencePacket}
            onDownloadRecovery={downloadRecoveryPlan}
          />
        ) : null}
      </main>

      {evidence && result ? (
        <EvidenceDrawer
          request={evidence}
          build={result}
          sourceKind={source?.kind ?? "upload"}
          closeButtonRef={closeButtonRef}
          onClose={closeEvidence}
        />
      ) : null}
    </>
  );
}

type IntakeStepProps = {
  initialMode: "trace" | "verify";
  initialVerificationView?: ReceiptVerificationView;
  initialVerificationSource?: string;
  error: { message: string; issues?: Array<{ path: string; message: string }> } | null;
  pasteValue: string;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onPasteChange: (value: string) => void;
  onSelectSample: (kind: "expected" | "overreaching" | "incomplete") => void;
  onFile: (event: ChangeEvent<HTMLInputElement>) => void;
  onUsePaste: () => void;
};

function IntakeStep({
  initialMode,
  initialVerificationView,
  initialVerificationSource,
  error,
  pasteValue,
  fileInputRef,
  onPasteChange,
  onSelectSample,
  onFile,
  onUsePaste,
}: IntakeStepProps) {
  const [mode, setMode] = useState<"trace" | "verify">(initialMode);
  const [verificationPaste, setVerificationPaste] = useState("");
  const [verificationFile, setVerificationFile] = useState<{
    bytes: Uint8Array;
    label: string;
  } | null>(null);
  const [verificationSource, setVerificationSource] = useState(
    initialVerificationSource ?? "",
  );
  const [verificationView, setVerificationView] =
    useState<ReceiptVerificationView | null>(initialVerificationView ?? null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  async function handleVerificationFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (
      file.type !== "application/json" &&
      !file.name.toLowerCase().endsWith(".json")
    ) {
      setVerificationError("Choose an exported Agent Receipt receipt or evidence packet .json file.");
      setVerificationFile(null);
      return;
    }
    setVerificationFile({
      bytes: new Uint8Array(await file.arrayBuffer()),
      label: file.name,
    });
    setVerificationPaste("");
    setVerificationView(null);
    setVerificationError(null);
  }

  async function performVerification(bytes: Uint8Array, label: string) {
    setVerifying(true);
    setVerificationError(null);
    try {
      const report = await verifyPortableArtifact(bytes);
      setVerificationView(buildReceiptVerificationView(report));
      setVerificationSource(label);
    } catch {
      setVerificationView(null);
      setVerificationError(
        "The local verifier could not finish. The source bytes were not sent anywhere.",
      );
    } finally {
      setVerifying(false);
    }
  }

  async function runVerification() {
    if (verificationPaste.trim().length > 0) {
      await performVerification(
        new TextEncoder().encode(verificationPaste),
        "Pasted portable export JSON",
      );
      return;
    }
    if (verificationFile) {
      await performVerification(verificationFile.bytes, verificationFile.label);
      return;
    }
    setVerificationError("Upload an exported receipt or evidence packet, or paste its JSON first.");
  }

  async function verifySyntheticReceipt(kind: "receipt" | "altered" | "packet") {
    setVerifying(true);
    setVerificationView(null);
    setVerificationError(null);
    try {
      const build = await buildReceipt(
        {
          rawBytes: exactFixtureBytes(fixtureB),
          authority: sharedAuthority,
        },
        { now: () => "2026-08-28T22:00:00.000Z" },
      );
      if (!build.ok) throw new Error(build.error.message);
      const portableReceipt = structuredClone(build.receipt);
      if (kind === "altered") {
        const firstFinding = portableReceipt.findings[0];
        if (!firstFinding) throw new Error("Demo receipt has no finding to alter");
        firstFinding.description = "This deterministic finding text was altered after export.";
      }
      const json = kind === "packet"
        ? await serializeEvidencePacket({
            receipt: portableReceipt,
            incidents: buildManagerIncidentBrief(portableReceipt),
            actions: buildRecoveryPlan(portableReceipt),
          })
        : kind === "altered"
          ? JSON.stringify(portableReceipt, null, 2)
          : serializeReceipt(portableReceipt);
      const bytes = new TextEncoder().encode(`${json}\n`);
      setVerificationPaste(json);
      setVerificationFile(null);
      const report = await verifyPortableArtifact(bytes);
      setVerificationView(buildReceiptVerificationView(report));
      setVerificationSource(
        kind === "packet"
          ? "Valid synthetic evidence packet"
          : kind === "altered"
            ? "Altered synthetic receipt"
            : "Valid synthetic receipt",
      );
    } catch {
      setVerificationError("The synthetic verifier demo could not be prepared.");
    } finally {
      setVerifying(false);
    }
  }

  function resetVerification() {
    setVerificationPaste("");
    setVerificationFile(null);
    setVerificationSource("");
    setVerificationView(null);
    setVerificationError(null);
  }

  return (
    <div className="intake-layout">
      <section className="intro-panel" aria-labelledby="intake-title">
        <p className="kicker">
          {mode === "trace" ? "Start with the record" : "Replay the export"}
        </p>
        <h1 id="intake-title">
          {mode === "trace"
            ? "Review a completed agent run."
            : "Check the handoff before you trust it."}
        </h1>
        <p className="intro-copy">
          {mode === "trace"
            ? "Add the execution log, map unfamiliar JSON fields explicitly when needed, then compare the observed actions with the authority the manager approved. Deterministic policy rules produce the verdict."
              : "Import a receipt or evidence packet. This browser hashes the exact file and replays its accounting, policy result, cited claims, and packet manifest without credentials or a network call."}
        </p>
        <div className="trust-note">
          <span aria-hidden="true">{mode === "trace" ? "01" : "V1"}</span>
          <p>
            {mode === "trace"
              ? "Your source log stays in this browser session. Original bytes are hashed unchanged; unfamiliar fields are never interpreted until you confirm their meaning."
              : "A passing report proves internal consistency, not authenticity. It cannot establish who created the export, whether the trace was complete, or whether the original trace bytes were trustworthy."}
          </p>
        </div>
      </section>

      <section className="intake-workbench" aria-labelledby="choose-trace-title">
        <div className="intake-mode-tabs" role="tablist" aria-label="Start a review">
          <button
            id="trace-mode-tab"
            role="tab"
            type="button"
            aria-selected={mode === "trace"}
            aria-controls="trace-mode-panel"
            onClick={() => setMode("trace")}
          >
            <span>01</span>
            Review a trace
          </button>
          <button
            id="verify-mode-tab"
            role="tab"
            type="button"
            aria-selected={mode === "verify"}
            aria-controls="verify-mode-panel"
            onClick={() => setMode("verify")}
          >
            <span>V1</span>
            Verify an export
          </button>
        </div>

        {mode === "trace" ? (
          <div id="trace-mode-panel" role="tabpanel" aria-labelledby="trace-mode-tab">
        <div className="section-heading">
          <div>
            <p className="section-number">Step 01</p>
            <h2 id="choose-trace-title">Choose a trace</h2>
          </div>
          <p>Native, OTLP/JSON, or mapped JSON records · 2 MiB max</p>
        </div>

        {error ? <ErrorSummary error={error} /> : null}

        <div className="sample-list" aria-label="Synthetic sample traces">
          <SampleButton
            label="Expected run"
            verdict="Fits the declared authority"
            detail="3 events: CRM read, internal guidance lookup, local summary"
            tone="calm"
            onClick={() => onSelectSample("expected")}
          />
          <SampleButton
            label="Overreaching run"
            verdict="Crosses declared limits"
            detail="6 events: external spreadsheet, retry, customer message"
            tone="alert"
            onClick={() => onSelectSample("overreaching")}
          />
          <SampleButton
            label="Incomplete OTLP run"
            verdict="Refuses to overclaim"
            detail="3 source spans: 1 mapped, 1 metadata-only, 1 material gap"
            tone="gap"
            onClick={() => onSelectSample("incomplete")}
          />
        </div>

        <div className="input-divider"><span>Use your own trace</span></div>

        <div className="custom-input-grid">
          <div className="upload-field">
            <label htmlFor="trace-file">Upload a JSON file</label>
            <p id="trace-file-help">We hash the original file bytes before parsing.</p>
            <input
              ref={fileInputRef}
              id="trace-file"
              name="trace-file"
              type="file"
              accept="application/json,.json"
              aria-describedby="trace-file-help"
              onChange={onFile}
            />
          </div>
          <div className="paste-field">
            <label htmlFor="trace-json">Paste agent log JSON</label>
            <textarea
              id="trace-json"
              name="trace-json"
              rows={7}
              spellCheck={false}
              value={pasteValue}
              onChange={(event) => onPasteChange(event.target.value)}
              aria-describedby="trace-json-help"
              placeholder={'{\n  "schemaVersion": "agent-receipt.native-trace.v1"\n}' }
            />
            <div className="field-action-row">
              <p id="trace-json-help">Paste one UTF-8 JSON object or array. Native and documented OTLP shapes open directly; other record arrays open an explicit mapping step. JSONL and remote URLs are not supported.</p>
              <button className="secondary-button" type="button" onClick={onUsePaste}>
                Use pasted trace
              </button>
            </div>
          </div>
        </div>
          </div>
        ) : (
          <div id="verify-mode-panel" role="tabpanel" aria-labelledby="verify-mode-tab">
            <div className="section-heading verifier-heading">
              <div>
                <p className="section-number">Portable verifier</p>
                <h2 id="choose-trace-title">Replay the evidence contract</h2>
              </div>
              <p>Browser-only · no credentials · no network · 4 MiB packet max</p>
            </div>

            {verificationError ? (
              <ErrorSummary error={{ message: verificationError }} />
            ) : null}

            {!verificationView ? (
              <>
                <div className="verifier-demo-strip" aria-label="Synthetic verifier demonstrations">
                  <div>
                    <p className="section-number">30-second proof</p>
                    <strong>Run the complete handoff test.</strong>
                    <p>Replay the three-artifact packet, then catch one altered deterministic claim.</p>
                  </div>
                  <div className="verifier-demo-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={verifying}
                      onClick={() => void verifySyntheticReceipt("packet")}
                    >
                      Verify evidence packet
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={verifying}
                      onClick={() => void verifySyntheticReceipt("receipt")}
                    >
                      Verify receipt only
                    </button>
                    <button
                      className="secondary-button verifier-altered-button"
                      type="button"
                      disabled={verifying}
                      onClick={() => void verifySyntheticReceipt("altered")}
                    >
                      Catch altered sample
                    </button>
                  </div>
                </div>

                <div className="input-divider"><span>Or verify your own portable export</span></div>

                <div className="custom-input-grid verifier-input-grid">
                  <div className="upload-field">
                    <label htmlFor="receipt-file">Upload receipt or packet JSON</label>
                    <p id="receipt-file-help">The exact received bytes are hashed before parsing.</p>
                    <input
                      id="receipt-file"
                      name="receipt-file"
                      type="file"
                      accept="application/json,.json"
                      aria-label="Upload exported receipt or evidence packet JSON for verification"
                      aria-describedby="receipt-file-help"
                      onChange={(event) => void handleVerificationFile(event)}
                    />
                    {verificationFile ? (
                      <p className="selected-verification-file">Selected: {verificationFile.label}</p>
                    ) : null}
                  </div>
                  <div className="paste-field">
                    <label htmlFor="receipt-json">Paste receipt or packet JSON</label>
                    <textarea
                      id="receipt-json"
                      name="receipt-json"
                      rows={9}
                      spellCheck={false}
                      value={verificationPaste}
                      onChange={(event) => {
                        setVerificationPaste(event.target.value);
                        setVerificationFile(null);
                        setVerificationView(null);
                      }}
                      aria-label="Paste exported receipt or evidence packet JSON for verification"
                      aria-describedby="receipt-json-help"
                      placeholder={'{\n  "schemaVersion": "agent-receipt.evidence-packet.v1"\n}'}
                    />
                    <div className="field-action-row">
                      <p id="receipt-json-help">Pasted text is encoded as UTF-8 and verified locally.</p>
                      <button
                        className="primary-button"
                        type="button"
                        disabled={
                          verifying ||
                          (verificationPaste.trim().length === 0 && !verificationFile)
                        }
                        onClick={() => void runVerification()}
                      >
                        {verifying ? "Replaying checks…" : "Verify export"}
                      </button>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <VerificationReportPanel
                source={verificationSource}
                view={verificationView}
                onReset={resetVerification}
              />
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function VerificationReportPanel(props: {
  source: string;
  view: ReceiptVerificationView;
  onReset: () => void;
}) {
  return (
    <section
      className={`verifier-report verifier-report-${props.view.status}`}
      role="region"
      aria-label="Verification report"
    >
      <div className="verifier-status" role="status" aria-live="polite">
        <div className="verifier-stamp" aria-hidden="true">
          <span>{props.view.statusCode}</span>
          <strong>{props.view.status === "pass" ? "✓" : "!"}</strong>
        </div>
        <div>
          <p className="section-number">{props.source}</p>
          <h2>{props.view.statusLabel}</h2>
          <p>{props.view.statusDescription}</p>
        </div>
      </div>

      {props.view.summary ? (
        <dl className="verifier-summary">
          <div><dt>Artifact</dt><dd>{props.view.summary.artifactLabel}</dd></div>
          <div><dt>Trace</dt><dd>{props.view.summary.traceId}</dd></div>
          <div><dt>Verdict</dt><dd>{props.view.summary.verdict}</dd></div>
          <div><dt>Evidence &amp; copy</dt><dd>{props.view.summary.rawEventCountLabel} · {props.view.summary.findingCountLabel} · {props.view.summary.generationSourceLabel}</dd></div>
        </dl>
      ) : null}

      <div className="verifier-digest">
        <div>
          <p className="section-number">Exact imported file</p>
          <strong>{props.view.byteLengthLabel}</strong>
        </div>
        <code>{props.view.fileSha256}</code>
      </div>

      <ol className="verifier-gates" aria-label="Verification gates">
        {props.view.gates.map((gate, index) => (
          <li
            key={gate.id}
            className={`verifier-gate verifier-gate-${gate.status}`}
            aria-label={gate.ariaLabel}
          >
            <span className="verifier-gate-number">{String(index + 1).padStart(2, "0")}</span>
            <span className="verifier-gate-marker" aria-hidden="true">{gate.marker}</span>
            <div>
              <strong>{gate.label}</strong>
              <p>{gate.detail}</p>
              {gate.issues.length > 0 ? (
                <ul>
                  {gate.issues.map((issue, issueIndex) => (
                    <li key={`${issue.path}-${issueIndex}`}>
                      <code>{issue.path}</code> {issue.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      <aside className="verifier-limitations" aria-labelledby="verifier-limitations-title">
        <p className="section-number">Required qualifier</p>
        <h3 id="verifier-limitations-title">What this cannot verify</h3>
        <ul>
          {props.view.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </aside>

      <div className="verifier-reset-row">
        <p>Nothing in this report was sent to Granite or any server route.</p>
        <button className="secondary-button" type="button" onClick={props.onReset}>
          Verify another export
        </button>
      </div>
    </section>
  );
}

function SampleButton(props: {
  label: string;
  verdict: string;
  detail: string;
  tone: "calm" | "alert" | "gap";
  onClick: () => void;
}) {
  return (
    <button className={`sample-button sample-${props.tone}`} type="button" onClick={props.onClick}>
      <span className="sample-topline">
        <span className="synthetic-label">Synthetic sample</span>
        <span aria-hidden="true">↗</span>
      </span>
      <strong>{props.label}</strong>
      <span>{props.verdict}</span>
      <small>{props.detail}</small>
    </button>
  );
}

function formatTraceFormat(format: TraceSource["format"]): string {
  switch (format) {
    case "native":
      return "Native Trace v1";
    case "otlp":
      return "Documented OTLP/JSON";
    case "generic":
      return "Generic JSON · explicit map";
  }
}

type AuthorityStepProps = {
  source: TraceSource;
  draft: AuthorityDraft;
  validation: ReturnType<typeof validateAuthorityDraft>;
  analyzing: boolean;
  buildError: { message: string; issues?: Array<{ path: string; message: string }> } | null;
  onDraftChange: (draft: AuthorityDraft) => void;
  onBack: () => void;
  onAnalyze: () => void;
};

function AuthorityStep(props: AuthorityStepProps) {
  const update = <K extends keyof AuthorityDraft>(key: K, value: AuthorityDraft[K]) => {
    props.onDraftChange({ ...props.draft, [key]: value });
  };
  const toggleOperation = (
    key: "permittedOperations" | "approvalRequiredFor",
    operation: CanonicalOperation,
  ) => {
    const current = props.draft[key];
    update(
      key,
      current.includes(operation)
        ? current.filter((item) => item !== operation)
        : [...current, operation],
    );
  };

  return (
    <div className="authority-layout">
      <aside className="authority-context">
        <button className="back-button" type="button" onClick={props.onBack}>
          {props.source.format === "generic" ? "← Back to mapping" : "← Back to trace"}
        </button>
        <p className="section-number">
          Step {props.source.format === "generic" ? "03" : "02"}
        </p>
        <h1>Set the authority for this review.</h1>
        <p>
          The manager&rsquo;s rules for the run are recorded here and evaluated as written.
        </p>
        <dl className="source-facts">
          <div><dt>Trace</dt><dd>{props.source.label}</dd></div>
          <div><dt>Input</dt><dd>{formatTraceSourceLabel(props.source.kind)}</dd></div>
          <div><dt>Format</dt><dd>{formatTraceFormat(props.source.format)}</dd></div>
          <div><dt>File size</dt><dd>{props.source.bytes.byteLength.toLocaleString()} bytes</dd></div>
        </dl>
      </aside>

      <section className="authority-form-shell" aria-labelledby="authority-form-title">
        <div className="section-heading">
          <div>
            <p className="section-number">Authority for this run</p>
            <h2 id="authority-form-title">Check these terms before building the receipt</h2>
          </div>
          <span className={props.validation.ok ? "validity valid" : "validity invalid"}>
            {props.validation.ok ? "Ready" : "Complete required fields"}
          </span>
        </div>

        {props.buildError ? <ErrorSummary error={props.buildError} /> : null}

        <form onSubmit={(event) => { event.preventDefault(); props.onAnalyze(); }} noValidate>
          <div className="form-grid two-column">
            <label>
              <span>Policy ID</span>
              <input
                name="policyId"
                value={props.draft.policyId}
                onChange={(event) => update("policyId", event.target.value)}
                aria-describedby="policy-id-help"
              />
              <small id="policy-id-help">Saved with the receipt so this policy can be identified later.</small>
            </label>
            <label className="wide-field">
              <span>Requested task</span>
              <textarea
                name="task"
                rows={4}
                value={props.draft.task}
                onChange={(event) => update("task", event.target.value)}
                aria-describedby="task-help"
              />
              <small id="task-help">State the assignment and the limits the agent was expected to follow.</small>
            </label>
          </div>

          <fieldset className="form-section">
            <legend>Permitted systems and boundaries</legend>
            <p>List every system the agent was allowed to use and mark its boundary.</p>
            <div className="system-editor">
              {props.draft.permittedSystems.map((system, index) => (
                <div className="system-row" key={`system-${index}`}>
                  <label>
                    <span>System {index + 1}</span>
                    <input
                      name={`system-${index}`}
                      value={system.systemId}
                      onChange={(event) => {
                        const next = props.draft.permittedSystems.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, systemId: event.target.value } : item,
                        );
                        update("permittedSystems", next);
                      }}
                    />
                  </label>
                  <label>
                    <span>Boundary</span>
                    <select
                      name={`boundary-${index}`}
                      value={system.boundary}
                      onChange={(event) => {
                        const boundary = event.target.value as typeof system.boundary;
                        const next = props.draft.permittedSystems.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, boundary } : item,
                        );
                        update("permittedSystems", next);
                      }}
                    >
                      <option value="local">Local</option>
                      <option value="internal">Internal</option>
                      <option value="external">External</option>
                    </select>
                  </label>
                  <button
                    className="remove-button"
                    type="button"
                    disabled={props.draft.permittedSystems.length === 1}
                    title={props.draft.permittedSystems.length === 1 ? "Keep at least one system row while editing." : undefined}
                    onClick={() => update(
                      "permittedSystems",
                      props.draft.permittedSystems.filter((_, itemIndex) => itemIndex !== index),
                    )}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button
              className="inline-button"
              type="button"
              onClick={() => update("permittedSystems", [
                ...props.draft.permittedSystems,
                { systemId: "", boundary: "internal" },
              ])}
            >
              + Add permitted system
            </button>
          </fieldset>

          <OperationFieldset
            legend="Permitted operations"
            description="A completed, unknown-outcome, or state-changing operation outside this list becomes a finding."
            selected={props.draft.permittedOperations}
            onToggle={(operation) => toggleOperation("permittedOperations", operation)}
          />

          <div className="form-grid two-column form-section">
            <label>
              <span>Prohibited data categories</span>
              <textarea
                name="prohibitedDataCategories"
                rows={4}
                value={props.draft.prohibitedDataCategories}
                onChange={(event) => update("prohibitedDataCategories", event.target.value)}
                aria-describedby="category-help"
              />
              <small id="category-help">Enter lowercase slugs separated by commas or new lines, such as customer_email.</small>
            </label>
            <label>
              <span>Maximum records read <em>Optional</em></span>
              <input
                name="maxRecordsRead"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={props.draft.maxRecordsRead}
                onChange={(event) => update("maxRecordsRead", event.target.value)}
                aria-describedby="record-limit-help"
              />
              <small id="record-limit-help">Leave this blank when no limit was declared. Missing event quantities stay unknown.</small>
            </label>
          </div>

          <div className="toggle-row form-section">
            <div>
              <strong>Allow external egress</strong>
              <p>Allow data to move to destinations marked external.</p>
            </div>
            <label className="switch-control">
              <input
                type="checkbox"
                name="externalEgressAllowed"
                checked={props.draft.externalEgressAllowed}
                onChange={(event) => update("externalEgressAllowed", event.target.checked)}
              />
              <span>{props.draft.externalEgressAllowed ? "Permitted" : "Not permitted"}</span>
            </label>
          </div>

          <OperationFieldset
            legend="Operations requiring approval"
            description="For each selected operation, the trace must contain a linked human approval recorded before the action."
            selected={props.draft.approvalRequiredFor}
            onToggle={(operation) => toggleOperation("approvalRequiredFor", operation)}
          />

          {!props.validation.ok ? (
            <div className="validation-note" role="status">
              <strong>Fill in the required authority fields.</strong>
              <ul>
                {props.validation.issues.slice(0, 5).map((issue, index) => (
                  <li key={`${issue.path}-${index}`}><code>{issue.path}</code>: {issue.message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="form-submit-row">
            <p>
              The original bytes are hashed before the trace is mapped and checked against this authority. Generic mappings remain attached to the receipt.
            </p>
            <button
              className="primary-button"
              type="submit"
              disabled={!props.validation.ok || props.analyzing}
              aria-describedby={!props.validation.ok ? "analyze-disabled-reason" : undefined}
            >
              {props.analyzing ? "Building receipt…" : "Build receipt"}
            </button>
          </div>
          {!props.validation.ok ? (
            <p className="sr-only" id="analyze-disabled-reason">Complete the required authority fields first.</p>
          ) : null}
          <p className="analysis-status" aria-live="polite">
            {props.analyzing ? "Hashing the source, mapping events, checking coverage, applying policy rules, and preparing cited copy." : ""}
          </p>
        </form>
      </section>
    </div>
  );
}

function OperationFieldset(props: {
  legend: string;
  description: string;
  selected: CanonicalOperation[];
  onToggle: (operation: CanonicalOperation) => void;
}) {
  return (
    <fieldset className="form-section operation-fieldset">
      <legend>{props.legend}</legend>
      <p>{props.description}</p>
      <div className="operation-grid">
        {ALL_OPERATIONS.map((operation) => (
          <label key={operation}>
            <input
              type="checkbox"
              checked={props.selected.includes(operation)}
              onChange={() => props.onToggle(operation)}
            />
            <span>{operation}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

type OpenEvidence = (
  event: ReactKeyboardEvent<HTMLButtonElement> | React.MouseEvent<HTMLButtonElement>,
  title: string,
  eventIds: string[],
  findingIds?: string[],
  rawPointers?: string[],
) => void;

function ReceiptStep(props: {
  build: SuccessfulBuild;
  source: TraceSource;
  exportStatus: string;
  recoveryExportStatus: string;
  onOpenEvidence: OpenEvidence;
  onDisposition: (disposition: ReviewDisposition) => void;
  onDownload: () => void;
  onDownloadEvidence: () => void;
  onDownloadRecovery: () => void;
}) {
  const { receipt } = props.build;
  const metrics = summarizeReceipt(receipt);
  const humanSummary = buildHumanActionSummary(receipt);
  const incidents = buildManagerIncidentBrief(receipt);
  const recoveryPlan = buildRecoveryPlan(receipt, incidents);
  const graniteBoundary = buildGraniteBoundaryView(receipt);
  const evidenceGap = buildEvidenceGapView(receipt);
  const findingsByEvent = new Map<string, Finding[]>();
  for (const finding of receipt.findings) {
    for (const eventId of finding.eventIds) {
      findingsByEvent.set(eventId, [...(findingsByEvent.get(eventId) ?? []), finding]);
    }
  }

  return (
    <div className="receipt-shell">
      <nav className="receipt-nav" aria-label="Receipt sections">
        <span>In this receipt</span>
        <a href="#overview">Overview</a>
        {evidenceGap ? <a href="#evidence-gaps">Evidence gaps</a> : null}
        <a href="#policy-ledger">Policy checks</a>
        <a href="#brief">Incident brief</a>
        <a href="#recovery">Recovery plan</a>
        <a href="#human-summary">Trace summary</a>
        <a href="#activity">Timeline</a>
        <a href="#movement">Systems and data</a>
        <a href="#deviations">Findings</a>
        <a href="#ai-boundary">AI boundary</a>
        <a href="#integrity">Integrity</a>
        <a href="#disposition">Decision</a>
      </nav>

      <section id="overview" className={`verdict-hero verdict-${receipt.verdict}`} aria-labelledby="verdict-title">
        <div className="verdict-register">
          <p className="section-number">Policy verdict</p>
          <span className="verdict-icon" aria-hidden="true">
            {receipt.verdict === "within_declared_authority" ? "✓" : "!"}
          </span>
          <p>{receipt.run.agent.name ?? receipt.run.agent.id}</p>
          <p>{receipt.run.traceId}</p>
        </div>
        <div className="verdict-copy">
          <p className="source-line">
            <span>{receipt.integrity.generationSource === "granite" ? "Granite explanation" : "Deterministic template"}</span>
            <span>{formatTraceSourceLabel(props.source.kind)}</span>
          </p>
          <h1 id="verdict-title">{receipt.verdictLabel}</h1>
          <p className="verdict-qualifier">{receipt.verdictQualifier}</p>
          <EvidenceClaim
            text={receipt.copy.headline.text}
            label="Open headline evidence"
            eventIds={receipt.copy.headline.eventIds}
            findingIds={receipt.copy.headline.findingIds}
            onOpen={props.onOpenEvidence}
          />
        </div>
        <div className="verdict-attention">
          <span className="attention-count">{receipt.findings.length.toString().padStart(2, "0")}</span>
          <p>{receipt.findings.length === 0 ? "No findings to review" : receipt.findings.length === 1 ? "Finding to review" : "Findings to review"}</p>
          <a href={evidenceGap ? "#evidence-gaps" : "#deviations"}>
            {evidenceGap ? "Review evidence gaps ↓" : "Go to findings ↓"}
          </a>
        </div>
      </section>

      <section className="task-outcome" aria-labelledby="task-outcome-title">
        <div>
          <p className="section-number">Requested task</p>
          <h2 id="task-outcome-title">Task and receipt conclusion</h2>
          <p>{receipt.authority.task}</p>
        </div>
        <div>
          <p className="section-number">Receipt conclusion</p>
          <EvidenceClaim
            text={receipt.copy.outcome.text}
            label="Open outcome evidence"
            eventIds={receipt.copy.outcome.eventIds}
            findingIds={[]}
            onOpen={props.onOpenEvidence}
            compact
          />
        </div>
      </section>

      <section className="metric-ledger" aria-label="Receipt counts">
        {(
          [
            ["Event", "Events", metrics.events],
            ["System", "Systems", metrics.systems],
            ["State change", "State changes", metrics.stateChanges],
            ["External event", "External events", metrics.externalTransfers],
            ["Human approval", "Human approvals", metrics.approvals],
            ["Error", "Errors", metrics.errors],
            ["Finding", "Findings", metrics.findings],
          ] as Array<[string, string, number]>
        ).map(([singular, plural, value]) => (
          <div key={singular}>
            <strong>{value}</strong>
            <span>{formatCountLabel(value, singular, plural)}</span>
          </div>
        ))}
      </section>

      {evidenceGap ? (
        <EvidenceGapPanel view={evidenceGap} onOpen={props.onOpenEvidence} />
      ) : null}

      <PolicyDecisionLedgerPanel
        ledger={props.build.policyLedger}
        onOpen={props.onOpenEvidence}
      />

      <IncidentBriefPanel incidents={incidents} onOpen={props.onOpenEvidence} />

      <RecoveryPlanPanel
        incidents={incidents}
        actions={recoveryPlan}
        exportStatus={props.recoveryExportStatus}
        onOpen={props.onOpenEvidence}
        onDownload={props.onDownloadRecovery}
      />

      <HumanActionSummaryPanel
        summary={humanSummary}
        onOpen={props.onOpenEvidence}
      />

      <section id="activity" className="receipt-section" aria-labelledby="activity-title">
        <SectionTitle number="02" title="Event timeline" detail="Events stay in trace order. Missing values are shown as unknown." id="activity-title" />
        <ol className="timeline">
          {receipt.events.map((event) => (
            <TimelineEvent
              key={event.eventId}
              event={event}
              findings={findingsByEvent.get(event.eventId) ?? []}
              onOpen={props.onOpenEvidence}
            />
          ))}
        </ol>
      </section>

      <section id="movement" className="receipt-section" aria-labelledby="movement-title">
        <SectionTitle number="03" title="Systems and data movement" detail="The table below contains every observed connection" id="movement-title" />
        <SystemMap receipt={receipt} onOpen={props.onOpenEvidence} />
      </section>

      <section id="deviations" className="receipt-section deviations-section" aria-labelledby="deviations-title">
        <SectionTitle number="04" title="Findings and coverage" detail="Policy findings and the trace evidence behind them" id="deviations-title" />
        <div className="deviation-layout">
          <div className="finding-stack">
            {receipt.findings.length === 0 ? (
              <div className="empty-findings"><strong>Policy rules produced no findings.</strong><p>Coverage details are shown alongside this result.</p></div>
            ) : receipt.findings.map((finding) => (
              <FindingCard key={finding.findingId} finding={finding} onOpen={props.onOpenEvidence} />
            ))}
          </div>
          <aside className="coverage-panel">
            <p className="section-number">Evidence coverage</p>
            <strong>{receipt.coverage.accountedRawEvents}/{receipt.coverage.rawEvents}</strong>
            <p>{formatCoverageSummary(receipt.coverage)}</p>
            <dl>
              <div><dt>Mapped</dt><dd>{receipt.coverage.mapped}</dd></div>
              <div><dt>Metadata-only</dt><dd>{receipt.coverage.metadataOnly}</dd></div>
              <div><dt>Unparsed</dt><dd>{receipt.coverage.unparsed}</dd></div>
              <div><dt>Canonical</dt><dd>{receipt.coverage.canonicalEvents}</dd></div>
            </dl>
            {receipt.warnings.length > 0 ? (
              <div className="warning-list"><strong>Parser warnings</strong><ul>{receipt.warnings.map((warning) => <li key={`${warning.pointer}-${warning.message}`}>{warning.pointer}: {warning.message}</li>)}</ul></div>
            ) : (
              <p className="no-warning">No parser warnings.</p>
            )}
          </aside>
        </div>
      </section>

      <section className="receipt-section generated-section" aria-labelledby="generated-title">
        <SectionTitle number="05" title="Evidence-linked receipt notes" detail="Open any note to see its citations" id="generated-title" />
        <div className="generated-copy-grid">
          <div>
            <h3>Finding notes</h3>
            {receipt.copy.notableActions.length === 0 ? <p>No cited finding notes.</p> : (
              <ul>{receipt.copy.notableActions.map((action, index) => (
                <li key={`${action.text}-${index}`}>
                  <EvidenceClaim
                    text={action.text}
                    label={`Open finding note ${index + 1}`}
                    eventIds={action.eventIds}
                    findingIds={action.findingIds}
                    onOpen={props.onOpenEvidence}
                    compact
                  />
                </li>
              ))}</ul>
            )}
          </div>
          <div>
            <h3>Assessment limits</h3>
            {receipt.copy.limitations.length === 0 ? <p>No additional evidence limits.</p> : (
              <ul>{receipt.copy.limitations.map((limitation, index) => (
                <li key={`${limitation.text}-${index}`}>
                  <EvidenceClaim
                    text={limitation.text}
                    label={`Open assessment limit ${index + 1}`}
                    eventIds={limitation.eventIds}
                    findingIds={[]}
                    onOpen={props.onOpenEvidence}
                    compact
                  />
                </li>
              ))}</ul>
            )}
          </div>
        </div>
      </section>

      <GraniteBoundaryPanel view={graniteBoundary} />

      <section id="integrity" className="receipt-section" aria-labelledby="integrity-title">
        <SectionTitle number="07" title="Integrity record" detail="Input hash, schema versions, policy ID, and copy source" id="integrity-title" />
        <IntegrityStrip receipt={receipt} />
      </section>

      <section id="disposition" className="disposition-section" aria-labelledby="disposition-title">
        <div>
          <p className="section-number">Manager decision</p>
          <h2 id="disposition-title">Record your decision.</h2>
          <p>The selected disposition is stored with the receipt. The product verdict and evidence stay as recorded.</p>
        </div>
        <fieldset className="disposition-options">
          <legend className="sr-only">Reviewer disposition</legend>
          {DISPOSITIONS.map((item) => (
            <label key={item.value}>
              <input
                type="radio"
                name="reviewerDisposition"
                value={item.value}
                checked={receipt.reviewerDisposition === item.value}
                onChange={() => props.onDisposition(item.value)}
              />
              <span><strong>{item.label}</strong><small>{item.description}</small></span>
            </label>
          ))}
        </fieldset>
        <div className="export-panel">
          <p>The evidence packet carries a manager brief, validated receipt, and citation-closed recovery plan in one manifest-checked file. It excludes the source trace, credentials, approvals, and execution commands.</p>
          <div className="export-actions">
            <button className="primary-button" type="button" onClick={props.onDownloadEvidence}>Download evidence packet</button>
            <button className="secondary-button" type="button" onClick={props.onDownload}>Receipt only</button>
          </div>
          <p className="export-status" aria-live="polite">{props.exportStatus}</p>
        </div>
      </section>
    </div>
  );
}

const POLICY_DECISION_STATUS_LABELS: Record<PolicyDecisionStatus, string> = {
  deviation_found: "Deviation found",
  no_finding: "No finding",
  unable_to_assess: "Unable to assess",
  not_active: "Not active",
};

function PolicyDecisionLedgerPanel(props: {
  ledger: PolicyDecisionLedger;
  onOpen: OpenEvidence;
}) {
  return (
    <section
      id="policy-ledger"
      className="policy-ledger-section"
      aria-labelledby="policy-ledger-title"
    >
      <div className="policy-ledger-heading">
        <div>
          <p className="section-number">Deterministic rule register</p>
          <h2 id="policy-ledger-title">Every policy check gets an outcome.</h2>
        </div>
        <p>
          Fired and non-fired checks stay visible together. “No finding” means
          no deviation was produced from the supplied facts; missing fields
          remain unknown.
        </p>
      </div>

      <dl className="policy-ledger-counts" aria-label="Policy decision counts">
        <div><dt>Checks recorded</dt><dd>{props.ledger.counts.total}</dd></div>
        <div><dt>Deviation found</dt><dd>{props.ledger.counts.deviations}</dd></div>
        <div><dt>No finding</dt><dd>{props.ledger.counts.noFindings}</dd></div>
        <div><dt>Unable to assess</dt><dd>{props.ledger.counts.unableToAssess}</dd></div>
        <div><dt>Not active</dt><dd>{props.ledger.counts.notActive}</dd></div>
      </dl>

      <ol className="policy-decision-list">
        {props.ledger.entries.map((entry, index) => {
          const hasEvidence =
            entry.eventIds.length > 0 ||
            entry.findingIds.length > 0 ||
            entry.rawPointers.length > 0;
          return (
            <li key={entry.decisionId} className={`policy-decision-${entry.status}`}>
              <article>
                <div className="policy-decision-register">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{POLICY_DECISION_STATUS_LABELS[entry.status]}</strong>
                </div>
                <div className="policy-decision-copy">
                  <p className="section-number">
                    {entry.category} · {entry.ruleIds.join(" + ")}
                  </p>
                  <h3>{entry.title}</h3>
                  <p>{entry.summary}</p>
                </div>
                <dl>
                  <div>
                    <dt>Declared check</dt>
                    <dd>{entry.criterion}</dd>
                  </div>
                  <div>
                    <dt>Authority field</dt>
                    <dd><code>{entry.policyPath ?? "Not authority-scoped"}</code></dd>
                  </div>
                </dl>
                {hasEvidence ? (
                  <button
                    type="button"
                    onClick={(event) => props.onOpen(
                      event,
                      `${entry.title}: ${POLICY_DECISION_STATUS_LABELS[entry.status]}`,
                      entry.eventIds,
                      entry.findingIds,
                      entry.rawPointers,
                    )}
                  >Inspect evaluated evidence ↗</button>
                ) : (
                  <p className="policy-no-evidence">
                    No event evidence is required because this constraint was not active.
                  </p>
                )}
              </article>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function EvidenceGapPanel(props: {
  view: EvidenceGapView;
  onOpen: OpenEvidence;
}) {
  return (
    <section
      id="evidence-gaps"
      className="evidence-gap-section"
      aria-labelledby="evidence-gap-title"
    >
      <div className="evidence-gap-heading">
        <div>
          <p className="section-number">Assessment stopped</p>
          <h2 id="evidence-gap-title">The trace stops the verdict here.</h2>
        </div>
        <p>
          Every submitted record remains in the ledger. Trust-critical evidence is
          missing, so a clean or deviation verdict would overstate what this trace
          can prove.
        </p>
      </div>

      <dl className="evidence-gap-counts" aria-label="Raw-record accounting">
        <div><dt>Accounted</dt><dd>{props.view.accounted}/{props.view.total}</dd></div>
        <div><dt>Mapped</dt><dd>{props.view.mapped}</dd></div>
        <div><dt>Metadata-only</dt><dd>{props.view.metadataOnly}</dd></div>
        <div><dt>Unparsed</dt><dd>{props.view.unparsed}</dd></div>
      </dl>

      <div className="evidence-gap-layout">
        <ol className="gap-list" aria-label="Evidence gaps that stopped assessment">
          {props.view.gaps.map((gap, index) => (
            <li key={gap.findingId}>
              <article>
                <div className="gap-index">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <code>{gap.findingId}</code>
                </div>
                <div>
                  <h3>{gap.label}</h3>
                  <p>{gap.description}</p>
                  <p className="gap-next-step"><strong>Evidence needed</strong>{gap.nextStep}</p>
                </div>
                <button
                  type="button"
                  onClick={(event) => props.onOpen(
                    event,
                    gap.label,
                    gap.eventIds,
                    [gap.findingId],
                    gap.rawPointers,
                  )}
                >Open source evidence ↗</button>
              </article>
            </li>
          ))}
        </ol>

        <aside className="raw-record-ledger" aria-labelledby="raw-record-ledger-title">
          <div className="raw-ledger-heading">
            <p className="section-number">Source ledger</p>
            <h3 id="raw-record-ledger-title">Every raw record</h3>
          </div>
          <ol>
            {props.view.records.map((record, index) => (
              <li key={record.rawPointer} className={`raw-record-${record.status}`}>
                <div className="raw-record-topline">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{record.status.replace("-", " ")}</strong>
                  <span>{record.material ? "material" : "nonmaterial"}</span>
                </div>
                <code>{record.rawPointer}</code>
                <p>
                  {record.canonicalEventIds.length > 0
                    ? `Canonical: ${record.canonicalEventIds.join(", ")}`
                    : record.reason ?? "No canonical event was created."}
                </p>
                <button
                  type="button"
                  onClick={(event) => props.onOpen(
                    event,
                    `Source record ${index + 1}`,
                    record.canonicalEventIds,
                    record.findingIds,
                    [record.rawPointer],
                  )}
                >Inspect retained record ↗</button>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </section>
  );
}

function GraniteBoundaryPanel({ view }: { view: GraniteBoundaryView }) {
  const usedGranite = view.generationSource === "granite";

  return (
    <section
      id="ai-boundary"
      className="receipt-section ai-boundary-section"
      aria-labelledby="ai-boundary-title"
    >
      <SectionTitle
        number="06"
        title="What Granite can see"
        detail="The exact minimized, redacted fact bundle and the deterministic gates around it"
        id="ai-boundary-title"
      />

      <div className="ai-boundary-status">
        <span>{usedGranite ? "Granite used" : "Fallback active"}</span>
        <p>
          {usedGranite
            ? "Granite selected verified finding IDs for this receipt. Deterministic code rendered the cited sentences."
            : "This receipt used the deterministic fallback. The same validated fact bundle is ready for Granite when live mode is available."}
        </p>
      </div>

      <p className="ai-boundary-intro">
        The server route recomputes policy before it creates this projection. Only the bundle
        shown below can reach Granite. The retained trace, raw event bodies, detected credential
        values, raw pointers, and policy comparison values stay out of the model request.
      </p>

      <ol className="ai-boundary-flow" aria-label="Granite control flow">
        <li>
          <span>01</span>
          <strong>Server verifies</strong>
          <p>Validate the request, account for events, and rerun deterministic policy.</p>
        </li>
        <li>
          <span>02</span>
          <strong>Granite selects</strong>
          <p>Choose up to five known finding IDs from the redacted projection.</p>
        </li>
        <li>
          <span>03</span>
          <strong>Code closes claims</strong>
          <p>Reject unknown citations, render fixed text, or use the validated fallback.</p>
        </li>
      </ol>

      <div className="ai-boundary-ledger">
        <dl aria-label="Granite fact bundle counts">
          <div><dt>Reduced events</dt><dd>{view.eventCount}</dd></div>
          <div><dt>Reduced findings</dt><dd>{view.findingCount}</dd></div>
          <div><dt>Allowed event citations</dt><dd>{view.allowedEventCitationCount}</dd></div>
          <div><dt>Allowed finding citations</dt><dd>{view.allowedFindingCitationCount}</dd></div>
          <div><dt>Projection size</dt><dd>{view.payloadBytes.toLocaleString()} bytes</dd></div>
        </dl>
        <div>
          <p className="section-number">Left out before Granite</p>
          <ul>
            <li>Retained source JSON and exact input bytes</li>
            <li>Event input, output, metadata, raw pointers, and source IDs</li>
            <li>Finding policy paths and observed or expected comparison values</li>
            <li>Credentials and values caught by recursive redaction</li>
          </ul>
        </div>
      </div>

      <details className="granite-bundle-preview">
        <summary>Inspect the exact minimized, redacted bundle</summary>
        <p>
          This read-only JSON is reconstructed from the validated receipt with the same bundle
          builder used by the server route.
        </p>
        <pre tabIndex={0}>{view.serializedBundle}</pre>
      </details>
    </section>
  );
}

function EvidenceClaim(props: {
  text: string;
  label: string;
  eventIds: string[];
  findingIds: string[];
  onOpen: OpenEvidence;
  compact?: boolean;
}) {
  return (
    <div className={props.compact ? "evidence-claim compact" : "evidence-claim"}>
      <p>{props.text}</p>
      <button
        type="button"
        aria-label={props.label}
        onClick={(event) => props.onOpen(event, props.text, props.eventIds, props.findingIds)}
      >
        Evidence <span aria-hidden="true">↗</span>
      </button>
    </div>
  );
}

function IncidentBriefPanel(props: {
  incidents: IncidentBrief[];
  onOpen: OpenEvidence;
}) {
  const findingCount = props.incidents.reduce(
    (total, incident) => total + incident.findingCount,
    0,
  );

  return (
    <section id="brief" className="attention-section incident-brief" aria-labelledby="incident-brief-title">
      <div className="section-heading">
        <div>
          <p className="section-number">Manager incident brief</p>
          <h2 id="incident-brief-title">
            {props.incidents.length === 0
              ? "No incidents to triage"
              : `${props.incidents.length} ${props.incidents.length === 1 ? "incident" : "incidents"} behind ${findingCount} ${findingCount === 1 ? "finding" : "findings"}`}
          </h2>
        </div>
        <p>Grouped deterministically by cited events and shared action keys. Every finding remains below.</p>
      </div>
      {props.incidents.length === 0 ? (
        <div className="clean-state">
          <span aria-hidden="true">✓</span>
          <div>
            <strong>No findings in this trace.</strong>
            <p>The recorded events fit the declared authority. Check the evidence you need, then record your decision.</p>
          </div>
        </div>
      ) : (
        <ol className="incident-list">
          {props.incidents.map((incident) => (
            <li key={incident.incidentId}>
              <article className="incident-card">
                <div className="incident-card-heading">
                  <div>
                    <span className={`severity severity-${incident.severity}`}>{incident.severity}</span>
                    <code>{incident.incidentId}</code>
                  </div>
                  <span>{incident.findingCount} {incident.findingCount === 1 ? "finding" : "findings"}</span>
                </div>
                <h3>{incident.title}</h3>
                <p>{incident.summary}</p>
                <dl>
                  <div><dt>Events</dt><dd>{incident.eventIds.join(", ") || "No event citation"}</dd></div>
                  <div><dt>Systems</dt><dd>{incident.systems.length > 0 ? formatPlainList(incident.systems.map(formatIdentifier)) : "Not supplied"}</dd></div>
                  <div><dt>Named data</dt><dd>{incident.dataCategories.length > 0 ? formatPlainList(incident.dataCategories.map(formatIdentifier)) : "Not supplied"}</dd></div>
                </dl>
                <button
                  type="button"
                  onClick={(event) => props.onOpen(
                    event,
                    incident.title,
                    incident.eventIds,
                    incident.findingIds,
                  )}
                >Open incident evidence ↗</button>
              </article>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function RecoveryPlanPanel(props: {
  incidents: IncidentBrief[];
  actions: RecoveryAction[];
  exportStatus: string;
  onOpen: OpenEvidence;
  onDownload: () => void;
}) {
  return (
    <section id="recovery" className="recovery-section" aria-labelledby="recovery-title">
      <div className="recovery-heading">
        <div>
          <p className="section-number">Human-approved recovery plan</p>
          <h2 id="recovery-title">Plan the repair. Keep execution accountable.</h2>
        </div>
        <p>
          These are deterministic, evidence-linked proposals. Agent Receipt has not accessed
          the named systems, executed a fix, or verified recovery.
        </p>
      </div>
      <div className="recovery-export">
        <div>
          <strong>Carry the plan into a controlled response workflow.</strong>
          <p id="recovery-export-note">
            The JSON includes the authority envelope, cited canonical evidence, proposed actions,
            and a SHA-256 binding to the exact validated receipt. It contains no credentials or
            execution command.
          </p>
        </div>
        <button
          type="button"
          aria-describedby="recovery-export-note recovery-export-status"
          onClick={props.onDownload}
        >
          Download recovery plan JSON
        </button>
        <p
          id="recovery-export-status"
          className="recovery-export-status"
          aria-live="polite"
        >
          {props.exportStatus}
        </p>
      </div>
      {props.actions.length === 0 ? (
        <p className="recovery-empty">No corrective actions are proposed because this receipt contains no findings.</p>
      ) : (
        <ol className="recovery-list">
          {props.actions.map((action, index) => {
            const incident = props.incidents.find(
              (candidate) => candidate.incidentId === action.incidentId,
            );
            return (
              <li key={action.actionId}>
                <article>
                  <div className="recovery-action-meta">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <span>Proposed · not executed</span>
                    <code>{action.incidentId}</code>
                  </div>
                  <h3>{action.title}</h3>
                  <p>{action.description}</p>
                  <dl>
                    <div><dt>Authority required</dt><dd>{action.authorityRequired}</dd></div>
                    <div><dt>Reversibility</dt><dd>{action.reversibility}</dd></div>
                  </dl>
                  <button
                    type="button"
                    onClick={(event) => props.onOpen(
                      event,
                      `${action.title}${incident ? ` — ${incident.title}` : ""}`,
                      action.eventIds,
                      action.findingIds,
                    )}
                  >Review supporting evidence ↗</button>
                </article>
              </li>
            );
          })}
        </ol>
      )}
      <p className="recovery-boundary">
        Why planning only: safe remediation needs current system state, authenticated authority,
        platform-specific rollback, and human approval. Automatic changes would exceed this
        post-run review MVP and could destroy evidence or compound the original mistake.
      </p>
    </section>
  );
}

function HumanActionSummaryPanel(props: {
  summary: HumanActionSummary;
  onOpen: OpenEvidence;
}) {
  return (
    <section
      id="human-summary"
      className="receipt-section human-summary-section"
      aria-labelledby="human-summary-title"
    >
      <SectionTitle
        number="01"
        title="What the trace records"
        detail="One sentence for each canonical event"
        id="human-summary-title"
      />
      <div className="human-summary-qualifier">
        <strong>Scope of this summary</strong>
        <p>
          This receipt covers the supplied trace and authority envelope. “No observed activity”
          means that no event in this trace names the item. Activity missing from the trace
          remains unknown.
        </p>
      </div>

      <div className="human-summary-highlights">
        <section aria-labelledby="accessed-title">
          <div className="human-summary-subhead">
            <p className="section-number">Systems in the trace</p>
            <h3 id="accessed-title">Systems and named data</h3>
          </div>
          {props.summary.systems.length === 0 ? (
            <p className="summary-empty">The canonical events do not name a system.</p>
          ) : (
            <ol className="system-summary-list">
              {props.summary.systems.map((system) => (
                <li key={system.systemId}>
                  <div className="system-summary-heading">
                    <code>{system.systemId}</code>
                    <span>{formatPlainList(system.boundaries)} boundary</span>
                  </div>
                  <p>
                    {system.eventIds.length} recorded {system.eventIds.length === 1 ? "event" : "events"}
                    {" · "}{formatSystemRoles(system.roles)}
                    {" · "}{formatPlainList(system.operations)}
                  </p>
                  <p>
                    {system.dataCategories.length > 0
                      ? `Named data: ${formatPlainList(system.dataCategories.map(formatIdentifier))}.`
                      : "Data category: not supplied."}
                  </p>
                  <div className="system-summary-footer">
                    <span>Status: {formatPlainList(system.statuses)}</span>
                    <button
                      type="button"
                      onClick={(event) =>
                        props.onOpen(
                          event,
                          `Activity recorded for ${system.systemId}`,
                          system.eventIds,
                        )
                      }
                    >
                      Evidence ↗
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="no-observed-panel" aria-labelledby="untouched-title">
          <div className="human-summary-subhead">
            <p className="section-number">No observed activity</p>
            <h3 id="untouched-title">Declared items absent from this trace</h3>
          </div>
          <ul>
            {props.summary.noObservedActivity.map((item, index) => (
              <li key={`${item.text}-${index}`}>
                <p>{item.text}</p>
                <button
                  type="button"
                  aria-label={`Open evidence for absence statement ${index + 1}`}
                  onClick={(event) =>
                    props.onOpen(event, item.text, item.eventIds)
                  }
                >
                  Review trace ↗
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="work-summary" aria-labelledby="work-summary-title">
        <div className="work-summary-heading">
          <div>
            <p className="section-number">Trace order</p>
            <h3 id="work-summary-title">Actions and attempts</h3>
          </div>
          <p>
            Each line keeps the event&rsquo;s recorded status, quantity, and data categories.
            Missing values are shown as unknown.
          </p>
        </div>
        <ol>
          {props.summary.actions.map((action) => (
            <li key={action.eventId}>
              <span className="work-sequence">{String(action.sequence).padStart(2, "0")}</span>
              <div>
                <p>{action.text}</p>
                <span className={`status status-${action.status}`}>{action.status}</span>
              </div>
              <button
                type="button"
                onClick={(event) =>
                  props.onOpen(
                    event,
                    `Recorded action ${action.eventId}`,
                    [action.eventId],
                  )
                }
              >
                Canonical + raw ↗
              </button>
            </li>
          ))}
        </ol>
      </section>
    </section>
  );
}

function formatIdentifier(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\bid\b/gi, "ID")
    .replace(/\bkb\b/gi, "KB");
}

function formatPlainList(values: string[]): string {
  if (values.length < 2) return values[0] ?? "unknown";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function formatSystemRoles(roles: Array<"source" | "destination">): string {
  return `${formatPlainList([...roles])} role`;
}

function TimelineEvent(props: {
  event: CanonicalEvent;
  findings: Finding[];
  onOpen: OpenEvidence;
}) {
  const event = props.event;
  return (
    <li className={`timeline-event operation-${event.operation} ${event.stateChange ? "is-state-change" : ""}`}>
      <div className="timeline-index"><span>{String(event.sequence).padStart(2, "0")}</span></div>
      <div className="timeline-main">
        <div className="timeline-topline">
          <span className="operation-label">{event.operation}</span>
          <time dateTime={event.timestamp}>{event.timestamp}</time>
          <span className={`status status-${event.status}`}>{event.status}</span>
        </div>
        <h3>{event.actorId} <span>· {event.actorType}</span></h3>
        <dl className="event-details">
          <div><dt>System path</dt><dd>{formatSystemPath(event)}</dd></div>
          <div><dt>Destination boundary</dt><dd>{event.destinationBoundary}</dd></div>
          <div><dt>Resource</dt><dd>{event.resourceType ?? "unknown"}</dd></div>
          <div><dt>Data categories</dt><dd>{event.dataCategories.length > 0 ? event.dataCategories.join(", ") : "unknown"}</dd></div>
          <div><dt>Quantity</dt><dd>{event.quantity ? `${event.quantity.value} ${event.quantity.unit}` : "unknown"}</dd></div>
          <div><dt>Changed state</dt><dd>{event.stateChange ? "Yes" : "No"}</dd></div>
        </dl>
        {props.findings.length > 0 ? (
          <div className="event-findings" aria-label={`${props.findings.length} linked ${props.findings.length === 1 ? "finding" : "findings"}`}>
            {props.findings.map((finding) => <span key={finding.findingId}>{finding.ruleId}</span>)}
          </div>
        ) : null}
      </div>
      <button
        className="event-evidence-button"
        type="button"
        onClick={(trigger) => props.onOpen(
          trigger,
          `${event.operation} event ${event.eventId}`,
          [event.eventId],
          props.findings.map((finding) => finding.findingId),
        )}
      >Canonical + raw ↗</button>
    </li>
  );
}

function SystemMap(props: { receipt: ReceiptResult; onOpen: OpenEvidence }) {
  const edges = buildSystemEdges(props.receipt.events);
  const systemsByBoundary = groupSystemsByBoundary(
    props.receipt.events,
    props.receipt.authority,
  );

  return (
    <div className="system-map-wrap">
      <p className="map-instruction">
        Destinations are grouped by boundary. On narrow screens, scroll to reach the external and
        unknown columns. The external column has an exclamation point and a red rule.
      </p>
      <div className="system-map" aria-hidden="true">
        <div className="agent-node"><span>Agent</span><strong>{props.receipt.run.agent.name ?? props.receipt.run.agent.id}</strong></div>
        {(["local", "internal", "external", "unknown"] as const).map((boundary) => (
          <div className={`boundary-column boundary-${boundary}`} key={boundary}>
            <h3>{boundary} boundary</h3>
            {systemsByBoundary[boundary].length > 0 ? systemsByBoundary[boundary].map((system) => (
              <span className="system-node" key={system}>{system}</span>
            )) : <span className="empty-boundary">No named system</span>}
          </div>
        ))}
      </div>
      <div className="edge-table-wrap">
        <h3>Recorded system connections</h3>
        <div className="responsive-table" role="region" aria-label="System and data movement records" tabIndex={0}>
          <table>
            <thead><tr><th>Event</th><th>From</th><th>Operation</th><th>To</th><th>Boundary</th><th>Data and quantity</th><th>Evidence</th></tr></thead>
            <tbody>
              {edges.map((edge) => (
                <tr key={edge.eventId}>
                  <td><code>{edge.eventId}</code></td>
                  <td>{edge.from}</td>
                  <td>{edge.operation}</td>
                  <td>{edge.to}</td>
                  <td><span className={`boundary-text boundary-text-${edge.boundary}`}>{edge.boundary}</span></td>
                  <td>{edge.detail}</td>
                  <td><button type="button" onClick={(event) => props.onOpen(event, `System connection for ${edge.eventId}`, [edge.eventId])}>Open ↗</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function FindingCard(props: { finding: Finding; onOpen: OpenEvidence }) {
  const finding = props.finding;
  return (
    <article className="finding-card">
      <div className="finding-meta">
        <span className={`severity severity-${finding.severity}`}>{finding.severity}</span>
        <code>{finding.ruleId}</code>
        <span>{finding.findingId}</span>
      </div>
      <h3>{finding.label}</h3>
      <p>{finding.description}</p>
      <dl>
        <div><dt>Policy field</dt><dd>{finding.policyPath ?? "Not applicable"}</dd></div>
        <div><dt>Event IDs</dt><dd>{finding.eventIds.join(", ") || "No event citation"}</dd></div>
      </dl>
      <button type="button" onClick={(event) => props.onOpen(event, finding.label, finding.eventIds, [finding.findingId])}>
        Inspect canonical + raw ↗
      </button>
    </article>
  );
}

function IntegrityStrip({ receipt }: { receipt: ReceiptResult }) {
  const integrity = receipt.integrity;
  const items: Array<[string, string]> = [
    ["SHA-256", integrity.sha256],
    ["Source bytes", integrity.byteLength.toLocaleString()],
    ["Input format", integrity.inputFormat],
    ["Adapter", `${integrity.adapterName} ${integrity.adapterVersion}`],
    ["Authority schema", integrity.authoritySchemaVersion],
    ["Policy", integrity.policyId],
    ["Canonical schema", integrity.canonicalEventSchemaVersion],
    ["Receipt schema", integrity.receiptSchemaVersion],
    ["Generated at", integrity.generatedAt],
    ["Copy source", integrity.generationSource],
    ...(integrity.generationSource === "granite"
      ? [
          ["Model", integrity.modelId],
          ["Model API", integrity.modelApiVersion],
        ] as Array<[string, string]>
      : []),
  ];
  return (
    <dl className="integrity-grid">
      {items.map(([label, value]) => (
        <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
      ))}
    </dl>
  );
}

function EvidenceDrawer({
  request,
  build,
  sourceKind,
  closeButtonRef,
  onClose,
}: {
  request: EvidenceRequest;
  build: SuccessfulBuild;
  sourceKind: TraceSourceKind;
  closeButtonRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const { receipt } = build;
  const citedFindings = request.findingIds
    .map((findingId) => receipt.findings.find((finding) => finding.findingId === findingId))
    .filter((finding): finding is Finding => Boolean(finding));
  const expandedEventIds = [...new Set([
    ...request.eventIds,
    ...citedFindings.flatMap((finding) => finding.eventIds),
  ])];
  const citedEvents = expandedEventIds
    .map((eventId) => receipt.events.find((event) => event.eventId === eventId))
    .filter((event): event is CanonicalEvent => Boolean(event));
  const canonicalPointers = new Set(
    citedEvents.map((event) => event.rawPointer),
  );
  const rawOnlyRecords = [...new Set(request.rawPointers)]
    .filter((rawPointer) => !canonicalPointers.has(rawPointer))
    .map((rawPointer) => ({
      rawPointer,
      accounting: receipt.accounting.find(
        (entry) => entry.rawPointer === rawPointer,
      ),
      rawObject: resolveRawPointer(
        build.retainedSource.rawDocument,
        rawPointer,
      ),
    }));

  return (
    <div className="drawer-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <aside
        className="evidence-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-title"
      >
        <header>
          <div>
            <p className="section-number">Evidence</p>
            <h2 id="evidence-title">{request.title}</h2>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close evidence drawer">Close</button>
        </header>
        <div className="drawer-source-note">
          <strong>{formatTraceSourceLabel(sourceKind)}</strong>
          <span>The normalized event and retained source object are shown from this browser session.</span>
        </div>
        <div className="drawer-content">
          {citedFindings.length > 0 ? (
            <section aria-labelledby="cited-findings-title">
              <h3 id="cited-findings-title">Cited findings</h3>
              {citedFindings.map((finding) => (
                <article className="drawer-finding" key={finding.findingId}>
                  <strong>{finding.label}</strong>
                  <span>{finding.ruleId} · {finding.severity}</span>
                  <p>{finding.description}</p>
                </article>
              ))}
            </section>
          ) : null}
          {citedEvents.length === 0 && rawOnlyRecords.length === 0 ? <p>This statement does not contain a resolvable event or source-record citation.</p> : citedEvents.map((event) => {
            const rawObject = resolveRawPointer(build.retainedSource.rawDocument, event.rawPointer);
            return (
              <section className="evidence-pair" key={event.eventId} aria-labelledby={`canonical-${event.eventId}`}>
                <div className="evidence-record-heading">
                  <div><span>Canonical event</span><h3 id={`canonical-${event.eventId}`}>{event.eventId}</h3></div>
                  <code>{event.rawPointer}</code>
                </div>
                <pre tabIndex={0}>{JSON.stringify(event, null, 2)}</pre>
                <div className="evidence-record-heading raw-heading">
                  <div><span>Retained source event</span><h3>{event.sourceEventId ?? "Source ID not supplied"}</h3></div>
                  <code>{event.rawPointer}</code>
                </div>
                {rawObject === undefined ? (
                  <p className="raw-missing">The retained pointer did not resolve to a source object.</p>
                ) : (
                  <pre tabIndex={0}>{JSON.stringify(rawObject, null, 2)}</pre>
                )}
              </section>
            );
          })}
          {rawOnlyRecords.map(({ rawPointer, accounting, rawObject }) => (
            <section className="evidence-pair raw-only-pair" key={rawPointer}>
              <div className="evidence-record-heading raw-heading">
                <div>
                  <span>Retained source record</span>
                  <h3>{accounting?.sourceEventId ?? "Source ID not supplied"}</h3>
                </div>
                <code>{rawPointer}</code>
              </div>
              {accounting ? (
                <dl className="raw-accounting-summary">
                  <div><dt>Classification</dt><dd>{accounting.status.replace("-", " ")}</dd></div>
                  <div><dt>Material</dt><dd>{accounting.material ? "Yes" : "No"}</dd></div>
                  <div><dt>Canonical mapping</dt><dd>{accounting.canonicalEventIds.join(", ") || "None"}</dd></div>
                  {accounting.reason ? <div><dt>Recorded reason</dt><dd>{accounting.reason}</dd></div> : null}
                </dl>
              ) : (
                <p className="raw-missing">This pointer is not present in the validated accounting ledger.</p>
              )}
              {rawObject === undefined ? (
                <p className="raw-missing">The retained pointer did not resolve to a source object.</p>
              ) : (
                <pre tabIndex={0}>{JSON.stringify(rawObject, null, 2)}</pre>
              )}
            </section>
          ))}
        </div>
      </aside>
    </div>
  );
}

function SectionTitle(props: { number: string; title: string; detail: string; id: string }) {
  return (
    <div className="receipt-section-title">
      <span>{props.number}</span>
      <div><h2 id={props.id}>{props.title}</h2><p>{props.detail}</p></div>
    </div>
  );
}

function ErrorSummary(props: {
  error: { message: string; issues?: Array<{ path: string; message: string }> };
}) {
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    errorRef.current?.focus();
  }, [props.error.message]);

  return (
    <div ref={errorRef} className="error-summary" role="alert" tabIndex={-1}>
      <strong>{props.error.message}</strong>
      {props.error.issues && props.error.issues.length > 0 ? (
        <ul>{props.error.issues.slice(0, 6).map((issue, index) => (
          <li key={`${issue.path}-${index}`}><code>{issue.path}</code>: {issue.message}</li>
        ))}</ul>
      ) : null}
    </div>
  );
}

function formatSystemPath(event: CanonicalEvent): string {
  if (event.sourceSystem && event.destinationSystem) {
    return `${event.sourceSystem} → ${event.destinationSystem}`;
  }
  if (event.sourceSystem) return `${event.sourceSystem} → ${event.actorId}`;
  if (event.destinationSystem) return `${event.actorId} → ${event.destinationSystem}`;
  return "unknown → unknown";
}
