import { describe, expect, it } from "vitest";

import {
  MANAGED_FIRESTORE_WRITE_ACKNOWLEDGEMENT,
  parseManagedFirestoreEvidenceConfig,
} from "../helpers/managedFirestore.js";

const validEnvironment = {
  COUNTERSTEP_MANAGED_FIRESTORE_PROJECT: "counterstep-proof-123",
  COUNTERSTEP_MANAGED_FIRESTORE_CONFIRM_PROJECT: "counterstep-proof-123",
  COUNTERSTEP_MANAGED_FIRESTORE_DATABASE_ID: "(default)",
  COUNTERSTEP_MANAGED_FIRESTORE_RUN_LABEL: "managed-20260829-a1b2c3",
  COUNTERSTEP_MANAGED_FIRESTORE_WRITE_ACK:
    MANAGED_FIRESTORE_WRITE_ACKNOWLEDGEMENT,
};

describe("managed Firestore evidence configuration", () => {
  it("accepts an exact real-project acknowledgement", () => {
    expect(
      parseManagedFirestoreEvidenceConfig(validEnvironment),
    ).toStrictEqual({
      projectId: "counterstep-proof-123",
      confirmedProjectId: "counterstep-proof-123",
      databaseId: "(default)",
      runLabel: "managed-20260829-a1b2c3",
      writeAcknowledgement: MANAGED_FIRESTORE_WRITE_ACKNOWLEDGEMENT,
      emulatorHost: undefined,
    });
  });

  it.each([
    ["missing environment", {}],
    [
      "mismatched confirmation",
      {
        ...validEnvironment,
        COUNTERSTEP_MANAGED_FIRESTORE_CONFIRM_PROJECT:
          "different-proof-123",
      },
    ],
    [
      "emulator fallback",
      { ...validEnvironment, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8087" },
    ],
    [
      "demo project",
      {
        ...validEnvironment,
        COUNTERSTEP_MANAGED_FIRESTORE_PROJECT: "demo-counterstep",
        COUNTERSTEP_MANAGED_FIRESTORE_CONFIRM_PROJECT: "demo-counterstep",
      },
    ],
    [
      "non-default database",
      {
        ...validEnvironment,
        COUNTERSTEP_MANAGED_FIRESTORE_DATABASE_ID: "counterstep-test",
      },
    ],
    [
      "missing write acknowledgement",
      {
        ...validEnvironment,
        COUNTERSTEP_MANAGED_FIRESTORE_WRITE_ACK: undefined,
      },
    ],
    [
      "reused-looking invalid label",
      {
        ...validEnvironment,
        COUNTERSTEP_MANAGED_FIRESTORE_RUN_LABEL: "short",
      },
    ],
  ])("rejects %s", (_label, environment) => {
    expect(() => parseManagedFirestoreEvidenceConfig(environment)).toThrow();
  });
});
