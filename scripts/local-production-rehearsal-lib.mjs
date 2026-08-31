import { z } from "zod";

export const LOCAL_REHEARSAL_SCHEMA_VERSION =
  "counterstep.local-production-rehearsal.v1";
export const LOCAL_REHEARSAL_PROJECT_ID = "demo-counterstep";
export const LOCAL_REHEARSAL_EMULATOR_HOST = "127.0.0.1:8087";
export const LOCAL_REHEARSAL_FIREBASE_TOOLS_VERSION = "15.28.2";
export const LOCAL_REHEARSAL_EVIDENCE_BOUNDARY =
  "Local production rehearsal only: this evidence uses the official Firestore emulator and a local production container. It is not managed Firestore, Cloud Run, or deployed evidence.";

const GeminiModelSchema = z.string().superRefine((modelId, context) => {
  const match = /^gemini-(\d+)(?:\.(\d+))?(?:-|$)/.exec(modelId);
  if (!match) {
    context.addIssue({
      code: "custom",
      message: "COUNTERSTEP_GEMINI_MODEL must be a recognized Gemini model ID.",
    });
    return;
  }
  const major = Number(match[1]);
  const minor = Number(match[2] ?? 0);
  if (major < 3 || (major === 3 && minor < 5)) {
    context.addIssue({
      code: "custom",
      message: "COUNTERSTEP_GEMINI_MODEL must be Gemini 3.5 or newer.",
    });
  }
});

const RehearsalConfigSchema = z
  .object({
    workspaceRoot: z.string().min(1),
    emulatorHost: z.literal(LOCAL_REHEARSAL_EMULATOR_HOST),
    projectId: z.literal(LOCAL_REHEARSAL_PROJECT_ID),
    geminiApiKey: z
      .string()
      .min(1, "GEMINI_API_KEY is missing from .env.local.")
      .regex(
        /^[^\s'"\0]+$/,
        "GEMINI_API_KEY must be an unquoted, single-line value.",
      ),
    geminiModel: GeminiModelSchema,
    imageTag: z
      .string()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9._/-]*(?::[a-z0-9][a-z0-9._-]*)?$/),
    appPort: z.literal(8080),
    baseUrl: z.literal("http://127.0.0.1:8080"),
    outputDirectory: z.string().min(1),
  })
  .strict();

const SmokeSummarySchema = z
  .object({
    run: z.number().int().positive(),
    runId: z.string().min(1),
    status: z.literal("repaired"),
    modelId: GeminiModelSchema,
    toolCalls: z.number().int().positive(),
    writes: z.literal(2),
    recordedEvents: z.number().int().positive(),
    closureDigest: z.string().regex(/^[a-f0-9]{64}$/),
    actionReceiptVerdict: z.literal("within_remediation_authority"),
  })
  .strict();

const RehearsalHealthSchema = z
  .object({
    ok: z.literal(true),
    deployment: z.literal("local"),
    repository: z.literal("firestore"),
    repositoryReachable: z.literal(true),
    geminiConfigured: z.literal(true),
    agentMode: z.literal("gemini"),
    modelId: GeminiModelSchema,
    agentFramework: z.literal("google-adk-typescript"),
  })
  .passthrough();

export const LocalProductionRehearsalManifestSchema = z
  .object({
    schemaVersion: z.literal(LOCAL_REHEARSAL_SCHEMA_VERSION),
    generatedAt: z.iso.datetime(),
    evidenceBoundary: z.literal(LOCAL_REHEARSAL_EVIDENCE_BOUNDARY),
    claims: z
      .object({
        liveGeminiAdk: z.literal(true),
        productionContainer: z.literal(true),
        firestoreProductionAdapter: z.literal(true),
        firestoreEmulator: z.literal(true),
        applicationRestartPersistence: z.literal(true),
        managedFirestore: z.literal(false),
        cloudRun: z.literal(false),
        deployed: z.literal(false),
      })
      .strict(),
    emulator: z
      .object({
        projectId: z.literal(LOCAL_REHEARSAL_PROJECT_ID),
        host: z.literal(LOCAL_REHEARSAL_EMULATOR_HOST),
        firebaseToolsVersion: z.literal(
          LOCAL_REHEARSAL_FIREBASE_TOOLS_VERSION,
        ),
        dataSurvivedApplicationRestart: z.literal(true),
      })
      .strict(),
    container: z
      .object({
        imageTag: z.string().min(1),
        imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        generations: z.literal(2),
        user: z.literal("node"),
        readOnlyRootFilesystem: z.literal(true),
        capDropAll: z.literal(true),
        noNewPrivileges: z.literal(true),
        loopbackPublishedPort: z.literal("127.0.0.1:8080:8080"),
        tmpfs: z.literal("/tmp:rw,noexec,nosuid,size=64m"),
      })
      .strict(),
    health: z
      .object({
        beforeRestart: RehearsalHealthSchema,
        afterRestart: RehearsalHealthSchema,
      })
      .strict(),
    journeys: z
      .array(
        z
          .object({
            phase: z.enum(["before_restart", "after_restart"]),
            summary: SmokeSummarySchema,
            finalView: z.record(z.string(), z.unknown()),
            closure: z.record(z.string(), z.unknown()),
          })
          .strict(),
      )
      .length(2),
    restartProof: z
      .object({
        originalRunId: z.string().min(1),
        readFromFreshProcess: z.literal(true),
        finalViewMatches: z.literal(true),
        closureMatches: z.literal(true),
      })
      .strict(),
  })
  .strict();

function parseEnvLocalValue(envLocalText, name) {
  const matches = envLocalText
    .split(/\r?\n/)
    .filter((line) => line.startsWith(`${name}=`));
  if (matches.length > 1) {
    throw new Error(`${name} appears more than once in .env.local.`);
  }
  return matches.length === 1 ? matches[0].slice(name.length + 1) : undefined;
}

export function parseLocalRehearsalConfig({
  environment,
  envLocalText,
  workspaceRoot,
}) {
  if (environment.K_SERVICE || environment.K_REVISION) {
    throw new Error(
      "Local rehearsal refuses Cloud Run runtime markers (K_SERVICE/K_REVISION).",
    );
  }
  const projectId =
    environment.GCLOUD_PROJECT ?? environment.GOOGLE_CLOUD_PROJECT;
  return RehearsalConfigSchema.parse({
    workspaceRoot,
    emulatorHost: environment.FIRESTORE_EMULATOR_HOST,
    projectId,
    geminiApiKey: parseEnvLocalValue(envLocalText, "GEMINI_API_KEY"),
    geminiModel:
      parseEnvLocalValue(envLocalText, "COUNTERSTEP_GEMINI_MODEL") ??
      "gemini-3.5-flash-lite",
    imageTag:
      environment.COUNTERSTEP_REHEARSAL_IMAGE ??
      "counterstep:local-production-rehearsal",
    appPort: 8080,
    baseUrl: "http://127.0.0.1:8080",
    outputDirectory: `${workspaceRoot}/output/local-production-rehearsal`,
  });
}

export function buildContainerEnvironment(config) {
  return {
    NODE_ENV: "production",
    PORT: String(config.appPort),
    COUNTERSTEP_AGENT_MODE: "gemini",
    COUNTERSTEP_REPOSITORY: "firestore",
    COUNTERSTEP_GEMINI_MODEL: config.geminiModel,
    GEMINI_API_KEY: config.geminiApiKey,
    GOOGLE_CLOUD_PROJECT: LOCAL_REHEARSAL_PROJECT_ID,
    GCLOUD_PROJECT: LOCAL_REHEARSAL_PROJECT_ID,
    FIRESTORE_DATABASE_ID: "(default)",
    FIRESTORE_EMULATOR_HOST: "host.docker.internal:8087",
    METADATA_SERVER_DETECTION: "none",
    COUNTERSTEP_MAX_DAILY_RUNS: "10",
    COUNTERSTEP_AGENT_TIMEOUT_MS: "30000",
  };
}

export function serializeContainerEnvironment(environment) {
  return `${Object.entries(environment)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => {
      if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
        throw new Error(`Invalid container environment variable name: ${name}`);
      }
      if (typeof value !== "string" || /[\r\n\0]/.test(value)) {
        throw new Error(`Container environment value for ${name} is unsafe.`);
      }
      return `${name}=${value}`;
    })
    .join("\n")}\n`;
}

export function buildDockerRunArgs({ config, containerName, envFilePath }) {
  if (!/^[a-z0-9][a-z0-9_.-]+$/.test(containerName)) {
    throw new Error("Generated container name is invalid.");
  }
  return [
    "run",
    "--detach",
    "--rm",
    "--name",
    containerName,
    "--publish",
    `127.0.0.1:${config.appPort}:8080`,
    "--env-file",
    envFilePath,
    "--add-host",
    "host.docker.internal:host-gateway",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=64m",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    config.imageTag,
  ];
}

export function validateLocalProductionRehearsalManifest(manifest) {
  return LocalProductionRehearsalManifestSchema.parse(manifest);
}
