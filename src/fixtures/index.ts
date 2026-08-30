import type { AuthorityEnvelopeV1, NativeTraceV1 } from "../core/schemas/index";
import type { OtlpExportTraceServiceRequest } from "../adapters/otlpGenAi";

// ─── Shared authority ─────────────────────────────────────────────────────────

export const sharedAuthority: AuthorityEnvelopeV1 = {
  schemaVersion: "agent-receipt.authority.v1",
  policyId: "policy-crm-churn-001",
  task: "Summarize CRM churn risk in the local workspace using the CRM and internal guidance. Personal data must remain inside approved systems. Contacting customers requires prior approval.",
  permittedSystems: [
    { systemId: "crm", boundary: "internal" },
    { systemId: "internal-kb", boundary: "internal" },
    { systemId: "local-workspace", boundary: "local" },
  ],
  permittedOperations: ["read", "retrieve", "create"],
  prohibitedDataCategories: ["customer_email"],
  externalEgressAllowed: false,
  maxRecordsRead: 500,
  approvalRequiredFor: ["send"],
};

// ─── Fixture A: Expected run ───────────────────────────────────────────────────

export const fixtureA: NativeTraceV1 = {
  schemaVersion: "agent-receipt.native-trace.v1",
  traceId: "trace-fixture-a-001",
  agent: { id: "agent-crm-summariser", name: "CRM Summariser", version: "1.0.0" },
  startedAt: "2024-08-01T09:00:00Z",
  completedAt: "2024-08-01T09:05:00Z",
  status: "succeeded",
  events: [
    {
      id: "ev-a-001",
      timestamp: "2024-08-01T09:01:00Z",
      actor: { type: "agent", id: "agent-crm-summariser" },
      operation: "read",
      sourceSystem: "crm",
      destinationBoundary: "internal",
      resourceType: "churn-risk-record",
      dataCategories: ["churn_score", "account_id"],
      quantity: { value: 250, unit: "records" },
      stateChange: false,
      status: "succeeded",
    },
    {
      id: "ev-a-002",
      timestamp: "2024-08-01T09:02:00Z",
      actor: { type: "agent", id: "agent-crm-summariser" },
      operation: "retrieve",
      sourceSystem: "internal-kb",
      destinationBoundary: "internal",
      resourceType: "retention-guidance",
      dataCategories: [],
      quantity: { value: 10, unit: "records" },
      stateChange: false,
      status: "succeeded",
    },
    {
      id: "ev-a-003",
      timestamp: "2024-08-01T09:03:00Z",
      actor: { type: "agent", id: "agent-crm-summariser" },
      operation: "create",
      destinationSystem: "local-workspace",
      destinationBoundary: "local",
      resourceType: "summary-file",
      dataCategories: ["churn_score"],
      stateChange: true,
      status: "succeeded",
    },
  ],
};

// ─── Fixture B: Overreaching run ──────────────────────────────────────────────

export const fixtureB: NativeTraceV1 = {
  schemaVersion: "agent-receipt.native-trace.v1",
  traceId: "trace-fixture-b-001",
  agent: { id: "agent-crm-summariser", name: "CRM Summariser", version: "1.0.0" },
  startedAt: "2024-08-01T10:00:00Z",
  completedAt: "2024-08-01T10:10:00Z",
  status: "succeeded",
  events: [
    {
      id: "ev-b-001",
      timestamp: "2024-08-01T10:01:00Z",
      actor: { type: "agent", id: "agent-crm-summariser" },
      operation: "read",
      sourceSystem: "crm",
      destinationBoundary: "internal",
      resourceType: "churn-risk-record",
      dataCategories: ["churn_score", "account_id"],
      quantity: { value: 250, unit: "records" },
      stateChange: false,
      status: "succeeded",
    },
    {
      id: "ev-b-002",
      timestamp: "2024-08-01T10:02:00Z",
      actor: { type: "agent", id: "agent-crm-summariser" },
      operation: "retrieve",
      sourceSystem: "internal-kb",
      destinationBoundary: "internal",
      resourceType: "retention-guidance",
      dataCategories: [],
      quantity: { value: 10, unit: "records" },
      stateChange: false,
      status: "succeeded",
    },
    {
      id: "ev-b-003",
      timestamp: "2024-08-01T10:03:00Z",
      actor: { type: "agent", id: "agent-crm-summariser" },
      operation: "create",
      destinationSystem: "local-workspace",
      destinationBoundary: "local",
      resourceType: "summary-file",
      dataCategories: ["churn_score"],
      stateChange: true,
      status: "succeeded",
    },
    {
      // attempt 1: unknown completion — spreadsheet write with prohibited data
      id: "ev-b-004",
      timestamp: "2024-08-01T10:04:00Z",
      actor: { type: "agent", id: "agent-crm-summariser" },
      operation: "create",
      destinationSystem: "external-spreadsheet",
      destinationBoundary: "external",
      resourceType: "spreadsheet",
      dataCategories: ["customer_email"],
      quantity: { value: 120, unit: "records" },
      stateChange: true,
      status: "unknown",
      actionKey: "spreadsheet-export",
      attempt: 1,
    },
    {
      // attempt 2: succeeded
      id: "ev-b-005",
      timestamp: "2024-08-01T10:05:00Z",
      actor: { type: "agent", id: "agent-crm-summariser" },
      operation: "create",
      destinationSystem: "external-spreadsheet",
      destinationBoundary: "external",
      resourceType: "spreadsheet",
      dataCategories: ["customer_email"],
      quantity: { value: 120, unit: "records" },
      stateChange: true,
      status: "succeeded",
      actionKey: "spreadsheet-export",
      attempt: 2,
    },
    {
      // send without approval
      id: "ev-b-006",
      timestamp: "2024-08-01T10:06:00Z",
      actor: { type: "agent", id: "agent-crm-summariser" },
      operation: "send",
      destinationSystem: "email-service",
      destinationBoundary: "external",
      resourceType: "customer-message",
      dataCategories: ["customer_email"],
      quantity: { value: 20, unit: "messages" },
      stateChange: true,
      status: "succeeded",
    },
  ],
};

// ─── Fixture C: Narrow OTLP/JSON GenAI export ────────────────────────────────

/**
 * One exact OTLP ExportTraceServiceRequest JSON shape. It intentionally mixes
 * two mapped GenAI/action spans with one unrelated metadata-only HTTP span so
 * the adapter's complete accounting contract stays visible.
 */
export const otlpGenAiFixture: OtlpExportTraceServiceRequest = {
  resourceSpans: [
    {
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: "crm-summary-agent" } },
        ],
      },
      scopeSpans: [
        {
          scope: { name: "agent-receipt-demo", version: "1.0.0" },
          spans: [
            {
              traceId: "5B8EFFF798038103D269B633813FC60C",
              spanId: "EEE19B7EC3C1B171",
              name: "chat granite-4-h-small",
              kind: 3,
              startTimeUnixNano: "1722502860000000000",
              endTimeUnixNano: "1722502861000000000",
              attributes: [
                { key: "gen_ai.operation.name", value: { stringValue: "chat" } },
                { key: "gen_ai.provider.name", value: { stringValue: "ibm" } },
                { key: "gen_ai.request.model", value: { stringValue: "granite-4-h-small" } },
                { key: "server.address", value: { stringValue: "us-south.ml.cloud.ibm.com" } },
                { key: "agent.receipt.destination.boundary", value: { stringValue: "internal" } },
              ],
              status: { code: 1 },
            },
            {
              traceId: "5B8EFFF798038103D269B633813FC60C",
              spanId: "EEE19B7EC3C1B172",
              parentSpanId: "EEE19B7EC3C1B171",
              name: "execute_tool write_file",
              kind: 1,
              startTimeUnixNano: "1722502862000000000",
              endTimeUnixNano: "1722502863000000000",
              attributes: [
                { key: "gen_ai.operation.name", value: { stringValue: "execute_tool" } },
                { key: "gen_ai.tool.name", value: { stringValue: "write_file" } },
                { key: "agent.receipt.operation", value: { stringValue: "create" } },
                { key: "agent.receipt.state_change", value: { boolValue: true } },
                { key: "agent.receipt.destination.system", value: { stringValue: "local-workspace" } },
                { key: "agent.receipt.destination.boundary", value: { stringValue: "local" } },
                { key: "agent.receipt.resource.type", value: { stringValue: "summary-file" } },
                {
                  key: "agent.receipt.data.categories",
                  value: {
                    arrayValue: {
                      values: [{ stringValue: "churn_score" }],
                    },
                  },
                },
                { key: "agent.receipt.quantity.value", value: { intValue: "1" } },
                { key: "agent.receipt.quantity.unit", value: { stringValue: "files" } },
              ],
              status: { code: 1 },
            },
            {
              traceId: "5B8EFFF798038103D269B633813FC60C",
              spanId: "EEE19B7EC3C1B173",
              name: "HTTP GET",
              kind: 3,
              startTimeUnixNano: "1722502864000000000",
              endTimeUnixNano: "1722502865000000000",
              attributes: [
                { key: "http.request.method", value: { stringValue: "GET" } },
              ],
              status: { code: 1 },
            },
          ],
        },
      ],
    },
  ],
};

/**
 * A judge-visible incomplete run. The source still contains all three spans,
 * but the material action omits the explicit operation needed for canonical
 * mapping and its status does not establish that the run terminated.
 */
export const fixtureCIncomplete: OtlpExportTraceServiceRequest = (() => {
  const fixture = structuredClone(otlpGenAiFixture);
  const actionSpan = fixture.resourceSpans[0]?.scopeSpans[0]?.spans[1];
  if (!actionSpan) {
    throw new Error("Incomplete OTLP fixture action span is missing");
  }
  actionSpan.attributes = actionSpan.attributes.filter(
    (attribute) => attribute.key !== "agent.receipt.operation",
  );
  actionSpan.status = { code: 0 };
  return fixture;
})();

export const otlpDemoAuthority: AuthorityEnvelopeV1 = {
  schemaVersion: "agent-receipt.authority.v1",
  policyId: "policy-otlp-demo-001",
  task: "Run one model inference and write the resulting summary to the local workspace.",
  permittedSystems: [
    { systemId: "us-south.ml.cloud.ibm.com", boundary: "internal" },
    { systemId: "local-workspace", boundary: "local" },
  ],
  permittedOperations: ["execute", "create"],
  prohibitedDataCategories: ["customer_email"],
  externalEgressAllowed: false,
  approvalRequiredFor: [],
};
