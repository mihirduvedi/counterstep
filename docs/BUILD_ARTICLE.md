# What happens after an AI agent oversteps?

*I created this article for the purpose of entering Counterstep in the Google All Things Agentic Hackathon.*

Agent tooling has become very good at showing us what an agent did. A trace can show the model call, the tool request, the retry, and the final response. That still leaves an awkward operational problem when the run went too far.

Imagine a CRM-summary agent with a narrow assignment: analyze churn risk inside approved systems. The run finishes, but its trace shows two problems. Customer data landed in an externally shared spreadsheet, and a customer email was queued without approval. The trace establishes the overstep. It does not tell the person responsible for the run whether the spreadsheet is still shared, whether the message is still queued, or which cleanup action is safe now.

That is the gap I built Counterstep to close.

Counterstep starts after a completed run has already been reconciled against its authority. It binds a short-lived remediation authority to the exact source receipt, inspects the current state of the affected resources, and gives Gemini a small recovery vocabulary through Google ADK. Gemini can inspect a resource, submit a cited plan, revoke external access, cancel a queued delivery, and ask for closure verification.

Those tools are useful because the model can adapt its sequence to what it finds. They are deliberately narrow because the model is not allowed to define reality, grant itself authority, or mark its own work successful.

## The model plans; deterministic code decides

This separation became the central design decision.

Gemini 3.5 Flash Lite receives minimized incident facts and the inspected sandbox state. It chooses a recovery plan and cites the source event or finding behind every proposed step. Counterstep then checks that candidate against deterministic rules:

- Is the resource inside this receipt-bound remediation authority?
- Is the transition allowed for that resource?
- Does the step cite a known incident fact?
- Does its expected version exactly match the latest inspection?
- Does the plan stay inside the write, tool-call, and replan budgets?
- Is the write tied to an application-derived idempotency key?

A plan that sounds sensible can still fail this gate. It cannot become executable because the model insists that it is safe.

The same checks matter again when the write reaches persistence. Counterstep's Firestore transaction reads the current run, authority, approved plan, idempotency record, and resource version before applying the state transition. A UI check or an earlier plan decision is not enough protection if the state changed in between.

## The stale write that made the design honest

The most useful test in the project is E4, the stale-state replan.

Both demo resources begin in reversible states. Counterstep inspects them and Gemini produces the first candidate plan. The sandbox then applies one disclosed, atomic version bump to the spreadsheet as if another actor changed it. When Counterstep attempts the planned write, the ordinary version precondition returns `stale_revision`. Nothing is overwritten.

Counterstep does not patch the new version into the old arguments and retry. It re-inspects both governed resources, admits one replacement plan, and preserves both plans in the final history. The replacement may perform the two authorized repairs. If the write becomes stale again, the run blocks.

The injected mutation is not counted as an agent write and never appears in the remediation action receipt. That distinction lets the interface show a real concurrency failure without misrepresenting the evidence.

## Restraint is part of the product

The Recovery Test Rack has four declared conditions:

1. Canonical recovery applies two writes and verifies both goals.
2. Already-safe state performs zero writes.
3. Irreversible delivery repairs the spreadsheet but leaves the delivered message unresolved.
4. Stale-state replan refuses the stale write, re-inspects, and admits one replacement plan.

Before a run starts, the UI shows the expected outcome, successful remediation writes, replans, tool calls, and approved plans. Server-owned deterministic code computes those five values after the terminal state. `Contract matched` appears only when all five agree.

That scenario result is separate from closure. E3 can match its contract and still close `partially_repaired`, because a delivered message cannot honestly be described as recalled. The closure receipt keeps that goal unsatisfied and cites the final snapshot.

## Building the cloud path

Counterstep runs as one strict TypeScript application on Cloud Run. The public browser uses Next.js server routes. Google ADK binds Gemini function tools to the active run. Firestore stores synthetic demos, resource versions, inspections, approved plans, event ledgers, idempotency records, admission counters, and closure receipts.

The deployed service uses separate build and runtime service accounts. The runtime reaches Vertex AI and Firestore through workload identity; there is no Gemini API key in the Cloud Run revision. Minimum instances are zero, maximum instances are one, request concurrency is one, and an application counter admits at most ten runs per UTC day.

The first cloud attempt did not work. The Developer API backend returned HTTP 429 because its separate prepaid credits were depleted. Counterstep ended that run with zero tool calls and zero writes. I did not add a simulated success path or buy more credits. I moved the deployment to the allowed Vertex AI backend, verified the workload-identity path, and ran the strict smoke journey again.

## Keeping the evidence layers separate

The project has several kinds of proof, and they do not substitute for each other.

A deterministic fixture proves the shared orchestration, gates, tools, state changes, scenario assessment, and closure logic. The official local Firestore emulator exercises the production repository transaction code without claiming managed infrastructure. A retained-write suite in Cloud Build establishes managed Firestore behavior. Live Vertex-backed journeys establish Gemini and Google ADK behavior. Cloud Run health proves the exact deployed runtime contract. Rendered browser checks cover only the states and viewports that were actually inspected.

The exact source release passed 445 automated tests, five deterministic evaluation cases, eight production-repository emulator cases, a Next.js production build, strict TypeScript, ESLint, and release/privacy scans. Six retained production-adapter cases passed against managed Firestore. Three live Gemini and ADK journeys produced two authorized writes, 12 accounted events, and digest-valid closures.

## Reuse without pretending the clock restarted

Counterstep uses a disclosed foundation from an earlier project, Agent Receipt. That code preserves exact input bytes, accounts for raw events, evaluates the original authority deterministically, and produces the source receipt for the synthetic CRM run.

The recovery system is new hackathon work: the remediation authority, Gemini and Google ADK orchestration, five recovery tools, version and transition gates, Firestore repository, stale-state replan, event and plan history, scenario rack, closure receipt, deployed Vertex path, and focused tests.

Creating a new repository would not make the foundation new. The repository names the exact source commit and keeps the reused and new areas separate in `ORIGIN_AND_REUSE.md`.

## The result

Counterstep gives an AI operations manager a narrow answer to a difficult question: given this exact completed run, this remediation authority, and the state we can inspect now, what can still be repaired safely?

The model handles the part that benefits from reasoning. Deterministic code handles the parts that must remain true even when the model is wrong. The final receipt records the difference.

Project: <https://github.com/mihirduvedi/counterstep>

Live demo: <https://counterstep-27573808078.us-central1.run.app>

Submission video: <https://youtu.be/8Bh8_6sFMNc>
