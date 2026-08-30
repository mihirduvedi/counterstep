import { describe, it, expect } from "vitest";
import { adaptNativeTrace } from "../../src/adapters/nativeTrace.js";
import { NativeTraceV1Schema } from "../../src/core/schemas/index.js";
import type { CanonicalEvent, NativeTraceV1, RawEventAccounting } from "../../src/core/schemas/index.js";

const BASE_TRACE: NativeTraceV1 = {
  schemaVersion: "agent-receipt.native-trace.v1",
  traceId: "trace-test-001",
  agent: { id: "agent-test" },
  startedAt: "2024-01-01T00:00:00Z",
  status: "succeeded",
  events: [
    {
      id: "ev-001",
      timestamp: "2024-01-01T00:01:00Z",
      actor: { type: "agent", id: "agent-test" },
      operation: "read",
      sourceSystem: "crm",
      destinationBoundary: "internal",
      dataCategories: ["pii"],
      stateChange: false,
      status: "succeeded",
      quantity: { value: 50, unit: "records" },
    },
    {
      id: "ev-002",
      timestamp: "2024-01-01T00:02:00Z",
      actor: { type: "agent", id: "agent-test" },
      operation: "create",
      destinationSystem: "local-workspace",
      destinationBoundary: "local",
      dataCategories: [],
      stateChange: true,
      status: "succeeded",
    },
  ],
};

describe("nativeTrace adapter", () => {
  it("maps all events with correct field projection", () => {
    const result = adaptNativeTrace(BASE_TRACE);

    expect(result.format).toBe("agent-receipt.native-trace.v1");
    expect(result.adapterVersion).toBe("1.0.0");
    expect(result.events).toHaveLength(2);
    expect(result.accounting).toHaveLength(2);

    const ev = result.events[0];
    expect(ev.schemaVersion).toBe("agent-receipt.canonical-event.v1");
    expect(ev.sourceEventId).toBe("ev-001");
    expect(ev.traceId).toBe("trace-test-001");
    expect(ev.operation).toBe("read");
    expect(ev.actorType).toBe("agent");
    expect(ev.actorId).toBe("agent-test");
    expect(ev.destinationBoundary).toBe("internal");
    expect(ev.dataCategories).toEqual(["pii"]);
  });

  it("assigns stable evt- IDs with zero-padding", () => {
    const result = adaptNativeTrace(BASE_TRACE);
    expect(result.events[0].eventId).toBe("evt-000001");
    expect(result.events[1].eventId).toBe("evt-000002");
  });

  it("orders events by timestamp ASC, then original order for ties", () => {
    const trace: NativeTraceV1 = {
      ...BASE_TRACE,
      events: [
        {
          id: "ev-late",
          timestamp: "2024-01-01T00:03:00Z",
          actor: { type: "agent", id: "a" },
          operation: "read",
          stateChange: false,
          status: "succeeded",
          dataCategories: [],
        },
        {
          id: "ev-early",
          timestamp: "2024-01-01T00:01:00Z",
          actor: { type: "agent", id: "a" },
          operation: "read",
          stateChange: false,
          status: "succeeded",
          dataCategories: [],
        },
        {
          id: "ev-tie-1",
          timestamp: "2024-01-01T00:02:00Z",
          actor: { type: "agent", id: "a" },
          operation: "create",
          stateChange: true,
          status: "succeeded",
          dataCategories: [],
        },
        {
          id: "ev-tie-2",
          timestamp: "2024-01-01T00:02:00Z",
          actor: { type: "agent", id: "a" },
          operation: "update",
          stateChange: true,
          status: "succeeded",
          dataCategories: [],
        },
      ],
    };
    const result = adaptNativeTrace(trace);
    expect(result.events.map((e: CanonicalEvent) => e.sourceEventId)).toEqual([
      "ev-early",
      "ev-tie-1",
      "ev-tie-2",
      "ev-late",
    ]);
  });

  it("defaults destinationBoundary to 'unknown' when absent", () => {
    const trace: NativeTraceV1 = {
      ...BASE_TRACE,
      events: [
        {
          id: "ev-no-boundary",
          timestamp: "2024-01-01T00:01:00Z",
          actor: { type: "agent", id: "a" },
          operation: "read",
          stateChange: false,
          status: "succeeded",
          dataCategories: [],
        },
      ],
    };
    const result = adaptNativeTrace(trace);
    expect(result.events[0].destinationBoundary).toBe("unknown");
  });

  it("defaults dataCategories to [] when absent", () => {
    const trace: NativeTraceV1 = {
      ...BASE_TRACE,
      events: [
        {
          id: "ev-no-cats",
          timestamp: "2024-01-01T00:01:00Z",
          actor: { type: "agent", id: "a" },
          operation: "read",
          stateChange: false,
          status: "succeeded",
        },
      ],
    };
    const result = adaptNativeTrace(trace);
    expect(result.events[0].dataCategories).toEqual([]);
  });

  it("rejects duplicate source event IDs with unparsed + material accounting", () => {
    const trace: NativeTraceV1 = {
      ...BASE_TRACE,
      events: [
        {
          id: "ev-dup",
          timestamp: "2024-01-01T00:01:00Z",
          actor: { type: "agent", id: "a" },
          operation: "read",
          stateChange: false,
          status: "succeeded",
          dataCategories: [],
        },
        {
          id: "ev-dup",
          timestamp: "2024-01-01T00:02:00Z",
          actor: { type: "agent", id: "a" },
          operation: "create",
          stateChange: true,
          status: "succeeded",
          dataCategories: [],
        },
      ],
    };
    const result = adaptNativeTrace(trace);

    // Both instances of the duplicate ID should be unparsed
    expect(result.events).toHaveLength(0);
    const unparsed = result.accounting.filter((a: RawEventAccounting) => a.status === "unparsed");
    expect(unparsed).toHaveLength(2);
    expect(unparsed.every((a: RawEventAccounting) => a.material)).toBe(true);
    expect(unparsed[0].reason).toContain("Duplicate source event ID");
  });

  it("produces 100% accounting — one record per raw event", () => {
    const result = adaptNativeTrace(BASE_TRACE);
    expect(result.accounting).toHaveLength(BASE_TRACE.events.length);
    expect(result.accounting.every((a: RawEventAccounting) => a.status === "mapped")).toBe(true);
  });

  it("accounting canonicalEventIds link to actual event IDs", () => {
    const result = adaptNativeTrace(BASE_TRACE);
    const canonicalIds = new Set(result.events.map((e: CanonicalEvent) => e.eventId));
    for (const acc of result.accounting) {
      for (const id of acc.canonicalEventIds) {
        expect(canonicalIds.has(id)).toBe(true);
      }
    }
  });

  it("validates correctly against NativeTraceV1Schema", () => {
    const raw = {
      schemaVersion: "agent-receipt.native-trace.v1",
      traceId: "t1",
      agent: { id: "a1" },
      startedAt: "2024-01-01T00:00:00Z",
      status: "succeeded",
      events: [],
    };
    const parsed = NativeTraceV1Schema.safeParse(raw);
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown schemaVersion", () => {
    const raw = { schemaVersion: "agent-receipt.native-trace.v99", traceId: "t1" };
    const parsed = NativeTraceV1Schema.safeParse(raw);
    expect(parsed.success).toBe(false);
  });
});
