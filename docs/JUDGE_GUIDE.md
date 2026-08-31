# Counterstep judge guide

Counterstep is a post-run recovery agent for a completed AI-agent workflow that exceeded authority. It inspects the current state, uses Gemini through Google ADK to choose a bounded plan, admits only deterministic version-pinned actions, and issues a closure receipt from fresh snapshots.

**Live demo:** <https://counterstep-27573808078.us-central1.run.app>

**Repository:** <https://github.com/mihirduvedi/counterstep>

**Exact release:** `4cd8b3308c9c6216b63999bf89882725cafb22f6` · Cloud Run `counterstep-00004-hp4` · [CI `33362745744`](https://github.com/mihirduvedi/counterstep/actions/runs/33362745744)

## If you have 30 seconds

1. Open the live demo and scan the four contracts in the **Recovery Test Rack**.
2. Choose **E4 Stale-state replan**.
3. Read the injected state and safety claim before running it.
4. Press **Run Counterstep** once. At the terminal state, look for `Contract matched`, the failed `stale_revision` event, two approved plans, two successful writes, 20/20 accounted events, and a digest-bearing closure.

E4 is the most compact proof of the architecture. The repository injects one disclosed external version bump after the initial inspection and candidate plan. The normal version precondition refuses the write. Counterstep then re-inspects both resources, admits one replacement plan, performs the two authorized repairs, and verifies the final state. The injected mutation is excluded from the agent's action receipt and write count.

## If you have 90 seconds

1. Start with **E1 Canonical recovery**. Before execution, note the exact contract: `repaired`, two writes, zero replans, six tool calls, and one approved plan.
2. Run it and watch the six phases: Inspect, Plan, Authorize, Repair, Verify, and Close.
3. Check the two visible resource transitions: spreadsheet `external → revoked` and message `queued → cancelled`, each with a new version.
4. Read the deterministic plan-gate result, 12/12 event accounting, action verdict, final goal statuses, and closure SHA-256.
5. Switch to **E3 Irreversible delivery**. The declared outcome is `partially_repaired`: Counterstep revokes spreadsheet access but does not claim it recalled a message that was already delivered.

The public service has a small daily admission cap. The [demo video](SUBMISSION.md#links), exact evidence record, and credential-free fixture path remain available if prior judging traffic has consumed it.

## What to look for

### Model judgment is bounded

Gemini receives minimized incident facts and inspected sandbox state. It selects from five Google ADK function tools and must cite known event or finding IDs. It cannot supply a different run ID, create its own idempotency key, add authority, overwrite a stale version, or decide the terminal verdict.

### Writes are real within the disclosed sandbox

The demo does not call customer systems. It performs real state transitions through the same memory or Firestore repository contract used by the deployed service. Every successful write records its approved plan and step, before and after versions, state digests, result code, and idempotency key.

### Closure is separate from the scenario score

`Contract matched` is an exact regression result across five declared measurements. The closure receipt is the authoritative incident outcome. This distinction matters in E3, where the scenario correctly matches while closure remains `partially_repaired` and the delivered-message goal stays unsatisfied.

### Failures do not become fake success

Missing Gemini execution produces zero writes. A malformed or uncited plan is rejected. A stale first write forces full re-inspection and one replacement plan. A second stale write blocks. Already-safe state produces zero writes.

## Architecture

The [README diagram](../README.md#architecture) shows the full flow. The trust boundary is:

```text
exact Agent Receipt
  → fresh resource inspection
  → Gemini/Google ADK candidate plan
  → deterministic citation, authority, transition, version, and budget gate
  → version-pinned idempotent tools
  → Firestore event and plan history
  → fresh deterministic closure
```

## Evidence against the judging criteria

| Criterion | Counterstep evidence |
|---|---|
| Innovation and Operational Utility | One start action repairs reversible consequences of a completed agent overstep. E2 proves restraint, E3 stops at an irreversible boundary, and E4 handles stale state without overwriting it. |
| Architectural Discipline and Tech Stack | Gemini 3.5 Flash Lite through Google ADK on Vertex AI; deterministic authority and closure; strict Zod boundaries; transactional Firestore persistence; exact versions and idempotency; fail-closed execution; separate workload identities. |
| Demo and Production Readiness | Public Cloud Run service, managed Firestore evidence, exact-source Cloud Build and CI, a four-case test rack, a README architecture diagram, fixture and emulator reproduction paths, and a release/privacy audit. |

## Reproduce it locally

Requirements: Node.js 24.13 or newer and npm. Java 21 or newer is needed only for the Firestore emulator suite.

```bash
git clone https://github.com/mihirduvedi/counterstep.git
cd counterstep
npm ci
cp .env.example .env.local
npm run dev
```

In `.env.local`, set `COUNTERSTEP_AGENT_MODE` to `fixture` and
`COUNTERSTEP_REPOSITORY` to `memory`; leave credential fields blank. Open
<http://localhost:3000>. The fixture is clearly labeled and makes no live-model
claim.

Run the repository gates with:

```bash
npm run verify
npm run eval
npm run test:firestore
```

## Evidence boundary

- **Automated local candidate:** 38 files / 445 tests, strict TypeScript, ESLint, Next.js standalone build, generated-secret scrub, and release/privacy audit passed.
- **Deterministic evaluation:** five cases passed.
- **Firestore emulator:** eight production-repository cases passed locally. This is not managed-cloud evidence.
- **Managed Firestore:** six retained production-adapter cases passed in Cloud Build.
- **Live Gemini / Google ADK:** three Vertex-backed runs passed with six bounded tool calls, two authorized writes, 12 accounted events, and digest-valid closures.
- **Exact-source deployment:** build `d97c03af-8861-45aa-aa4c-448c3394a425`, revision `counterstep-00004-hp4`, and CI `33362745744` are bound to release commit `4cd8b3308c9c6216b63999bf89882725cafb22f6`. The replacement revision passed its health contract; the three model journeys were recorded on the immediately preceding equivalent runtime revision.
- **Visual/accessibility:** responsive, reduced-motion, forced-colors, semantic, focus, and target-size checks are recorded separately. No claim of accessibility certification is made.
- **Synthetic scope:** no real spreadsheet, email, customer record, or private trace is used.

The complete identifiers, digests, screenshots, and qualifications are in [Google Cloud deployment evidence](GOOGLE_CLOUD_DEPLOYMENT_EVIDENCE_2026-08-31.md), [Recovery Test Rack evidence](RECOVERY_TEST_RACK_2026-08-30.md), and [origin and reuse](../ORIGIN_AND_REUSE.md).

## Product boundary

Counterstep restores known-safe state after a completed run. It is not a live interception system, generic chat agent, universal rollback engine, production incident-response platform, compliance certification, or chain-of-thought recorder. The current P0 is a synthetic two-resource recovery contract built to make authority, state change, restraint, and closure independently inspectable.
