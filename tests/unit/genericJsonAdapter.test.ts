import { describe, expect, it } from "vitest";

import {
  adaptGenericJson,
  inspectGenericJson,
  resolveJsonPointer,
  semanticValueKey,
} from "../../src/adapters/genericJson";
import { buildReceipt } from "../../src/core/receipt";
import type {
  AuthorityEnvelopeV1,
  GenericJsonMapping,
} from "../../src/core/schemas/index";

const genericDocument = {
  export: {
    actions: [
      {
        event: { uid: "action-2", at: "2026-08-28T18:00:02Z" },
        executor: { id: "codex" },
        action: "write_file",
        outcome: "ok",
        mutates: true,
        target: { system: "local-workspace", boundary: "on_device" },
        categories: ["source_code"],
      },
      {
        event: { uid: "action-1", at: "2026-08-28T18:00:01Z" },
        executor: { id: "codex" },
        action: "read_file",
        outcome: "ok",
        mutates: false,
        origin: { system: "local-workspace" },
        target: { boundary: "on_device" },
        categories: ["source_code"],
      },
    ],
  },
};

const mapping: GenericJsonMapping = {
  schemaVersion: "agent-receipt.generic-json-mapping.v1",
  recordsPointer: "/export/actions",
  run: {
    traceId: "generic-run-001",
    agent: { id: "codex", name: "Codex" },
    startedAt: "2026-08-28T18:00:00Z",
    completedAt: "2026-08-28T18:00:03Z",
    status: "succeeded",
  },
  fields: {
    sourceEventId: "/event/uid",
    timestamp: { pointer: "/event/at", format: "rfc3339" },
    actorId: { kind: "path", pointer: "/executor/id" },
    actorType: { kind: "constant", value: "agent" },
    operation: "/action",
    sourceSystem: "/origin/system",
    destinationSystem: "/target/system",
    destinationBoundary: "/target/boundary",
    dataCategories: "/categories",
    stateChange: "/mutates",
    status: "/outcome",
  },
  values: {
    operations: {
      "string:read_file": "read",
      "string:write_file": "update",
    },
    statuses: { "string:ok": "succeeded" },
    stateChanges: {
      "boolean:false": false,
      "boolean:true": true,
    },
    actorTypes: {},
    boundaries: { "string:on_device": "local" },
  },
};

const authority: AuthorityEnvelopeV1 = {
  schemaVersion: "agent-receipt.authority.v1",
  policyId: "generic-policy",
  task: "Read and update the local workspace.",
  permittedSystems: [{ systemId: "local-workspace", boundary: "local" }],
  permittedOperations: ["read", "update"],
  prohibitedDataCategories: [],
  externalEgressAllowed: false,
  approvalRequiredFor: [],
};

describe("explicit generic JSON adapter", () => {
  it("discovers nested and root record arrays without interpreting semantics", () => {
    const nested = inspectGenericJson(genericDocument);
    expect(nested.recordSets).toEqual([
      expect.objectContaining({
        pointer: "/export/actions",
        recordCount: 2,
      }),
    ]);
    expect(nested.recordSets[0]?.fieldPointers).toContain("/event/uid");
    expect(nested.recordSets[0]?.fieldPointers).toContain("/target/boundary");

    const root = inspectGenericJson(genericDocument.export.actions);
    expect(root.recordSets[0]).toEqual(
      expect.objectContaining({ pointer: "", label: "Root array", recordCount: 2 }),
    );
  });

  it("maps reviewer-confirmed paths and values, then orders canonical events by time", () => {
    const adapted = adaptGenericJson(genericDocument, mapping);

    expect(adapted.rawRecordCount).toBe(2);
    expect(adapted.adapter.events.map((event) => event.sourceEventId)).toEqual([
      "action-1",
      "action-2",
    ]);
    expect(adapted.adapter.events.map((event) => event.operation)).toEqual([
      "read",
      "update",
    ]);
    expect(adapted.adapter.events[0]?.destinationBoundary).toBe("local");
    expect(adapted.adapter.accounting).toEqual([
      expect.objectContaining({
        rawPointer: "/export/actions/0",
        status: "mapped",
        canonicalEventIds: ["evt-000002"],
      }),
      expect.objectContaining({
        rawPointer: "/export/actions/1",
        status: "mapped",
        canonicalEventIds: ["evt-000001"],
      }),
    ]);
  });

  it("keeps unmapped semantics material and unparsed instead of guessing", async () => {
    const partialDocument = structuredClone(genericDocument);
    partialDocument.export.actions[0]!.outcome = "mystery";
    const rawBytes = new TextEncoder().encode(JSON.stringify(partialDocument));

    const result = await buildReceipt({
      rawBytes,
      authority,
      genericJsonMapping: mapping,
    });

    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.receipt.coverage).toEqual(
      expect.objectContaining({ rawEvents: 2, mapped: 1, unparsed: 1 }),
    );
    expect(result.receipt.verdict).toBe("unable_to_assess_fully");
    expect(result.receipt.accounting[0]).toEqual(
      expect.objectContaining({
        status: "unparsed",
        material: true,
        reason: expect.stringContaining("No reviewer-confirmed status mapping"),
      }),
    );
  });

  it("retains the exact mapping manifest and hashes the unchanged source bytes", async () => {
    const rawBytes = new TextEncoder().encode(
      `${JSON.stringify(genericDocument, null, 2)}\n`,
    );
    const result = await buildReceipt({
      rawBytes,
      authority,
      genericJsonMapping: mapping,
    });

    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.receipt.verdict).toBe("within_declared_authority");
    expect(result.receipt.integrity.inputFormat).toBe("generic-json-records.v1");
    expect(result.receipt.integrity.adapterName).toBe(
      "genericJsonExplicitMapping",
    );
    expect(result.receipt.integrity.genericJsonMapping).toEqual(mapping);
    expect(result.retainedSource.bytes).toEqual(rawBytes);
    expect(result.retainedSource.rawDocument).toEqual(genericDocument);
  });

  it("rejects duplicate mapped source IDs without dropping either record", () => {
    const duplicateDocument = structuredClone(genericDocument);
    duplicateDocument.export.actions[1]!.event.uid = "action-2";
    const adapted = adaptGenericJson(duplicateDocument, mapping);

    expect(adapted.adapter.events).toHaveLength(0);
    expect(adapted.adapter.accounting).toHaveLength(2);
    expect(adapted.adapter.accounting.every((entry) => entry.status === "unparsed")).toBe(
      true,
    );
    expect(adapted.adapter.accounting[0]?.reason).toContain(
      "Duplicate source event ID",
    );
  });

  it("normalizes declared epoch timestamps and resolves evidence pointers safely", () => {
    const epochDocument = {
      records: [
        {
          id: 7,
          at: 1_788_000_001,
          actor: "codex",
          action: "read_file",
          outcome: "ok",
          mutates: false,
        },
      ],
    };
    const epochMapping: GenericJsonMapping = {
      ...mapping,
      recordsPointer: "/records",
      fields: {
        sourceEventId: "/id",
        timestamp: { pointer: "/at", format: "unix-seconds" },
        actorId: { kind: "path", pointer: "/actor" },
        actorType: { kind: "constant", value: "agent" },
        operation: "/action",
        stateChange: "/mutates",
        status: "/outcome",
      },
    };

    const adapted = adaptGenericJson(epochDocument, epochMapping);
    expect(adapted.adapter.events[0]?.timestamp).toBe(
      new Date(1_788_000_001_000).toISOString(),
    );
    expect(adapted.adapter.events[0]?.sourceEventId).toBe("7");
    expect(resolveJsonPointer(epochDocument, "/records/0/action")).toBe(
      "read_file",
    );
    expect(resolveJsonPointer(epochDocument, "/records/not-an-index")).toBeUndefined();
    expect(semanticValueKey(false)).toBe("boolean:false");
  });
});
