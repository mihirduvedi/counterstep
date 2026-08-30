import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  fixtureA,
  fixtureB,
  fixtureCIncomplete,
  otlpDemoAuthority,
  sharedAuthority,
} from "../../src/fixtures/index.js";
import { _resetFindingCounter } from "../../src/core/policyEngine.js";
import {
  buildReceipt,
  MAX_TRACE_BYTES,
  serializeReceipt,
} from "../../src/core/receipt.js";
import type {
  AuthorityEnvelopeV1,
  ReceiptResult,
} from "../../src/core/schemas/index.js";
import {
  RECEIPT_VERIFIER_LIMITATIONS,
  verifyReceipt,
} from "../../src/core/verifyReceipt.js";

const GENERATED_AT = "2026-08-28T22:00:00.000Z";

describe("portable receipt verifier", () => {
  beforeEach(() => {
    _resetFindingCounter();
  });

  it.each([
    ["expected native trace", fixtureA, sharedAuthority],
    ["overreaching native trace", fixtureB, sharedAuthority],
    ["incomplete OTLP trace", fixtureCIncomplete, otlpDemoAuthority],
  ])("passes a freshly exported %s receipt", async (_name, trace, authority) => {
    const bytes = await exportedReceiptBytes(trace, authority);
    const result = await verifyReceipt(bytes);

    expect(result.status).toBe("pass");
    expect(result.gates.every((gate) => gate.status === "passed")).toBe(true);
    expect(result.fileSha256).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(result.summary?.traceId).toBeDefined();
    expect(result.limitations).toStrictEqual([...RECEIPT_VERIFIER_LIMITATIONS]);
  });

  it("hashes the exact imported bytes before parsing and changes on a one-byte edit", async () => {
    const bytes = await exportedReceiptBytes(fixtureA, sharedAuthority);
    const edited = Uint8Array.from(bytes);
    edited[edited.length - 1] = edited[edited.length - 1] === 10 ? 32 : 10;

    const original = await verifyReceipt(bytes);
    const changed = await verifyReceipt(edited);

    expect(original.fileSha256).not.toBe(changed.fileSha256);
    expect(original.byteLength).toBe(bytes.byteLength);
    expect(changed.byteLength).toBe(edited.byteLength);
  });

  it("rejects input over the 2 MiB boundary before decoding", async () => {
    const result = await verifyReceipt(new Uint8Array(MAX_TRACE_BYTES + 1));

    expect(result.status).toBe("rejected");
    expect(gate(result, "exact_byte_digest").status).toBe("passed");
    expect(gate(result, "size_limit").status).toBe("failed");
    expect(gate(result, "utf8").status).toBe("not_run");
  });

  it("rejects non-UTF-8 input without attempting JSON parsing", async () => {
    const result = await verifyReceipt(Uint8Array.from([0xc3, 0x28]));

    expect(result.status).toBe("rejected");
    expect(gate(result, "utf8").status).toBe("failed");
    expect(gate(result, "json").status).toBe("not_run");
  });

  it("rejects malformed JSON and retains the exact file digest", async () => {
    const bytes = new TextEncoder().encode('{"schemaVersion":');
    const result = await verifyReceipt(bytes);

    expect(result.status).toBe("rejected");
    expect(result.fileSha256).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(gate(result, "json").status).toBe("failed");
    expect(gate(result, "receipt_contract").status).toBe("not_run");
  });

  it("rejects valid JSON that is not a strict receipt export", async () => {
    const result = await verifyReceipt(new TextEncoder().encode("{}"));

    expect(result.status).toBe("rejected");
    expect(gate(result, "receipt_contract").status).toBe("failed");
    expect(gate(result, "receipt_contract").issues.length).toBeGreaterThan(0);
    expect(gate(result, "policy_replay").status).toBe("not_run");
  });

  it("rejects a changed verdict even when its label and qualifier are changed with it", async () => {
    const receipt = await exportedReceipt(fixtureB, sharedAuthority);
    receipt.verdict = "within_declared_authority";
    receipt.verdictLabel = "Within declared authority";
    receipt.verdictQualifier =
      "Within declared authority. Based on the supplied trace and authority envelope.";
    const result = await verifyReceipt(encodeUncheckedReceipt(receipt));

    expect(result.status).toBe("inconsistent");
    expect(gate(result, "receipt_contract").status).toBe("passed");
    expect(gate(result, "policy_replay").status).toBe("failed");
    expect(gate(result, "policy_replay").issues).toContainEqual(
      expect.objectContaining({ path: "$.verdict" }),
    );
  });

  it("detects a schema-valid edit to deterministic finding text", async () => {
    const receipt = await exportedReceipt(fixtureB, sharedAuthority);
    const firstFinding = receipt.findings[0];
    if (!firstFinding) throw new Error("Fixture B must have findings");
    firstFinding.description = "Edited deterministic finding text.";
    const result = await verifyReceipt(encodeUncheckedReceipt(receipt));

    expect(result.status).toBe("inconsistent");
    expect(gate(result, "receipt_contract").status).toBe("passed");
    expect(gate(result, "policy_replay").status).toBe("failed");
    expect(gate(result, "citation_validation").status).toBe("failed");
  });

  it("rejects altered coverage at the cross-object receipt boundary", async () => {
    const receipt = await exportedReceipt(fixtureA, sharedAuthority);
    receipt.coverage.mapped += 1;
    const result = await verifyReceipt(encodeUncheckedReceipt(receipt));

    expect(result.status).toBe("rejected");
    expect(gate(result, "receipt_contract").status).toBe("failed");
    expect(gate(result, "accounting_replay").status).toBe("not_run");
    expect(gate(result, "receipt_contract").issues).toContainEqual(
      expect.objectContaining({ path: "$.coverage.mapped" }),
    );
  });

  it("rejects a receipt note with an invented event citation", async () => {
    const receipt = await exportedReceipt(fixtureA, sharedAuthority);
    receipt.copy.headline.eventIds = ["evt-invented"];
    const result = await verifyReceipt(encodeUncheckedReceipt(receipt));

    expect(result.status).toBe("rejected");
    expect(gate(result, "receipt_contract").status).toBe("failed");
    expect(gate(result, "receipt_contract").issues).toContainEqual(
      expect.objectContaining({ path: "$.copy.headline.eventIds" }),
    );
  });
});

async function exportedReceipt(
  trace: unknown,
  authority: AuthorityEnvelopeV1,
): Promise<ReceiptResult> {
  const result = await buildReceipt(
    {
      rawBytes: new TextEncoder().encode(`${JSON.stringify(trace, null, 2)}\n`),
      authority,
    },
    { now: () => GENERATED_AT },
  );
  expect(result.ok, result.ok ? undefined : JSON.stringify(result.error)).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return structuredClone(result.receipt);
}

async function exportedReceiptBytes(
  trace: unknown,
  authority: AuthorityEnvelopeV1,
): Promise<Uint8Array> {
  return encodeReceipt(await exportedReceipt(trace, authority));
}

function encodeReceipt(receipt: ReceiptResult): Uint8Array {
  return new TextEncoder().encode(`${serializeReceipt(receipt)}\n`);
}

function encodeUncheckedReceipt(receipt: ReceiptResult): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(receipt, null, 2)}\n`);
}

function gate(
  report: Awaited<ReturnType<typeof verifyReceipt>>,
  id: Awaited<ReturnType<typeof verifyReceipt>>["gates"][number]["id"],
) {
  const result = report.gates.find((candidate) => candidate.id === id);
  if (!result) throw new Error(`Missing verification gate ${id}`);
  return result;
}
