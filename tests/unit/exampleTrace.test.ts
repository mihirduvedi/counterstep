import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildReceipt } from "../../src/core/receipt.js";
import type { AuthorityEnvelopeV1 } from "../../src/core/schemas/index.js";

const RELEASE_TRACE_URL = new URL(
  "../../examples/codex-policy-ledger-release-trace.json",
  import.meta.url,
);
const GENERIC_RELEASE_LOG_URL = new URL(
  "../../examples/codex-policy-ledger-release-generic-log.json",
  import.meta.url,
);
const GENERIC_RELEASE_MAPPING_URL = new URL(
  "../../examples/codex-policy-ledger-release-generic-mapping.json",
  import.meta.url,
);

const releaseAuthority: AuthorityEnvelopeV1 = {
  schemaVersion: "agent-receipt.authority.v1",
  policyId: "policy-codex-release-001",
  task: "Inspect and improve Agent Receipt, verify the exact candidate, then commit, push, and deploy only after explicit human approval.",
  permittedSystems: [
    { systemId: "local-workspace", boundary: "local" },
    { systemId: "local-shell", boundary: "local" },
    { systemId: "git-local", boundary: "local" },
    { systemId: "github", boundary: "external" },
    { systemId: "github-actions", boundary: "external" },
    { systemId: "vercel", boundary: "external" },
  ],
  permittedOperations: [
    "read",
    "retrieve",
    "create",
    "update",
    "send",
    "execute",
    "approve",
  ],
  prohibitedDataCategories: [],
  externalEgressAllowed: true,
  approvalRequiredFor: ["send"],
};

describe("Codex release trace example", () => {
  it("builds a complete evidence-linked receipt under its declared authority", async () => {
    const rawBytes = new Uint8Array(readFileSync(RELEASE_TRACE_URL));
    const result = await buildReceipt({ rawBytes, authority: releaseAuthority });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.receipt.run).toMatchObject({
      traceId: "trace-codex-policy-ledger-release-2026-08-29",
      status: "succeeded",
    });
    expect(result.receipt.verdict).toBe("within_declared_authority");
    expect(result.receipt.findings).toEqual([]);
    expect(result.receipt.coverage).toMatchObject({
      rawEvents: 10,
      canonicalEvents: 10,
      accountedRawEvents: 10,
      mapped: 10,
      metadataOnly: 0,
      unparsed: 0,
    });
    expect(result.policyLedger.counts).toEqual({
      total: 9,
      deviations: 0,
      noFindings: 6,
      unableToAssess: 0,
      notActive: 3,
    });
  });

  it("produces the same authority result from an unrelated generic log shape", async () => {
    const rawBytes = new Uint8Array(readFileSync(GENERIC_RELEASE_LOG_URL));
    const genericJsonMapping = JSON.parse(
      readFileSync(GENERIC_RELEASE_MAPPING_URL, "utf8"),
    ) as unknown;
    const result = await buildReceipt({
      rawBytes,
      authority: releaseAuthority,
      genericJsonMapping,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.verdict).toBe("within_declared_authority");
    expect(result.receipt.findings).toEqual([]);
    expect(result.receipt.coverage).toMatchObject({
      rawEvents: 10,
      canonicalEvents: 10,
      accountedRawEvents: 10,
      mapped: 10,
      metadataOnly: 0,
      unparsed: 0,
    });
    expect(result.receipt.integrity).toMatchObject({
      inputFormat: "generic-json-records.v1",
      adapterName: "genericJsonExplicitMapping",
      genericJsonMapping,
    });
    expect(result.policyLedger.counts).toEqual({
      total: 9,
      deviations: 0,
      noFindings: 6,
      unableToAssess: 0,
      notActive: 3,
    });
  });
});
