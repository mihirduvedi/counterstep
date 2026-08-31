import { describe, expect, it } from "vitest";

import {
  LOCAL_REHEARSAL_EMULATOR_HOST,
  LOCAL_REHEARSAL_EVIDENCE_BOUNDARY,
  LOCAL_REHEARSAL_FIREBASE_TOOLS_VERSION,
  LOCAL_REHEARSAL_PROJECT_ID,
  LOCAL_REHEARSAL_SCHEMA_VERSION,
  buildContainerEnvironment,
  buildDockerRunArgs,
  parseLocalRehearsalConfig,
  serializeContainerEnvironment,
  validateLocalProductionRehearsalManifest,
} from "../../scripts/local-production-rehearsal-lib.mjs";

const fakeKey = "fake-gemini-key-for-tests";

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    FIRESTORE_EMULATOR_HOST: LOCAL_REHEARSAL_EMULATOR_HOST,
    GCLOUD_PROJECT: LOCAL_REHEARSAL_PROJECT_ID,
  };
}

function validConfig() {
  return parseLocalRehearsalConfig({
    environment: validEnvironment(),
    envLocalText: [
      "COUNTERSTEP_GEMINI_MODEL=gemini-3.5-flash-lite",
      `GEMINI_API_KEY=${fakeKey}`,
    ].join("\n"),
    workspaceRoot: "/workspace/counterstep",
  });
}

function validManifest() {
  const health = {
    ok: true,
    deployment: "local",
    repository: "firestore",
    repositoryReachable: true,
    geminiConfigured: true,
    agentMode: "gemini",
    modelId: "gemini-3.5-flash-lite",
    agentFramework: "google-adk-typescript",
  };
  const summary = (run: number) => ({
    run,
    runId: `run-${run}`,
    status: "repaired",
    modelId: "gemini-3.5-flash-lite",
    toolCalls: 6,
    writes: 2,
    recordedEvents: 12,
    closureDigest: String(run).repeat(64),
    actionReceiptVerdict: "within_remediation_authority",
  });
  return {
    schemaVersion: LOCAL_REHEARSAL_SCHEMA_VERSION,
    generatedAt: "2026-08-29T23:00:00.000Z",
    evidenceBoundary: LOCAL_REHEARSAL_EVIDENCE_BOUNDARY,
    claims: {
      liveGeminiAdk: true,
      productionContainer: true,
      firestoreProductionAdapter: true,
      firestoreEmulator: true,
      applicationRestartPersistence: true,
      managedFirestore: false,
      cloudRun: false,
      deployed: false,
    },
    emulator: {
      projectId: LOCAL_REHEARSAL_PROJECT_ID,
      host: LOCAL_REHEARSAL_EMULATOR_HOST,
      firebaseToolsVersion: LOCAL_REHEARSAL_FIREBASE_TOOLS_VERSION,
      dataSurvivedApplicationRestart: true,
    },
    container: {
      imageTag: "counterstep:local-production-rehearsal",
      imageId: `sha256:${"a".repeat(64)}`,
      generations: 2,
      user: "node",
      readOnlyRootFilesystem: true,
      capDropAll: true,
      noNewPrivileges: true,
      loopbackPublishedPort: "127.0.0.1:8080:8080",
      tmpfs: "/tmp:rw,noexec,nosuid,size=64m",
    },
    health: { beforeRestart: health, afterRestart: health },
    journeys: [
      {
        phase: "before_restart",
        summary: summary(1),
        finalView: { run: { runId: "run-1" } },
        closure: { runId: "run-1" },
      },
      {
        phase: "after_restart",
        summary: summary(2),
        finalView: { run: { runId: "run-2" } },
        closure: { runId: "run-2" },
      },
    ],
    restartProof: {
      originalRunId: "run-1",
      readFromFreshProcess: true,
      finalViewMatches: true,
      closureMatches: true,
    },
  };
}

describe("local production rehearsal boundary", () => {
  it("accepts only the fixed demo project and loopback emulator", () => {
    expect(validConfig()).toMatchObject({
      emulatorHost: "127.0.0.1:8087",
      projectId: "demo-counterstep",
      geminiModel: "gemini-3.5-flash-lite",
      appPort: 8080,
    });

    expect(() =>
      parseLocalRehearsalConfig({
        environment: {
          ...validEnvironment(),
          GCLOUD_PROJECT: "handy-operation-492002-h3",
        },
        envLocalText: `GEMINI_API_KEY=${fakeKey}`,
        workspaceRoot: "/workspace/counterstep",
      }),
    ).toThrow();
    expect(() =>
      parseLocalRehearsalConfig({
        environment: {
          ...validEnvironment(),
          FIRESTORE_EMULATOR_HOST: "firestore.googleapis.com:443",
        },
        envLocalText: `GEMINI_API_KEY=${fakeKey}`,
        workspaceRoot: "/workspace/counterstep",
      }),
    ).toThrow();
  });

  it("refuses Cloud Run identity and quoted or missing secrets", () => {
    expect(() =>
      parseLocalRehearsalConfig({
        environment: { ...validEnvironment(), K_SERVICE: "counterstep" },
        envLocalText: `GEMINI_API_KEY=${fakeKey}`,
        workspaceRoot: "/workspace/counterstep",
      }),
    ).toThrow("refuses Cloud Run runtime markers");
    for (const envLocalText of ["", `GEMINI_API_KEY=\"${fakeKey}\"`]) {
      expect(() =>
        parseLocalRehearsalConfig({
          environment: validEnvironment(),
          envLocalText,
          workspaceRoot: "/workspace/counterstep",
        }),
      ).toThrow();
    }
  });

  it("keeps the secret in a permissioned env file, not Docker arguments", () => {
    const config = validConfig();
    const environment = buildContainerEnvironment(config);
    const serialized = serializeContainerEnvironment(environment);
    expect(serialized).toContain(`GEMINI_API_KEY=${fakeKey}\n`);
    expect(environment).toMatchObject({
      NODE_ENV: "production",
      COUNTERSTEP_AGENT_MODE: "gemini",
      COUNTERSTEP_REPOSITORY: "firestore",
      GOOGLE_CLOUD_PROJECT: "demo-counterstep",
      FIRESTORE_EMULATOR_HOST: "host.docker.internal:8087",
    });
    const args = buildDockerRunArgs({
      config,
      containerName: "counterstep-rehearsal-test-a",
      envFilePath: "/private/tmp/rehearsal/container.env",
    });
    expect(args.join(" ")).not.toContain(fakeKey);
    expect(args).toEqual(
      expect.arrayContaining([
        "127.0.0.1:8080:8080",
        "--read-only",
        "/tmp:rw,noexec,nosuid,size=64m",
        "ALL",
        "no-new-privileges:true",
      ]),
    );
    expect(() =>
      serializeContainerEnvironment({ GEMINI_API_KEY: "line1\nline2" }),
    ).toThrow("unsafe");
  });

  it("makes managed, Cloud Run, and deployed claims impossible", () => {
    const manifest = validManifest();
    expect(validateLocalProductionRehearsalManifest(manifest)).toEqual(
      manifest,
    );
    for (const claim of ["managedFirestore", "cloudRun", "deployed"] as const) {
      expect(() =>
        validateLocalProductionRehearsalManifest({
          ...manifest,
          claims: { ...manifest.claims, [claim]: true },
        }),
      ).toThrow();
    }
  });
});
