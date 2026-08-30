# Policy Decision Ledger

The Policy Decision Ledger makes the deterministic policy engine's complete review surface visible. Findings answer which supplied facts crossed a rule. The ledger also records the checks that produced no finding, could not be assessed, or were not activated by the declared authority.

Its schema version is `agent-receipt.policy-decision-ledger.v1`.

## Why it exists

A finding-only interface leaves a manager guessing whether an absent rule was evaluated, skipped, or blocked by missing evidence. The ledger removes that ambiguity without introducing a score or a model judgment.

For every completed receipt build, it records nine manager-facing policy checks:

| Check | Deterministic rules | Activation and outcome basis |
|---|---|---|
| System allowlist | `AR-SYS-001` | Explicit source and destination systems versus `permittedSystems` |
| Operation allowlist | `AR-OP-001` | Applicable explicit operations versus `permittedOperations` |
| External egress | `AR-EGRESS-001` | Active when the envelope prohibits external egress |
| Restricted data categories | `AR-DATA-001` | Active when prohibited categories are declared |
| Record-read limit | `AR-VOLUME-001`, related `AR-TRACE-001` evidence | Active when `maxRecordsRead` is declared; a missing usable quantity becomes unable to assess |
| Prior human approval | `AR-APPROVAL-001`, `AR-APPROVAL-002` | Active for operations named in `approvalRequiredFor` |
| Uncertain-result retry | `AR-RETRY-001` | Checks increasing attempts that share an action key |
| State change after branch error | `AR-ERROR-001` | Checks supplied branch order and error-handling facts |
| Trace sufficiency | `AR-TRACE-001` | Checks material accounting, operations, quantities, and terminal status |

These are check families, not a claim that the MVP implements every policy an organization may need.

## Four explicit outcomes

Each entry has exactly one status:

- `deviation_found`: one or more deterministic findings belong to the check.
- `no_finding`: the check ran and produced no deviation from the explicit supplied facts.
- `unable_to_assess`: missing or unsupported supplied evidence prevents the check from reaching a supported conclusion.
- `not_active`: the authority envelope did not declare the constraint that would activate the check.

`no_finding` is deliberately narrower than “compliant,” “safe,” or “nothing happened.” Missing fields remain unknown, and the result is qualified by the supplied trace and authority envelope.

## Evidence links

Every entry may cite:

- finding IDs produced by the deterministic policy engine;
- canonical event IDs evaluated for the check;
- retained raw pointers that support those events or expose an accounting gap.

The interface opens those citations through the existing evidence drawer. A `not_active` entry with no relevant event evidence stays visibly noninteractive instead of manufacturing a citation.

## Deterministic architecture

`src/core/policyLedger.ts` derives the ledger only from the validated authority envelope, canonical events, raw-event accounting, deterministic findings, and deterministic verdict. Its strict Zod contract rejects unknown fields, duplicate decision IDs, duplicate citations, and any count that does not match the entries.

The policy engine builds the ledger in the same pass that produces findings and the verdict. The receipt builder returns it as deterministic review evidence for the current browser session.

The ledger is intentionally not embedded in Receipt v1 or Evidence Packet v1. Those released schemas remain backward-compatible, and their existing verifier still replays the complete deterministic policy result. A future exported-ledger format would require an explicit versioned contract and verifier update.

Granite does not create, complete, rank, or alter ledger entries. The feature remains fully usable without credentials or network access.

## Interface and accessibility

The completed receipt shows a ruled register with an always-visible outcome count strip and one row per check. Status text accompanies each semantic color rail, so color is never the only carrier of meaning. Evidence controls use the existing keyboard-operable modal drawer with Escape close and focus restoration.

The layout reflows at 840 and 600 CSS pixels. The compact layout keeps outcome counts legible, turns each decision into a single-column record, preserves at least 44 CSS-pixel evidence controls, and does not require horizontal page scrolling.

## Automated evaluation

The reproducible four-case corpus records 36 decisions in total:

- expected native run: nine `no_finding` decisions;
- overreaching native run: six `deviation_found` and three `no_finding` decisions;
- supported OTLP run: nine decisions;
- incomplete OTLP run: one `unable_to_assess`, two `not_active`, and six `no_finding` decisions.

Focused tests cover clean, overreaching, and incomplete outcomes, evidence linkage, strict count validation, and the distinction between unknown evidence and an inactive authority constraint. These are synthetic fixture results, not real-world false-positive, coverage, compliance, or completeness measurements.
