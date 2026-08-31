# Counterstep local live Gemini evidence

This record separates a real local Gemini/Google ADK execution from fixture,
emulator, managed-cloud, and deployed evidence. It contains no API key or other
credential.

## Evidence boundary

- Date observed: August 29, 2026 America/Los_Angeles (August 30 UTC)
- Command: `npm run eval:live`
- Runtime: local Next.js development server
- Repository: in-memory production contract implementation
- Agent framework: Google ADK for TypeScript
- Model: `gemini-3.5-flash-lite`
- Input: Counterstep's synthetic canonical incident only
- Billing tier: not asserted by this evidence
- Managed Firestore, Cloud Run, Secret Manager, and deployed behavior: not
  exercised or claimed

Each successful invocation passed the live evidence contract before its summary
was printed. That contract requires Gemini provenance, Google ADK, inspection of
every governed resource, an approved citation-closed plan, a contiguous event
ledger, exactly two authorized version-bound writes, satisfied cited closure
goals, the canonical evidence qualifier, an in-authority action receipt, a
matching downloaded closure, and a replayed SHA-256 closure digest.

## Successful executions

| Run ID | Status | Tool calls | Writes | Events | Closure digest | Action-receipt verdict |
|---|---:|---:|---:|---:|---|---|
| `run-98ade15e-92c9-4240-9035-265970a8d914` | `repaired` | 6 | 2 | 12 | `886dec5156dab484b3ac5d5cb1557dd7cd96f41c58e93f53c4f8d959229652b0` | `within_remediation_authority` |
| `run-6b82b80a-ba58-46b2-ba29-62e535450845` | `repaired` | 6 | 2 | 12 | `980bc4be9c7cab0c3913937bef35dce094b109b5b8b497e12648203806459dd1` | `within_remediation_authority` |
| `run-fbddda5a-a96c-4721-a5be-a0fe281c3b12` | `repaired` | 6 | 2 | 12 | `73f85e46864a3f9362a7ab85b0a3a410e1bd72a43372afcda38b404002ecf990` | `within_remediation_authority` |

The first downloaded closure receipt is retained at
[`evidence/live-gemini-closure-run-98ade15e.json`](./evidence/live-gemini-closure-run-98ade15e.json).

## Fail-closed diagnostic execution

One immediate additional invocation ended after the first model request without
producing an inspection, plan, tool call, write, or closure:

| Run ID | Status | Terminal reason | Tool calls | Writes | Recorded events |
|---|---|---|---:|---:|---:|
| `run-f68c8bd0-56b9-4d80-b14a-674b7355fe70` | `failed` | `agent_stopped_without_closure` | 0 | 0 | 1 failed system event |

Both governed resources remained at their original versions and states. The
observed evidence does not establish why the ADK stream stopped, so this record
does not label it as a quota or model failure. A later fresh invocation passed.

The evaluator and cloud smoke scripts now check the returned run for a closure
before requesting the receipt endpoint. A fail-closed terminal run therefore
reports its status, deterministic terminal reason, and write count directly
instead of being masked by a secondary `closure_not_found` response.

## What this proves and does not prove

This proves repeatable local Gemini planning and Google ADK orchestration through
Counterstep's deterministic server-bound tools and closure verifier. It also
proves that the observed no-closure attempt performed no consequential write.

It does not prove managed Firestore transaction behavior, Cloud Run service
identity or secret retrieval, deployed smoke behavior, public access, deployed
visual quality, or deployed accessibility. Those remain separate gates.
