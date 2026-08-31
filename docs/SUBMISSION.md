# Counterstep submission copy

Paste-ready material for the Google All Things Agentic Hackathon. The finished public YouTube video and repository fallback are ready. The team line reflects the repository's sole author; adjust it only if the actual Devpost team includes another eligible member.

## Project title

Counterstep

## One-line pitch

Counterstep safely cleans up after an AI agent overreaches and proves what it repaired.

## Category

Taskmaster

## Short description

An agent can finish a task and still leave a human operator with dangerous cleanup work. Counterstep starts from an evidence-linked receipt for a completed run, checks what is true now, asks Gemini to choose a bounded recovery plan, and passes every proposed action through deterministic authority and version gates. It applies only approved reversible changes, re-reads the final state, and produces a closure receipt that says exactly what was repaired and what remains unresolved.

## Inspiration

Agent observability is good at answering “what happened?” It is much less helpful with the next operational question: what can still be undone safely?

The demo begins after a synthetic CRM-summary agent exceeded its authority. Restricted customer data remains in an externally shared spreadsheet, and a customer email was queued without approval. A human could inspect both systems, reason through retries and stale state, make the corrections, and document the result. Counterstep turns that manual cleanup into one evidence-bound recovery run.

## What it does

The Recovery Test Rack exposes four conditions before the agent starts:

- **E1 Canonical recovery:** revoke external spreadsheet access and cancel a queued message.
- **E2 Already safe:** inspect both resources and perform zero unnecessary writes.
- **E3 Irreversible delivery:** repair the spreadsheet but leave the delivered message explicitly unresolved.
- **E4 Stale-state replan:** refuse a stale write, re-inspect both resources, admit one replacement plan, and finish without overwriting newer state.

Each condition declares its expected outcome, successful write count, replan count, tool-call count, and approved-plan count. After the run, server-owned deterministic code computes the observed values. `Contract matched` appears only when all five agree.

For every consequential write, Counterstep requires a cited approved step, the exact inspected resource version, an allowed state transition, remaining authority budget, and an application-derived idempotency key. A stale version cannot be overwritten. Closure is computed from fresh sandbox snapshots and recorded tool results rather than from the model's narration.

## How it was built

Counterstep is a strict TypeScript application on Next.js 16.3.3. The browser talks only to server routes running on Cloud Run. Google ADK for TypeScript binds Gemini 3.5 Flash Lite to five narrow function tools: inspect a resource, submit a plan, revoke external access, cancel a queued delivery, and verify closure.

Gemini receives minimized incident facts and inspected sandbox state. It can choose and sequence a recovery, but deterministic code owns policy evaluation, plan admission, write authority, stale-version handling, the action-receipt verdict, and the closure outcome.

Firestore persisted the recorded live-evidence demos, resource versions, approved plans, event ledgers, idempotency records, daily admission counters, and closure receipts. That revision used Vertex AI and Firestore through separate workload identities and contained no Gemini API key. The current public revision is the same application image in deterministic fixture/memory mode.

The repository includes a credential-free fixture mode, deterministic evaluation cases, a production Firestore adapter suite against the official local emulator, an opt-in retained-write managed Firestore harness, strict cloud smoke checks, and a release/privacy audit.

## Architecture

The complete diagram is rendered in the [README](../README.md#architecture). In one line:

`Agent Receipt evidence → fresh inspection → Gemini/ADK candidate plan → deterministic gate → version-pinned idempotent tools → Firestore event ledger → fresh deterministic closure`

## Technologies used

- Gemini 3.5 Flash Lite on Vertex AI
- Google Agent Development Kit for TypeScript
- Google Cloud Run
- Google Cloud Firestore
- Cloud Build and Artifact Registry
- Next.js 16.3.3, React 19, TypeScript 6, and Zod 4
- Vitest and the official Firestore emulator

## Other data sources

Counterstep uses only disclosed synthetic data. The seeded incident comes from the Agent Receipt foundation and describes a fictional CRM churn-analysis run, spreadsheet, and customer message. No real customer data, email, spreadsheet, or private agent log is used in the demo.

## Challenges

The hardest part was keeping the model useful without letting it define reality or authority. Tool calls need enough context for Gemini to recover the incident, but a plausible plan is still unsafe if its citations, version, resource, transition, or budget are wrong. The implementation therefore separates model planning from deterministic admission and repeats critical checks inside the repository transaction.

Stale state exposed another edge. Counterstep cannot retry a rejected write with a new version and call that safe. It must re-inspect every governed resource, admit one replacement plan, preserve both plans in the receipt, and block if the second attempt also becomes stale.

The cloud path also failed honestly before it succeeded. The first Developer API deployment hit depleted prepaid credits and ended with zero writes. The recorded live-evidence deployment then used Vertex AI workload identity, with separate build and runtime service accounts and no deployed API key. After the live proof and video were captured, the public service was deliberately switched to deterministic fixture mode with in-memory synthetic state, and the runtime identity's Vertex AI and Firestore roles were removed so judge traffic cannot consume managed model or database quota.

## Accomplishments

- Four judge-selectable recovery conditions use the same P0 service and authority boundary.
- E4 causes a real atomic sandbox version bump, a real `stale_revision` refusal, full re-inspection, and one bounded replan.
- E3 closes `partially_repaired` and never describes a delivered message as recalled.
- The exact release passes 445 automated tests, a strict production build, release/privacy scans, five deterministic evaluation cases, and eight production-repository emulator cases.
- Six retained production-adapter cases passed against managed Firestore.
- Three live Gemini/ADK/Vertex journeys passed with six bounded tool calls, two authorized writes, 12 accounted events, and digest-valid closures.
- The exact-source Cloud Run image is bound to release commit `5890e2b09049564130428f3d6cc4a768b221b180`; current public revision `counterstep-00006-6nd` serves that image as a quota-isolated synthetic fixture, while the video and evidence record retain the live Gemini/ADK/Vertex/Firestore proof.

## What was learned

The recovery agent became more dependable as its freedom narrowed. A small tool vocabulary, explicit authority tuple, immutable plan history, and fresh reads made failures explainable. They also made the live demo easier to judge because every claim has a visible event, state version, or receipt field behind it.

The evidence layers also need separate names. A fixture proves deterministic orchestration. An emulator exercises production transaction code locally. Managed Firestore proves cloud persistence. A live model run proves Gemini and ADK behavior. A screenshot proves only what was rendered. Counterstep records those layers separately instead of letting one stand in for another.

## Reuse disclosure

Counterstep is a new remediation layer built during the hackathon on a disclosed Agent Receipt foundation from commit `296df0798fd49fa52658c0c813bfabef2dc75d10`. The foundation supplies exact-byte trace hashing, canonical event accounting, deterministic policy findings, the original receipt, and the synthetic CRM fixture. Counterstep's autonomous remediation, Google ADK/Gemini integration, deterministic recovery authority, transactional tools, Firestore persistence, Recovery Test Rack, closure receipt, cloud deployment, and related tests are new work. Full details are in [ORIGIN_AND_REUSE.md](../ORIGIN_AND_REUSE.md).

## Testing instructions

### Fastest judge path

1. Open <https://counterstep-27573808078.us-central1.run.app>.
2. Select **E4 Stale-state replan**.
3. Press **Run Counterstep** once and wait for the terminal state.
4. Confirm `Contract matched`, one failed `stale_revision` write, two approved plans, two successful remediation writes, 10 tool calls, 20/20 accounted events, and a digest-bearing `repaired` closure.

The public service is a deterministic in-memory fixture with a small daily run cap. It exercises the same gate, tools, event accounting, scenario assessor, and closure contracts without invoking Gemini or Firestore. The video and repository evidence remain the authoritative live-model and managed-service proof.

### Credential-free local path

```bash
git clone https://github.com/mihirduvedi/counterstep.git
cd counterstep
npm ci
cp .env.example .env.local
npm run dev
```

In `.env.local`, set `COUNTERSTEP_AGENT_MODE` to `fixture` and
`COUNTERSTEP_REPOSITORY` to `memory`; leave credential fields blank. Open
<http://localhost:3000>. Fixture mode exercises the same deterministic gate,
tools, state transitions, event accounting, scenario assessor, and closure
evaluator. The UI labels it clearly because it does not prove a live Gemini run.

### Verification commands

```bash
npm run verify
npm run eval
npm run test:firestore
```

`npm run test:firestore` also needs Java 21 or newer. Exact managed and deployed evidence is recorded in [docs/GOOGLE_CLOUD_DEPLOYMENT_EVIDENCE_2026-08-31.md](GOOGLE_CLOUD_DEPLOYMENT_EVIDENCE_2026-08-31.md).

## Links

- Public synthetic demo: <https://counterstep-27573808078.us-central1.run.app> (`fixture` / `memory`; no Gemini or Firestore quota)
- Repository: <https://github.com/mihirduvedi/counterstep>
- Demo video, four minutes maximum: <https://youtu.be/8Bh8_6sFMNc> (signed-out playback, embedding, duration, and English captions verified August 31, 2026)
- Team members: Mihir Duvedi

## Final submission check

- Select exactly one category: **Taskmaster**.
- Confirm the listed team member is eligible and signed into the intended Devpost account.
- Confirm the public repository opens while signed out.
- Check the public synthetic demo, repository, architecture diagram, video, and every linked evidence page while signed out.
- Keep the video at or below four minutes, public on YouTube or Vimeo, and in English or captioned in English.
- Preserve one continuous, unedited live-action segment and show the `.run.app` URL or Google Cloud console proof in the video.
- If using the optional bonuses, publish [BUILD_ARTICLE.md](BUILD_ARTICLE.md) on a public platform with its hackathon-purpose disclosure, publish [SOCIAL_POST.md](SOCIAL_POST.md) with `#AllThingsAgenticHackathon`, and add both public URLs to the Devpost form.
- If the actual Devpost team includes another eligible member, add that person before submission. Search the tracked repository for placeholders and stale challenge names.
- Submit before August 31, 2026 at 5:00 PM Pacific Time.
- After submission, do not change the repository, video, or submitted app through the judging period. Use a separate fork for later work.
