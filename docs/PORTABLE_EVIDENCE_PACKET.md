# Portable Evidence Packet v1

Portable Evidence Packet v1 is the manager handoff artifact for Agent Receipt. It packages the decision-ready view and the replayable evidence contract into one strict JSON file without including the original trace.

The schema version is `agent-receipt.evidence-packet.v1`.

## What the packet contains

| Artifact | Purpose |
|---|---|
| Decision brief | A compact, deterministic manager summary of the task, verdict, evidence coverage, incident count, and proposed-action count |
| Receipt | The complete validated Agent Receipt v1 artifact, including authority, canonical evidence, findings, coverage, cited copy, integrity metadata, and reviewer disposition |
| Recovery plan | The citation-closed Recovery Plan v1 artifact, bound to the canonical receipt digest and explicitly marked as proposal-only |

The outer packet also records the supplied trace digest and byte length from the receipt, a fixed qualifier, fixed limitations, and a three-entry artifact manifest.

The browser's Policy Decision Ledger is a deterministic view derived during receipt construction. It is not a fourth packet artifact and is not silently embedded in Receipt v1 or Evidence Packet v1. The packet verifier continues to replay the complete deterministic findings and verdict under the released schemas; exporting the ledger would require its own explicit versioned contract.

## Canonical artifact serialization

Each embedded artifact is independently parsed through its Zod schema, then serialized as UTF-8 JSON with two-space indentation and no trailing newline. The manifest records that canonical artifact's:

- artifact ID;
- schema version;
- media type and serialization rule;
- exact byte length; and
- SHA-256 digest.

The outer packet is strict JSON. Unknown fields are rejected at every packet boundary.

## Builder invariants

The packet builder fails closed unless all of the following hold:

- the receipt, incidents, and recovery actions pass their existing strict schemas;
- the decision brief matches the receipt's trace, task, verdict, qualifier, disposition, coverage, finding count, and generation source;
- the brief's incidents exactly match the recovery plan incidents;
- the brief's action count matches the recovery plan action count;
- the recovery plan source binding matches the receipt; and
- all three manifest entries match the canonical embedded artifacts.

Missing facts remain unknown. The packet builder does not ask Granite or any other model to infer them.

## Browser-only verification

The portable verifier auto-detects both Receipt v1 and Evidence Packet v1. Evidence packets pass eight ordered gates:

1. SHA-256 of the exact imported packet bytes, computed before decoding or parsing;
2. the 4 MiB packet size limit;
3. fatal UTF-8 decoding;
4. JSON syntax;
5. the strict packet contract and cross-artifact references;
6. byte length and SHA-256 replay for all three manifest artifacts;
7. the complete embedded-receipt accounting, policy, and citation replay; and
8. recovery-plan binding to the canonical receipt artifact.

A byte, format, or schema-boundary failure reports `REJECTED` and stops dependent checks. A schema-valid packet that contradicts its manifest or embedded evidence reports `CHECK FAILED`. The verifier makes no network request and does not call Granite or a server route.

## Deliberate exclusions

The packet contains no original trace bytes, retained raw source objects, credentials, approvals, execution commands, or proof of current external state. Recovery actions remain proposals for an accountable human.

A passing packet proves internal consistency only. Anyone able to rewrite the packet can recompute its unsigned manifest. The packet does not authenticate the exporter, establish that the supplied trace was complete, prove that the recorded input digest matches unavailable original bytes, provide tamper-proof provenance, or create a digital signature or nonrepudiation claim.

Every conclusion remains qualified as based only on the supplied trace and authority envelope.

## Reproduce the checks

Run the focused packet and verifier tests:

```bash
npm run test:run -- tests/unit/evidencePacket.test.ts tests/unit/verifyReceipt.test.ts tests/unit/verificationView.test.ts
```

Run the judge-facing synthetic evaluation:

```bash
npm run eval
```

Run the complete local release gate before treating a candidate as complete:

```bash
npm run verify
```
