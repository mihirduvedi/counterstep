# Agent Receipt submission copy

This is paste-ready copy for the IBM SkillsBuild AI Builders Challenge with IBM Bob. Replace the video and team placeholders only after checking the final details in a signed-out browser.

## Project title

Agent Receipt

## One-line pitch

Upload a completed agent JSON log, declare what the agent was allowed to do, and Agent Receipt produces an evidence-linked receipt for deciding whether to accept, investigate, or reject the run.

## Selected theme

Wildcard: Build Intelligent Systems for the Future of Work

## Problem

AI agents can finish useful work while leaving a manager with an accountability gap. A success message rarely answers which systems the agent touched, whether it used restricted data, whether approval was present, or what happened after an uncertain side effect. Teams often have a JSON export, but a raw log still does not reconcile observed actions with the authority a person actually granted.

## Solution

Agent Receipt reviews one completed run from a file the manager uploads or pastes into the live app. Native Trace v1 and the documented OTLP/JSON profile open directly. For another record-oriented JSON structure, the app finds candidate action arrays and asks the reviewer to confirm field paths and observed-value translations. The mapping is previewed and retained with the receipt. It never relies on a model to guess what a vendor-specific field means.

After intake, the same pipeline preserves the exact supplied bytes, accounts for every raw event, converts supported records into canonical actions, and compares those actions with a manager-confirmed authority envelope. Deterministic rules produce the findings and verdict. Every material conclusion opens into retained evidence.

The Policy Decision Ledger shows every deterministic check, including rules that did not fire. Each manager-facing check is labeled deviation found, no finding, unable to assess, or not active and links back to the supplied evidence. “No finding” is limited to explicit supplied facts; it is not a compliance or trace-completeness claim.

When the supplied trace cannot support a complete conclusion, Evidence Gap Mode refuses to guess. It shows the exact missing semantics, keeps every mapped, metadata-only, and unparsed source record visible, and opens raw-only records even when no canonical event exists.

When a run needs attention, the interface groups related findings into incidents and proposes cited recovery steps for human approval. The primary export is Portable Evidence Packet v1: one strict JSON file containing a deterministic manager brief, the validated receipt, and a Recovery Plan v1 artifact bound to the canonical receipt by SHA-256. The recovery plan says that current state is unknown, approval is required, and no action was executed. Standalone receipt and recovery exports remain available.

The portable verifier makes that handoff testable. A manager or judge can import a receipt or evidence packet in the browser. Packet verification runs eight deterministic gates: exact-file digest, size, UTF-8, JSON, strict packet contract, all three manifest entries, the complete embedded-receipt replay, and recovery binding. A valid packet passes; one changed deterministic finding fails. No imported artifact is sent to Granite or a server route.

## AI and technical architecture

IBM Granite has a deliberately narrow runtime role. A server-only route recomputes deterministic findings, minimizes and redacts the facts, then asks Granite to select notable finding IDs. The application accepts only valid IDs and renders deterministic cited sentences. The receipt also exposes the exact read-only model projection, allowed citation IDs, omitted fields, and fallback or Granite provenance. Missing credentials, timeouts, malformed output, or invented citations use the same usable deterministic fallback.

The prototype is built with strict TypeScript, Next.js, React, and Zod. Its deployed intake supports Agent Receipt Native Trace v1, one documented OTLP/JSON GenAI shape, and root or nested arrays from unfamiliar JSON exports through a reviewer-confirmed mapping manifest retained with the receipt. Packet assembly and verification are deterministic. The browser receives no model credentials, Granite cannot change the verdict, and missing evidence stays unknown.

## How IBM Bob was used

IBM Bob was the primary development tool for the trust-critical foundation: the versioned schemas, native adapter, raw-event accounting, deterministic policy engine, first Granite boundary, redaction, claim validation, fallback path, fixtures, and focused tests. Supporting tools performed independent review, later UI and orchestration work, documentation, and verification. The repository's Bob build story and assistance records keep those roles separate.

## Why it matters

Agent Receipt gives people a practical review surface for work completed by AI collaborators using a file they can bring from their own workflow. The bundled examples make the result easy to reproduce; they are not the only logs the app can accept. The product does not claim to watch agents live or certify compliance. It helps the accountable manager make a bounded decision from supplied evidence, then carry cited follow-up work into an approval process without silently granting execution authority.

## Reproducible evidence

- Five declared synthetic cases produce five expected deterministic verdicts.
- All twenty-five raw corpus records are explicitly accounted for; twenty-two become canonical events.
- The overreaching fixture activates all six seeded authority-rule families.
- The five-case Policy Decision Ledger records 45 of 45 check outcomes: six deviations, 31 no findings, one unable to assess, and seven not active.
- Invented generated citations and invalid Granite selections are rejected.
- The AI boundary preview uses the same minimized, redacted bundle builder as the server route and excludes retained raw fields.
- A material unparsed OTLP span plus unknown termination forces `unable_to_assess_fully`; the UI exposes both gaps and all three source-span classifications.
- A vendor-shaped ten-record JSON log maps through the deployed upload path using explicit field paths and value translations. The public app mapped 10 of 10 selected records, retained the manifest, and produced the same qualified clean authority result as its native equivalent; unmapped values remain material-unparsed.
- Recovery Plan v1 closes two incidents and six proposed actions over three events and twelve findings, with an independently checked receipt digest.
- The browser-only Portable Receipt Verifier passes valid exports from all three receipt outcomes and catches byte, format, schema, accounting, policy, and citation failures across twelve focused trust cases.
- Evidence Packet v1 carries three independently digested artifacts. The evaluation passes the manifest, embedded receipt replay, and recovery binding, then detects one altered deterministic finding through both manifest and policy failure.
- `npm run verify` runs lint, strict type checking, the full tests, a production build, and release-safety scans.

The evaluation corpus is synthetic so every expected result is declared and reproducible. The custom-upload workflow is live, but one successful vendor-shaped example does not establish compatibility with every agent exporter. Record-oriented JSON with explicit action semantics can be mapped now; free-form transcripts, JSONL, binary telemetry, mixed multi-run bundles, and logs that omit required meanings need preprocessing or a dedicated adapter. None of these results establish universal policy coverage, production scale, legal compliance, trace completeness, or real-world false-positive rates. Exact deployed evidence is recorded in `docs/RELEASE_QA.md`.

A passing verifier report means the supplied receipt or packet agrees with itself under the current schema and rules. The packet manifest is unsigned. It does not prove trace completeness, exporter identity, original trace bytes, authenticity, tamper-proof provenance, or a digital signature.

## Links

- Live demo: <https://receipt-one-flax.vercel.app>
- Public repository: <https://github.com/mihirduvedi/agent-receipt>
- Public video, no more than three minutes: `[ADD VIDEO URL AFTER SIGNED-OUT PLAYBACK CHECK]`
- Team members: `[CONFIRM REGISTERED ELIGIBLE TEAM LIST]`

## Final form check

- Confirm Wildcard is selected and no teammate has a conflicting prior Wildcard submission.
- Confirm every teammate completed the required IBM SkillsBuild Bob activity.
- Open the repository, live demo, and video links while signed out.
- Confirm the video duration is at or below three minutes.
- Confirm GitHub Actions and Vercel remain successful for the exact current `main` SHA, then reproduce the generic-log, packet-verifier, standalone-receipt, and altered-receipt journeys recorded in `docs/RELEASE_QA.md`.
- Submit before August 31, 2026 at 11:59 PM ET / 8:59 PM PT, unless the live challenge page shows a newer deadline.
