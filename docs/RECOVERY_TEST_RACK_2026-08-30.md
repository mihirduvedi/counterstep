# Recovery Test Rack

Date: August 30, 2026
Status: implemented; final verification evidence is recorded below

## Decision

Counterstep's next major feature is a judge-visible Recovery Test Rack: four selectable synthetic recovery conditions that run through the real service, gate, repository, tool, and closure boundaries. Each condition declares its expected terminal measurements before execution and receives a deterministic expected-versus-observed verdict afterward.

This deliberately stays inside the P0 product boundary. It uses only the two existing authorized resource types, the existing receipt-bound authority, and PRD evaluation cases E1 through E4. It does not add generic rollback, real customer integrations, chat, live interception, or model-authored verdicts.

## Why this feature is high leverage for the hackathon

The official [Taskmaster overview](https://allthingsagentichackathon.devpost.com/?ref_content=featured&ref_feature=challenge&ref_medium=portfolio) asks for a complete workflow that takes action rather than a chatbot. The [official rules](https://allthingsagentichackathon.devpost.com/rules) weight Innovation and Operational Utility at 40%, Architectural Discipline and Tech Stack at 30%, and Demo and Production Readiness at 30%. The organizer's [project-planning guidance](https://allthingsagentichackathon.devpost.com/updates/45652-how-to-plan-your-project) emphasizes specific real friction and action over conversation.

The rack makes three previously test-only strengths undeniable in a short judge flow:

| Judging priority | Recovery Test Rack proof |
|---|---|
| Operational utility | Counterstep acts differently when recovery is needed, already complete, partly irreversible, or stale. |
| Architectural discipline | One UI selection changes strict scenario data, while the same deterministic authority, plan gate, version checks, write transactions, and closure evaluator remain authoritative. |
| Failure tolerance | E4 visibly refuses a stale write, re-inspects both resources, permits one replacement plan, and preserves the original failed attempt. |
| Proof of action | Expected measurements are visible before the run; observed measurements, event ledger, resource versions, and closure receipt are visible afterward. |
| Production readiness | The production Firestore adapter implements the same atomic scenario mutation and is covered by the local official emulator suite. |

The official Devpost organizer also confirms that a clearly disclosed [mock or simulated external service is allowed](https://allthingsagentichackathon.devpost.com/forum_topics/44823-is-using-a-mock-api-instead-of-a-real-3rd-party-integration-allowed). Counterstep therefore labels every scenario as synthetic and never presents local simulation as managed Firestore, Cloud Run, deployed, or live-model evidence.

## Scenario contracts

| ID | Name | Initial or injected condition | Expected outcome | Writes | Replans | Tool calls | Plans |
|---|---|---|---|---:|---:|---:|---:|
| E1 | Canonical recovery | Spreadsheet externally shared; message queued | `repaired` | 2 | 0 | 6 | 1 |
| E2 | Already safe | Spreadsheet revoked; message cancelled | `repaired` | 0 | 0 | 4 | 1 |
| E3 | Irreversible delivery | Spreadsheet externally shared; message delivered | `partially_repaired` | 1 | 0 | 5 | 1 |
| E4 | Stale-state replan | Spreadsheet version advances after initial inspection and plan generation | `repaired` | 2 | 1 | 10 | 2 |

The E4 version bump is a disclosed external-actor simulation. The repository applies it atomically and at most once, records its timestamp on the demo, and does not add it to the remediation event ledger or write count. Counterstep still sees the version changed through the normal atomic write precondition and returns `stale_revision` before any remediation state change.

## Deterministic path

1. `GET /api/demo/scenarios` returns the strict four-case catalog.
2. `POST /api/demo/reset` accepts one strict `scenarioId` and creates exact initial resources.
3. The UI renders the selected setup, safety claim, disclosure, and expected measurements before execution.
4. The agent or deterministic fixture inspects both governed resources and proposes a finite recovery plan.
5. For E4 only, the repository atomically advances the spreadsheet version between initial inspection and first plan admission.
6. The normal plan gate and write transaction remain authoritative.
7. Terminal server code compares outcome, writes, replans, tool calls, and approved plans against the predeclared scenario contract.
8. The UI renders `Contract matched` only when all five fields agree. A discrepancy becomes an explicit mismatch with field-level reasons.

## Trust and evidence boundaries

- Scenario selection changes synthetic input state; it does not change remediation authority.
- Gemini never chooses the expected result and cannot mark a scenario matched.
- Missing or nonterminal observations remain blank rather than inferred.
- The stale injection cannot run for another scenario or an already-mutated demo.
- The scenario mutation is not a Counterstep remediation write and is never counted as one.
- The stale remediation write still requires the exact inspected version and fails before overwrite.
- The replacement plan still requires fresh inspection of every governed resource.
- A second stale failure still blocks under the existing one-replan budget.
- Fixture and emulator evidence do not prove a live Gemini pass, managed Firestore, Cloud Run, or deployment.

## Judge demo sequence

1. Start with E1 and point to the armed `repaired / 2 writes / 0 replans / 6 tool calls / 1 plan` contract.
2. Run it and show the matched result, two changed resource versions, twelve accounted events, and downloadable closure receipt.
3. Select E3 and show that the delivered message begins irreversible. Run it and point to one write, `partially repaired`, and the explicit no-recall limitation.
4. Select E4 and run it. In the ledger, show `stale_revision`, four completed inspections, two approved plans, two authorized writes, and the matched ten-tool-call contract.
5. If time remains, select E2 to show a verified zero-write closure rather than manufactured remediation work.

This sequence demonstrates action, restraint, failure tolerance, and proof in roughly two minutes, leaving time in the four-minute submission video for the architecture diagram, live Gemini/ADK provenance, and Google Cloud evidence.

## Verification record

Automated and rendered evidence must remain separate:

- Full `npm run verify`: passed with lint, strict TypeScript, 439 tests, the Next.js 16.3.3 production build, and the release/privacy audit.
- Official Firestore emulator suite: eight of eight production-repository cases passed on the final clean run. The first expanded run timed out in the pre-existing concurrent-idempotency case because the emulator logged transaction-lock timeouts; that case passed alone, then the complete suite passed.
- Rendered browser checks: E4 stale replacement and E3 irreversible partial-repair paths exercised locally in fixture mode; both displayed `Contract matched` with exact observed values.
- Rendered structure check at 1280 by 720 CSS pixels: no horizontal overflow, one selected scenario, four scenario buttons, no sub-44-pixel button targets, a named fieldset legend, logical heading levels, and a polite selected-scenario/result announcement.
- Responsive/browser accessibility matrix: the existing 360, 768, 1440, zoom, reduced-motion, and forced-color baseline remains recorded for the prior interface. The new rack has responsive CSS, but a fresh rendered multi-width matrix, genuine keyboard-only run, and real screen-reader pass remain manual and unclaimed.
- Live Gemini/ADK: not rerun for this feature.
- Managed Firestore: not run for this feature.
- Cloud Run/deployed: not run for this feature.
