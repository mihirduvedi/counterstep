# Agent Receipt Evaluation

This report records a reproducible automated evaluation of the current prototype. The corpus uses declared examples so every expected outcome can be regenerated locally. That choice makes the evidence repeatable; it does not limit the product to those files. The deployed app also accepts a reviewer-uploaded or pasted record-oriented JSON log through the explicit mapping workflow described in `docs/GENERIC_JSON_ADAPTER.md`.

## Result at a glance

| Check | Result |
|---|---:|
| Expected deterministic verdicts | 5 / 5 |
| Seeded authority-rule detections | 6 / 6 |
| Policy Decision Ledger | 45 / 45 decisions recorded across 5 cases |
| Ledger outcomes | 6 deviations, 31 no findings, 1 unable to assess, 7 not active |
| Raw records explicitly accounted for | 25 / 25 |
| Known native-trace SHA-256 digests | 2 / 2 |
| Receipt schemas accepted | 5 / 5 |
| Generated receipt items with valid citations | 24 |
| Byte-identical deterministic replay | Passed |
| Invented citation rejected | Passed |
| Invalid Granite selection rejected with usable fallback | Passed |
| Material unparsed OTLP span forced an incomplete verdict | Passed |
| Explicitly mapped generic JSON records | 10 / 10 mapped; clean qualified verdict |
| Recovery plan receipt binding and deterministic replay | Passed |
| Recovery plan evidence closure | 2 incidents, 6 actions, 3 events, 12 findings |
| Recovery plan execution boundary | Closed: not executed, current state unknown, approval required |
| Portable receipt verifier focused cases | 12 / 12 passed |
| Valid / altered verifier demonstrations | PASS / CHECK FAILED |
| Portable evidence packet manifest | 3 / 3 artifacts passed |
| Packet receipt replay and recovery binding | Passed / Passed |
| Altered packet finding detected | Passed |

Run the evaluation with:

```bash
npm run eval
```

The executable corpus and assertions live in `src/evaluation/hackathonEvaluation.ts` and `tests/evaluation/hackathonEvaluation.test.ts`.

## Corpus

| Case | Input | Expected verdict | Purpose |
|---|---|---|---|
| Native expected run | Agent Receipt Native Trace v1, 3 raw events | `within_declared_authority` | Confirms that activity inside the supplied authority envelope is not over-flagged. |
| Native overreaching run | Agent Receipt Native Trace v1, 6 raw events | `material_deviations_found` | Seeds six policy-rule families and checks that each is detected. |
| Narrow OTLP GenAI export | OTLP/JSON `resourceSpans`, 3 raw spans | `within_declared_authority` | Confirms the documented external adapter path and metadata-only accounting. |
| Incomplete OTLP evidence | OTLP/JSON `resourceSpans`, 3 raw spans | `unable_to_assess_fully` | Confirms that a material unmapped action and unknown run termination stop the assessment without dropping source records. |
| Explicit generic JSON release log | Vendor-shaped `activity_log`, 10 raw records + versioned mapping manifest | `within_declared_authority` | Confirms that an unrelated field structure reaches the same deterministic authority result when its semantics are explicitly mapped. |

Across the corpus, all 25 raw records are classified as mapped, metadata-only, or unparsed. Twenty-two become canonical events. The incomplete case still accounts for all three source spans: one maps, one stays metadata-only, and one material action remains unparsed. The generic case enters through the same adapter and receipt pipeline used by the browser upload flow, maps all ten vendor-shaped records, and retains the exact mapping manifest with receipt integrity.

## Seeded rule coverage

The overreaching fixture is expected to activate these deterministic rules:

- `AR-SYS-001`: system outside the declared allowlist
- `AR-OP-001`: operation outside the declared allowlist
- `AR-EGRESS-001`: external egress contrary to the envelope
- `AR-DATA-001`: restricted data category referenced
- `AR-APPROVAL-001`: required approval absent or invalid
- `AR-RETRY-001`: retry after an unknown outcome, creating possible duplicate-side-effect risk

The evaluation detected all six. This is fixture coverage, not a claim that the catalog detects every possible real-world policy violation.

## Adversarial trust checks

The harness also changes inputs or generated output to verify failure behavior:

1. Rebuilding the same receipt with a fixed evaluation timestamp produces an identical serialized receipt.
2. Replacing a generated citation with `evt-invented` causes claim validation to reject the copy.
3. Returning a Granite selection containing `finding-invented` causes the application to use deterministic fallback copy.
4. The declared incomplete fixture removes the explicit operation semantic from a material OTLP action span and supplies no terminal status. Both gaps are exposed as `AR-TRACE-001` findings, and the verdict becomes `unable_to_assess_fully`.
5. Building the recovery plan twice from the same validated receipt produces identical JSON, and its SHA-256 binding independently matches the exact serialized receipt.
6. Every incident and proposed action in the exported plan resolves to retained receipt evidence. The plan carries no execution authority and makes no claim about current external state.
7. The Portable Receipt Verifier accepts valid exports from the clean, overreaching, and incomplete fixtures; catches exact-byte changes; rejects oversize, invalid UTF-8, invalid JSON, and non-receipt input; and detects altered verdicts, findings, accounting, and citations.
8. Portable Evidence Packet v1 deterministically serializes a manager brief, receipt, and recovery plan. The evaluation replays all three manifest entries, the full embedded receipt, and the recovery binding, then changes one deterministic finding and confirms both manifest and policy replay fail.
9. The Policy Decision Ledger records nine check families for every corpus case. The expected run shows nine no-finding outcomes, the overreaching run keeps six fired checks beside three non-fired checks, and the incomplete run separates one unable-to-assess check from two inactive constraints.
10. The generic case loads a non-native `activity_log` plus `agent-receipt.generic-json-mapping.v1`, verifies all ten records map, and produces the same qualified clean result as its equivalent Native Trace example.

These checks protect the product's central claim: uncertainty is exposed rather than filled in by a model.

## What this evaluation does not establish

- It is not a production benchmark, penetration test, legal-compliance assessment, or independent audit.
- It does not measure manager task time, usability, false-positive rates on real traces, or performance at scale.
- It does not claim universal OpenTelemetry compatibility; the OTLP adapter supports one documented JSON shape and a small GenAI/action semantic profile.
- It does not claim that arbitrary logs contain enough facts. The generic adapter broadens field structure through explicit reviewer mapping; missing or ambiguous semantics remain unknown or unparsed.
- It does not compare Granite with other models. Granite is optional and cannot change the deterministic verdict.
- A passing portable-verifier report establishes internal receipt consistency, not exporter identity, trace completeness, trusted capture, original trace bytes, or signed provenance.
- The evidence-packet manifest is unsigned. A passing packet is not an authenticity, tamper-proof provenance, digital-signature, or nonrepudiation result.
- The cases are intentionally small and known. The live mapper can accept a compatible custom export, but more exporters, consented real traces, larger stress corpora, and structured user studies are future evaluation work.
- A ledger status of `no_finding` means the current deterministic check produced no deviation from explicit supplied facts. It is not evidence that the trace is complete or that the run is safe or compliant.

## Suggested judge demo

Start by uploading `examples/codex-policy-ledger-release-generic-log.json` and follow the mapping recipe in `docs/GENERIC_JSON_ADAPTER.md`. Show the **10 mapped / 0 unparsed** preview and explain that another record-oriented export uses its own reviewed paths and value translations. Then run `npm run eval`, open the overreaching sample, and select **Policy checks** to show six fired checks beside three non-fired checks. After the incident and recovery path, download the evidence packet. Open **Incomplete OTLP run** to contrast one unable-to-assess check with two inactive constraints and to show all three raw records. Finish in **Verify an export** with the evidence-packet and altered-receipt demonstrations. The first replays the complete handoff; the second catches a changed deterministic claim.
