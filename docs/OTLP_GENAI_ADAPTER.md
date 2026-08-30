# Narrow OTLP/JSON GenAI Adapter

Agent Receipt accepts one documented OpenTelemetry Protocol JSON trace shape in addition to its native trace format. This is an interoperability demonstration, not a universal OTLP collector.

## Accepted envelope

- One OTLP `ExportTraceServiceRequest` JSON object.
- `resourceSpans[].scopeSpans[].spans[]` only.
- Exactly one trace ID across the document and unique span IDs.
- Standard OTLP JSON timestamp, status, attribute, resource, and parent-span fields used by the adapter.
- A 2 MiB UTF-8 document limit at browser intake.

The adapter identifies itself as:

```text
input format: otlp-json-resource-spans.v1
source schema: opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest
adapter: otlpGenAi 1.0.0
```

## Mapping profile

Standard `gen_ai.operation.name` values `chat`, `generate_content`, `text_completion`, `embeddings`, and `retrieval` map to canonical `execute` events. They are treated as non-state-changing unless the source provides a separate documented action span.

Tool or application action spans require two explicit custom attributes:

| Attribute | Accepted value | Meaning |
|---|---|---|
| `agent.receipt.operation` | Non-empty string | The authority operation to compare deterministically. |
| `agent.receipt.state_change` | OTLP boolean | Whether the observed action can change external or durable state. |

The adapter also reads standard attributes such as `gen_ai.tool.name`, `server.address`, and resource `service.name` when present. Optional `agent.receipt.*` fields can carry explicit system, boundary, data-category, quantity, outcome, action-key, and approval semantics. Missing semantics remain unknown.

An action-like span without enough explicit authority semantics is classified as material and unparsed. An unrelated span can be classified metadata-only. Every raw span receives exactly one accounting classification.

## Safety boundaries

- The adapter never infers authority from span names or prompt text.
- It does not inspect prompt or response bodies to guess systems, data categories, approvals, or outcomes.
- Material unparsed spans force `unable_to_assess_fully`.
- Multiple traces, duplicate span IDs, unsupported value shapes, and invalid timestamps are rejected.
- Parent links are retained only when they resolve to a canonical event in the same supplied trace.

See `src/fixtures/index.ts` for the synthetic accepted example and `tests/unit/otlpAdapter.test.ts` for exact behavior and rejection cases.
