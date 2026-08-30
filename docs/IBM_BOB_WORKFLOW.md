# IBM Bob Development Workflow

## Short answer: can we use other AI tools?

Yes, as supporting tools. The live Wildcard requirements say that IBM Bob must be the **primary development tool** and that AI must be a core functional component. They also welcome open-source AI tools, APIs, integrations, and additional frameworks. The official rules describe other technologies being used in addition to Bob.

That is permission to supplement Bob, not to make Bob ceremonial. We should be able to show that Bob drove the core planning, implementation, testing, and refinement of Agent Receipt.

## What “Bob-primary” means for this team

- Start each trust-critical implementation slice in Bob Plan mode.
- Use Bob Agent mode or Bob Shell to implement the core schema, adapter, policy engine, Granite boundary, UI, and tests.
- Use Bob Ask mode for read-only code explanation, architectural questions, and diagnosing failures.
- Keep human review and tool approvals enabled for writes and terminal execution.
- Record material Bob sessions and their verified outputs in `docs/AI_ASSISTANCE_LOG.md`.
- Do not measure primacy by an invented percentage. Demonstrate it through meaningful artifacts: prompts, diffs, tests, and the development log.

Supporting AI tools may be used for current-source research, an independent code review, copy editing, visual critique, or a narrowly scoped second opinion. Record material contributions honestly. Never claim Bob generated work another tool produced.

## Codespaces and Bob

### Recommended remote workflow: Bob Shell inside the Codespace

The Codespace uses Node.js 24, which meets the current Bob Shell requirement. Bob Shell installation and authentication are intentionally manual because the installer downloads executable software, first use requires accepting IBM’s license, and login requires an IBMid or a user-created API key.

After the Codespace opens:

```bash
curl -fsSL https://bob.ibm.com/download/bobshell.sh | bash
bob chat
```

Review IBM’s installation command at <https://bob.ibm.com/docs/shell/getting-started/install-and-setup> before running it. Never put `BOB_API_KEY` in the repository, `.env.local`, devcontainer configuration, terminal transcript, screenshot, or demo video. Prefer interactive IBMid authentication for development.

Bob IDE is a standalone application rather than a normal VS Code/Codespaces extension. If the team prefers the IDE, clone the same GitHub repository in Bob IDE, work on feature branches, and push changes back to GitHub. Codespaces remains the reproducible build/test environment.

### Why Bob is not auto-installed by the devcontainer

- It requires an external download and interactive license acceptance.
- Authentication is teammate-specific.
- Codespaces configuration is public; credentials must never be baked into it.
- A failed vendor installer must not stop the repository from opening.

## First Bob session

1. Open the repository in Bob IDE or start `bob chat` from the repository root.
2. Confirm Bob can read `AGENTS.md`, `.bob/rules/00-agent-receipt.md`, and `docs/PRD.md`.
3. If using Bob IDE, run `/init` only after reviewing the files Bob proposes. Preserve the existing root `AGENTS.md` trust invariants; merge rather than overwrite them.
4. Use Ask mode: `Explain the product boundary and list the P0 trust invariants from @docs/PRD.md. Do not modify files.`
5. Use Plan mode: `Plan the August 26 schema, native adapter, digest, accounting, fixtures, and golden tests. Keep the plan within the PRD and identify every file you would change.`
6. Review the plan, then switch to Agent mode and implement only that daily slice.
7. Run `npm run verify`, inspect the diff, and log the session.

## Daily Bob protocol

### 1. Plan

Give Bob one bounded outcome, relevant PRD sections, acceptance criteria, allowed files, and the verification command. Ask it to identify assumptions before editing.

### 2. Implement

Use Agent mode. Approve read actions freely; review write and execute actions. Keep changes in one conceptual slice and require tests with behavior.

### 3. Ask and debug

If a test fails, switch to Ask mode first:

```text
Explain this failure using the relevant source and test files. Identify the smallest root-cause fix. Do not modify files.
```

Then return to Agent mode for the approved fix.

### 4. Verify

Require Bob to run the focused tests and then `npm run verify`. Manual UI claims must be labeled separately from automated evidence.

### 5. Log

Add one row to `docs/AI_ASSISTANCE_LOG.md` with date, tool/mode, task, affected files, human review, and verification. Keep prompts that demonstrate substantive Bob use, but never log secrets or private trace content.

## Recommended prompts by day

### August 26 — evidence foundation

```text
Use @docs/PRD.md sections 7, 11, and 12 as authoritative product requirements. Implement the Zod schemas, native v1 adapter, exact-byte SHA-256 digest, raw-event accounting, and the expected/overreach fixtures. Add golden tests. Do not implement UI or Granite. Unknown fields must remain unknown and no raw event may be silently dropped. Run focused tests and npm run verify.
```

### August 27 — deterministic policy

```text
Implement only the rule catalog and verdict precedence in @docs/PRD.md section 8. Write positive and negative tests for every rule. A retry after unknown completion must be described as a possible duplicate side effect, not a confirmed duplicate. Do not use an LLM anywhere in rule evaluation.
```

### August 28 — Granite boundary

```text
Implement the server-only Granite fact bundle, recursive redaction, generated-output Zod schema, citation and prohibited-claim validation, one repair attempt, eight-second timeout, and deterministic fallback from @docs/PRD.md section 9. Keep WATSONX_API_KEY server-only. Add mocked success, invalid JSON, unknown citation, timeout, and fallback tests.
```

### August 29 — review experience

```text
Build the manager-first intake, authority form, receipt overview, timeline, findings, coverage, evidence drawer, accessible system/data view, and JSON export from @docs/PRD.md section 10. Consume the golden receipt object rather than inventing data. Every claim and finding must open its canonical and raw evidence.
```

### August 30 — QA and release

```text
Audit the two end-to-end fixture flows against every P0 requirement in @docs/PRD.md. Fix functional, responsive, keyboard, focus, contrast, overflow, empty, error, and fallback states. Run npm run verify, report automated versus manual evidence separately, and update README only with claims the checks support.
```

## Using Codex, ChatGPT, Claude, Copilot, or other tools

Allowed supporting patterns:

- research that needs current sources;
- independent review of a Bob-produced diff;
- visual/accessibility critique;
- copy editing of README or demo script;
- narrow troubleshooting when Bob is blocked;
- brainstorming explicitly treated as unverified input.

Avoid:

- delegating most core implementation to another AI and calling Bob primary;
- hiding or misattributing generated work;
- pasting secrets, private logs, or IBM credentials into any model;
- accepting one model’s tests as proof without executing them;
- letting a model classify authority violations that the PRD assigns to deterministic rules.

## Evidence to preserve for judges

- `AGENTS.md` and `.bob/rules/` in version control
- Dated Bob entries in `docs/AI_ASSISTANCE_LOG.md`
- A few representative Bob prompts and their resulting tested commits
- README section explaining Bob’s development role and Granite’s runtime role
- Optional 5–10 second demo-video glimpse of Bob Plan/Agent workflow
- Actual test output and public repository history

Do not manufacture a Bob transcript or retroactively attribute earlier work to Bob.

## Current official-source basis

- The live Wildcard page says Bob is the primary development tool, AI is a core component, and additional technologies/frameworks are welcome: <https://aibuilderschallenge-bobhub.bemyapp.com/#/sponsors/3-wildcard-challenge-july-or-august>
- Official rules require Bob as a core component and permit additional IBM AI-supported technologies: <https://res.cloudinary.com/ideation/image/upload/q_100,f_pdf,dpr_auto/id-ibm-skillsbuil-3eec69/pkqvg8j3q3a4teedy1kd.pdf>
- Bob’s official quickstart describes Bob IDE as standalone and documents Ask, Plan, and Agent workflows: <https://bob.ibm.com/docs/ide/getting-started/quickstart>
- Bob Shell’s official installation guide currently requires Node.js 24 or later: <https://bob.ibm.com/docs/shell/getting-started/install-and-setup>

Rules can change during the contest. Recheck the live platform immediately before submission.
