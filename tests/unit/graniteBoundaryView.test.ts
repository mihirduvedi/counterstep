import { describe, expect, it } from "vitest";

import { buildReceipt } from "../../src/core/receipt.js";
import { fixtureB, sharedAuthority } from "../../src/fixtures/index.js";
import { buildGraniteBoundaryView } from "../../src/ui/graniteBoundaryView.js";
import { exactFixtureBytes } from "../../src/ui/receiptView.js";

describe("Granite boundary view", () => {
  it("reconstructs the minimized, citation-closed bundle without raw fields", async () => {
    const result = await buildReceipt({
      rawBytes: exactFixtureBytes(fixtureB),
      authority: sharedAuthority,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const view = buildGraniteBoundaryView(result.receipt);

    expect(view.generationSource).toBe("deterministic_fallback");
    expect(view.eventCount).toBe(6);
    expect(view.findingCount).toBe(12);
    expect(view.allowedEventCitationCount).toBe(6);
    expect(view.allowedFindingCitationCount).toBe(12);
    expect(view.payloadBytes).toBe(
      new TextEncoder().encode(view.serializedBundle).byteLength,
    );

    expect(view.bundle.events[3]).toMatchObject({
      eventId: "evt-000004",
      operation: "create",
      status: "unknown",
      destinationSystem: "external-spreadsheet",
    });
    expect(view.serializedBundle).not.toContain('"rawPointer"');
    expect(view.serializedBundle).not.toContain('"sourceEventId"');
    expect(view.serializedBundle).not.toContain('"approvalRef"');
    expect(view.serializedBundle).not.toContain('"observedValue"');
    expect(view.serializedBundle).not.toContain('"expectedValue"');
    expect(view.serializedBundle).not.toContain('"policyPath"');
    expect(view.serializedBundle).not.toContain('"input"');
    expect(view.serializedBundle).not.toContain('"output"');
    expect(view.serializedBundle).not.toContain('"metadata"');
    expect(view.serializedBundle).not.toContain("ev-b-004");
  });

  it("shows the redacted projection rather than the sensitive authority value", async () => {
    const secret = "Bearer model-bound-secret-value";
    const result = await buildReceipt({
      rawBytes: exactFixtureBytes(fixtureB),
      authority: {
        ...sharedAuthority,
        task: `Review this run with ${secret}`,
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const view = buildGraniteBoundaryView(result.receipt);

    expect(view.bundle.task).toContain("[REDACTED]");
    expect(view.serializedBundle).not.toContain(secret);
    expect(view.serializedBundle).not.toContain("model-bound-secret-value");
  });
});
