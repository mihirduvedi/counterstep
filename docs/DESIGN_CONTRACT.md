# Counterstep design contract

## Product

- **Direction:** The recovery ledger.
- **Product thesis:** Counterstep helps an AI operations lead turn a completed agent overstep into a bounded, inspectable repair. Current state, authority, and proof should remain easier to follow than the model's narration.
- **Core journey:** Open the evidence-linked incident, run one bounded recovery, watch exact tool/state transitions, inspect the deterministic closure receipt.
- **Audience context:** A first-time hackathon judge on desktop or phone, under time pressure, with no account and no product training.
- **Platform:** Responsive web application on Next.js and Cloud Run; keyboard and touch are first-class inputs.

## Visual voice

- **Emotional register:** Evidentiary, controlled, consequential. Avoid glossy futurism and cheerful automation theatre.
- **Subject concept:** An overstep and its counterstep form a visible before/after pair joined by an accountable action spine.
- **Dominant rule:** A vertical sequence rail carries the run from evidence through inspection, plan, gate, writes, and verification. Content aligns to that sequence instead of becoming an even card grid.
- **Controlled counter-rule:** The closure result becomes one broad horizontal field because the final claim must be read before its supporting detail.
- **Signature:** Each affected resource is rendered as an explicit `before → action → after` state line with versions and evidence IDs.
- **Creative risk:** Editorial serif display type carries the high-stakes verdict while the operational interface remains compact and sans-serif. The contrast must clarify hierarchy rather than make the tool resemble a magazine.
- **Recognition:** Inherit Agent Receipt's off-white paper field, ink rules, restrained rose incident tone, acid-lime product mark, serif verdict language, and visible evidence IDs.

## System

- **Geometry:** Rectilinear ruled sections, small 0–8px corner family, stable left edges, no nested rounded-card stack.
- **Material:** Flat paper and ink. Dark fields are reserved for the active action/gate and final closure emphasis.
- **Typography:** Georgia for verdict/display continuity; Arial/Helvetica for operational copy; system monospace only for digests, versions, and IDs. The stack avoids network font dependencies.
- **Palette:** Bone canvas, near-black ink, muted graphite, incident rose, safety lime, verified green, blocked amber, and a blue-violet focus ring used only for interaction visibility.
- **Motion:** Brief opacity/translate feedback for newly appended events; no staged page reveal. Reduced-motion removes transform and scrolling animation.
- **Icons:** CSS geometry and text labels only for the base. No decorative icon library or emoji.

## Behavior and trust

- **Primary action:** `Run Counterstep`. It disables during a run, names the current phase, surfaces failures locally, and never claims completion before fresh verification.
- **Reset action:** `Reset synthetic demo`. It creates a new isolated namespace and clearly discards only sandbox demo state.
- **State grammar:** Every phase has a noun/verb label, stable status text, timestamp, and evidence when available. A stale-version path names the failed write, fresh re-inspections, and replacement-plan admission; the gate summary shows when more than one approved plan exists. Color is supplementary.
- **Copy voice:** Concrete verbs and exact boundaries. Avoid generic transformation language, hype, and claims that the model granted authority or proved universal safety.
- **Trust model:** Show the source receipt digest, exact allowed tools/resources, inspected versions, gate results, state changes, provenance, unresolved effects, and the closure qualifier in the main journey.

## Behavior contracts

| Route | Action | Accessible name | Handler | Durable result | Failure behavior |
|---|---|---|---|---|---|
| `/` | Reset fixture | `Reset synthetic demo` | `POST /api/demo/reset` | New demo ID and canonical resource versions | Existing view remains; error explains retry. |
| `/` | Run recovery | `Run Counterstep` | `POST /api/remediation-runs`, then `POST /api/remediation-runs/:runId/execute` | Persisted run, events, state changes, and closure when Gemini succeeds | No-write fallback or exact terminal status; no fake success. |
| `/` | Refresh run | automatic poll while active | `GET /api/remediation-runs/:runId` | Latest persisted phase/events/snapshots | Poll stops and retry control appears. |
| `/` | Download closure | `Download closure receipt` | `GET /api/remediation-runs/:runId/closure-receipt` | Strict JSON artifact | Link appears only after a closure exists. |

## Validation

- First reading order: material incident, exact bounded recovery, one Run Counterstep control.
- Completion reading order: deterministic outcome, before/after proof, supporting event and receipt IDs.
- Test 360px, 768px, 1440px, 200% zoom, keyboard-only flow, reduced motion, long IDs, blocked/partial/failure states, and actual loading.
- The design becomes generic if the action spine, paired state transitions, evidence IDs, and inherited receipt grammar are removed.
