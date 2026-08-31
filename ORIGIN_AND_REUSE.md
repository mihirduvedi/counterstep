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

## Submission video production reuse

The Counterstep submission video also reuses a disclosed editorial production
system from the approved Agent Receipt v6 video. Reused production elements are
limited to the Georgia/Arial paper-box visual grammar, the user-supplied
crumpled-paper texture, the Emma Multilingual narrator identity and delivery
profiles, the low-center black caption treatment, and the physical-paper
transition vocabulary. The Agent Receipt v6 reference master has SHA-256
`d0925060ff95d0b7ed1c6acf13d2044e91ee2d00bffc7dfaaa86d79e04b6b080`.

All Counterstep narration, scene design, diagrams, product recordings, public
Cloud Run execution footage, Firestore/health proof, recovery claims, and final
composition are new for this submission. The video uses no third-party stock
footage, music, ambience, or sound effects. The live E1 interval is retained at
1x speed with no temporal cuts; local E3/E4 clips are visibly labeled as
deterministic fixture rehearsals rather than live Gemini evidence.

## Verification evidence boundary

| Evidence layer | Current status | What it does and does not establish |
|---|---|---|
| Automated local | Passed | Lint, strict TypeScript, 38 files / 445 tests, Next.js production build, secret-cache scrub, and release audit pass on the deployed source candidate. |
| Firestore emulator | Passed locally | Eight production-repository cases pass, including the Recovery Test Rack's atomic stale-scenario mutation, concurrent idempotency, atomic daily admission, and stale transactions. The first expanded run hit an emulator transaction-lock timeout in the pre-existing concurrent-idempotency case; that case then passed alone and the complete eight-case suite passed on a clean rerun. This does not establish managed Firestore behavior. |
| Local production rehearsal | Prior complete pass retained; fresh reruns failed closed | A prior exact production-container rehearsal passed twice around an application restart and reproduced the first persisted run and closure from the official emulator. Two fresh pre-release attempts built and started the current image but Gemini stopped before inspection; both failed closed with zero writes and emitted no passing manifest. Managed Firestore, Cloud Run, and deployed claims remain `false`. |
| Google ADK / Gemini live | Passed on deployed Vertex AI | Three fresh `gemini-3.5-flash-lite` runs executed through Google ADK on Cloud Run using Vertex workload identity. Each made six bounded tool calls, two authorized writes, 12 accounted events, an in-authority action receipt, and a digest-valid closure. The earlier API-key attempt failed closed with zero writes when prepaid Developer API credits were depleted. |
| Managed Firestore | Passed in Google Cloud | Cloud Build `0a89c790-f5f7-4e16-95c4-b0362b60b7df` ran six retained production-adapter cases against `(default)`: canonical closure, concurrent idempotency, transactional admission, both stale-state outcomes, and delivered-message partial repair. |
| Cloud readiness | Passed | Billing, required APIs including Vertex AI, free-tier Firestore, Artifact Registry, isolated build/runtime identities, and Cloud Run all pass the read-only preflight. Three service-specific $1 spend caps and a project-wide $1 alert budget are configured. |
| Cloud Run / deployed | Passed; public and source-bound | Exact-source build `e734fe09-5e29-41cc-a6fd-310ab8f186c3` deployed source commit `5890e2b09049564130428f3d6cc4a768b221b180` as `counterstep-00005-nft`, serving 100% at `https://counterstep-27573808078.us-central1.run.app` from image digest `sha256:766f1d07da7cb4f853638c93659a995926a7a8eadc6eec56ceb67d19efaa42c4`. GitHub Actions run `33368011137` passed on that SHA. Three strict live journeys remain recorded on an earlier Vertex/Firestore revision; the exact-source replacement passed its production health contract without another model run. |
| Visual | Passed locally and captured deployed | Ready, loading, repaired, fail-closed, offline, stale replacement-plan, and irreversible partial-repair states have rendered locally. The current local submission candidate's E1 rack and terminal contract were re-rendered at 1440px with no relevant console warning or error. Public Cloud Run ready/repaired states plus Cloud Run, Firestore, and cost-control consoles are saved in `docs/evidence/`. |
| Accessibility | Partially checked locally | The new scenario group has a programmatic legend, pressed state, disabled execution state, 44-pixel-or-larger targets, a polite selected-scenario announcement, and semantic expected-versus-observed terms. A fresh keyboard-only run, responsive matrix, and real screen-reader check remain manual and unclaimed. |
| Submission video | Complete and public on YouTube | The 177.195-second H.264/AAC master includes one continuous public E1 execution at 1x speed. Click-to-terminal time was 13.358 seconds. The raw public clip SHA-256 is `61d6a3de1c32e890e0c12aa8e0d3ffdae716867d61a8c032e646004e64a9898f`; the final master SHA-256 is `942b363777980cb2e4b2e1f8f104872aef0b318d9e620a76be40e865484eba40`. Fixture clips are labeled, the public health response is shown separately from the Firestore console, and deterministic decode/black/silence checks passed. The public YouTube page passed signed-out playback and embedding checks, reports a 177-second duration, and exposes English captions. The 720p repository fallback has SHA-256 `89123d7d1b18b472ca8d0e75444f3d082378ff1b3356df8e5f59af81bbdb0e18`; the English SRT has SHA-256 `ec39144479d05f11274d20432f8e04365c5645a2ad45d7de342212c937198fe7`. |
