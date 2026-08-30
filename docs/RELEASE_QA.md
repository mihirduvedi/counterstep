# Release QA Ledger

**Snapshot:** August 29, 2026

**Scope:** Deployed Generic JSON Adapter product release `8fdf2adae455c09073a847f66959d13fb73779ec` and the judge-facing documentation refresh that explains the live custom-log workflow.

**Decision:** The product release passed the complete automated gate, reproducible evaluation, strict UI scan, exact-SHA GitHub Actions and Vercel checks, and a full custom-log journey on the public site. The deployed app accepts live user-uploaded or pasted record-oriented JSON through an explicit mapping step. The bundled files make that path easy to reproduce; they are not the only accepted inputs.

This ledger separates automated evidence from browser, manual-accessibility, live-service, deployment, and submission evidence. A checked local test does not prove an unexecuted layer.

## Automated evidence

| Check | Latest result | What it supports |
|---|---|---|
| Generic adapter `npm run verify` | August 29: lint with zero warnings, strict TypeScript, 24 test files and 364 tests, production build, release audit across 90 source files, 143 build files, 474 dependency entries, and 11 media assets | The Generic JSON Adapter, existing receipt contracts, and release-safety boundaries pass locally |
| Generic adapter `npm run eval` | One evaluation test covering five declared cases, 25 accounted raw records, 22 canonical events, and 45 policy decisions passed on August 29 | The generic example maps 10 of 10 records and reaches the same qualified clean result as its native equivalent |
| Generic adapter strict UI scan | 64 source files, 0 errors, 0 warnings | Source-level UI heuristics only; not rendered or assistive-technology proof |
| Deployed Generic JSON Adapter CI | [Run `33239296527`](https://github.com/mihirduvedi/agent-receipt/actions/runs/33239296527) passed for exact product SHA `8fdf2adae455c09073a847f66959d13fb73779ec` on August 29 | A clean hosted install and complete gate passed for the feature-bearing release now served at the public alias |
| `npm run verify` | Portable Evidence Packet v1 passed locally and in exact-SHA hosted CI on August 28: lint with zero warnings, strict TypeScript, 20 test files and 346 tests, production build, release audit across 80 source files, 143 build files, 474 dependency entries, and 11 media assets | The tested deterministic, packet, UI-helper, build, and release-safety contracts reproduce in a clean hosted runner; this is not browser or live-provider proof |
| GitHub Actions `CI` | [Run `33227804643`](https://github.com/mihirduvedi/agent-receipt/actions/runs/33227804643) passed for exact product SHA `2dee60545e18bea965afd2bb381eb9d918af8a98` on August 28 | A clean hosted install and complete `npm run verify` passed for the deployed packet release |
| `npm run eval` | One evaluation test covering four declared cases passed on August 28 | Synthetic verdict, rule-family, accounting, deterministic replay, citation, fallback, OTLP limitation, evidence-gap, and Recovery Plan v1 assertions passed |
| `npm audit --omit=dev --json` | Zero known production dependency vulnerabilities on August 28 | Current npm advisory data reported no production vulnerability |
| Strict UI static scan | Packet release scan: 31 source files, 0 errors, 0 warnings | Source-level UI heuristics only; not rendered or assistive-technology proof |
| Markdown local-link audit | 62 local links checked across 19 tracked repository Markdown files, 0 missing | Current judge-facing repository links resolve locally |

The full suite covers exact-byte digest behavior, native, narrow OTLP, and explicitly mapped generic JSON adaptation/accounting; deterministic policy rules; incident grouping; recovery proposals; Recovery Plan v1 binding and citation closure; Granite fact minimization/redaction/selection validation/fallback/token caching; route media and body limits; receipt orchestration and export validation; all declared fixtures; portable-receipt replay and failure boundaries; the synthetic evaluation corpus; release-source enumeration; and deterministic UI view helpers.

## Deployed custom JSON workflow

The deployed app accepts one reviewer-selected action-record array from an uploaded or pasted UTF-8 JSON object or root array. Structural suggestions remain inert until the reviewer confirms RFC 6901 field pointers and typed operation, status, state-change, actor-type, and boundary translations. Every selected item becomes one canonical event or one material-unparsed accounting record. The validated mapping manifest remains in receipt integrity, and Granite never participates in ingestion.

Focused generic-log tests passed 27 of 27 checks across adapter, mapping-view, example-equivalence, and intake suites. The local production browser mapped the 5,363-byte vendor-shaped example at SHA-256 `e5648722f62afccffcd40274f3b9c72a5c5c927f751c5b6ced7173003d90d0e1`: 10 selected, 10 mapped, zero unparsed, six systems, four state changes, one external event, one prior human approval, and zero findings.

The same file then passed through the public upload and mapping flow on exact release `8fdf2adae455c09073a847f66959d13fb73779ec`. The public receipt reported input format `generic-json-records.v1`, adapter `genericJsonExplicitMapping` version `1.0.0`, deterministic fallback provenance, 10 events, 6 systems, 4 state changes, 1 external event, 1 human approval, and 0 findings. Raw evidence opened at `/activity_log/0`, closing the drawer restored focus, document width matched the 1280 × 720 viewport, and browser warning/error logs were empty. Vercel target `8X1ScdmL7QcNBBnDwByMA9veSqMv` reported **Deployment has completed**, and the public alias returned HTTP 200. Earlier responsive checks covered the mapping interface at 390 × 844 without document overflow.

This establishes a live custom-log workflow for compatible record-oriented JSON and the supplied reviewed example. It does not establish universal zero-configuration parsing, trace completeness, or compatibility with logs that omit required action semantics.

## Deployed Policy Decision Ledger

The Policy Decision Ledger adds a strict deterministic register with nine manager-facing check families and four explicit outcomes: deviation found, no finding, unable to assess, and not active. Each active row links to deterministic findings, canonical events, and retained raw pointers when available. Granite does not create or change the register. The feature is returned as browser review evidence and does not silently change Receipt v1 or Evidence Packet v1.

Focused tests cover expected, overreaching, and incomplete receipts, citation linkage, strict aggregate counts, and count-drift rejection. Browser QA covered the three receipt states at 390, 840, and 1280 CSS pixels. The expected receipt showed nine no-finding checks; overreaching showed six deviations and three no findings; incomplete showed six no findings, one unable to assess, and two inactive constraints. Document width equaled viewport width at each breakpoint, the minimum measured ledger evidence control was 44 CSS pixels, and the evidence drawer closed with Escape and restored focus.

The same incomplete-fixture pass confirmed the two requested presentation repairs: the receipt count strip displayed **1 Event** and **1 System**, and the final blue metadata-only rail ended at the exact source-ledger bottom. A fresh browser tab recorded no warning or error entries. These browser checks are not a real screen-reader or cross-browser certification.

## Deployed Portable Evidence Packet v1

The release makes one Evidence Packet v1 file the primary manager handoff. It contains a deterministic decision brief, the full validated receipt, and the citation-closed Recovery Plan v1 artifact. Each canonical embedded artifact has an independent byte length and SHA-256 manifest entry. The outer packet excludes the original trace, retained raw source, credentials, approvals, and execution commands.

The browser verifier auto-detects receipts and packets. Packet verification hashes the exact outer bytes before decoding, enforces a 4 MiB limit, validates strict cross-artifact references, replays all three manifest entries, runs the complete embedded-receipt verifier, and confirms the recovery plan is bound to the canonical receipt artifact.

Focused packet tests currently cover clean, overreaching, and incomplete verdicts; stable serialization; exact-byte sensitivity; strict cross-artifact validation; manifest changes; complete receipt replay; invented recovery citations; receipt-or-packet auto-detection; and size, UTF-8, and JSON boundaries. The judge-facing evaluation independently checks all three artifact digests, receipt replay, recovery binding, deterministic packet serialization, and detection of an altered finding.

In the deployed browser, the overreaching receipt downloaded a 42,376-byte packet. A separate verifier invocation passed all eight gates on that exact downloaded file with SHA-256 `4755bdf819bc5f966d1ad2725f4c855ed113a64527f7956a1b7d522f89a93f7d`. The deployed synthetic packet report displayed the three-artifact summary and all eight passed gates on a separate 42,377-byte generated packet. The deployed receipt-only report also passed all eight receipt gates; the altered receipt reported **CHECK FAILED** at deterministic policy and cited-claim validation. The tested page matched the 1280-pixel viewport width. Browser-console diagnostics were not independently captured in this release pass.

The packet manifest is unsigned. Passing establishes internal consistency only, not exporter identity, trace completeness, original-byte availability, authenticity, tamper-proof provenance, a digital signature, or nonrepudiation.

## Deployed Portable Receipt Verifier

The verifier accepts an exported receipt as exact file bytes or pasted UTF-8 text and runs entirely in the browser. It computes the imported-file SHA-256 before decoding, enforces the 2 MiB limit, validates UTF-8, JSON, the strict receipt contract and cross-object references, recomputes accounting, replays the deterministic policy verdict and complete findings, then validates the exported copy against its citations. A boundary failure is rejected; a valid receipt that contradicts replay reports CHECK FAILED.

Focused automated checks covered twelve cases: passing exports from the expected, overreaching, and incomplete outcomes; exact-byte digest sensitivity; oversize, invalid UTF-8, invalid JSON, and non-receipt inputs; altered verdict and deterministic finding records; changed coverage; and invented citations.

Local browser checks covered the valid and altered query shortcuts at 1280 × 720, 840 × 900, and 390 × 844. At 840 and 390 CSS pixels the document width equaled the viewport width, and the minimum measured button height was 46 CSS pixels. The passing report showed all eight successful gates; the altered report showed policy and citation failures with the required limitations.

On the deployed release, browser automation activated **Verify another receipt**, **Verify valid sample**, and **Catch altered sample** at 1280 × 720. The valid sample reported PASS with all eight gates; the altered sample reported CHECK FAILED with exactly the policy and citation gates failed. Document width equaled viewport width and browser error logs were empty. This does not establish cross-browser behavior, physical-device behavior, or a screen-reader result. A pass also does not prove receipt authenticity, trace completeness, exporter identity, original trace bytes, or signed provenance.

## Deployed Evidence Gap Mode

The release adds a third, intentionally incomplete OTLP journey. One material action span lacks the supported operation field, so the adapter accounts for all three raw spans as one mapped, one metadata-only, and one unparsed. The deterministic result is `unable_to_assess_fully`, with separate findings for the material parse gap and unknown run termination. The UI links both gaps to retained evidence and asks for the missing facts instead of inferring them.

Focused production-build and development-browser checks covered:

- the three-sample intake and prefilled OTLP authority envelope;
- 3/3 raw-record accounting, the 1/1/1 classification split, two trace findings, and an unknown termination status;
- a complete raw-record ledger and exact raw-only drawer view for the unparsed action span;
- the single evidence-collection recovery action, without generic remediation that assumes a known operation;
- Escape close and focus return from the raw-only evidence drawer;
- fallback provenance in the production build and accepted local Granite provenance through the unchanged server-only boundary;
- 390 × 844, 840 × 900, and 1280 × 720 layouts with document width equal to viewport width;
- no browser warning or error entries in the tested development or production tabs.

The deployed incomplete fixture built an **Authority assessment incomplete** receipt in deterministic fallback mode, displayed 3/3 accounting with the 1/1/1 split, retained both evidence gaps and all three raw records, matched the 1280-pixel viewport width, and logged no browser errors. Local checks retain the wider responsive and evidence-drawer evidence. Cross-browser behavior, a physical-device result, and a real screen-reader experience remain unverified.

## Previously verified Portable Evidence Packet deployment

Historical verified product target: <https://receipt-one-flax.vercel.app>, exact packet feature commit `2dee60545e18bea965afd2bb381eb9d918af8a98`, synthetic fixtures only. Vercel target `54zjcRQwWTDw66vdRGrSaCE7yaed` reported **Deployment has completed** and a successful exact-SHA commit status. Newer release evidence supersedes this entry only when its exact hosted SHA and browser results are recorded.

- The alias returned HTTP 200 on August 28.
- Vercel reported **Deployment has completed** for the exact SHA.
- The GitHub repository was publicly readable at <https://github.com/mihirduvedi/agent-receipt>.

| Journey or condition | August 28 result |
|---|---|
| Expected run at 390 px | Clean verdict, 3/3 coverage, deterministic fallback provenance, Recovery Plan v1 control present, no document-level overflow |
| Overreaching run | Material-deviation verdict, two incidents, six proposed recovery actions, 12 findings, 6/6 accounting, deterministic fallback provenance |
| Recovery Plan v1 | The control was present in both deployed journeys. Overreaching activation displayed the citation-validation and exact-receipt SHA-256 success state; the clean fixture displayed the explicit empty-plan success state. Browser automation did not independently capture either Blob file event; focused tests cover serialization, digest binding, citation closure, and raw-source exclusion. |
| Mobile recovery section at 390 px | Document width equaled viewport width. The export appeared immediately below the recovery heading and before the six-action proposal list. Its description/status references resolved, and the proposal cards and evidence controls remained readable. |
| Inspectable Granite boundary | Expected displayed 3 reduced events, 0 reduced findings, and citation allowlists of 3/0. Overreaching displayed 6/12 and allowlists of 6/12. Both showed deterministic fallback provenance in production. Expanded JSON omitted raw pointers, source event IDs, event input/output, metadata, policy comparison fields, and retained raw source data. |
| Public links | Demo, repository, challenge page, submission platform, official-rules PDF, and SkillsBuild page returned HTTP 200 |

These checks used Chrome with pointer interaction and a responsive viewport override. They are not a cross-browser, physical-device, or screen-reader certification.

## Deployed Granite-boundary browser evidence

The Granite-boundary release was exercised at the public production alias in the in-app Chromium browser at 1280 × 720 and 390 × 844:

- both fixtures completed with deterministic fallback provenance, matching the credential-free public deployment contract;
- the panel exposed the exact redacted projection, both citation allowlists, and the correct reduced counts for each fixture;
- expanded JSON omitted raw pointers, source event IDs, event input/output, metadata, policy comparison fields, and retained raw source data;
- desktop and mobile layouts had no document-level horizontal overflow;
- the JSON preview stayed inside a bounded scroll region;
- browser logs contained no warning or error entries;
- browser automation observed the Recovery Plan download control and success UI, but did not capture the browser-created Blob file event.

These checks establish the tested public deployment path, but not cross-browser behavior, a real screen-reader experience, live Granite in Vercel, or future provider availability.

## Previously verified rendered behavior

The current implementation also has recorded browser evidence for:

- expected, overreaching, and incomplete intake, authority, and receipt flows;
- OTLP paste intake;
- long task, system, and agent names at 390 px, 640 px, and 1280 px;
- 640 CSS-pixel reflow as a 200% zoom equivalent;
- evidence-drawer focus entry, Tab/Shift+Tab containment, Escape close, focus restoration, and body-scroll restoration;
- human disposition and receipt JSON status;
- explicit text labels for unknown and succeeded outcomes;
- eleven README screenshots at 1280 × 720 using only synthetic data;
- the complete project-guide PDF with bounds, font, page-grid, and readable-page inspection.

The prior focused 390-pixel public rerun was completed on product release `7b712e5df8ad781162c896ddcae0463b3160c210`. The combined release preserved that code while adding the two new surfaces; the same final code passed local 390/840/1280 checks and deployed 1280-pixel journeys. The earlier public evidence remains useful for unchanged wider responsive, long-content, keyboard-dialog, and accessibility-tree behavior.

## Live watsonx.ai evidence

Local live-service checks on August 28 used the Dallas watsonx.ai Chat API and `ibm/granite-4-h-small`. Credentials stayed in `.env.local`; no key or access token was printed or committed.

| Condition | Result |
|---|---|
| IAM exchange and minimal Chat API request | HTTP 200; current response shape contained `choices[0].message.content` |
| Expected and overreaching fixture journeys | Valid compact finding selections; integrity recorded `granite`, model `ibm/granite-4-h-small`, API version `2025-10-25` |
| Invalid process-only credential | Safe deterministic fallback; no model metadata attached |
| Explicit `GRANITE_MODE=fallback` | Receipt remained fully usable without a network call |
| Rejected open-ended paraphrase diagnostic | Unsupported claims were rejected; the compact selection contract replaced the wider output surface |

The production browser journeys recorded `deterministic_fallback`. Local provider success does not prove that live Granite is configured in Vercel or that future provider behavior will be identical.

## Documentation and artifact state

- `README.md` leads with the live upload and paste workflow, explains how an unfamiliar record array is mapped, and distinguishes repeatable examples from the product's actual input boundary.
- `docs/SUBMISSION.md` contains the verified public repository URL. The public-video and eligible-team fields remain intentionally unresolved.
- `docs/JUDGE_GUIDE.md` begins with the bring-your-own-log path, retains the 30- and 60-second repeatable demonstrations, and maps concrete evidence to the judging lenses.
- `docs/PROJECT_GUIDE.md` and the Version 2.0 PDF explain the deployed custom-log workflow alongside the existing policy, packet, Granite-boundary, Evidence Gap Mode, receipt-verifier, responsive, and live-provider evidence boundaries. The 65-page Letter PDF is 1,855,849 bytes with SHA-256 `1c64cefb0ef3978b4e6331c42a5b297c8a4420a3c44e4dbc7b07fabf8cc710bc`; it has extractable text on every page, no replacement characters, no encryption or JavaScript, 0 bounds errors, 0 safe-zone warnings, embedded custom fonts, and a clean cover, custom-log section, FAQ, closing-page, and full contact-sheet review.
- All application screenshots use synthetic fixture data and are declared in `docs/ASSET_LICENSES.md`.

## Open release and submission gates

- [x] Run a clean hosted install and `npm run verify` on exact product SHA `7b712e5df8ad781162c896ddcae0463b3160c210`.
- [x] Verify GitHub Actions and Vercel status on exact product SHA `7b712e5df8ad781162c896ddcae0463b3160c210`.
- [x] Make the GitHub repository public and verify it while signed out.
- [x] Complete both fixture journeys on the public Recovery Plan v1 release.
- [x] Configure and test live watsonx.ai locally, including deterministic fallback after forced failure.
- [x] Run responsive, long-content, zoom-equivalent, keyboard-dialog, and accessibility-tree checks on the core journey.
- [x] Finish `npm run verify`, strict UI scan, local-link audit, and the focused local browser rerun on the presentation patch.
- [x] Commit and push the judge-path product release after explicit approval.
- [x] Verify exact-SHA CI/Vercel status and repeat both public fixture journeys after the product push. At 390 px, the export preceded the proposal list, its descriptive/status references resolved, both fixture activations displayed their correct success states, and document width equaled viewport width. Browser automation did not independently capture either Blob file event.
- [x] Run the complete local gate, static UI scan, and desktop/mobile browser checks for the Granite-boundary release.
- [x] Commit and push the Granite-boundary release after fresh approval, verify exact-SHA hosted CI/Vercel status, and repeat both public fixture journeys.
- [x] Run the complete local gate, static UI scan, and focused desktop/tablet/mobile browser checks for Evidence Gap Mode.
- [x] Run the complete local gate and focused desktop/tablet/mobile browser checks for the Portable Receipt Verifier.
- [x] Commit and push Evidence Gap Mode plus the Portable Receipt Verifier after fresh explicit approval; verify exact-SHA CI, Vercel, the incomplete receipt, and both verifier states.
- [x] Run the complete local gate, strict UI scan, packet-file verification, local-link audit, and rendered-guide inspection for Portable Evidence Packet v1.
- [x] Commit and push Portable Evidence Packet v1 after fresh explicit approval; verify exact-SHA CI, Vercel, the packet download, packet replay, receipt-only replay, and altered-receipt failure on the deployed build.
- [x] Run the complete local gate, evaluation, strict UI scan, 390/840/1280 browser QA, and Version 1.9 rendered-guide inspection for the Policy Decision Ledger candidate.
- [x] Commit, push, deploy, and publicly exercise the Generic JSON Adapter release with 10 of 10 selected records mapped.
- [ ] Run a real screen-reader spot check if a stronger accessibility claim is desired.
- [ ] Have the custom proprietary terms reviewed by qualified counsel before relying on them for commercial enforcement.
- [ ] Confirm every teammate's eligibility, challenge registration, required IBM SkillsBuild Bob activity, and no conflicting prior Wildcard submission.
- [ ] Record a public video no longer than three minutes, add its URL to `docs/SUBMISSION.md`, and verify signed-out playback and captions.
- [ ] Complete and submit the project page before the official deadline.

## Release boundary

Agent Receipt is a post-run review aid. It does not prove trace completeness, trusted capture, real-world inactivity outside the supplied trace, legal compliance, tamper resistance, or access to private chain-of-thought. Every conclusion is limited to the supplied trace and authority envelope.
