import { describe, expect, it } from "vitest";

import { buildReceipt, MAX_TRACE_BYTES } from "../../src/core/receipt.js";
import type { Finding } from "../../src/core/schemas/index.js";
import {
  fixtureA,
  fixtureB,
  fixtureCIncomplete,
  otlpDemoAuthority,
  otlpGenAiFixture,
  sharedAuthority,
} from "../../src/fixtures/index.js";
import {
  authorityToDraft,
  blankAuthorityDraft,
  buildHumanActionSummary,
  buildManagerIncidentBrief,
  buildRecoveryPlan,
  buildSystemEdges,
  exactFixtureBytes,
  formatCountLabel,
  formatTraceSourceLabel,
  groupSystemsByBoundary,
  resolveRawPointer,
  sortFindingsByAttention,
  summarizeReceipt,
  validateAuthorityDraft,
  validateTraceBytes,
} from "../../src/ui/receiptView.js";

describe("receipt UI view helpers", () => {
  it("uses singular metric labels only when the count is exactly one", () => {
    expect(formatCountLabel(1, "Event")).toBe("Event");
    expect(formatCountLabel(0, "Event")).toBe("Events");
    expect(formatCountLabel(2, "System")).toBe("Systems");
    expect(formatCountLabel(1, "Finding", "Findings")).toBe("Finding");
  });

  it("keeps synthetic, uploaded, and pasted source provenance distinct", () => {
    expect(formatTraceSourceLabel("synthetic")).toBe("Synthetic fixture");
    expect(formatTraceSourceLabel("upload")).toBe("Uploaded trace");
    expect(formatTraceSourceLabel("paste")).toBe("Pasted trace");
  });

  it("encodes committed samples with exact reproducible bytes", () => {
    const expected = exactFixtureBytes(fixtureA);
    expect(new TextDecoder().decode(expected)).toBe(
      `${JSON.stringify(fixtureA, null, 2)}\n`,
    );
    expect(expected.byteLength).toBe(1751);
    expect(exactFixtureBytes(fixtureB).byteLength).toBe(3421);
  });

  it("validates intake without changing bytes or echoing invalid JSON content", () => {
    const valid = validateTraceBytes(exactFixtureBytes(fixtureA), MAX_TRACE_BYTES);
    expect(valid).toEqual({ ok: true, format: "native", trace: fixtureA });

    const secret = "secret-input-value-should-not-appear";
    const invalid = validateTraceBytes(
      new TextEncoder().encode(`{\n  "token": "${secret}"`),
      MAX_TRACE_BYTES,
    );
    expect(invalid.ok).toBe(false);
    if (invalid.ok) return;
    expect(invalid.code).toBe("invalid_json");
    expect(invalid.message).toContain("line");
    expect(invalid.message).not.toContain(secret);
  });

  it("rejects oversize and unsupported inputs before the authority step", () => {
    const oversize = validateTraceBytes(
      new Uint8Array(MAX_TRACE_BYTES + 1),
      MAX_TRACE_BYTES,
    );
    expect(oversize.ok).toBe(false);
    if (!oversize.ok) expect(oversize.code).toBe("input_too_large");

    const unsupported = validateTraceBytes(
      new TextEncoder().encode(JSON.stringify({ schemaVersion: "other" })),
      MAX_TRACE_BYTES,
    );
    expect(unsupported.ok).toBe(false);
    if (!unsupported.ok) expect(unsupported.code).toBe("unsupported_format");
  });

  it("accepts only the documented OTLP/JSON resourceSpans shape", () => {
    const accepted = validateTraceBytes(
      new TextEncoder().encode(JSON.stringify(otlpGenAiFixture)),
      MAX_TRACE_BYTES,
    );
    expect(accepted).toEqual({ ok: true, format: "otlp" });

    const malformed = validateTraceBytes(
      new TextEncoder().encode(JSON.stringify({ resourceSpans: [{}] })),
      MAX_TRACE_BYTES,
    );
    expect(malformed.ok).toBe(false);
    if (malformed.ok) return;
    expect(malformed.code).toBe("invalid_trace");
    expect(malformed.message).toContain("supported resourceSpans shape");
  });

  it("routes unfamiliar JSON record arrays into explicit mapping", () => {
    const document = {
      export: {
        actions: [{ id: "one", action: "read", at: "2026-08-28T18:00:00Z" }],
      },
    };
    const accepted = validateTraceBytes(
      new TextEncoder().encode(JSON.stringify(document)),
      MAX_TRACE_BYTES,
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.format).toBe("generic");
    if (accepted.format !== "generic") return;
    expect(accepted.inspection.recordSets[0]).toEqual(
      expect.objectContaining({ pointer: "/export/actions", recordCount: 1 }),
    );
    expect(resolveRawPointer(document, "/export/actions/0")).toEqual(
      document.export.actions[0],
    );
  });

  it("maps authority drafts through the authoritative Zod boundary", () => {
    const valid = validateAuthorityDraft(authorityToDraft(sharedAuthority));
    expect(valid).toEqual({ ok: true, authority: sharedAuthority });

    const blank = validateAuthorityDraft(blankAuthorityDraft());
    expect(blank.ok).toBe(false);

    const normalized = authorityToDraft(sharedAuthority);
    normalized.prohibitedDataCategories = " Customer Email, account-id ";
    const result = validateAuthorityDraft(normalized);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.authority.prohibitedDataCategories).toEqual([
        "customer_email",
        "account_id",
      ]);
    }
  });

  it("derives manager metrics, movement edges, and raw pointer resolution", async () => {
    const result = await buildReceipt({
      rawBytes: exactFixtureBytes(fixtureB),
      authority: sharedAuthority,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(summarizeReceipt(result.receipt)).toEqual({
      events: 6,
      systems: 5,
      stateChanges: 4,
      externalTransfers: 3,
      approvals: 0,
      errors: 0,
      findings: 12,
    });
    const edges = buildSystemEdges(result.receipt.events);
    expect(edges).toHaveLength(6);
    expect(edges[0]).toMatchObject({
      from: "crm",
      to: "agent-crm-summariser",
      boundary: "internal",
    });
    expect(edges[5]).toMatchObject({
      from: "agent-crm-summariser",
      to: "email-service",
      boundary: "external",
    });
    expect(
      resolveRawPointer(result.retainedSource.rawDocument, "events[5]"),
    ).toEqual(fixtureB.events[5]);
    expect(
      resolveRawPointer(result.retainedSource.rawDocument, "events.nope"),
    ).toBeUndefined();

    expect(groupSystemsByBoundary(result.receipt.events, sharedAuthority)).toEqual({
      local: ["local-workspace"],
      internal: ["crm", "internal-kb"],
      external: ["external-spreadsheet", "email-service"],
      unknown: [],
    });

    const unknownSource = structuredClone(result.receipt.events);
    unknownSource[0].sourceSystem = "undeclared-source";
    expect(groupSystemsByBoundary(unknownSource, sharedAuthority).unknown).toContain(
      "undeclared-source",
    );
  });

  it("translates every expected-run event and qualifies no-observed activity", async () => {
    const result = await buildReceipt({
      rawBytes: exactFixtureBytes(fixtureA),
      authority: sharedAuthority,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const summary = buildHumanActionSummary(result.receipt);
    expect(summary.actions).toHaveLength(result.receipt.events.length);
    expect(summary.actions.map((action) => action.eventId)).toEqual([
      "evt-000001",
      "evt-000002",
      "evt-000003",
    ]);
    expect(summary.actions[0].text).toBe(
      "Read churn risk record from crm. Quantity: 250 records. Named data: churn score and account ID.",
    );
    expect(summary.actions[1].text).toContain("Data category was not supplied.");
    expect(summary.actions[2].text).toContain("Quantity was not supplied.");
    expect(summary.systems.map((system) => system.systemId)).toEqual([
      "crm",
      "internal-kb",
      "local-workspace",
    ]);
    expect(summary.systems[0]).toMatchObject({
      boundaries: ["internal"],
      roles: ["source"],
      operations: ["read"],
      statuses: ["succeeded"],
      dataCategories: ["churn_score", "account_id"],
      eventIds: ["evt-000001"],
    });
    expect(summary.noObservedActivity.map((item) => item.text)).toEqual([
      "The restricted data category customer email does not appear in any supplied event.",
      "No supplied event names an external destination.",
    ]);
    expect(summary.noObservedActivity[0].eventIds).toEqual(
      result.receipt.events.map((event) => event.eventId),
    );
  });

  it("keeps attempts distinct from completed work in the overreaching run", async () => {
    const result = await buildReceipt({
      rawBytes: exactFixtureBytes(fixtureB),
      authority: sharedAuthority,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const summary = buildHumanActionSummary(result.receipt);
    expect(summary.actions).toHaveLength(6);
    expect(summary.actions[3]).toMatchObject({
      eventId: "evt-000004",
      status: "unknown",
      text: "Attempt 1: Tried to create spreadsheet in external spreadsheet. The result is unknown in the trace. Quantity: 120 records. Named data: customer email.",
    });
    expect(summary.actions[4].text).toBe(
      "Attempt 2: Created spreadsheet in external spreadsheet. Quantity: 120 records. Named data: customer email.",
    );
    expect(summary.actions[5].text).toBe(
      "Sent customer message to email service. Quantity: 20 messages. Named data: customer email.",
    );
    expect(summary.systems.map((system) => system.systemId)).toEqual([
      "crm",
      "internal-kb",
      "local-workspace",
      "external-spreadsheet",
      "email-service",
    ]);
    expect(summary.noObservedActivity).toHaveLength(1);
    expect(summary.noObservedActivity[0].text).toBe(
      "Every declared system and restricted data category appears in the trace, and at least one external destination is named.",
    );
  });

  it("groups rule findings into two deterministic manager incidents", async () => {
    const result = await buildReceipt({
      rawBytes: exactFixtureBytes(fixtureB),
      authority: sharedAuthority,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const incidents = buildManagerIncidentBrief(result.receipt);
    expect(incidents).toHaveLength(2);
    expect(incidents[0]).toMatchObject({
      incidentId: "incident-001",
      title: "External spreadsheet creation retried after an unknown result",
      severity: "high",
      eventIds: ["evt-000004", "evt-000005"],
      findingCount: 7,
      statuses: ["unknown", "succeeded"],
      systems: ["external-spreadsheet"],
      dataCategories: ["customer_email"],
    });
    expect(incidents[0].findingIds).toHaveLength(7);
    expect(incidents[0].summary).toContain("7 deterministic findings");
    expect(incidents[1]).toMatchObject({
      incidentId: "incident-002",
      title: "20 customer messages sent to email service",
      severity: "high",
      eventIds: ["evt-000006"],
      findingCount: 5,
    });
    expect(
      incidents.flatMap((incident) => incident.findingIds).sort(),
    ).toEqual(result.receipt.findings.map((finding) => finding.findingId).sort());
  });

  it("builds cited recovery proposals without claiming execution", async () => {
    const result = await buildReceipt({
      rawBytes: exactFixtureBytes(fixtureB),
      authority: sharedAuthority,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const incidents = buildManagerIncidentBrief(result.receipt);
    const actions = buildRecoveryPlan(result.receipt, incidents);
    expect(actions).toHaveLength(6);
    expect(actions.every((action) => action.status === "proposed")).toBe(true);
    expect(actions.every((action) => action.eventIds.length > 0)).toBe(true);
    expect(actions.every((action) => action.findingIds.length > 0)).toBe(true);
    expect(actions.map((action) => action.title)).toEqual([
      "Resolve the ambiguous destination state",
      "Review access and contain the external copy",
      "Correct the authority controls before another run",
      "Preserve and verify the destination evidence",
      "Review delivery scope and available containment",
      "Correct the authority controls before another run",
    ]);
    expect(actions.map((action) => action.description).join(" ")).toContain(
      "Agent Receipt does not execute",
    );

    const expected = await buildReceipt({
      rawBytes: exactFixtureBytes(fixtureA),
      authority: sharedAuthority,
    });
    expect(expected.ok).toBe(true);
    if (!expected.ok) return;
    expect(buildManagerIncidentBrief(expected.receipt)).toEqual([]);
    expect(buildRecoveryPlan(expected.receipt)).toEqual([]);
  });

  it("proposes evidence collection only when an incomplete run has no canonical incident event", async () => {
    const result = await buildReceipt({
      rawBytes: new TextEncoder().encode(
        `${JSON.stringify(fixtureCIncomplete, null, 2)}\n`,
      ),
      authority: otlpDemoAuthority,
    });
    expect(result.ok, result.ok ? undefined : JSON.stringify(result.error)).toBe(true);
    if (!result.ok) return;

    expect(
      resolveRawPointer(
        result.retainedSource.rawDocument,
        "resourceSpans[0].scopeSpans[0].spans[1]",
      ),
    ).toEqual(fixtureCIncomplete.resourceSpans[0]!.scopeSpans[0]!.spans[1]);

    const incidents = buildManagerIncidentBrief(result.receipt);
    const actions = buildRecoveryPlan(result.receipt, incidents);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      title: "Close the evidence gap before accepting the run",
      eventIds: [],
      status: "proposed",
    });
    expect(actions[0]?.findingIds.length).toBeGreaterThan(0);
    expect(actions[0]?.title).not.toContain("named system");
  });

  it("orders attention items by severity and then event sequence", () => {
    const findings: Finding[] = [
      {
        findingId: "medium-early",
        ruleId: "TEST-2",
        severity: "medium",
        label: "Medium",
        description: "Medium item",
        eventIds: ["evt-000001"],
      },
      {
        findingId: "high-late",
        ruleId: "TEST-1",
        severity: "high",
        label: "High late",
        description: "High late item",
        eventIds: ["evt-000003"],
      },
      {
        findingId: "high-early",
        ruleId: "TEST-1",
        severity: "high",
        label: "High early",
        description: "High early item",
        eventIds: ["evt-000002"],
      },
    ];
    const events = fixtureA.events.map((source, index) => ({
      schemaVersion: "agent-receipt.canonical-event.v1" as const,
      eventId: `evt-${String(index + 1).padStart(6, "0")}`,
      sourceEventId: source.id,
      traceId: fixtureA.traceId,
      sequence: index + 1,
      timestamp: source.timestamp,
      actorType: source.actor.type,
      actorId: source.actor.id,
      operation: source.operation,
      destinationBoundary: source.destinationBoundary ?? "unknown",
      dataCategories: source.dataCategories ?? [],
      stateChange: source.stateChange,
      status: source.status,
      rawPointer: `events[${index}]`,
      adapterWarnings: [],
      riskTags: [],
    }));
    expect(sortFindingsByAttention(findings, events).map((item) => item.findingId)).toEqual([
      "high-early",
      "high-late",
      "medium-early",
    ]);
  });
});
