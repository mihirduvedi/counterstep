# Counterstep

Counterstep repairs the part of a completed AI-agent run that is still reversible, then checks whether the declared incident goals are actually closed.

The demo starts with an [Agent Receipt](./ORIGIN_AND_REUSE.md) for a synthetic churn-analysis task. The receipt shows two material oversteps: restricted customer data remains in an externally shared spreadsheet, and a customer email was queued without approval. One click starts a bounded recovery agent. It inspects current state, proposes a source-cited plan, passes that plan through a deterministic gate, applies only the permitted transitions, and produces a closure receipt from fresh snapshots.

This is an action system, not a chat interface. The model can decide which allowed repair is still needed. It cannot grant itself authority or turn its own narration into proof.

**Live demo:** https://counterstep-27573808078.us-central1.run.app

**Submission video:** [watch the 2:57 demo](https://youtu.be/8Bh8_6sFMNc)

**Managed/deployed evidence:** [Google Cloud deployment evidence](./docs/GOOGLE_CLOUD_DEPLOYMENT_EVIDENCE_2026-08-31.md)

**Judge guide:** [A 30-second path, a 90-second path, and exact evidence boundaries](./docs/JUDGE_GUIDE.md)

**Submission kit:** [Devpost copy](./docs/SUBMISSION.md) · [video production record](./docs/DEMO_SCRIPT.md) · [public build article](./docs/BUILD_ARTICLE.md) · [social copy](./docs/SOCIAL_POST.md)

**Documentation map:** [current submission evidence vs. retained Agent Receipt foundation](./docs/README.md)

## Submission video

[![Watch the Counterstep submission video](./docs/media/counterstep-submission-background.png)](https://youtu.be/8Bh8_6sFMNc)

[Watch the 2:57 submission video on YouTube](https://youtu.be/8Bh8_6sFMNc). Signed-out playback, embedding, duration, and English-caption availability were verified on August 31, 2026. A [repository video copy](./docs/media/counterstep-submission-video.mp4) and [English captions](./docs/media/counterstep-submission-video.en.srt) are retained as download fallbacks.

## If you have one minute

1. Open the live demo and read the four predeclared contracts in the **Recovery Test Rack**.
2. Choose **E4 Stale-state replan**. It is the shortest view of Counterstep's main technical claim: a write becomes stale after inspection, the version check refuses it, both governed resources are re-inspected, and one replacement plan is admitted.
3. Press **Run Counterstep** once and leave the page open. The live path uses Gemini 3.5 Flash Lite through Google ADK on Vertex AI and persists the run in Firestore.
4. At the terminal state, check **Contract matched**, the failed `stale_revision` event, two approved plans, two authorized writes, 20/20 accounted events, and the closure digest.

The selected condition and its expected outcome are visible before execution. Counterstep does not grade itself from UI state; server-owned deterministic code computes the five observed measurements and the closure outcome.

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

## Architecture

```mermaid
flowchart LR
    Judge["Judge or AI operations manager"] --> Web["Next.js interface and API\nCloud Run"]
    Receipt["Agent Receipt\nexact trace bytes + deterministic findings"] --> Service["Counterstep service\nrun state + bounded orchestration"]
    Web --> Service
    Service --> Inspect["Fresh resource inspection"]
    Inspect --> ADK["Google ADK for TypeScript\nGemini 3.5 Flash Lite on Vertex AI"]
    ADK --> Candidate["Cited candidate plan"]
    Candidate --> Gate["Deterministic authority gate\nresources + transitions + versions + budgets"]
    Gate -->|"approved only"| Tools["Transactional sandbox tools\nexact version + idempotency key"]
    Gate -->|"rejected"| Refusal["No write / bounded replan"]
    Tools --> Firestore["Firestore\nruns + resources + events + receipts"]
    Refusal --> Firestore
    Firestore --> Verify["Fresh deterministic closure evaluation"]
    Verify --> Web
```

Gemini chooses among a small set of recovery actions. It does not decide what happened, grant authority, bypass a stale version, or declare closure. Those decisions remain deterministic and are persisted with the evidence needed to replay them.

## The hackathon path

Counterstep is shaped around the Google All Things Agentic Hackathon's “Taskmaster” requirement: the primary experience is a visible, autonomous task flow with consequential tool use, not a chatbot wrapper. The live path uses the TypeScript [Agent Development Kit](https://adk.dev/get-started/typescript/) and Gemini function tools. The deployment files target Cloud Run with Firestore persistence.

The selected model is `gemini-3.5-flash-lite`, which supports function calling. The agent receives five tools:

- `inspect_resource`
- `submit_recovery_plan`
- `revoke_external_access`
- `cancel_queued_delivery`
- `verify_closure`

The model must call them in a bounded recovery sequence. Every FunctionTool is server-bound to the active run. Gemini cannot supply a different run ID or an idempotency key; Counterstep derives the key from the approved action envelope. The gate and write transaction remain authoritative even when the model calls a tool with bad arguments.

### Recovery Test Rack

The judge interface includes four selectable, disclosed synthetic conditions that exercise the same two-resource P0 authority boundary:

| Case | Injected current state | Predeclared terminal contract |
|---|---|---|
| E1 Canonical recovery | External spreadsheet, queued message | `repaired`, 2 writes, 0 replans, 6 tool calls, 1 plan |
| E2 Already safe | Revoked spreadsheet, cancelled message | `repaired`, 0 writes, 0 replans, 4 tool calls, 1 plan |
| E3 Irreversible delivery | External spreadsheet, delivered message | `partially_repaired`, 1 write, 0 replans, 5 tool calls, 1 plan |
| E4 Stale-state replan | Reversible start, then an external spreadsheet version bump after inspection | `repaired`, 2 writes, 1 replan, 10 tool calls, 2 plans |

The expected contract is rendered before execution. After a terminal result, server-owned deterministic code compares the observed outcome, write count, replan count, tool-call count, and approved-plan count. The UI reports `Contract matched` only when all five measures agree. The E4 concurrency injection is an atomic, idempotent sandbox mutation, not an agent action; it is disclosed in the interface and excluded from the remediation write count and action receipt. The first stale write is therefore genuinely refused by the same version check used in production, after which Counterstep must re-inspect both governed resources and admit one replacement plan.

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

Execution admission is also deterministic. `POST /api/remediation-runs/:runId/execute` atomically claims the run and one UTC daily slot. The in-memory and Firestore repositories share the same strict counter contract; concurrent requests for one run consume one slot, and an exhausted cap returns `daily_run_limit_exceeded` without starting the agent.

## Run modes

| Mode | When it is used | What it proves |
|---|---|---|
| `gemini` | `COUNTERSTEP_AGENT_MODE=gemini` with either a server-only `GEMINI_API_KEY`, or complete Vertex AI project/location configuration | Live Gemini planning and Google ADK orchestration through the production tool boundary; health reports the selected backend |
| `fixture` | Explicit mode, or the default in local development with no mode set | The same deterministic tool, gate, persistence, and closure contracts with a fixed local planner; it does not count as a live model run |
| `no_execution` | Production has no complete Gemini backend, or explicitly selected | Fail-closed behavior with zero writes and an exact terminal reason |

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

Secrets are server-only. No secret variable is exposed with a `NEXT_PUBLIC_` prefix. A local production build may cause Turbopack to copy a server-only value into its ignored generated cache even though the value is absent from the runnable output. The `npm run build` workflow detects an exact `GEMINI_API_KEY` copy after a successful build and removes the complete generated Turbopack cache, preserving the standalone output and avoiding corrupted partial-cache metadata.

## Persistence

The in-memory repository makes local development fast. The Firestore repository implements the same interface and repeats critical authorization checks inside its write transaction.

Set the following for Cloud Run or a local Firestore emulator:

```dotenv
COUNTERSTEP_REPOSITORY=firestore
GOOGLE_CLOUD_PROJECT=your_project_id
FIRESTORE_DATABASE_ID=(default)
```

Firestore stores demos and sandbox resources under `counterstep_demos`, remediation runs under `counterstep_runs`, and UTC admission counters under `counterstepLimits`. Each run contains its authority, active plan decision, immutable approved plans, inspections, event ledger, idempotency records, and closure receipt. Browser clients have no direct Firestore access; `firestore.rules` denies all client reads and writes.

The production Firestore adapter has a credential-free local integration suite:

```bash
npm run test:firestore
```

This starts the official Firestore emulator for the isolated `demo-counterstep` project, runs the production repository against it, and shuts the emulator down. The `demo-` project boundary prevents accidental access to live resources. The first invocation downloads the pinned emulator binary to Firebase's user cache. It does not require a Firebase login, Google Cloud project, service-account key, or billing account.

The eight-case suite covers complete canonical persistence and closure, isolated reset/repeat, concurrent idempotent execution, concurrent daily admission, the Recovery Test Rack's atomic stale-scenario mutation, one-time injected stale re-inspection/replan with immutable plan history, deterministic second-stale blocking, and delivered-message partial repair. Emulator evidence validates the Firestore transaction contract locally; it is not managed-Firestore or Cloud Run evidence.

### Billing-free local production rehearsal

When managed Firestore and Cloud Run are unavailable, the closest honest local rehearsal is:

```bash
npm run rehearse:local
```

This one command starts the pinned official Firestore emulator with the isolated `demo-counterstep` project, builds the exact production Docker image, and runs that image as the non-root `node` user with a read-only root filesystem, dropped Linux capabilities, no-new-privileges, a bounded `/tmp`, and a loopback-only port. The real production Firestore adapter points only to the emulator. The real server-only Gemini key from permissioned `.env.local` runs one strict Google ADK journey, then the application container is destroyed and recreated while emulator data remains alive. The fresh process must reproduce the first persisted run and closure with deep structural equality before a second strict live journey can pass.

If Gemini ends naturally after an approved plan has begun but before `verify_closure`, Counterstep may issue exactly one bounded continuation in the same ADK session. The continuation contains only deterministic counters, the active approved plan ID, completed step IDs, exact remaining approved step arguments, and the required closure call. It cannot run without an approved active plan, cannot repeat completed steps, cannot exceed the original tool/write/replan authority, and cannot recur a second time. If it stops again, the run fails closed.

Requirements are Docker Desktop, Java 21 or newer, and an unquoted `GEMINI_API_KEY` in a mode-`600` `.env.local`. The script refuses a real Google Cloud project ID, a non-loopback host-side emulator, Cloud Run runtime markers, unsafe secret-file permissions, or a Docker build context that does not exclude `.env*`. The key is passed through a temporary mode-`600` Docker env file, never a command argument, and that file and both generated containers are removed on exit. Firebase owns emulator shutdown.

A successful run writes an ignored, mode-`600` evidence manifest under `output/local-production-rehearsal/`. Its schema requires the managed Firestore, Cloud Run, and deployed claims to remain `false`. This rehearsal never invokes `gcloud`, enables billing, creates a Google Cloud resource, or proves managed/deployed behavior. It does make two live Gemini/ADK journeys, with at most one additional bounded invocation per journey when eligible, so all model usage remains subject to the quota and terms attached to the configured Gemini key.

A separate, opt-in suite can record the corresponding production-adapter evidence against an explicitly confirmed managed default database. It uses Application Default Credentials and performs retained synthetic writes, so choose a new run label every time and run it only after independently confirming the project:

```bash
COUNTERSTEP_MANAGED_FIRESTORE_PROJECT=your_project_id \
COUNTERSTEP_MANAGED_FIRESTORE_CONFIRM_PROJECT=your_project_id \
COUNTERSTEP_MANAGED_FIRESTORE_DATABASE_ID='(default)' \
COUNTERSTEP_MANAGED_FIRESTORE_RUN_LABEL=managed-20260829-a1b2c3 \
COUNTERSTEP_MANAGED_FIRESTORE_WRITE_ACK=I_ACKNOWLEDGE_COUNTERSTEP_MANAGED_FIRESTORE_WRITES \
npm run test:firestore:managed
```

The managed suite refuses missing or mismatched project confirmation, `demo-` projects, emulator fallback, non-default databases, invalid or reused-looking labels, and a missing exact write acknowledgement. It checks that the label has not already created its canonical sentinel before proceeding, never cleans up or overwrites prior evidence, and emits one structured `COUNTERSTEP_MANAGED_FIRESTORE_EVIDENCE` record. Its six cases cover canonical fresh-reader closure, concurrent idempotency, transactional admission on a reserved synthetic date, both stale-state outcomes, and delivered-message partial repair. The harness being present or passing its local guard tests is not managed-Firestore evidence; only a completed explicitly authorized run is.

`cloudbuild.managed-firestore.yaml` runs that same retained-write suite inside Google Cloud with the isolated `counterstep-build` identity, so no downloaded service-account key is required. Supply a unique `_RUN_LABEL`; the config does not read the Gemini secret.

## API

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/demo/scenarios` | List the four strict Recovery Test Rack contracts |
| `POST` | `/api/demo/reset` | Create a new isolated synthetic demo for a selected scenario |
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
npm run rehearse:local
npm run preflight:cloud
npm run security:audit
```

`npm run verify` runs lint, strict TypeScript, the complete inherited and Counterstep test suites, the standalone production build, and the release/privacy audit.

`npm run test:firestore` is separate so the default local suite does not require Java or an emulator download. CI runs both commands.

`npm run preflight:cloud` is read-only and requires an explicit `COUNTERSTEP_GCP_PROJECT`. It checks CLI authentication, project access, billing, required APIs, the default Firestore database, Artifact Registry, a dedicated runtime service account, a pinned Gemini secret version, and any existing Cloud Run service. It never enables an API, creates a resource, reads secret material, builds, or deploys.

The deterministic evaluation set currently covers:

- all four selectable Recovery Test Rack cases against exact expected-versus-observed contracts;
- the canonical two-repair path;
- an already-safe state with zero writes;
- a delivered message that remains explicitly unresolved;
- a disclosed stale-state mutation that triggers full re-inspection and one replacement plan;
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

The live evaluator requires Gemini provenance, a Gemini 3.5+ model, Google ADK, inspected governed resources, an authorized two-write event ledger, cited satisfied closure goals, a matching downloaded receipt, and a valid replayed closure digest.

For a deployed Cloud Run service:

```bash
COUNTERSTEP_BASE_URL=https://your-service-url npm run smoke:cloud
```

The cloud smoke check requires Cloud Run identity, reachable Firestore, configured Gemini mode, a repaired canonical run, two recorded writes, and a downloadable digest-valid closure receipt. It performs two fresh reset/run/closure journeys by default; set `COUNTERSTEP_SMOKE_RUNS` to an integer from 1 through 5 only when a different explicit evidence count is needed.

## Cloud Run

`Dockerfile` builds the Next.js standalone server and copies only the generated standalone and static outputs; this repository currently has no `public/` asset directory. `cloudbuild.yaml` builds and pushes the image with the dedicated `counterstep-build` identity, then deploys it to Cloud Run with the separate `counterstep-runtime` service identity. The runtime uses its short-lived workload identity for both Firestore and Gemini 3.5 Flash Lite on Vertex AI; no API key is injected into the deployed revision. The locked P0 envelope is request-based CPU with startup boost disabled, both service- and revision-level scaling fixed at zero minimum and one maximum instance, concurrency 1, no session affinity, 1 vCPU, 512 MiB, a 60-second request timeout, a 30-second agent timeout, and a 10-run UTC daily cap.

Before the first deployment, explicitly choose a Google Cloud project, enable billing and the required APIs, create the `counterstep` Artifact Registry repository, default Firestore database, and the isolated `counterstep-build` and `counterstep-runtime` service accounts with least-privilege permissions. Check that boundary without mutation:

```bash
COUNTERSTEP_GCP_PROJECT=your-project-id \
npm run preflight:cloud
```

Only after the preflight passes and deployment is freshly authorized, submit `cloudbuild.yaml` from that exact project. The deployed health response must identify `modelBackend` as `vertex-ai`; an API-key-backed local rehearsal is never relabeled as deployed Vertex AI evidence.

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
  scenarios.ts               four synthetic conditions and result oracle
  service.ts                 recovery orchestration and event accounting
src/app/api/                 request-driven server routes
src/components/              recovery-ledger interface
tests/counterstep/           contract and end-to-end tests
tests/evaluation/            deterministic scenario evaluation
scripts/local-production-rehearsal.mjs
                             fail-closed emulator + production-image restart rehearsal
counterstep-planning/        original PRD and continuation context
```

## Provenance and current evidence

The project began from a clean archive of Agent Receipt commit `296df0798fd49fa52658c0c813bfabef2dc75d10`. The original checkout was not modified. [ORIGIN_AND_REUSE.md](./ORIGIN_AND_REUSE.md) lists what was retained and what Counterstep adds.

Confirmed through August 31, 2026:

- strict TypeScript and ESLint pass;
- the current local submission candidate passes 445 automated tests;
- the Next.js standalone production build passes;
- a browser-driven deterministic run records 12 events and two writes;
- both closure goals are satisfied and all 12 events are accounted;
- a deterministic stale-version evaluation re-inspects both resources, admits one replacement plan, preserves both approved plans, and closes `repaired` without a stale overwrite;
- a repeated-stale evaluation blocks after the permitted replan with zero state-changing remediation events;
- eight production-adapter tests pass against the local Firestore emulator, including concurrent idempotency, transactional daily admission, reset/repeat, the Recovery Test Rack's atomic stale mutation, both injected stale outcomes, and delivered-message handling;
- the exact production container passes the local rehearsal against the official Firestore emulator: two live `gemini-3.5-flash-lite` / Google ADK journeys each record six bounded tool calls, two authorized writes, and 12 accounted events, and a fresh second container reproduces the first persisted run and closure exactly after application restart;
- after two later model invocations stopped before closure (one after one write and one after two), the bounded-continuation repair passed a fresh two-journey production rehearsal without weakening the deterministic gate or evidence contract;
- two fresh pre-release rehearsals built and started the current production image but Gemini stopped before inspection; both attempts failed closed with zero writes and no passing manifest, after which the seven-case credential-free production Firestore repository suite passed against the official emulator;
- the opt-in managed Firestore harness passed six retained cases against the real default Firestore database in Cloud Build;
- three live `gemini-3.5-flash-lite` runs through Google ADK pass the strict evidence gate with six bounded tool calls, two authorized writes, 12 accounted events, an in-authority action receipt, and a downloaded digest-valid closure each;
- one additional live attempt failed closed before inspection with zero tool calls and zero writes; a later fresh run passed, and the evaluator now reports such deterministic terminal results before requesting a nonexistent receipt;
- the read-only cloud preflight passes for the confirmed Counterstep project with billing, Vertex AI, Artifact Registry, Cloud Build, Firestore, IAM, Cloud Run, and the isolated service identities ready;
- exact-source Cloud Build `e734fe09-5e29-41cc-a6fd-310ab8f186c3` succeeded from release commit `5890e2b09049564130428f3d6cc4a768b221b180`;
- Cloud Run revision `counterstep-00005-nft` serves 100% of traffic at the public URL from image digest `sha256:766f1d07da7cb4f853638c93659a995926a7a8eadc6eec56ceb67d19efaa42c4`, with min 0 / max 1, request-only CPU, and no deployed Gemini API key;
- GitHub Actions run [`33368011137`](https://github.com/mihirduvedi/counterstep/actions/runs/33368011137) passed on the exact release commit;
- two strict deployed smoke journeys and one continuous browser journey passed on the immediately preceding equivalent Vertex/Firestore revision with Gemini 3.5 Flash Lite through Google ADK; the exact-source replacement revision then passed its public health contract without spending another model run;
- the closure download fires, reset/repeat succeeds, and the browser console is clean;
- browser-driven E3 and E4 runs display exact five-field `Contract matched` verdicts; E4 visibly refuses the stale write before re-inspecting and replanning, while E3 leaves delivered state unresolved;
- the ready, loading, repaired, fail-closed, and offline judge states are explicit;
- the 360px, 768px, and 1440px layouts have no horizontal overflow, and the
  720px 200% zoom equivalent, reduced-motion, and forced-colors checks pass.

Not yet claimed:

- a real screen-reader pass for the deployed build;
- signed-out access to the GitHub repository while it remains private.

The exact managed/deployed IDs, closure digests, cost controls, screenshots, and evidence limits are in [docs/GOOGLE_CLOUD_DEPLOYMENT_EVIDENCE_2026-08-31.md](./docs/GOOGLE_CLOUD_DEPLOYMENT_EVIDENCE_2026-08-31.md). Earlier local evidence remains in [docs/LIVE_GEMINI_EVIDENCE_2026-08-29.md](./docs/LIVE_GEMINI_EVIDENCE_2026-08-29.md), [docs/LOCAL_PRODUCTION_REHEARSAL_EVIDENCE_2026-08-29.md](./docs/LOCAL_PRODUCTION_REHEARSAL_EVIDENCE_2026-08-29.md), [docs/RECOVERY_TEST_RACK_2026-08-30.md](./docs/RECOVERY_TEST_RACK_2026-08-30.md), and [docs/COUNTERSTEP_UI_QA_2026-08-30.md](./docs/COUNTERSTEP_UI_QA_2026-08-30.md).
