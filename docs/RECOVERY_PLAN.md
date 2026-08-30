# Recovery Plan v1

Recovery Plan v1 is a portable, deterministic handoff for the human-approved follow-up shown in Agent Receipt. It packages cited incidents and proposed actions without pretending the application knows current external state or has permission to change it.

## Why it exists

The receipt answers whether a completed run stayed within the supplied authority envelope. When it did not, a manager also needs a clean way to carry the review into an approval or incident process. The recovery-plan export provides that bridge while keeping execution outside Agent Receipt.

## Trust contract

- `schemaVersion` is `agent-receipt.recovery-plan.v1`.
- `sourceReceipt.receiptDigest` is the SHA-256 of the exact validated receipt JSON serialization.
- `sourceReceipt.inputSha256` remains the digest of the exact trace bytes captured before normalization.
- Every incident and action cites included canonical events and deterministic findings.
- The evidence section contains only records cited by an incident; raw input and retained raw objects are excluded.
- Invented, missing, duplicate, cross-incident, or otherwise inconsistent citations fail Zod validation.
- The same receipt and derived plan serialize byte-identically.

The two hashes answer different questions:

| Digest | What it binds |
|---|---|
| `sourceReceipt.inputSha256` | The exact supplied trace bytes |
| `sourceReceipt.receiptDigest` | The complete validated receipt, including the reviewer disposition |

Changing the disposition changes the receipt digest. It does not change the deterministic verdict or trace digest.

## Execution boundary

Every export records:

```json
{
  "status": "not_executed",
  "currentExternalState": "unknown",
  "executionAuthority": "not_granted",
  "approval": "required"
}
```

There are no credentials, connectors, HTTP targets, shell commands, or mutation handlers in the plan. Proposed actions describe what a qualified human might approve after re-checking current state. They are not proof that a repair is safe, still needed, approved, or complete.

## Shape

```text
schemaVersion + qualifier
sourceReceipt
  receipt digest, trace digest, trace ID, policy ID, verdict, disposition
authority
executionBoundary
incidents[]
actions[]
evidence
  events[]
  findings[]
```

The clean synthetic fixture exports empty incident, action, and evidence arrays. The overreaching fixture exports two incidents and six proposed actions backed by three canonical events and twelve findings.

## Verify a downloaded pair

Download the receipt and recovery plan from the same review state, then compute the receipt file's SHA-256:

```bash
shasum -a 256 agent-receipt-<trace-id>.json
```

The resulting hexadecimal digest must equal `sourceReceipt.receiptDigest` in `agent-receipt-recovery-<trace-id>.json`. Schema and citation validation are implemented in `src/core/recoveryPlan.ts`; focused tests live in `tests/unit/recoveryPlan.test.ts`.

This check establishes that the plan points to that exact receipt file. It does not establish trace completeness, trusted capture, current external state, approval, or execution.
