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
- deterministic plan, authority, version, transition, citation, budget, and idempotency gates;
- bounded stale-version recovery with fresh re-inspection, one replacement plan, and immutable approved-plan history;
- Firestore-backed sandbox/run/event/receipt persistence;
- remediation action events and action-receipt evaluation;
- deterministic closure evaluator and closure receipt;
- Counterstep API routes and focused judge interface;
- Cloud Run deployment configuration, evaluation cases, architecture, and release evidence.

Creating a new repository does not reset the age of reused code. Submission materials must link this file and describe Counterstep as a new remediation layer built on a disclosed Agent Receipt foundation.
