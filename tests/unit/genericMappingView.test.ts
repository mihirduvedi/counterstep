import { describe, expect, it } from "vitest";

import { inspectGenericJson } from "../../src/adapters/genericJson";
import {
  collectGenericSemanticValues,
  createGenericJsonMappingDraft,
  refreshGenericValueMaps,
  validateGenericJsonMappingDraft,
} from "../../src/ui/genericMappingView";

const document = {
  export: {
    actions: [
      {
        event: { uid: "e-1", at: "2026-08-28T18:00:01Z" },
        executor: { id: "agent-1" },
        action: "read_file",
        outcome: "ok",
        mutates: false,
        target: { boundary: "on_device" },
      },
      {
        event: { uid: "e-2", at: "2026-08-28T18:00:02Z" },
        executor: { id: "agent-1" },
        action: "write_file",
        outcome: "ok",
        mutates: true,
        target: { boundary: "on_device" },
      },
    ],
  },
};

describe("generic mapping view model", () => {
  it("suggests common structural paths but leaves noncanonical meanings unconfirmed", () => {
    const draft = createGenericJsonMappingDraft(
      document,
      inspectGenericJson(document),
    );

    expect(draft.recordsPointer).toBe("/export/actions");
    expect(draft.fields.sourceEventId).toBe("/event/uid");
    expect(draft.fields.timestamp).toBe("/event/at");
    expect(draft.fields.actorId).toBe("/executor/id");
    expect(draft.fields.operation).toBe("/action");
    expect(draft.fields.status).toBe("/outcome");
    expect(draft.fields.stateChange).toBe("/mutates");
    expect(draft.values.operations).toEqual({
      "string:read_file": "",
      "string:write_file": "",
    });
    expect(draft.values.statuses).toEqual({ "string:ok": "" });
    expect(draft.values.stateChanges).toEqual({
      "boolean:false": false,
      "boolean:true": true,
    });
  });

  it("counts each distinct semantic value for the reviewer", () => {
    expect(
      collectGenericSemanticValues(
        document,
        "/export/actions",
        "/outcome",
      ),
    ).toEqual([{ key: "string:ok", label: '"ok"', count: 2 }]);
  });

  it("builds a valid preview only after required run and semantic choices exist", () => {
    let draft = createGenericJsonMappingDraft(
      document,
      inspectGenericJson(document),
    );
    expect(validateGenericJsonMappingDraft(document, draft).ok).toBe(false);

    draft.run = {
      traceId: "trace-1",
      agentId: "agent-1",
      agentName: "Example agent",
      agentVersion: "",
      startedAt: "2026-08-28T18:00:00Z",
      completedAt: "2026-08-28T18:00:03Z",
      status: "succeeded",
    };
    draft.fields.actorType = "agent";
    draft.values.operations = {
      "string:read_file": "read",
      "string:write_file": "update",
    };
    draft.values.statuses = { "string:ok": "succeeded" };
    draft.values.boundaries = { "string:on_device": "local" };
    draft = refreshGenericValueMaps(document, draft);

    const result = validateGenericJsonMappingDraft(document, draft);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview).toEqual({
      rawRecords: 2,
      mapped: 2,
      unparsed: 0,
      reasons: [],
    });
    expect(result.mapping.values.operations).toEqual(draft.values.operations);
  });

  it("allows a partial map but exposes every remaining record as unparsed", () => {
    const draft = createGenericJsonMappingDraft(
      document,
      inspectGenericJson(document),
    );
    draft.run = {
      traceId: "trace-1",
      agentId: "agent-1",
      agentName: "",
      agentVersion: "",
      startedAt: "2026-08-28T18:00:00Z",
      completedAt: "",
      status: "unknown",
    };
    draft.fields.actorType = "agent";
    draft.values.operations["string:read_file"] = "read";
    draft.values.statuses["string:ok"] = "succeeded";
    draft.values.boundaries["string:on_device"] = "local";

    const result = validateGenericJsonMappingDraft(document, draft);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview).toEqual(
      expect.objectContaining({ rawRecords: 2, mapped: 1, unparsed: 1 }),
    );
    expect(result.preview.reasons[0]).toContain(
      "No reviewer-confirmed operation mapping",
    );
  });
});
