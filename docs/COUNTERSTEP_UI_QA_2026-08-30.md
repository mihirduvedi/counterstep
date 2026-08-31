# Counterstep judge-path UI QA

**Date:** August 30, 2026

**Scope:** Local P0 judge path only

**Decision:** Passed for the rendered states and viewports listed below

This ledger records the visual, responsive, failure-state, and accessibility
hardening of Counterstep's focused recovery interface. It separates source-level,
automated, rendered, and still-manual evidence. The browser runs used only the
deterministic fixture and fail-closed no-execution modes. They do not establish a
Cloud Run deployment, managed Firestore behavior, or a new live Gemini result.

## Defect ledger

| ID | Priority | Finding | Repair | Result |
|---|---:|---|---|---|
| CSQA-01 | P1 | A terminal no-model failure was visible only deep in the event ledger. | Added a terminal outcome panel directly below the recovery controls with the exact failure, zero-write, tool-call, and event result. | Fixed and rendered in `no_execution` mode. |
| CSQA-02 | P1 | The interface did not expose the PRD's six recovery phases or runtime provenance. | Added deterministic Inspect, Plan, Authorize, Repair, Verify, and Close states plus deployment, persistence, orchestration, and execution-path provenance. | Fixed in ready, active, repaired, and stopped states. |
| CSQA-03 | P1 | A disconnected reset surfaced the browser string `Failed to fetch`. | Normalized network failures and kept the current evidence unchanged. | Fixed with an offline reset exercise. |
| CSQA-04 | P2 | The masthead home control measured 34 CSS pixels tall. | Raised its minimum target height to 44 CSS pixels. | Fixed at 360 and 768 CSS pixels. |
| CSQA-05 | P2 | The primary mobile action fell below the first 360 x 800 viewport. | Tightened the narrow hero and control spacing without removing content. | Fixed; the action ends at 798.54 CSS pixels with `scrollY = 0`. |
| CSQA-06 | P2 | Event state relied too heavily on color and result-code detail. | Added explicit started, succeeded, and failed status text to every event. | Fixed in repaired and failed runs. |
| CSQA-07 | P2 | Progress announcements were concentrated on final status. | Added a dedicated atomic live region and deterministic phase/result announcements. | Fixed in ready, active, repaired, and fail-closed states. |
| CSQA-08 | P2 | Forced-colors behavior had not been checked. | Added forced-colors borders and verified the rendered interface under emulation. | Fixed for the tested path. |

## Trust-critical implementation evidence

- Browser API responses are parsed at runtime with the existing strict Zod public
  schemas; malformed success payloads and malformed error payloads fail closed.
- Recovery progress is derived from persisted run status and recorded event types.
  The interface does not ask a model to infer missing phases or claims.
- A terminal run without closure stops at the last evidenced phase and does not
  mark later phases complete.
- The no-execution path displays `Execution unavailable - zero writes` and does
  not claim repair.
- Ten focused unit tests cover ready, active, terminal, stopped, closure,
  announcement, and fail-closed view derivation.

## Rendered verification matrix

| State or condition | Viewport / mode | Result |
|---|---|---|
| Ready | 360 x 800 | No horizontal overflow; primary action remains in the initial viewport; masthead target is 44 CSS pixels. |
| Active recovery | 1440 CSS pixels with delayed network | Controls and ledger expose `aria-busy`; Inspect is current; the live announcement names the active phase. |
| Canonical repaired run | 360, 768, and 1440 CSS pixels | Outcome is `Repaired and verified`; all six phases are complete; two changed resources, 12 explicitly labelled events, closure jump, and receipt download are present. |
| Fail-closed no-execution run | 360 CSS pixels | Outcome is `Execution unavailable - zero writes`; zero writes, zero tool calls, one failed system event, no closure, and only Inspect is marked `Stopped here`. |
| Service unreachable during reset | 360 CSS pixels | The alert explains that Counterstep could not reach the service and that existing evidence was left unchanged. |
| 200% zoom equivalent | 720 x 900 CSS pixels | No horizontal overflow; phases reflow to three columns and the repaired result remains readable. |
| Reduced motion | 720 x 900 CSS pixels | Reduced-motion media query is active, smooth scrolling is disabled, and event animation duration is reduced to effectively zero. |
| Forced colors | 360 x 800 CSS pixels | No horizontal overflow; primary action and evidence controls retain visible boundaries and readable text. |

The 768-pixel pass measured 44 CSS pixels for the masthead link, 74 for both
recovery buttons, 44 for the closure jump, and 57 for the receipt download.
The tested desktop contrast ratios were 16.45:1 for body text, 6.02:1 for
secondary text, 16.44:1 for the primary action, 7.03:1 for the verified outcome,
9.12:1 for the closure qualifier, and 16.44:1 for the download action.

The accessibility tree exposed one main landmark, the page heading, named
recovery controls, the terminal result heading, a named recovery-phase list,
the closure heading, and the named receipt download. Browser warning and error
logs were empty in the final rendered pass.

## Automated verification

- Strict source-level UI scan: 58 files, 0 errors, 0 warnings.
- `npm run test:run -- tests/unit/counterstepView.test.ts`: 1 file, 10 tests passed.
- `npm run verify`: lint, strict TypeScript, 431 tests, production build, and release audit passed.
- `npm run eval`: the deterministic evaluation suite passed.
- `git diff --check`: passed.

## Evidence not claimed

- No genuine keyboard-only end-to-end pass was completed. Browser automation did
  not move focus for Tab key commands reliably, so source semantics and the
  accessibility tree are recorded without upgrading that to a manual keyboard claim.
- No real screen-reader, physical-device, cross-browser, managed Firestore,
  Cloud Run, or deployed-path result is claimed here.
- Stale replacement-plan rendering was not re-exercised in this UI pass; its
  deterministic behavior remains covered by the existing automated evaluation.
