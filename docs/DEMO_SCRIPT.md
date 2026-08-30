# Agent Receipt three-minute judge demo

Target length: 2 minutes 58 seconds. Record at 1280 × 720 or higher. Keep the browser zoom at 100%, hide personal bookmarks and notifications, and use only the repository's public example data.

## Shot plan and narration

### 0:00–0:16 — The accountability gap

**Show:** Landing page and **Upload JSON**.

**Say:**

“An AI agent can report success while leaving its manager with a harder question: did it do only what I authorized? Agent Receipt lets me upload the agent's JSON log and review the completed run against the authority it was given.”

### 0:16–0:42 — Bring a JSON log from another agent

**Show:** Upload `examples/codex-policy-ledger-release-generic-log.json`. Select `/activity_log`, show the discovered paths and value translations, then jump to the completed preview: **Selected 10 · Mapped 10 · Unparsed 0**.

**Say:**

“This file does not use Agent Receipt's own schema. The live app finds its action array, and I confirm where timestamps, operations, outcomes, actors, systems, and approvals live. The preview accounts for all ten records before review. The mapping stays with the receipt; no model guesses what these fields mean.”

### 0:42–0:58 — Declare authority and build the receipt

**Show:** Continue to the authority step, point to systems, operations, egress, and approvals, then build the receipt. Land on the clean verdict and ten-of-ten coverage.

**Say:**

“Authority is entered separately; it is never inferred from the log. This uploaded run maps all ten records and stays within the supplied envelope. That is a qualified result based on this file and this authority, not a claim that the exporter captured everything.”

### 0:58–1:24 — The overreaching run

**Show:** Start a new review, select **Overreaching run**, continue, and build. Open **Policy checks**, then land on the verdict and incident brief.

**Say:**

“Now the same task includes an external spreadsheet attempt with an unknown outcome, a retry, and an unapproved customer-email send. The ledger shows six deviating checks beside three that produced no finding. Twelve findings become two cited incidents without hiding the full policy record.”

### 1:24–1:42 — Evidence, not a risk score

**Show:** Open one incident's evidence, point to the finding, canonical event, and retained raw object, then close the drawer.

**Say:**

“This is not an unexplained risk score. Every material claim opens into its deterministic finding, normalized event, and retained source object. Unknown stays unknown, including the first spreadsheet attempt.”

### 1:42–2:00 — Make the model boundary visible

**Show:** Open **AI boundary**, point to the fallback or Granite status, the three deterministic gates, and the omitted-field list. Expand the JSON only if the recording remains readable.

**Say:**

“The interface shows exactly what Granite can receive. Raw event bodies, source pointers, and policy comparison values stay out. Granite may select up to five known finding IDs; deterministic code renders the cited text or falls back safely.”

### 2:00–2:15 — Recovery without hidden execution

**Show:** Open **Recovery plan**, scan the required-authority and reversibility labels, then use the decision section to download the complete evidence packet.

**Say:**

“Agent Receipt proposes cited follow-up steps, but it never executes them. The complete packet includes a Recovery Plan v1 artifact that is citation-closed and SHA-256-bound to this receipt. Current state stays unknown, execution authority was not granted, and approval is required.”

### 2:15–2:33 — Refuse to overclaim

**Show:** Start a new review with **Incomplete OTLP run**, build it, then open **Evidence gaps** and the unparsed source record.

**Say:**

“A trustworthy reviewer also needs to know when the evidence is not enough. This OTLP run accounts for all three source spans, but one material action lacks an explicit operation and the run has no terminal status. Agent Receipt refuses a clean or violation verdict, names the evidence needed, and still opens the exact raw-only span.”

### 2:33–2:53 — Carry and verify the complete handoff

**Show:** Switch to **Verify an export** and choose **Verify evidence packet**. Point to PASS, the three-artifact summary, and the manifest, receipt-replay, and recovery-binding gates.

**Say:**

“One file now carries the manager brief, validated receipt, and cited recovery plan. The browser-only verifier hashes the exact packet, replays all three artifacts, then reruns the receipt and recovery binding. It proves internal consistency, not who created the file or whether the trace was complete.”

### 2:53–2:58 — Close

**Show:** Integrity strip or README architecture section.

**Say:**

“IBM Bob built the trust-critical foundation. Agent Receipt works with the JSON evidence teams already have, shows where that evidence stops, and keeps the complete handoff checkable.”

## Mapping setup before recording

Rehearse the generic mapping from `docs/GENERIC_JSON_ADAPTER.md` before recording. Keep the upload and array-selection interaction visible, then use a clean jump cut after enough of the field and value mapping is shown to establish that it is a real workflow. Do not make viewers watch every dropdown. The final preview must visibly report **Selected 10 · Mapped 10 · Unparsed 0**.

The narration should say that the included file makes the demo reproducible and that another record-oriented exporter follows the same workflow with its own documented paths and values. Do not say “any JSON.” Free-form transcripts, JSONL, binary telemetry, mixed multi-run bundles, and logs without explicit meanings still need preprocessing or a dedicated adapter.

## Recording checks

- Keep the final cut at or below three minutes, including title and end cards.
- Make the pointer movement slow enough to follow and remove dead time from mapping and between review states.
- Ensure the selected array, 10/10 mapping preview, policy outcome register, evidence drawer, AI boundary labels, Evidence Gap ledger, packet summary, verifier gates, and export status are legible at the uploaded resolution.
- Do not show `.env.local`, browser autofill, terminal history, account dashboards, private repository controls, or real traces.
- Add captions and verify them manually against the spoken words.
- Upload publicly, then test playback and all project links while signed out.
