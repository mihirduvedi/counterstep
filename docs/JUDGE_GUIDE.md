# Judge guide

Agent Receipt is a working post-run reviewer for agent logs. An AI operations manager can upload or paste a completed JSON export, map an unfamiliar record structure in the browser, declare what the agent was allowed to do, and produce a deterministic, evidence-linked receipt.

**Live demo:** <https://receipt-one-flax.vercel.app>

**Public repository:** <https://github.com/mihirduvedi/agent-receipt>

**Current deployed product:** Generic JSON Adapter release `8fdf2adae455c09073a847f66959d13fb73779ec` passed [GitHub Actions run `33239296527`](https://github.com/mihirduvedi/agent-receipt/actions/runs/33239296527), Vercel's exact-commit deployment check, and a public ten-record custom-log walkthrough on August 29, 2026. Full evidence is recorded in `docs/RELEASE_QA.md`.

## Use a log from your own agent

The three bundled runs are quick, repeatable demonstrations. They are not the product's input boundary. In the deployed app, choose **Upload JSON** or **Paste JSON** to review a file produced by another agent or workflow.

For a record-oriented JSON file, Agent Receipt finds candidate arrays up to four object levels deep. The reviewer selects the action array, confirms JSON Pointer paths, and translates the exporter's operation, outcome, actor, state-change, and optional policy fields into the receipt vocabulary. The screen previews how many records will map and how many will remain material-unparsed before authority review begins. The confirmed mapping manifest stays with the receipt, and Granite is never used to interpret the source log.

This works live for root arrays and nested action-record arrays with explicit semantic fields. It is intentionally not a universal transcript parser. JSONL, binary telemetry, mixed multi-run bundles, free-form conversations, and logs that omit required meanings need preprocessing or a dedicated adapter. Missing facts remain unknown.

For a reproducible proof, upload [`examples/codex-policy-ledger-release-generic-log.json`](../examples/codex-policy-ledger-release-generic-log.json) and follow the [mapping recipe](GENERIC_JSON_ADAPTER.md#test-the-example-in-the-ui). The public deployment mapped all ten selected records, retained `/activity_log/0` as raw evidence, and produced the qualified verdict **Within declared authority** with zero unparsed records and zero findings. Another exporter follows the same live workflow with its own documented paths and values.

## If you have 30 seconds

1. Open the live demo, switch to **Verify an export**, and select **Verify evidence packet**.
2. Read **PASS** and scan the eight gates, especially the three-artifact manifest, complete embedded-receipt replay, and recovery-plan binding.
3. Select **Verify another export**, then **Catch altered sample**. One deterministic receipt finding was changed after export, so policy and citation replay fail with **CHECK FAILED**.
4. Point to **What this cannot verify**. The unsigned manifest proves internal consistency, not exporter identity, trace completeness, or signed provenance.

The same deployed verifier retains the standalone receipt proof through **Verify receipt only** and the altered receipt through **Catch altered sample**. The direct `/?mode=verify&sample=valid` and `/?mode=verify&sample=altered` shortcuts remain available.

## If you have 60 seconds

1. Open the live demo and choose **Overreaching run**.
2. Keep the preset authority and select **Build receipt**.
3. Open **Policy checks**. Six checks show **Deviation found** and three show **No finding**; open one to see its finding, canonical event, and retained source object together.
4. Read the verdict and two-incident brief. The ledger exposes the complete decision surface while the incident brief keeps the manager queue concise.
5. Open **AI boundary**. The panel shows fallback or Granite provenance, the exact minimized and redacted fact bundle, the evidence IDs Granite may select, and the raw fields held back from the model request.
6. Open **Recovery plan** and download Recovery Plan v1. The status confirms citation validation and a SHA-256 binding to the exact receipt.
7. Record a manager disposition and download the **evidence packet**. It contains the decision brief, full receipt, and recovery plan in one strict JSON file with three manifest entries.
8. Start a new review with **Incomplete OTLP run**. Build the receipt, then compare **Policy checks** with **Evidence gaps**. The product separates one unable-to-assess check from two inactive constraints while accounting for all three source spans.

The seeded run records six events. Three stay inside the declared authority. The other three capture an external spreadsheet attempt with an unknown result, its successful retry, and an unapproved customer-email send. Deterministic rules produce 12 findings and group them into two incidents without hiding the underlying queue.

## What makes the project different

Most trace tools show activity. Agent Receipt asks whether that activity stayed inside a specific authority envelope and gives the accountable human a bounded decision: accept, investigate, or reject.

The model does not decide the verdict. IBM Granite receives a minimized, redacted fact bundle from a server-only route and may select which verified findings to emphasize. The receipt makes that boundary inspectable instead of asking a judge to trust a model badge. Invalid output, missing credentials, or a network failure uses the deterministic fallback. The review still works.

Recovery Plan v1 carries cited follow-up work into a later approval process. It contains no credentials or execution commands, records current external state as unknown, and grants no execution authority.

Evidence Gap Mode completes the decision model. A run can be inside authority, outside authority, or not assessable from the supplied trace. The third state is not a softer risk score: it is a deterministic refusal with a raw-record ledger and exact evidence requests.

The Policy Decision Ledger makes the policy engine's complete review surface inspectable. A finding-only queue cannot show whether an absent check passed, was blocked by missing evidence, or was not active. The ledger assigns each manager-facing check one of those explicit outcomes and links active checks to supplied evidence. “No finding” is carefully limited to the supplied facts.

The Portable Receipt Verifier makes the exported artifact testable after it changes hands. It hashes the exact imported file, validates the strict receipt contract, recomputes event accounting, replays the deterministic policy result, and checks the cited copy. It runs in the browser without credentials or a network call.

Portable Evidence Packet v1 completes that handoff. One file carries the manager brief, validated receipt, and proposal-only recovery plan. The verifier independently replays all three manifest digests, the complete receipt contract, and the recovery binding. The packet is deliberately unsigned and never described as authentic or tamper-proof.

## Evidence for the judging lenses

| Criterion | Evidence to inspect |
|---|---|
| Technical execution | Exact-byte SHA-256, complete raw-event accounting, a strict four-status policy-decision contract, deterministic policy and verdict, three-artifact manifest replay, full embedded-receipt verification, server-only Granite route, full tests, production build, and release audit |
| Innovation | Intent-versus-action reconciliation, a complete fired/non-fired/unknown/inactive policy register, deterministic evidence refusal, an inspectable AI boundary, and a self-checking manager handoff that catches altered deterministic claims |
| Feasibility | Live upload or paste for Native Trace v1, documented OTLP/JSON, and explicitly mapped record-oriented JSON; credential-free fallback; one complete evidence-packet export; and browser-only receipt or packet verification with no service dependency |
| Challenge fit | Decision support for managers reviewing work completed by AI collaborators, under the Future of Work wildcard theme |
| Real-world impact | A manager can see what happened, what crossed authority, why the evidence may be insufficient, and what a controlled response workflow should review next |

The challenge page presents five lenses. The official rules use four scored headings and combine implementation with feasibility; the evidence above covers both versions.

The declared evaluation cases are synthetic so their expected results can be reproduced. The deployed upload and mapping path also accepts a reviewer's own record-oriented JSON, but the current evidence does not establish legal compliance, trusted trace capture, production-scale performance, or universal policy coverage.

## Reproduce the evidence

Run the declared evaluation:

```bash
npm ci
npm run eval
```

Run the complete gate:

```bash
npm run verify
```

The evaluation report explains the corpus and limitations: [docs/EVALUATION.md](EVALUATION.md). The [Policy Decision Ledger contract](POLICY_DECISION_LEDGER.md), [Portable Evidence Packet contract](PORTABLE_EVIDENCE_PACKET.md), and [standalone receipt-verifier contract](PORTABLE_RECEIPT_VERIFIER.md) record their deterministic boundaries and non-claims. The public Bob build story records IBM Bob's primary role without attributing supporting-tool work to Bob: [docs/BOB_BUILD_STORY.md](BOB_BUILD_STORY.md).

## Product boundary

Agent Receipt reviews supplied evidence after a run. It does not watch an agent live, stop actions, execute remediation, certify compliance, prove that a trace is complete, or expose private chain-of-thought. Every conclusion is limited to the supplied trace and authority envelope.
