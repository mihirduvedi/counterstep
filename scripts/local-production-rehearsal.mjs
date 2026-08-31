#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  assertDownloadedClosure,
  assertLocalProductionRehearsalHealth,
} from "./evidence-contract.mjs";
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
} from "./local-production-rehearsal-lib.mjs";
import { requestJson, runSmokeJourney } from "./smoke-journey.mjs";

const execFileAsync = promisify(execFile);
const workspaceRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const envLocalPath = join(workspaceRoot, ".env.local");
const dockerIgnorePath = join(workspaceRoot, ".dockerignore");
const activeContainers = new Set();
let temporaryDirectory;
let secretForRedaction = "";
let cleanupPromise;

function redact(value) {
  const message = value instanceof Error ? value.message : String(value);
  return secretForRedaction
    ? message.split(secretForRedaction).join("[REDACTED]")
    : message;
}

async function runCommand(command, args, options = {}) {
  return execFileAsync(command, args, {
    cwd: workspaceRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
}

async function runStreamingCommand(command, args) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else {
        rejectPromise(
          new Error(
            `${command} exited ${code ?? "without a code"}${
              signal ? ` after ${signal}` : ""
            }.`,
          ),
        );
      }
    });
  });
}

async function assertPortAvailable(port) {
  await new Promise((resolvePromise, rejectPromise) => {
    const server = createServer();
    server.once("error", (error) => {
      rejectPromise(
        new Error(
          `127.0.0.1:${port} is unavailable; stop the existing listener before rehearsing (${redact(
            error,
          )}).`,
        ),
      );
    });
    server.listen(port, "127.0.0.1", () => {
      server.close((error) =>
        error ? rejectPromise(error) : resolvePromise(),
      );
    });
  });
}

async function assertSecretFileSafety() {
  const fileStat = await stat(envLocalPath);
  if (!fileStat.isFile()) throw new Error(".env.local is not a regular file.");
  if ((fileStat.mode & 0o077) !== 0) {
    throw new Error(
      ".env.local must not be readable or writable by group or other users; run chmod 600 .env.local.",
    );
  }
  const dockerIgnore = await readFile(dockerIgnorePath, "utf8");
  if (!dockerIgnore.split(/\r?\n/).includes(".env*")) {
    throw new Error(
      ".dockerignore must contain an exact .env* rule before a credentialed rehearsal.",
    );
  }
}

async function assertDockerAvailable() {
  try {
    const result = await runCommand("docker", [
      "info",
      "--format",
      "{{.ServerVersion}}",
    ]);
    if (!result.stdout.trim()) throw new Error("Docker returned no server version.");
    return result.stdout.trim();
  } catch (error) {
    throw new Error(
      `Docker Desktop is not ready. Start or restart it, then rerun npm run rehearse:local (${redact(
        error,
      )}).`,
    );
  }
}

async function stopContainer(containerName) {
  if (!activeContainers.has(containerName)) return;
  try {
    await runCommand("docker", ["rm", "--force", containerName]);
  } catch {
    // A container started with --rm may already be gone.
  } finally {
    activeContainers.delete(containerName);
  }
}

async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    for (const containerName of [...activeContainers]) {
      await stopContainer(containerName);
    }
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      temporaryDirectory = undefined;
    }
  })();
  return cleanupPromise;
}

async function waitForHealthyContainer(config, containerName) {
  let lastError = "health endpoint was not ready";
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const health = await requestJson(config.baseUrl, "/api/health");
      assertLocalProductionRehearsalHealth(health);
      return health;
    } catch (error) {
      lastError = redact(error);
    }
    const state = await runCommand("docker", [
      "inspect",
      "--format",
      "{{.State.Running}}",
      containerName,
    ]).catch(() => ({ stdout: "false" }));
    if (state.stdout.trim() !== "true") {
      const logs = await runCommand("docker", [
        "logs",
        "--tail",
        "80",
        containerName,
      ]).catch(() => ({ stdout: "", stderr: "" }));
      const safeLogs = redact(`${logs.stdout}${logs.stderr}`).trim();
      throw new Error(
        `Production container exited before becoming healthy.${
          safeLogs ? `\n${safeLogs}` : ""
        }`,
      );
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  }
  throw new Error(`Production container health timed out: ${lastError}`);
}

async function inspectContainerSecurity(containerName) {
  const inspectValue = async (template) =>
    (await runCommand("docker", ["inspect", "--format", template, containerName]))
      .stdout.trim();
  const [user, readOnly, capDropRaw, securityOptRaw, tmpfsRaw, publishedPort] =
    await Promise.all([
      inspectValue("{{.Config.User}}"),
      inspectValue("{{.HostConfig.ReadonlyRootfs}}"),
      inspectValue("{{json .HostConfig.CapDrop}}"),
      inspectValue("{{json .HostConfig.SecurityOpt}}"),
      inspectValue("{{json .HostConfig.Tmpfs}}"),
      runCommand("docker", ["port", containerName, "8080/tcp"]).then(
        ({ stdout }) => stdout.trim(),
      ),
    ]);
  const capDrop = JSON.parse(capDropRaw);
  const securityOptions = JSON.parse(securityOptRaw);
  const tmpfs = JSON.parse(tmpfsRaw);
  const tmpfsOptions = new Set(String(tmpfs["/tmp"] ?? "").split(","));
  const expectedTmpfsOptions = ["rw", "noexec", "nosuid", "size=64m"];
  const security = {
    user,
    readOnlyRootFilesystem: readOnly === "true",
    capDropAll: Array.isArray(capDrop) && capDrop.includes("ALL"),
    noNewPrivileges:
      Array.isArray(securityOptions) &&
      securityOptions.includes("no-new-privileges:true"),
    loopbackPublishedPort: publishedPort,
    tmpfsValid: expectedTmpfsOptions.every((option) =>
      tmpfsOptions.has(option),
    ),
  };
  if (
    security.user !== "node" ||
    !security.readOnlyRootFilesystem ||
    !security.capDropAll ||
    !security.noNewPrivileges ||
    security.loopbackPublishedPort !== "127.0.0.1:8080" ||
    !security.tmpfsValid
  ) {
    throw new Error(
      "Production container does not satisfy the rehearsal security contract.",
    );
  }
  return security;
}

async function startContainer(config, containerName, envFilePath) {
  const args = buildDockerRunArgs({ config, containerName, envFilePath });
  await runCommand("docker", args);
  activeContainers.add(containerName);
  const health = await waitForHealthyContainer(config, containerName);
  const security = await inspectContainerSecurity(containerName);
  return { health, security };
}

function createManifest({
  config,
  generatedAt,
  imageId,
  before,
  after,
  beforeJourney,
  afterJourney,
}) {
  return validateLocalProductionRehearsalManifest({
    schemaVersion: LOCAL_REHEARSAL_SCHEMA_VERSION,
    generatedAt,
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
      imageTag: config.imageTag,
      imageId,
      generations: 2,
      user: before.security.user,
      readOnlyRootFilesystem: before.security.readOnlyRootFilesystem,
      capDropAll: before.security.capDropAll,
      noNewPrivileges: before.security.noNewPrivileges,
      loopbackPublishedPort: "127.0.0.1:8080:8080",
      tmpfs: "/tmp:rw,noexec,nosuid,size=64m",
    },
    health: {
      beforeRestart: before.health,
      afterRestart: after.health,
    },
    journeys: [
      {
        phase: "before_restart",
        summary: beforeJourney.summary,
        finalView: beforeJourney.finalView,
        closure: beforeJourney.closure,
      },
      {
        phase: "after_restart",
        summary: afterJourney.summary,
        finalView: afterJourney.finalView,
        closure: afterJourney.closure,
      },
    ],
    restartProof: {
      originalRunId: beforeJourney.summary.runId,
      readFromFreshProcess: true,
      finalViewMatches: true,
      closureMatches: true,
    },
  });
}

async function main() {
  await assertSecretFileSafety();
  const envLocalText = await readFile(envLocalPath, "utf8");
  const config = parseLocalRehearsalConfig({
    environment: process.env,
    envLocalText,
    workspaceRoot,
  });
  secretForRedaction = config.geminiApiKey;

  await assertPortAvailable(config.appPort);
  const dockerVersion = await assertDockerAvailable();
  console.log(`Docker ${dockerVersion} is ready.`);
  console.log(
    `Building ${config.imageTag}; .env.local is excluded from the build context.`,
  );
  await runStreamingCommand("docker", [
    "build",
    "--progress",
    "plain",
    "--tag",
    config.imageTag,
    ".",
  ]);
  const imageId = (
    await runCommand("docker", ["image", "inspect", "--format", "{{.Id}}", config.imageTag])
  ).stdout.trim();

  temporaryDirectory = await mkdtemp(join(tmpdir(), "counterstep-rehearsal-"));
  await chmod(temporaryDirectory, 0o700);
  const envFilePath = join(temporaryDirectory, "container.env");
  await writeFile(
    envFilePath,
    serializeContainerEnvironment(buildContainerEnvironment(config)),
    { mode: 0o600, flag: "wx" },
  );

  const suffix = `${process.pid}-${Date.now()}`;
  const firstContainer = `counterstep-rehearsal-${suffix}-a`;
  const secondContainer = `counterstep-rehearsal-${suffix}-b`;

  console.log("Starting production container generation 1 of 2.");
  const before = await startContainer(config, firstContainer, envFilePath);
  const beforeJourney = await runSmokeJourney({
    baseUrl: config.baseUrl,
    runNumber: 1,
  });

  console.log(
    `First strict live journey repaired ${beforeJourney.summary.runId}; restarting the application container.`,
  );
  await stopContainer(firstContainer);
  await assertPortAvailable(config.appPort);

  const after = await startContainer(config, secondContainer, envFilePath);
  const encodedRunId = encodeURIComponent(beforeJourney.summary.runId);
  const persistedView = await requestJson(
    config.baseUrl,
    `/api/remediation-runs/${encodedRunId}`,
  );
  const persistedClosure = await requestJson(
    config.baseUrl,
    `/api/remediation-runs/${encodedRunId}/closure-receipt`,
  );
  assertDownloadedClosure(persistedView, persistedClosure);
  if (!isDeepStrictEqual(persistedView, beforeJourney.finalView)) {
    throw new Error(
      "The fresh application process returned a different persisted run view.",
    );
  }
  if (!isDeepStrictEqual(persistedClosure, beforeJourney.closure)) {
    throw new Error(
      "The fresh application process returned a different closure receipt.",
    );
  }

  console.log(
    "The fresh process reproduced the first run and closure exactly; running journey 2 of 2.",
  );
  const afterJourney = await runSmokeJourney({
    baseUrl: config.baseUrl,
    runNumber: 2,
  });
  const generatedAt = new Date().toISOString();
  const manifest = createManifest({
    config,
    generatedAt,
    imageId,
    before,
    after,
    beforeJourney,
    afterJourney,
  });
  await mkdir(config.outputDirectory, { recursive: true });
  const timestamp = generatedAt.replace(/[:.]/g, "-");
  const manifestPath = join(
    config.outputDirectory,
    `rehearsal-${timestamp}.json`,
  );
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });

  console.log(
    JSON.stringify(
      {
        result: "passed",
        evidenceBoundary: LOCAL_REHEARSAL_EVIDENCE_BOUNDARY,
        artifact: manifestPath,
        claims: manifest.claims,
        runs: manifest.journeys.map((journey) => journey.summary),
      },
      null,
      2,
    ),
  );
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void cleanup().finally(() => {
      process.kill(process.pid, signal);
    });
  });
}

try {
  await main();
} catch (error) {
  console.error(`Local production rehearsal failed: ${redact(error)}`);
  process.exitCode = 1;
} finally {
  await cleanup();
}
