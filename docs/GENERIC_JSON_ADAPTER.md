# Use a JSON export from another agent

Agent Receipt can review a completed log even when it does not use Native Trace v1 or the documented OTLP/JSON profile. Upload or paste a record-oriented JSON document in the live app, select the array that represents actions, and confirm how the exporter's fields and values should map into the receipt.

The mapping step is part of the working product, not a test-only conversion script. It lets the same review pipeline handle different field names and nesting without asking Granite or another model to guess what vendor-specific fields mean. The confirmed mapping is validated, versioned, and retained with the receipt.

A log still needs explicit facts such as time, operation, outcome, actor, and state-change semantics. Changing the structure cannot recover facts that the exporter did not record. Missing or ambiguous meanings remain unknown or material-unparsed.

## When this is useful

Use this path when an agent platform, workflow runner, or internal tool exports a JSON object or array with one record per action, but its schema differs from Agent Receipt's native format. For example, `action_name`, `result_code`, and `side_effect` can be mapped to canonical operation, status, and state-change fields after the reviewer checks the exporter's documentation.

Use preprocessing or a dedicated adapter when the source is JSONL, binary telemetry, a free-form conversation transcript, a mixed bundle of several runs, or a format that hides important semantics in prose. The generic adapter generalizes record structure; it does not claim universal log understanding.

## Accepted generic shape

- One UTF-8 JSON document up to 2 MiB.
- The root may be an array of record objects, or an object containing one or more non-empty record arrays.
- The intake inspector searches record containers up to four object levels deep.
- One record array is selected per receipt. Each item is treated as a potentially material action record.
- JSONL, YAML, ZIP, binary protobuf, remote URLs, and multiple runs in one receipt remain unsupported.

The original file is not wrapped or rewritten. Agent Receipt snapshots and hashes the exact uploaded bytes before decoding or mapping them.

## Mapping workflow

When an uploaded or pasted document is not Native Trace v1 or the supported OTLP shape, the app opens **Explicit mapping**:

1. Select the array that contains action records.
2. Enter run identity, agent identity, start time, optional completion time, and the run status established by the exporter.
3. Confirm JSON Pointer paths for timestamp, actor, operation, outcome, and state change. Event ID is optional but strongly recommended for approval and evidence linkage.
4. Translate every distinct observed operation, outcome, state-change, and actor-type value into the canonical receipt vocabulary.
5. Optionally map systems, destination boundary, resource type, data categories, quantity, approval reference, action key, retry number, and tool name.
6. Review the deterministic preview. It shows selected, mapped, and material-unparsed counts before authority review.
7. Continue to the normal authority envelope and build the receipt.

Blank or unknown semantic translations do not disappear. Their records become material-unparsed and force `unable_to_assess_fully` as long as at least one other record maps. If zero records map, receipt generation is blocked because cited receipt copy would have no canonical evidence.

## Mapping contract

The versioned manifest is `agent-receipt.generic-json-mapping.v1`. It uses RFC 6901 JSON Pointers so nested keys and escaped `/` or `~` characters are unambiguous.

```json
{
  "schemaVersion": "agent-receipt.generic-json-mapping.v1",
  "recordsPointer": "/activity_log",
  "run": {
    "traceId": "run-123",
    "agent": { "id": "agent-7" },
    "startedAt": "2026-08-28T18:00:00Z",
    "status": "unknown"
  },
  "fields": {
    "sourceEventId": "/record/uid",
    "timestamp": { "pointer": "/record/at", "format": "rfc3339" },
    "actorId": { "kind": "path", "pointer": "/principal/id" },
    "actorType": { "kind": "constant", "value": "agent" },
    "operation": "/action_name",
    "stateChange": "/side_effect",
    "status": "/result_code"
  },
  "values": {
    "operations": { "string:file.write": "update" },
    "statuses": { "string:ok": "succeeded" },
    "stateChanges": { "boolean:true": true },
    "actorTypes": {},
    "boundaries": {}
  }
}
```

Typed map keys prevent collisions between JSON values such as the string `"true"` and the boolean `true`:

- `string:ok`
- `boolean:true`
- `number:200`
- `null:null`

The UI builds these keys from observed scalar values. Object or array values cannot serve as operation, status, actor-type, state-change, or boundary tokens.

## Canonical semantics

| Meaning | Supported values |
|---|---|
| Operation | `read`, `retrieve`, `create`, `update`, `delete`, `send`, `execute`, `approve`, `error`, `unknown` |
| Event status | `started`, `succeeded`, `failed`, `cancelled`, `unknown` |
| Actor type | `agent`, `workflow`, `tool`, `human` |
| Destination boundary | `local`, `internal`, `external`, `unknown` |
| Timestamp | RFC 3339 with timezone, Unix seconds, Unix milliseconds, or Unix nanoseconds |
| State change | Explicit reviewer mapping to boolean `true` or `false` |

Epoch timestamps are deterministically normalized to RFC 3339 millisecond precision and carry an adapter warning. Data categories may be a string or an array of strings. The adapter never scans prompts, tool output, or free-form text to invent categories, boundaries, approvals, quantities, or operations.

## Accounting and receipt integrity

Every selected array item receives exactly one accounting entry:

- `mapped` — produced one canonical event;
- `unparsed` — could not satisfy the confirmed mapping, with a concrete reason.

Generic records are never automatically labeled metadata-only because selecting the array asserts that its items are action records. A primitive array item, duplicate mapped source ID, missing required field, unmapped semantic value, invalid timestamp, or invalid canonical field becomes material-unparsed.

The exported receipt records:

- SHA-256 and byte length of the unchanged source file;
- `generic-json-records.v1` input format;
- `genericJsonExplicitMapping` adapter name and version;
- the complete validated generic mapping manifest;
- JSON Pointer evidence links back to the retained source while the browser session remains open.

The standalone receipt export does not include the original log. A later reviewer needs both the receipt and the exact source file to independently repeat source-to-canonical adaptation. Evidence-packet verification proves internal packet consistency, not trusted capture, authorship, or real-world completeness.

## Included record-oriented example

Two files demonstrate the same ten-action Codex release run without using Agent Receipt's native event shape. They make the workflow repeatable for tests and judges; the live upload screen accepts another compatible exporter in the same way.

- [`examples/codex-policy-ledger-release-generic-log.json`](../examples/codex-policy-ledger-release-generic-log.json) — vendor-shaped raw log;
- [`examples/codex-policy-ledger-release-generic-mapping.json`](../examples/codex-policy-ledger-release-generic-mapping.json) — exact mapping manifest.

The focused test loads both files through the real `buildReceipt` pipeline. The public deployment was also exercised through the browser upload and mapping flow. With the declared release authority, all 10 records map and the deterministic result is `within_declared_authority` with zero findings. This establishes the included example and the live custom-log path. It does not establish that every agent exporter records the facts needed for an authority review.

### Test the example in the UI

1. Open **Review a trace** and upload `examples/codex-policy-ledger-release-generic-log.json`.
2. Keep `/activity_log` as the selected record array.
3. Enter the run facts shown in the companion mapping file. The required field suggestions should select `/record/uid`, `/record/at`, `/principal/id`, `/action_name`, `/result_code`, and `/side_effect`; choose **Read from each record** for actor type and select `/principal/kind`.
4. Translate the observed values exactly as shown in `codex-policy-ledger-release-generic-mapping.json`. Expand **Map additional policy evidence** and copy its optional field paths and boundary translations.
5. Confirm that the preview says **Selected 10 · Mapped 10 · Unparsed 0**, then continue.
6. Set policy ID `policy-codex-release-001` and task `Inspect and improve Agent Receipt, verify the exact candidate, then commit, push, and deploy only after explicit human approval.`
7. Add permitted systems: `local-workspace` (local), `local-shell` (local), `git-local` (local), `github` (external), `github-actions` (external), and `vercel` (external).
8. Permit `read`, `retrieve`, `create`, `update`, `send`, `execute`, and `approve`; allow external egress; require approval for `send`; leave prohibited categories and maximum records blank.
9. Build the receipt. The expected deterministic result is **Within declared authority**, 10 mapped source records, zero unparsed records, and zero findings.

## Honest limits

The adapter cannot establish facts that the source did not record. In particular, it cannot prove that the log captured every real action, infer authority from behavior, reconstruct hidden reasoning, recognize undocumented tool semantics, or decide whether an ambiguous field really means external egress. The reviewer must use the exporter's real schema documentation. Every conclusion remains qualified: based on the supplied trace and authority envelope.
