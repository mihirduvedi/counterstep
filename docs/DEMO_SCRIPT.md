# Counterstep submission video production record

Final length: 2 minutes 57.195 seconds. The 1920 × 1080 H.264/AAC master uses only the synthetic Counterstep demo and includes the continuous live-action eligibility segment below.

The live-action section below is the eligibility proof. Keep it continuous and unedited from the visible `.run.app` address through the terminal closure state.

## Shot plan and narration

### 0:00–0:22 · The cleanup gap

**Show:** The Counterstep hero and original incident summary.

**Say:**

“An AI agent can finish its task and still leave an operator with risky cleanup. This completed CRM run left restricted data in an externally shared spreadsheet and queued a customer email without approval. Counterstep checks what is true now, repairs only what is still reversible, and proves the final state.”

### 0:22–0:42 · Declare the test before the run

**Show:** The Recovery Test Rack. Pause on E1, then briefly point to E2, E3, and E4.

**Say:**

“Each condition declares its result before execution. Canonical recovery requires two writes. Already-safe state requires zero. Delivered mail must remain unresolved. A stale write must be refused and replanned once. Deterministic code grades these contracts; Gemini does not.”

### 0:42–1:45 · Continuous live Cloud Run action

**Show without a cut:**

1. The public `.run.app` URL in the address bar or `/api/health` response.
2. **E1 Canonical recovery** selected with the expected contract visible.
3. Click **Run Counterstep** once.
4. Leave the screen recording continuous while the six phases advance.
5. At the terminal state, show `Contract matched`, the two resource transitions, 2/2 writes, six tool calls, 12/12 accounted events, `within remediation authority`, both satisfied goals, and the closure digest.

**Say:**

“This is the public Cloud Run service. Gemini 3.5 Flash Lite is running through Google ADK on Vertex AI, and Firestore persists the run. Counterstep first inspects exact resource versions. Gemini proposes a cited plan. A deterministic gate checks the resource, transition, citations, versions, and budget before either write can run. Fresh reads, not model narration, decide closure.”

When the result appears:

“The spreadsheet moved from version three to four with external access revoked. The queued message moved from version one to two and is cancelled. All 12 events are accounted for, both goals are satisfied, and the receipt has a replayable SHA-256 digest.”

### 1:45–2:20 · Restraint and stale-state recovery

**Show:** Pre-recorded terminal views or concise callouts for E3 and E4. Do not present edited fixture footage as a live model run; keep the runtime label visible.

**Say:**

“The happy path is only one condition. E3 repairs the spreadsheet but refuses to describe delivered mail as recalled, so closure is partial. E4 injects a disclosed external version bump after inspection. The write fails with `stale_revision`, both resources are re-inspected, one replacement plan is admitted, and the newer state is never overwritten.”

### 2:20–3:05 · Architecture and trust boundary

**Show:** The README architecture diagram, then the UI plan-gate and runtime-provenance panels.

**Say:**

“Counterstep begins with an exact Agent Receipt and deterministic findings. Google ADK gives Gemini five narrow tools and minimized inspected state. Gemini chooses a candidate recovery. Deterministic code owns citations, authority, versions, transitions, write budgets, idempotency, the action verdict, and closure. Firestore stores the resource history, approved plans, events, and final receipt. The deployed revision uses separate build and runtime identities with no Gemini API key.”

### 3:05–3:30 · Proof and reuse

**Show:** The Google Cloud evidence page, exact release SHA, green CI run, and origin/reuse disclosure.

**Say:**

“The exact source release passed 445 tests, five deterministic evaluations, eight production-repository emulator cases, a production build, and release/privacy scans. Managed Firestore passed six retained cases. Three Vertex-backed Gemini and ADK journeys produced digest-valid closures. Counterstep is new hackathon work built on a precisely disclosed Agent Receipt evidence foundation.”

### 3:30–3:45 · Close

**Show:** The repaired closure and the line `Every overstep gets a counterstep.`

**Say:**

“Observability can tell us an agent overstepped. Counterstep completes the bounded repair and leaves proof another operator can inspect.”

## Production and upload checklist

- Use the exact public URL <https://counterstep-27573808078.us-central1.run.app>.
- Check `/api/health` immediately before recording. It must report Cloud Run, reachable Firestore, Vertex AI, Gemini mode, Gemini 3.5 Flash Lite, and Google ADK TypeScript.
- Reset E1 before the take. Do not burn public runs on repeated rehearsal when fixture mode is enough.
- Keep the address bar or Cloud Run console proof visible in the continuous segment.
- Do not cut, speed up, or cover the live-action section. If any timing treatment is used elsewhere, label it.
- Keep runtime provenance visible when showing fixture footage.
- Add accurate English captions and review every technical term, count, and digest label.
- Use no private console identifiers beyond the public project/service evidence already recorded in the repository.
- [x] Export at or below 4:00 and watch the final file from start to finish.
- [x] Upload publicly to YouTube and verify playback, embedding, duration, and English captions while signed out.
- [x] Paste the final URL into [SUBMISSION.md](SUBMISSION.md#links) after the signed-out check.
- Paste the same URL into the Devpost form.
