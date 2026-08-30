"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  ActionEvent,
  PublicDemoView,
  PublicRunView,
  SandboxResource,
} from "@/counterstep/schemas";

const TERMINAL = new Set([
  "repaired",
  "partially_repaired",
  "blocked",
  "unable_to_verify",
  "failed",
]);

type ApiErrorPayload = {
  error?: { code?: string; message?: string };
};

async function requestJson<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options?.body ? { "content-type": "application/json" } : {}),
      ...options?.headers,
    },
    cache: "no-store",
  });
  const payload = (await response.json()) as T & ApiErrorPayload;
  if (!response.ok) {
    throw new Error(
      payload.error?.message || `Counterstep request failed (${response.status}).`,
    );
  }
  return payload;
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
  const [resetting, setResetting] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState("");
  const activeRunId = run?.run.runId;
  const activeRunStatus = run?.run.status;

  const resetDemo = useCallback(async () => {
    setResetting(true);
    setError("");
    try {
      const next = await requestJson<PublicDemoView>("/api/demo/reset", {
        method: "POST",
        body: "{}",
      });
      setDemo(next);
      setRun(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The demo could not be reset.",
      );
    } finally {
      setResetting(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await requestJson<PublicDemoView>("/api/demo/reset", {
          method: "POST",
          body: "{}",
        });
        if (!cancelled) setDemo(next);
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "The demo could not be loaded.",
          );
        }
      } finally {
        if (!cancelled) setResetting(false);
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
        const latest = await requestJson<PublicRunView>(
          `/api/remediation-runs/${encodeURIComponent(activeRunId)}`,
        );
        if (!cancelled) setRun(latest);
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "The action ledger could not be refreshed.",
          );
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
      const created = await requestJson<PublicRunView>(
        "/api/remediation-runs",
        {
          method: "POST",
          body: JSON.stringify({
            demoId: demo.demo.demoId,
            sourceReceiptDigest: demo.demo.sourceReceiptDigest,
          }),
        },
      );
      setRun(created);
      const completed = await requestJson<PublicRunView>(
        `/api/remediation-runs/${encodeURIComponent(created.run.runId)}/execute`,
        { method: "POST", body: "{}" },
      );
      setRun(completed);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The recovery run stopped.",
      );
    } finally {
      setExecuting(false);
    }
  }

  const writeEvents = useMemo(
    () => run?.events.filter((event) => event.stateChange) ?? [],
    [run],
  );
  const outcome = run?.closure?.outcome ?? run?.run.status;
  const actionLabel = executing
    ? `Running · ${run?.run.status.replaceAll("_", " ") ?? "starting"}`
    : run && TERMINAL.has(run.run.status)
      ? "Run Counterstep again"
      : "Run Counterstep";

  return (
    <main className="cs-shell">
      <header className="cs-masthead">
        <a className="cs-brand" href="#top" aria-label="Counterstep home">
          <span className="cs-brand-mark" aria-hidden="true">CS</span>
          <span>COUNTERSTEP</span>
        </a>
        <p className="cs-kicker">Evidence-bound remediation for agent runs</p>
        <span className="cs-build">BASE / 0.1</span>
      </header>

      <div id="top" className="cs-hero">
        <section className="cs-hero-copy" aria-labelledby="cs-title">
          <p className="cs-eyebrow">The action happened. Now close the loop.</p>
          <h1 id="cs-title">From agent overstep<br />to verified counterstep.</h1>
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

      <section className="cs-command" aria-label="Recovery controls">
        <div>
          <span className="cs-label">Bounded recovery</span>
          <p>Two resources · two permitted writes · final verification required</p>
        </div>
        <button
          className="cs-primary"
          type="button"
          onClick={() => void runCounterstep()}
          disabled={!demo || executing || resetting}
        >
          <span aria-hidden="true">→</span> {actionLabel}
        </button>
        <button
          className="cs-secondary"
          type="button"
          onClick={() => void resetDemo()}
          disabled={executing || resetting}
        >
          {resetting ? "Resetting sandbox…" : "Reset synthetic demo"}
        </button>
      </section>

      {error ? (
        <div className="cs-error" role="alert">
          <strong>Run notice</strong><span>{error}</span>
        </div>
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

      <section className="cs-section cs-ledger" aria-labelledby="ledger-title">
        <header className="cs-section-head">
          <span className="cs-index">03</span>
          <div><p>Agent action ledger</p><h2 id="ledger-title">Inspect → gate → repair → verify</h2></div>
          <span className={`cs-status cs-status-${outcome ?? "idle"}`} aria-live="polite">
            {(outcome ?? "ready").replaceAll("_", " ")}
          </span>
        </header>
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
