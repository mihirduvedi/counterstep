import { describe, expect, it } from "vitest";

import {
  DECISION_BRIEF_SCHEMA_VERSION,
  EVIDENCE_PACKET_LIMITATIONS,
  EVIDENCE_PACKET_SCHEMA_VERSION,
  EvidencePacketSchema,
  MAX_EVIDENCE_PACKET_BYTES,
  buildEvidencePacket,
  serializeEvidencePacket,
  verifyEvidencePacket,
  verifyPortableArtifact,
} from "../../src/core/evidencePacket.js";
import { serializeReceipt, buildReceipt } from "../../src/core/receipt.js";
import {
  fixtureA,
  fixtureB,
  fixtureCIncomplete,
  otlpDemoAuthority,
  sharedAuthority,
} from "../../src/fixtures/index.js";
import {
  buildManagerIncidentBrief,
  buildRecoveryPlan,
  exactFixtureBytes,
} from "../../src/ui/receiptView.js";
import type { ReceiptResult } from "../../src/core/schemas/index.js";

const GENERATED_AT = "2026-08-29T01:30:00.000Z";

describe("Portable Evidence Packet", () => {
  it("builds three strict, digest-addressed artifacts without retained source", async () => {
    const packet = await packetFor(fixtureB);

    expect(EvidencePacketSchema.parse(packet)).toStrictEqual(packet);
    expect(packet.schemaVersion).toBe(EVIDENCE_PACKET_SCHEMA_VERSION);
    expect(packet.decisionBrief.schemaVersion).toBe(
      DECISION_BRIEF_SCHEMA_VERSION,
    );
    expect(packet.manifest.map((artifact) => artifact.artifactId)).toStrictEqual([
      "receipt",
      "decision_brief",
      "recovery_plan",
    ]);
    expect(packet.manifest.every((artifact) => artifact.sha256.length === 64)).toBe(true);
    expect(packet.decisionBrief.findingCount).toBe(12);
    expect(packet.decisionBrief.incidentCount).toBe(2);
    expect(packet.decisionBrief.proposedActionCount).toBe(6);
    expect(packet.limitations).toStrictEqual([...EVIDENCE_PACKET_LIMITATIONS]);

    const serialized = JSON.stringify(packet);
    expect(serialized).not.toContain("retainedSource");
    expect(serialized).not.toContain("rawBytes");
    expect(serialized).not.toContain("executionCommand");
    expect(serialized).not.toContain('"credentials"');
  });

  it("verifies the packet manifest, embedded receipt, and recovery binding", async () => {
    const serialized = await serializedPacketFor(fixtureB);
    const report = await verifyEvidencePacket(new TextEncoder().encode(serialized));

    expect(report.status).toBe("pass");
    expect(report.summary).toMatchObject({
      artifactType: "evidence_packet",
      artifactCount: 3,
      traceId: fixtureB.traceId,
      findingCount: 12,
    });
    expect(report.gates).toHaveLength(8);
    expect(report.gates.every((gate) => gate.status === "passed")).toBe(true);
  });

  it("keeps a clean receipt useful with an empty proposal-only recovery plan", async () => {
    const packet = await packetFor(fixtureA);

    expect(packet.receipt.findings).toHaveLength(0);
    expect(packet.decisionBrief.incidents).toHaveLength(0);
    expect(packet.decisionBrief.proposedActionCount).toBe(0);
    expect(packet.recoveryPlan.actions).toHaveLength(0);
    expect(packet.recoveryPlan.executionBoundary.status).toBe("not_executed");

    const report = await verifyEvidencePacket(
      new TextEncoder().encode(JSON.stringify(packet, null, 2)),
    );
    expect(report.status).toBe("pass");
  });

  it("preserves an incomplete-evidence verdict without filling missing fields", async () => {
    const build = await buildReceipt(
      {
        rawBytes: new TextEncoder().encode(
          `${JSON.stringify(fixtureCIncomplete, null, 2)}\n`,
        ),
        authority: otlpDemoAuthority,
      },
      { now: () => GENERATED_AT },
    );
    if (!build.ok) throw new Error(build.error.message);
    const incidents = buildManagerIncidentBrief(build.receipt);
    const actions = buildRecoveryPlan(build.receipt, incidents);
    const packet = await buildEvidencePacket({
      receipt: build.receipt,
      incidents,
      actions,
    });

    expect(packet.receipt.verdict).toBe("unable_to_assess_fully");
    expect(packet.decisionBrief.verdict).toBe("unable_to_assess_fully");
    expect(packet.decisionBrief.qualifier).toContain("Based only on the supplied trace");
    expect(packet.recoveryPlan.executionBoundary.currentExternalState).toBe("unknown");

    const report = await verifyEvidencePacket(
      new TextEncoder().encode(JSON.stringify(packet, null, 2)),
    );
    expect(report.status).toBe("pass");
  });

  it("detects a changed finding through both manifest and policy replay", async () => {
    const packet = await packetFor(fixtureB);
    packet.receipt.findings[0]!.description =
      "This finding was changed after the packet was assembled.";

    const report = await verifyEvidencePacket(
      new TextEncoder().encode(JSON.stringify(packet, null, 2)),
    );

    expect(report.status).toBe("inconsistent");
    expect(gate(report, "artifact_manifest").status).toBe("failed");
    expect(gate(report, "embedded_receipt_replay").status).toBe("failed");
  });

  it("rejects a recovery plan with an invented evidence citation", async () => {
    const packet = await packetFor(fixtureB);
    packet.recoveryPlan.actions[0]!.eventIds = ["evt-invented"];

    const report = await verifyEvidencePacket(
      new TextEncoder().encode(JSON.stringify(packet, null, 2)),
    );

    expect(report.status).toBe("rejected");
    expect(gate(report, "packet_contract").status).toBe("failed");
    expect(gate(report, "artifact_manifest").status).toBe("not_run");
  });

  it("hashes exact outer packet bytes before parsing", async () => {
    const serialized = await serializedPacketFor(fixtureA);
    const first = await verifyEvidencePacket(new TextEncoder().encode(serialized));
    const second = await verifyEvidencePacket(
      new TextEncoder().encode(`${serialized}\n`),
    );

    expect(first.status).toBe("pass");
    expect(second.status).toBe("pass");
    expect(first.fileSha256).not.toBe(second.fileSha256);
  });

  it("rejects oversize, invalid UTF-8, and invalid JSON at ordered boundaries", async () => {
    const oversize = await verifyEvidencePacket(
      new Uint8Array(MAX_EVIDENCE_PACKET_BYTES + 1),
    );
    expect(oversize.status).toBe("rejected");
    expect(gate(oversize, "size_limit").status).toBe("failed");
    expect(gate(oversize, "utf8").status).toBe("not_run");

    const invalidUtf8 = await verifyEvidencePacket(Uint8Array.from([0xc3, 0x28]));
    expect(invalidUtf8.status).toBe("rejected");
    expect(gate(invalidUtf8, "utf8").status).toBe("failed");

    const invalidJson = await verifyEvidencePacket(
      new TextEncoder().encode("{not json}"),
    );
    expect(invalidJson.status).toBe("rejected");
    expect(gate(invalidJson, "json").status).toBe("failed");
  });

  it("auto-detects both standalone receipts and evidence packets", async () => {
    const receipt = await receiptFor(fixtureA);
    const receiptReport = await verifyPortableArtifact(
      new TextEncoder().encode(serializeReceipt(receipt)),
    );
    const packetReport = await verifyPortableArtifact(
      new TextEncoder().encode(await serializedPacketFor(fixtureA)),
    );

    expect(receiptReport.status).toBe("pass");
    expect(receiptReport.summary?.artifactType).toBe("receipt");
    expect(packetReport.status).toBe("pass");
    expect(packetReport.summary?.artifactType).toBe("evidence_packet");
  });

  it("serializes a packet that reparses without normalization changes", async () => {
    const serialized = await serializedPacketFor(fixtureB);
    const parsed = EvidencePacketSchema.parse(JSON.parse(serialized));

    expect(JSON.stringify(parsed, null, 2)).toBe(serialized);
  });
});

async function receiptFor(
  fixture: typeof fixtureA | typeof fixtureB,
): Promise<ReceiptResult> {
  const build = await buildReceipt(
    { rawBytes: exactFixtureBytes(fixture), authority: sharedAuthority },
    { now: () => GENERATED_AT },
  );
  if (!build.ok) throw new Error(build.error.message);
  return build.receipt;
}

async function packetFor(fixture: typeof fixtureA | typeof fixtureB) {
  const receipt = await receiptFor(fixture);
  const incidents = buildManagerIncidentBrief(receipt);
  const actions = buildRecoveryPlan(receipt, incidents);
  return buildEvidencePacket({ receipt, incidents, actions });
}

async function serializedPacketFor(
  fixture: typeof fixtureA | typeof fixtureB,
): Promise<string> {
  const receipt = await receiptFor(fixture);
  const incidents = buildManagerIncidentBrief(receipt);
  const actions = buildRecoveryPlan(receipt, incidents);
  return serializeEvidencePacket({ receipt, incidents, actions });
}

function gate(
  report: Awaited<ReturnType<typeof verifyEvidencePacket>>,
  id: Awaited<ReturnType<typeof verifyEvidencePacket>>["gates"][number]["id"],
) {
  const result = report.gates.find((candidate) => candidate.id === id);
  if (!result) throw new Error(`Missing gate ${id}`);
  return result;
}
