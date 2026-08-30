# Portable Receipt Verifier

The Portable Receipt Verifier checks an exported Agent Receipt without sending the file to a server, Granite, or any other service. It is designed for the moment after a receipt changes hands: a manager, auditor, or hackathon judge can ask whether the JSON still agrees with the deterministic evidence inside it.

This is an internal consistency check, not an authenticity claim.

## Fastest judge path

Run the application locally, then open either shortcut:

- `http://localhost:3000/?mode=verify&sample=valid` shows a receipt that passes all eight gates.
- `http://localhost:3000/?mode=verify&sample=altered` shows the same kind of receipt with one deterministic finding changed after export. The policy replay and citation gates fail.

The same verifier also accepts an exported receipt as a JSON file or pasted text from **Verify an export** on the intake screen. That intake now auto-detects Portable Evidence Packet v1 as a separate strict path documented in `docs/PORTABLE_EVIDENCE_PACKET.md`.

## What the verifier checks

The verifier starts with a private copy of the exact received bytes. It then runs eight ordered gates:

1. Compute SHA-256 before decoding or parsing.
2. Enforce the 2 MiB limit.
3. Require valid UTF-8.
4. Require valid JSON.
5. Validate the strict `agent-receipt.receipt.v1` schema and cross-object references.
6. Recompute raw-event coverage and accounting.
7. Re-run the deterministic policy engine and compare the complete verdict and finding records.
8. Rebuild the minimized fact bundle and validate every exported receipt note and citation.

A boundary failure such as invalid UTF-8, invalid JSON, or an invalid receipt schema is **REJECTED**. Dependent checks are marked **not run**. A valid receipt that disagrees with a fresh deterministic replay is **CHECK FAILED**. Only a receipt that passes every gate receives **PASS**.

The report never renders the imported JSON body. It shows the exact file digest, byte count, a compact receipt summary, every gate result, bounded issue details, and the required limitations.

## What a pass means

A pass means the exported receipt is internally self-consistent under the current Agent Receipt schemas and deterministic rules. In particular, its accounting, coverage, policy result, and cited manager copy agree with the evidence stored in that export.

A pass does not establish:

- that the original trace captured every real action;
- that the exporter or person who supplied the receipt is trustworthy;
- that the original trace bytes match the trace digest recorded in the receipt, because the export does not contain those raw bytes;
- authenticity, a digital signature, tamper-proof provenance, or nonrepudiation;
- anything beyond the supplied receipt, its cited canonical evidence, and its declared authority envelope.

These limits are always visible in the report, including on a passing result.

## Privacy and runtime boundary

Verification runs in the browser. It does not call `/api/receipt-copy`, contact watsonx.ai, use credentials, or require network access after the application has loaded. No imported receipt data is added to the normal trace-review state, and the UI offers a reset control when the reviewer is finished.

## Implementation map

| Responsibility | Source |
|---|---|
| Exact-byte verification and deterministic replay | `src/core/verifyReceipt.ts` |
| Manager-readable report model | `src/ui/verificationView.ts` |
| Intake, sample demos, and report UI | `src/components/ReceiptReviewApp.tsx` |
| Shareable judge shortcuts | `src/app/page.tsx` |
| Focused trust-critical tests | `tests/unit/verifyReceipt.test.ts` |
| View-model tests | `tests/unit/verificationView.test.ts` |

## Verification evidence

The focused suite covers valid receipts from all three declared review outcomes, exact-byte digest sensitivity, the 2 MiB boundary, invalid UTF-8, invalid JSON, non-receipt JSON, changed verdicts, changed deterministic findings, altered accounting, and invented citations.

The deployed combined release passed exact-SHA GitHub Actions with 20 test files and 346 tests, a production build, and the release audit. The standalone receipt-focused cases remain covered alongside the new packet tests. Local browser inspection covered the valid and altered receipt reports at 1280 × 720, 840 × 900, and 390 × 844; the tested pages had no document-level horizontal overflow, and the smallest tested button height was 46 CSS pixels. The deployed 1280-pixel verifier also passed the receipt-only report and caught the altered policy and cited claim.

The 390- and 840-pixel responsive results remain local evidence. Hosted CI and the deployed 1280-pixel receipt-only and altered-receipt journeys are recorded separately above; they do not establish cross-browser, physical-device, or assistive-technology behavior.
