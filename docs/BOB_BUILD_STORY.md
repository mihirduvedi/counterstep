# How IBM Bob Built Agent Receipt's Trust Foundation

IBM Bob was the primary development tool for Agent Receipt's trust-critical foundation. The repository history preserves two large, tested Bob-authored implementation slices, while later supporting-tool work is named separately and never attributed to Bob.

## Bob's material implementation

| Public commit | Bob-authored outcome | Verifiable evidence |
|---|---|---|
| `1fa6679` — Build deterministic evidence and policy engine | Zod evidence contracts, exact-byte integrity, native adapter, complete raw-event accounting, deterministic policy rules, fixtures, and focused tests | 12 files and roughly 2,585 added lines; the commit contains adapter, integrity, policy, schema, timestamp, fixture, unit, hardening, and golden-test work. |
| `560b5b9` — Build Granite explanation boundary and fallback | Minimized fact bundle, recursive redaction, watsonx client, claim validation, repair/fallback path, server route, and extensive mocked tests | 13 files and roughly 3,051 added lines; the commit contains the AI boundary, API route, and 1,485-line Granite test suite. |

Bob also performed a hardening pass between those milestones, adding stricter timestamp handling, approval linkage, unknown-quantity limitations, and more tests. The subsequent receipt orchestration, UI, release work, compatibility updates, and current hackathon refinements used supporting tools and human review; those changes are disclosed separately in the local assistance ledger and public commit history.

## Development protocol

The team gave Bob bounded tasks tied to the product requirements and trust invariants. A representative evidence-foundation task required Bob to:

1. implement only the schemas, native adapter, byte digest, raw-event accounting, and two synthetic fixtures;
2. preserve missing fields as unknown and account for every raw record;
3. add golden and focused tests; and
4. run the complete repository verification gate before the slice was accepted.

The Granite task similarly kept Bob inside one boundary: server-only minimization and redaction, structured generated output, citation and prohibited-claim validation, timeout/repair behavior, deterministic fallback, and mocked success and failure tests. Granite was never assigned policy evaluation or verdict computation.

The reusable workflow is documented in `docs/IBM_BOB_WORKFLOW.md`, with the same sequence for each material slice:

```text
bounded plan → implementation → focused tests → full verification → human diff review → assistance log
```

## Why this evidence matters

The Bob contribution is visible in working code rather than a ceremonial mention:

- deterministic rules, adapters, schemas, and tests are present in the Bob-authored commits;
- the public history keeps commit boundaries and messages intact;
- the app's core review flow depends directly on those modules;
- a credential-free deterministic path lets judges exercise the result without trusting a hosted model; and
- later tools are credited only for the work they actually performed.

For a submission video, show a brief view of the Bob workflow or commit diff, then demonstrate that the resulting receipt can open a verdict into cited canonical and raw evidence. Do not show credentials, private logs, or hidden model reasoning.
