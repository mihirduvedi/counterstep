# Counterstep Team Standards

## Product boundary

Build the P0 submission contract in `counterstep-planning/PRD.md`. The primary user is an AI operations manager restoring a known-safe state after a completed agent run exceeded authority. Do not widen the product into generic chat, live interception, universal rollback, production incident response, real customer integrations, compliance certification, or chain-of-thought capture.

## Trust invariants

- Preserve exact raw input bytes and compute their SHA-256 before normalization.
- Account for every raw event as mapped, metadata-only, or unparsed.
- Keep policy evaluation and verdict computation deterministic.
- Treat missing fields as unknown; never ask a model to infer them.
- Send only minimized, structured incident facts and inspected sandbox state to Gemini from server-only code.
- Reject generated claims without valid event/finding citations.
- Re-inspect current state before every consequential write.
- Keep remediation authority, transition admission, action-receipt verdict, and closure outcome deterministic.
- Require exact inspected versions and idempotency keys for every write.
- Without valid Gemini execution, fail closed and perform no write.
- Qualify closure as based on the supplied trace, remediation authority, recorded tool results, and final sandbox snapshots.

## Engineering rules

- TypeScript strict mode and Zod at all external boundaries.
- Add focused tests for every changed trust-critical behavior.
- Run `npm run verify` before declaring a slice complete.
- Separate automated evidence from manual, visual, deployed, and accessibility checks.
- Never commit `.env*`, credentials, real personal data, or private logs.
- Keep changes inside the current P0 slice and follow the PRD cut order.

## Reuse and hackathon evidence

Keep `ORIGIN_AND_REUSE.md` current. Preserve the pre-existing Agent Receipt history and attribution, distinguish reused foundation from Counterstep work, and record Google ADK/Gemini, Firestore, Cloud Run, automated, live, deployed, visual, and accessibility evidence separately.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
