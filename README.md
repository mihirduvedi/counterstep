# Counterstep

Counterstep repairs the part of a completed AI-agent run that is still reversible, then checks whether the declared incident goals are actually closed.

The demo starts with an [Agent Receipt](./ORIGIN_AND_REUSE.md) for a synthetic churn-analysis task. The receipt shows two material oversteps: restricted customer data remains in an externally shared spreadsheet, and a customer email was queued without approval. One click starts a bounded recovery agent. It inspects current state, proposes a source-cited plan, passes that plan through a deterministic gate, applies only the permitted transitions, and produces a closure receipt from fresh snapshots.

This is an action system, not a chat interface. The model can decide which allowed repair is still needed. It cannot grant itself authority or turn its own narration into proof.

## Why this exists

Agent observability usually stops at “what happened?” That matters, but a production operator still has to answer the next question: what can be safely undone now?

Counterstep separates those jobs:

1. Agent Receipt reconstructs and evaluates the original trace.
2. Counterstep binds a short-lived remediation authority to that exact receipt digest.
3. A Google ADK agent inspects current state and proposes the recovery plan.
4. Deterministic code approves or rejects every plan step.
5. Transactional tools apply exact, idempotent state transitions.
6. Fresh reads decide whether each closure goal is satisfied.

The final artifact is deliberately qualified. It says what was checked, which events support the result, what remained unresolved, and which synthetic boundaries apply.

## The hackathon path

Counterstep is shaped around the Google All Things AI Agentic “Taskmaster” requirement: the primary experience is a visible, autonomous task flow with consequential tool use, not a chatbot wrapper. The live path uses the TypeScript [Agent Development Kit](https://adk.dev/get-started/typescript/) and Gemini function tools. The deployment files target Cloud Run with Firestore persistence.

The selected model is `gemini-3.5-flash-lite`, which supports function calling. The agent receives five tools:

- `inspect_resource`
- `submit_recovery_plan`
- `revoke_external_access`
- `cancel_queued_delivery`
- `verify_closure`

The model must call them in a bounded recovery sequence. The gate and write transaction remain authoritative even when the model calls a tool with bad arguments.

## Trust contract

Counterstep will not:

- execute a write that is missing from the active approved plan;
- use a resource or transition outside the receipt-bound remediation authority;
- overwrite a resource whose version changed after inspection;
- retry a stale write without fresh inspection and a newly gated plan;
- apply the same successful action twice;
- describe a delivered message as recalled;
- claim repair without fresh final snapshots;
- silently replace a missing Gemini run with simulated model output in production.

Every state-changing event records the before and after versions, SHA-256 digests, plan and step IDs, result code, and idempotency-bound action key. If a resource becomes stale, Counterstep re-inspects every governed resource, admits at most one replacement plan, and blocks a second stale write. The closure receipt preserves the full approved-plan history so every successful write is checked against the exact plan that authorized it, then accounts for every remediation event.

## Run modes

| Mode | When it is used | What it proves |
|---|---|---|
| `gemini` | `COUNTERSTEP_AGENT_MODE=gemini` and `GEMINI_API_KEY` is present | Live Gemini planning and Google ADK orchestration through the production tool boundary |
| `fixture` | Explicit mode, or the default in local development with no mode set | The same deterministic tool, gate, persistence, and closure contracts with a fixed local planner; it does not count as a live model run |
| `no_execution` | Production has no Gemini key, or explicitly selected | Fail-closed behavior with zero writes and an exact terminal reason |

The interface labels fixture runs as `deterministic contract fixture · ADK live path not invoked` so screenshots cannot be mistaken for live Gemini evidence.

## Quick start

Requirements:

- Node.js 24.13 or newer
- npm
- Java 21 or newer only for the local Firestore emulator suite

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`. With no environment file, development uses the deterministic fixture path. Press **Run Counterstep** to exercise the full local contract.

For the live agent path, copy `.env.example` to `.env.local`, add a Gemini key, and keep:

```dotenv
COUNTERSTEP_AGENT_MODE=gemini
COUNTERSTEP_REPOSITORY=memory
COUNTERSTEP_GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_API_KEY=your_key_here
```

Secrets are server-only. No secret variable is exposed with a `NEXT_PUBLIC_` prefix.

## Persistence

The in-memory repository makes local development fast. The Firestore repository implements the same interface and repeats critical authorization checks inside its write transaction.

Set the following for Cloud Run or a local Firestore emulator:

```dotenv
COUNTERSTEP_REPOSITORY=firestore
GOOGLE_CLOUD_PROJECT=your_project_id
FIRESTORE_DATABASE_ID=(default)
```

Firestore stores demos and sandbox resources under `counterstep_demos`, and remediation runs under `counterstep_runs`. Each run contains its authority, active plan decision, immutable approved plans, inspections, event ledger, idempotency records, and closure receipt. Browser clients have no direct Firestore access; `firestore.rules` denies all client reads and writes.

The production Firestore adapter has a credential-free local integration suite:

```bash
npm run test:firestore
```

This starts the official Firestore emulator for the isolated `demo-counterstep` project, runs the production repository against it, and shuts the emulator down. The `demo-` project boundary prevents accidental access to live resources. The first invocation downloads the pinned emulator binary to Firebase's user cache. It does not require a Firebase login, Google Cloud project, service-account key, or billing account.

The suite covers complete canonical persistence and closure, isolated reset/repeat, concurrent idempotent execution, one-time stale re-inspection/replan with immutable plan history, deterministic second-stale blocking, and delivered-message partial repair. Emulator evidence validates the Firestore transaction contract locally; it is not managed-Firestore or Cloud Run evidence.

## API

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/demo/reset` | Create a new isolated synthetic demo |
| `GET` | `/api/demo/:demoId` | Read the incident and current sandbox resources |
| `POST` | `/api/remediation-runs` | Create a receipt-bound run and authority |
| `POST` | `/api/remediation-runs/:runId/execute` | Start the configured autonomous execution path |
| `GET` | `/api/remediation-runs/:runId` | Poll persisted phases, events, resources, and closure |
| `GET` | `/api/remediation-runs/:runId/closure-receipt` | Download strict closure JSON |
| `GET` | `/api/health` | Report deployment, repository, agent mode, model, and readiness |

Mutation endpoints accept strict `application/json` bodies with a 24 KB limit. Unknown fields are rejected. Error responses use stable codes and do not echo secrets or stack traces.

## Verification

```bash
npm run verify
npm run eval
npm run test:firestore
npm run security:audit
```

`npm run verify` runs lint, strict TypeScript, the complete inherited and Counterstep test suites, the standalone production build, and the release/privacy audit.

`npm run test:firestore` is separate so the default local suite does not require Java or an emulator download. CI runs both commands.

The deterministic evaluation set currently covers:

- the canonical two-repair path;
- an already-safe state with zero writes;
- a delivered message that remains explicitly unresolved;
- a stale write that triggers full re-inspection and one replacement plan;
- a second stale write that blocks with zero unsafe overwrites;
- exact action-receipt binding across original and replacement plans;
- plan-schema and citation rejection;
- idempotent replay and write-count preservation;
- fail-closed behavior when Gemini is unavailable;
- closure digest verification.

For a running server configured with live Gemini:

```bash
npm run eval:live
```

For a deployed Cloud Run service:

```bash
COUNTERSTEP_BASE_URL=https://your-service-url npm run smoke:cloud
```

The cloud smoke check requires Cloud Run identity, reachable Firestore, configured Gemini mode, a repaired canonical run, two recorded writes, and a downloadable closure receipt.

## Cloud Run

`Dockerfile` builds the Next.js standalone server. `cloudbuild.yaml` builds and pushes the image, deploys it to Cloud Run, selects Firestore and Gemini mode, and reads `GEMINI_API_KEY` from Secret Manager.

Before the first deployment, create the Artifact Registry repository, Firestore database, service account permissions, and Secret Manager entry named `counterstep-gemini-api-key`. Then submit the build from an explicitly chosen Google Cloud project.

No deployment is claimed in this repository until `npm run smoke:cloud` passes against the public URL.

## Repository map

```text
src/counterstep/
  adkAgent.ts                Google ADK agent and five FunctionTools
  closure.ts                 action and closure receipt construction
  firestoreRepository.ts    transactional Cloud persistence
  gate.ts                    deterministic plan authorization
  incident.ts                Agent Receipt source and incident grouping
  memoryRepository.ts       local persistence and atomic tool contract
  schemas.ts                 strict versioned Zod contracts
  service.ts                 recovery orchestration and event accounting
src/app/api/                 request-driven server routes
src/components/              recovery-ledger interface
tests/counterstep/           contract and end-to-end tests
tests/evaluation/            deterministic scenario evaluation
counterstep-planning/        original PRD and continuation context
```

## Provenance and current evidence

The project began from a clean archive of Agent Receipt commit `296df0798fd49fa52658c0c813bfabef2dc75d10`. The original checkout was not modified. [ORIGIN_AND_REUSE.md](./ORIGIN_AND_REUSE.md) lists what was retained and what Counterstep adds.

Confirmed locally on August 29, 2026:

- strict TypeScript and ESLint pass;
- 382 automated tests pass;
- the Next.js standalone production build passes;
- a browser-driven deterministic run records 12 events and two writes;
- both closure goals are satisfied and all 12 events are accounted;
- a deterministic stale-version evaluation re-inspects both resources, admits one replacement plan, preserves both approved plans, and closes `repaired` without a stale overwrite;
- a repeated-stale evaluation blocks after the permitted replan with zero state-changing remediation events;
- six production-adapter tests pass against the local Firestore emulator, including concurrent idempotency, reset/repeat, both stale outcomes, and delivered-message handling;
- the closure download fires, reset/repeat succeeds, and the browser console is clean;
- the 360px, 768px, and 1440px layouts have no horizontal overflow.

Not yet claimed:

- a live Gemini evaluation;
- a managed Firestore transaction run;
- a deployed Cloud Run URL;
- Cloud Run smoke results.

Those require credentials or external deployment state and should be recorded only after they are executed.
