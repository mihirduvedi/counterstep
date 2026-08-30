import { describe, expect, it } from "vitest";

import { buildReceipt } from "../../src/core/receipt.js";
import {
  fixtureA,
  fixtureCIncomplete,
  otlpDemoAuthority,
  sharedAuthority,
} from "../../src/fixtures/index.js";
import { buildEvidenceGapView } from "../../src/ui/evidenceGapView.js";
import { exactFixtureBytes } from "../../src/ui/receiptView.js";

function bytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

describe("evidence gap view", () => {
  it("accounts for every incomplete OTLP record and links the gaps to raw evidence", async () => {
    const result = await buildReceipt({
      rawBytes: bytes(fixtureCIncomplete),
      authority: otlpDemoAuthority,
    });
    expect(result.ok, result.ok ? undefined : JSON.stringify(result.error)).toBe(true);
    if (!result.ok) return;

    expect(result.receipt.verdict).toBe("unable_to_assess_fully");
    const view = buildEvidenceGapView(result.receipt);
    expect(view).not.toBeNull();
    if (!view) return;

    expect(view).toMatchObject({
      accounted: 3,
      total: 3,
      mapped: 1,
      metadataOnly: 1,
      unparsed: 1,
    });
    expect(view.gaps.map((gap) => gap.label)).toEqual([
      "Material event could not be parsed",
      "Run termination is unknown",
    ]);
    expect(view.records).toHaveLength(3);
    expect(new Set(view.records.map((record) => record.rawPointer)).size).toBe(3);

    const unparsed = view.records.find((record) => record.status === "unparsed");
    expect(unparsed).toMatchObject({
      rawPointer: "resourceSpans[0].scopeSpans[0].spans[1]",
      material: true,
      canonicalEventIds: [],
    });
    expect(unparsed?.findingIds).toContain(view.gaps[0]?.findingId);
    expect(view.gaps[0]?.rawPointers).toEqual([
      "resourceSpans[0].scopeSpans[0].spans[1]",
    ]);
    expect(view.gaps[1]?.rawPointers).toEqual(
      view.records.map((record) => record.rawPointer),
    );
  });

  it("does not create a gap mode for a complete receipt", async () => {
    const result = await buildReceipt({
      rawBytes: exactFixtureBytes(fixtureA),
      authority: sharedAuthority,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(buildEvidenceGapView(result.receipt)).toBeNull();
  });
});
