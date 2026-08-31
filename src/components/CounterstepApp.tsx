"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { z, type ZodType } from "zod";

import {
  HealthResponseSchema,
  PublicDemoViewSchema,
  PublicRunViewSchema,
  ScenarioCatalogResponseSchema,
  type HealthResponse,
  type ActionEvent,
  type DemoScenarioId,
  type PublicDemoScenario,
  type PublicDemoView,
  type PublicRunView,
  type SandboxResource,
} from "@/counterstep/schemas";
import {
  COUNTERSTEP_HEADLINE,
  buildRecoveryProgress,
  getRecoveryAnnouncement,
  getTerminalRunNotice,
} from "@/ui/counterstepView";

const TERMINAL = new Set([
  "repaired",
  "partially_repaired",
  "blocked",
  "unable_to_verify",
  "failed",
]);

const ApiErrorPayloadSchema = z
  .object({
    error: z
      .object({
        code: z.string().optional(),
        message: z.string().optional(),
      })
      .strict(),
  })
  .strict();

function errorMessage(cause: unknown, fallback: string): string {
  if (
    cause instanceof TypeError &&
    /fetch|network|load failed/i.test(cause.message)
  ) {
    return `${fallback} Counterstep could not reach the service. The current evidence was left unchanged; try again when the service is available.`;
  }
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

async function requestJson<T>(
  url: string,
  schema: ZodType<T>,
  options?: RequestInit,
  acceptErrorStatus = false,
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options?.body ? { "content-type": "application/json" } : {}),
      ...options?.headers,
    },
    cache: "no-store",
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(
      response.ok
        ? "Counterstep received a response that did not match its JSON boundary."
        : `Counterstep request failed (${response.status}).`,
    );
  }
  if (!response.ok && !acceptErrorStatus) {
    const apiError = ApiErrorPayloadSchema.safeParse(payload);
    throw new Error(
      apiError.success && apiError.data.error.message
        ? apiError.data.error.message
        : `Counterstep request failed (${response.status}).`,
    );
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(
      "Counterstep received a response that did not match its strict client contract.",
    );
  }
  return parsed.data;
}

function shortId(value: string, length = 12): string {
  return value.length <= length ? value : `${value.slice(0, length)}…`;
}

function timeLabel(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function stateLabel(resource: SandboxResource): string {
  return resource.kind === "spreadsheet"
    ? resource.accessState.replaceAll("_", " ")
    : resource.deliveryState;
}

function eventLabel(event: ActionEvent): string {
  const labels: Record<ActionEvent["toolName"], string> = {
    inspect_resource: "Inspect current state",
    submit_recovery_plan: "Gate recovery plan",
    revoke_external_access: "Revoke external access",
    cancel_queued_delivery: "Cancel queued delivery",
    verify_closure: "Verify closure",
    system: "System boundary",
  };
  return labels[event.toolName];
}

export function CounterstepApp() {
  const [demo, setDemo] = useState<PublicDemoView | null>(null);
  const [run, setRun] = useState<PublicRunView | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [scenarios, setScenarios] = useState<PublicDemoScenario[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] =
    useState<DemoScenarioId>("canonical_recovery");
  const [resetting, setResetting] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState("");
  const activeRunId = run?.run.runId;
  const activeRunStatus = run?.run.status;

  const resetDemo = useCallback(async (scenarioId: DemoScenarioId) => {
    setResetting(true);
    setError("");
    try {
      const next = await requestJson(
        "/api/demo/reset",
        PublicDemoViewSchema,
        {
          method: "POST",
          body: JSON.stringify({ scenarioId }),
        },
      );
      setDemo(next);
      setSelectedScenarioId(next.scenario.scenarioId);
      setRun(null);
    } catch (cause) {
      setError(errorMessage(cause, "The demo could not be reset."));
    } finally {
      setResetting(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [demoResult, healthResult, scenarioResult] = await Promise.allSettled([
        requestJson("/api/demo/reset", PublicDemoViewSchema, {
          method: "POST",
          body: JSON.stringify({ scenarioId: "canonical_recovery" }),
        }),
        requestJson("/api/health", HealthResponseSchema, undefined, true),
        requestJson("/api/demo/scenarios", ScenarioCatalogResponseSchema),
      ]);
      if (!cancelled) {
        if (demoResult.status === "fulfilled") {
          setDemo(demoResult.value);
        } else {
          setError(
            errorMessage(demoResult.reason, "The demo could not be loaded."),
          );
        }
        if (healthResult.status === "fulfilled") {
          setHealth(healthResult.value);
        }
        if (scenarioResult.status === "fulfilled") {
          setScenarios(scenarioResult.value.scenarios);
        } else {
          setError((current) =>
            current ||
            errorMessage(
              scenarioResult.reason,
              "The recovery scenarios could not be loaded.",
            ),
          );
        }
        setResetting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!executing || !activeRunId || !activeRunStatus || TERMINAL.has(activeRunStatus)) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const latest = await requestJson(
          `/api/remediation-runs/${encodeURIComponent(activeRunId)}`,
          PublicRunViewSchema,
        );
        if (!cancelled) {
          setRun(latest);
          setError("");
        }
      } catch (cause) {
        if (!cancelled) {
          setError(errorMessage(cause, "The action ledger could not be refreshed."));
        }
      }
    };
    const timer = window.setInterval(() => void poll(), 500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeRunId, activeRunStatus, executing]);

  async function runCounterstep() {
    if (!demo || executing) return;
    setExecuting(true);
    setError("");
    try {
      let runDemo = demo;
      if (run && TERMINAL.has(run.run.status)) {
        runDemo = await requestJson(
          "/api/demo/reset",
          PublicDemoViewSchema,
          {
            method: "POST",
            body: JSON.stringify({ scenarioId: selectedScenarioId }),
          },
        );
        setDemo(runDemo);
        setRun(null);
      }
      const created = await requestJson(
        "/api/remediation-runs",
        PublicRunViewSchema,
        {
          method: "POST",
          body: JSON.stringify({
            demoId: runDemo.demo.demoId,
            sourceReceiptDigest: runDemo.demo.sourceReceiptDigest,
          }),
        },
      );
      setRun(created);
      const completed = await requestJson(
        `/api/remediation-runs/${encodeURIComponent(created.run.runId)}/execute`,
        PublicRunViewSchema,
        { method: "POST", body: "{}" },
      );
      setRun(completed);
    } catch (cause) {
      setError(errorMessage(cause, "The recovery run stopped."));
    } finally {
      setExecuting(false);
    }
  }

  async function selectScenario(scenarioId: DemoScenarioId) {
    if (executing || resetting || scenarioId === selectedScenarioId) return;
    setSelectedScenarioId(scenarioId);
    await resetDemo(scenarioId);
  }

  const writeEvents = useMemo(
    () => run?.events.filter((event) => event.stateChange) ?? [],
    [run],
  );
  const outcome = run?.closure?.outcome ?? run?.run.status;
  const progress = useMemo(
    () =>
      buildRecoveryProgress({
        status: run?.run.status,
        events: run?.events,
        hasClosure: Boolean(run?.closure),
      }),
    [run],
  );
  const announcement = useMemo(
    () =>
      getRecoveryAnnouncement({
        demoReady: Boolean(demo),
        error: error || undefined,
        executing,
        resetting,
        run: run ?? undefined,
      }),
    [demo, error, executing, resetting, run],
  );
  const terminalNotice = useMemo(() => getTerminalRunNotice(run), [run]);
  const selectedScenario =
    scenarios.find((scenario) => scenario.scenarioId === selectedScenarioId) ??
    demo?.scenario;
  const scenarioAssessment = run?.scenarioAssessment;
  const scenarioContract = scenarioAssessment?.expected ?? selectedScenario?.expected;
  const actionLabel = executing
    ? `Running · ${run?.run.status.replaceAll("_", " ") ?? "starting"}`
    : run && TERMINAL.has(run.run.status)
      ? "Rerun fresh scenario"
      : "Run Counterstep";

  return (
    <main id="top" className="cs-shell">
      <p
        className="cs-sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
        {demo ? ` Selected scenario: ${demo.scenario.label}.` : ""}
      </p>
      <header className="cs-masthead">
        <a className="cs-brand" href="#top" aria-label="Counterstep home">
          <span className="cs-brand-mark" aria-hidden="true">CS</span>
          <span>COUNTERSTEP</span>
        </a>
        <p className="cs-kicker">Evidence-bound remediation for agent runs</p>
        <span className="cs-build">BASE / 0.1</span>
      </header>

      <div className="cs-hero">
        <section className="cs-hero-copy" aria-labelledby="cs-title">
          <p className="cs-eyebrow">The action happened. Now close the loop.</p>
          <h1 id="cs-title" aria-label={COUNTERSTEP_HEADLINE}>
            From agent overstep<br />to verified counterstep.
          </h1>
          <p className="cs-dek">
            Counterstep reads the original receipt, inspects what is true now,
            authorizes only cited reversible repairs, and checks the result from
            fresh state.
          </p>
        </section>
        <aside className="cs-incident-stamp" aria-label="Original incident status">
          <span>Original verdict</span>
          <strong>{demo?.incident.verdictLabel ?? "Loading incident…"}</strong>
          <dl>
            <div><dt>Raw events</dt><dd>{demo?.incident.coverage.rawEvents ?? "—"}</dd></div>
            <div><dt>Accounted</dt><dd>{demo?.incident.coverage.accountedRawEvents ?? "—"}</dd></div>
            <div><dt>Findings</dt><dd>{demo?.incident.coverage.findings ?? "—"}</dd></div>
          </dl>
        </aside>
      </div>

      <section className="cs-scenario-rack" aria-labelledby="scenario-rack-title">
        <header>
          <div>
            <p>Recovery test rack</p>
            <h2 id="scenario-rack-title">Prove the boundary, not just the happy path.</h2>
          </div>
          <span>4 deterministic conditions</span>
        </header>
        <fieldset disabled={executing || resetting || scenarios.length === 0}>
          <legend className="cs-sr-only">Choose a synthetic recovery condition</legend>
          {scenarios.map((scenario) => {
            const selected = scenario.scenarioId === selectedScenarioId;
            return (
              <button
                key={scenario.scenarioId}
                type="button"
                className={`cs-scenario-choice ${selected ? "is-selected" : ""}`}
                aria-pressed={selected}
                onClick={() => void selectScenario(scenario.scenarioId)}
              >
                <span>{scenario.code}</span>
                <strong>{scenario.label}</strong>
                <small>
                  {scenario.expected.outcome.replaceAll("_", " ")} · {scenario.expected.writes} {scenario.expected.writes === 1 ? "write" : "writes"}
                </small>
              </button>
            );
          })}
        </fieldset>
      </section>

      <section
        className="cs-command"
        aria-label="Recovery controls"
        aria-busy={executing || resetting}
      >
        <div>
          <span className="cs-label">Bounded recovery</span>
          <p id="cs-recovery-limit">
            Two resources · deterministic authority · fresh-state verification
          </p>
        </div>
        <button
          className="cs-primary"
          type="button"
          onClick={() => void runCounterstep()}
          disabled={!demo || executing || resetting}
          aria-describedby="cs-recovery-limit"
        >
          <span aria-hidden="true">→</span> {actionLabel}
        </button>
        <button
          className="cs-secondary"
          type="button"
          onClick={() => void resetDemo(selectedScenarioId)}
          disabled={executing || resetting}
        >
          {resetting ? "Resetting sandbox…" : "Reset synthetic demo"}
        </button>
      </section>

      {selectedScenario ? (
        <section className="cs-scenario-brief" aria-label="Selected scenario evidence boundary">
          <div>
            <span>Injected state</span>
            <p>{selectedScenario.setup}</p>
          </div>
          <div>
            <span>Safety claim under test</span>
            <p>{selectedScenario.safetyClaim}</p>
          </div>
          <small>{selectedScenario.disclosure}</small>
        </section>
      ) : null}

      {scenarioContract ? (
        <section
          className={`cs-contract cs-contract-${scenarioAssessment?.status ?? "awaiting_terminal"}`}
          aria-labelledby="scenario-contract-title"
        >
          <div className="cs-contract-lead">
            <span>Expected vs observed</span>
            <h2 id="scenario-contract-title">
              {scenarioAssessment?.status === "matched"
                ? "Contract matched"
                : scenarioAssessment?.status === "mismatched"
                  ? "Contract mismatch"
                  : "Contract armed"}
            </h2>
            <p>
              {scenarioAssessment?.status === "mismatched"
                ? scenarioAssessment.mismatches.join(" · ")
                : scenarioAssessment?.status === "matched"
                  ? "The terminal run matched every predeclared scenario measure."
                  : "Observed values remain blank until the run reaches a terminal state."}
            </p>
          </div>
          <dl>
            {([
              ["Outcome", "outcome"],
              ["Writes", "writes"],
              ["Replans", "replans"],
              ["Tool calls", "toolCalls"],
              ["Plans", "approvedPlans"],
            ] as const).map(([label, field]) => (
              <div key={field}>
                <dt>{label}</dt>
                <dd>
                  <span>{String(scenarioContract[field]).replaceAll("_", " ")}</span>
                  <strong>
                    {scenarioAssessment?.observed
                      ? String(scenarioAssessment.observed[field]).replaceAll("_", " ")
                      : "—"}
                  </strong>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {error ? (
        <div className="cs-error" role="alert">
          <strong>Request needs attention</strong>
          <span>{error}</span>
        </div>
      ) : null}

      {terminalNotice && run ? (
        <section
          className={`cs-run-result cs-run-result-${terminalNotice.tone}`}
          aria-labelledby="cs-run-result-title"
        >
          <div>
            <span>{terminalNotice.eyebrow}</span>
            <h2 id="cs-run-result-title">{terminalNotice.title}</h2>
            <p>{terminalNotice.detail}</p>
          </div>
          <dl>
            <div><dt>Writes</dt><dd>{run.run.writeCount} / {run.authority.maxWrites}</dd></div>
            <div><dt>Tool calls</dt><dd>{run.run.toolCallCount} / {run.authority.maxToolCalls}</dd></div>
            <div><dt>Recorded events</dt><dd>{run.events.length}</dd></div>
          </dl>
          <div className="cs-run-result-action">
            <a href={terminalNotice.evidenceHref}>
              {terminalNotice.evidenceLabel} <span aria-hidden="true">↓</span>
            </a>
            {run.run.terminalReasonCode ? (
              <code>{run.run.terminalReasonCode}</code>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="cs-section cs-source" aria-labelledby="source-title">
        <header className="cs-section-head">
          <span className="cs-index">01</span>
          <div><p>Source evidence</p><h2 id="source-title">What crossed the line</h2></div>
          <code title={demo?.demo.sourceReceiptDigest}>
            SHA-256 {demo ? shortId(demo.demo.sourceReceiptDigest, 16) : "—"}
          </code>
        </header>
        <p className="cs-task">{demo?.incident.task ?? "Loading the synthetic source receipt…"}</p>
        <div className="cs-incidents">
          {demo?.incident.incidents.map((incident) => (
            <article key={incident.incidentId} className="cs-incident">
              <span className="cs-incident-id">{incident.incidentId}</span>
              <h3>{incident.title}</h3>
              <p>{incident.summary}</p>
              <div className="cs-citations">
                <span>{incident.findingIds.length} source findings</span>
                <span>{incident.eventIds.join(" · ")}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="cs-section" aria-labelledby="scope-title">
        <header className="cs-section-head">
          <span className="cs-index">02</span>
          <div><p>Current state + authority</p><h2 id="scope-title">The recovery boundary</h2></div>
          <span className="cs-limit">MAX 2 WRITES</span>
        </header>
        <div className="cs-resource-list">
          {demo?.resources.map((resource, index) => {
            const current =
              run?.currentResources.find(
                (candidate) => candidate.resourceId === resource.resourceId,
              ) ?? resource;
            const action = index === 0 ? "revoke_external_access" : "cancel_queued_delivery";
            return (
              <article className="cs-resource" key={resource.resourceId}>
                <div className="cs-resource-meta">
                  <span>{resource.kind.replaceAll("_", " ")}</span>
                  <code>{resource.resourceId}</code>
                </div>
                <div className="cs-state-line">
                  <div><small>Before · v{resource.version}</small><strong>{stateLabel(resource)}</strong></div>
                  <span className="cs-arrow" aria-hidden="true">→</span>
                  <div><small>Permitted action</small><strong>{action.replaceAll("_", " ")}</strong></div>
                  <span className="cs-arrow" aria-hidden="true">→</span>
                  <div className={stateLabel(current) !== stateLabel(resource) ? "is-changed" : ""}>
                    <small>Now · v{current.version}</small><strong>{stateLabel(current)}</strong>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section
        className="cs-section cs-ledger"
        aria-labelledby="ledger-title"
        aria-busy={executing}
      >
        <header className="cs-section-head">
          <span className="cs-index">03</span>
          <div><p>Agent action ledger</p><h2 id="ledger-title">Inspect → gate → repair → verify</h2></div>
          <span className={`cs-status cs-status-${outcome ?? "idle"}`}>
            {(outcome ?? "ready").replaceAll("_", " ")}
          </span>
        </header>
        <ol className="cs-phases" aria-label="Recovery phase progress">
          {progress.map((phase, index) => (
            <li
              key={phase.key}
              className={`cs-phase cs-phase-${phase.state}`}
              aria-current={phase.state === "active" ? "step" : undefined}
            >
              <span className="cs-phase-index" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <strong>{phase.label}</strong>
                <p>{phase.detail}</p>
              </div>
              <small>
                {phase.state === "complete"
                  ? "Complete"
                  : phase.state === "active"
                    ? "In progress"
                    : phase.state === "stopped"
                      ? "Stopped here"
                      : "Not started"}
              </small>
            </li>
          ))}
        </ol>
        <dl className="cs-provenance" aria-label="Runtime provenance">
          <div>
            <dt>Deployment</dt>
            <dd>
              {health
                ? health.deployment === "cloud-run"
                  ? "Cloud Run"
                  : "Local runtime"
                : "Unavailable"}
            </dd>
          </div>
          <div>
            <dt>Persistence</dt>
            <dd>
              {health
                ? `${health.repository === "firestore" ? "Firestore" : "Memory sandbox"} · ${health.repositoryReachable ? "reachable" : "unreachable"}`
                : "Unavailable"}
            </dd>
          </div>
          <div>
            <dt>Orchestration</dt>
            <dd>Google ADK · TypeScript</dd>
          </div>
          <div>
            <dt>Execution path</dt>
            <dd>
              {run
                ? run.run.generationSource === "deterministic_fixture"
                  ? "Deterministic fixture"
                  : run.run.generationSource === "deterministic_no_execution"
                    ? "No model execution"
                    : run.run.modelId ?? "Gemini"
                : health
                  ? health.agentMode === "gemini"
                    ? health.modelId
                    : health.agentMode.replaceAll("_", " ")
                  : "Unavailable"}
            </dd>
          </div>
        </dl>
        {run?.events.length ? (
          <ol className="cs-timeline">
            {run.events.map((event) => (
              <li key={event.eventId} className={`cs-event cs-event-${event.status}`}>
                <span className="cs-node" aria-hidden="true" />
                <div className="cs-event-head">
                  <strong>{eventLabel(event)}</strong>
                  <time dateTime={event.timestamp}>{timeLabel(event.timestamp)}</time>
                </div>
                <p>{event.detail}</p>
                <div className="cs-event-proof">
                  <span>{event.status}</span>
                  <code>#{event.sequence} · {event.resultCode}</code>
                  {event.beforeVersion !== undefined ? (
                    <span>v{event.beforeVersion} → v{event.afterVersion}</span>
                  ) : null}
                  <code title={event.eventId}>{shortId(event.eventId, 18)}</code>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="cs-empty-ledger">
            <span className="cs-empty-line" aria-hidden="true" />
            <div>
              <strong>No recovery claims yet.</strong>
              <p>The ledger fills only when an inspection, gate, action, or verification is recorded.</p>
            </div>
          </div>
        )}
        {run?.planDecision ? (
          <aside className={`cs-gate cs-gate-${run.planDecision.status}`}>
            <div>
              <span>Deterministic plan gate</span>
              <strong>
                {run.planDecision.status}
                {run.approvedPlans.length > 1
                  ? ` · ${run.approvedPlans.length} approved plans`
                  : ""}
              </strong>
            </div>
            {run.planDecision.status === "approved" ? (
              <p>
                {run.planDecision.plan.steps.length} steps · {run.planDecision.approvedStepIds.length} IDs bound · source receipt matched
                {run.approvedPlans.length > 1
                  ? " · one replacement admitted after fresh re-inspection"
                  : " · initial plan"}
              </p>
            ) : (
              <p>{run.planDecision.reasonCodes.join(" · ")}</p>
            )}
          </aside>
        ) : null}
      </section>

      <section className={`cs-closure ${run?.closure ? "has-closure" : ""}`} aria-labelledby="closure-title">
        <div className="cs-closure-title">
          <p>04 / Deterministic closure</p>
          <h2 id="closure-title">
            {run?.closure
              ? run.closure.outcome.replaceAll("_", " ")
              : "Proof waits for fresh state."}
          </h2>
          <p>
            {run?.closure?.qualifier ??
              "Counterstep will not call the incident repaired until every declared goal is re-read and satisfied."}
          </p>
        </div>
        {run?.closure ? (
          <div className="cs-closure-body">
            <div className="cs-goals">
              {run.closure.goalResults.map((result) => (
                <article key={result.goal.goalId}>
                  <span className={`cs-goal-status cs-goal-${result.status}`}>{result.status}</span>
                  <strong>{result.goal.resourceId}</strong>
                  <p>{result.detail}</p>
                </article>
              ))}
            </div>
            <dl className="cs-closure-metrics">
              <div><dt>Authorized writes</dt><dd>{writeEvents.length} / {run.authority.maxWrites}</dd></div>
              <div><dt>Events accounted</dt><dd>{run.closure.remediation.actionReceipt.coverage.accountedEvents} / {run.closure.remediation.actionReceipt.coverage.recordedEvents}</dd></div>
              <div><dt>Action verdict</dt><dd>{run.closure.remediation.actionReceipt.verdict.replaceAll("_", " ")}</dd></div>
            </dl>
            <a
              className="cs-download"
              href={`/api/remediation-runs/${encodeURIComponent(run.run.runId)}/closure-receipt`}
              download
            >
              Download closure receipt <span aria-hidden="true">↓</span>
            </a>
            <code className="cs-digest" title={run.closure.integrity.digest}>
              SHA-256 {run.closure.integrity.digest}
            </code>
          </div>
        ) : (
          <div className="cs-closure-pending" aria-hidden="true">
            <span /> <span /> <span />
          </div>
        )}
      </section>

      <footer className="cs-footer">
        <p><strong>Built on Agent Receipt.</strong> The receipt explains what happened; Counterstep acts on what remains reversible.</p>
        <p>
          {run
            ? run.run.generationSource === "deterministic_fixture"
              ? "deterministic contract fixture · ADK live path not invoked"
              : `${run.run.generationSource.replaceAll("_", " ")} · ${run.run.agentFramework}${run.run.modelId ? ` · ${run.run.modelId}` : ""}`
            : "Synthetic sandbox · strict schemas · deterministic authorization"}
        </p>
      </footer>
    </main>
  );
}
