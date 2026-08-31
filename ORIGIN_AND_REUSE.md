# Origin and reuse disclosure

Counterstep is a new post-run remediation product created for the Google All Things Agentic Hackathon. It uses a disclosed evidence foundation from Agent Receipt rather than presenting that earlier work as new.

## Source foundation

- Repository: https://github.com/mihirduvedi/agent-receipt
- Source commit: `296df0798fd49fa52658c0c813bfabef2dc75d10`
- Source copied on: August 29, 2026
- Source purpose: deterministically reconcile a completed AI-agent trace against a declared authority envelope and produce an evidence-linked receipt.
- License: see `LICENSE`. The source and derivative are owned by Mihir Duvedi.

The Counterstep workspace was created from `git archive` at the exact commit above. Uncommitted files in the source checkout were not copied. The source checkout was not reset, cleaned, stashed, or modified.

## Reused foundation

The initial derivative includes Agent Receipt's committed repository so its original tests and provenance remain inspectable. The following areas are intentionally reused by Counterstep's judged workflow:

| Reused capability | Source area | Counterstep use |
|---|---|---|
| Exact-byte input hashing | `src/core/receipt.ts`, `src/core/integrity.ts` | Bind remediation to the exact original incident receipt. |
| Canonical trace and event accounting | `src/adapters/`, `src/core/schemas/index.ts` | Preserve every original event and stable evidence IDs. |
| Deterministic policy findings | `src/core/policyEngine.ts` | Establish the original overstep without asking Gemini to judge it. |
| Evidence-linked receipt and verifier | `src/core/receipt.ts`, `src/core/verifyReceipt.ts` | Keep the original receipt immutable and cite findings/events from it. |
| Synthetic CRM fixture | `src/fixtures/index.ts` | Seed the disclosed original run that Counterstep remediates. |

The inherited Granite generation path, IBM-specific workflow material, generic trace intake, and full Agent Receipt review interface are not part of Counterstep's judged recovery path. Their presence in the first derivative snapshot preserves provenance; release cleanup may remove unused artifacts while retaining this disclosure and Git history.

## New Counterstep work

The following functionality is new for this submission:

- strict remediation resource, authority, plan, run, event, and closure contracts;
- current-state sandbox and reset workflow;
- Google ADK TypeScript agent using Gemini 3.5 or newer;
- five bounded recovery tools;
- one fail-closed ADK continuation admitted only for a nonterminal run with an
  existing approved active plan, exact remaining approved steps, sufficient
  original tool budget, and no unhandled failed step;
- server-bound ADK run authority with application-derived idempotency keys;
- deterministic plan, authority, version, transition, citation, budget, and idempotency gates;
- bounded stale-version recovery with fresh re-inspection, one replacement plan, and immutable approved-plan history;
- a judge-visible Recovery Test Rack with four PRD-defined synthetic conditions,
  predeclared deterministic result contracts, and an atomic idempotent stale-state
  injection that is disclosed and excluded from remediation write evidence;
- Firestore-backed sandbox/run/event/receipt persistence;
- atomic UTC daily execution admission shared by memory and Firestore;
- credential-free Firestore emulator integration coverage for reset, concurrency,
  idempotency, daily admission, stale recovery, repeated-stale blocking, and irreversible state;
- a fail-closed local production rehearsal that builds the exact container, runs
  the production Firestore adapter against the official emulator, executes live
  Gemini/ADK, restarts the application process, and proves persisted receipt
  continuity without relabeling emulator evidence as managed or deployed;
- an explicitly project-confirmed, write-acknowledged managed Firestore evidence
  harness that retains bounded synthetic records and is excluded from default tests;
- remediation action events and action-receipt evaluation;
- deterministic closure evaluator and closure receipt;
- Counterstep API routes and focused judge interface;
- deterministic six-stage recovery progress, terminal fail-closed summaries,
  runtime provenance, strict browser response validation, and responsive
  accessibility hardening for the focused judge interface;
- Cloud Run deployment configuration, evaluation cases, architecture, and release evidence.

Creating a new repository does not reset the age of reused code. Submission materials must link this file and describe Counterstep as a new remediation layer built on a disclosed Agent Receipt foundation.

## Verification evidence boundary

| Evidence layer | Current status | What it does and does not establish |
|---|---|---|
| Automated local | Passed | Lint, strict TypeScript, 38 files / 444 tests, Next.js production build, secret-cache scrub, and release audit pass after the Vertex AI backend and cost-envelope changes. |
| Firestore emulator | Passed locally | Eight production-repository cases pass, including the Recovery Test Rack's atomic stale-scenario mutation, concurrent idempotency, atomic daily admission, and stale transactions. The first expanded run hit an emulator transaction-lock timeout in the pre-existing concurrent-idempotency case; that case then passed alone and the complete eight-case suite passed on a clean rerun. This does not establish managed Firestore behavior. |
| Local production rehearsal | Prior complete pass retained; fresh reruns failed closed | A prior exact production-container rehearsal passed twice around an application restart and reproduced the first persisted run and closure from the official emulator. Two fresh pre-release attempts built and started the current image but Gemini stopped before inspection; both failed closed with zero writes and emitted no passing manifest. Managed Firestore, Cloud Run, and deployed claims remain `false`. |
| Google ADK / Gemini live | Passed on deployed Vertex AI | Three fresh `gemini-3.5-flash-lite` runs executed through Google ADK on Cloud Run using Vertex workload identity. Each made six bounded tool calls, two authorized writes, 12 accounted events, an in-authority action receipt, and a digest-valid closure. The earlier API-key attempt failed closed with zero writes when prepaid Developer API credits were depleted. |
| Managed Firestore | Passed in Google Cloud | Cloud Build `0a89c790-f5f7-4e16-95c4-b0362b60b7df` ran six retained production-adapter cases against `(default)`: canonical closure, concurrent idempotency, transactional admission, both stale-state outcomes, and delivered-message partial repair. |
| Cloud readiness | Passed | Billing, required APIs including Vertex AI, free-tier Firestore, Artifact Registry, isolated build/runtime identities, and Cloud Run all pass the read-only preflight. Three service-specific $1 spend caps and a project-wide $1 alert budget are configured. |
| Cloud Run / deployed | Passed; public and source-bound | Exact-source build `d97c03af-8861-45aa-aa4c-448c3394a425` deployed release commit `4cd8b3308c9c6216b63999bf89882725cafb22f6` as `counterstep-00004-hp4`, serving 100% at `https://counterstep-27573808078.us-central1.run.app` from image digest `sha256:4f18e727f09489fccb48a06236b0053b99b4bf6d22ac28380f8d12af7c41ad28`. Two strict smoke journeys and one continuous browser journey passed on the immediately preceding equivalent Vertex/Firestore revision; the exact-source replacement then passed its production health contract without another model run. |
| Visual | Passed locally and captured deployed | Ready, loading, repaired, fail-closed, offline, stale replacement-plan, and irreversible partial-repair states have rendered locally. The current local submission candidate's E1 rack and terminal contract were re-rendered at 1440px with no relevant console warning or error. Public Cloud Run ready/repaired states plus Cloud Run, Firestore, and cost-control consoles are saved in `docs/evidence/`. |
| Accessibility | Partially checked locally | The new scenario group has a programmatic legend, pressed state, disabled execution state, 44-pixel-or-larger targets, a polite selected-scenario announcement, and semantic expected-versus-observed terms. A fresh keyboard-only run, responsive matrix, and real screen-reader check remain manual and unclaimed. |
