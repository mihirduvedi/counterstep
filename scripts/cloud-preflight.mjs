#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

const ProjectIdSchema = z
  .string()
  .min(6)
  .max(30)
  .regex(/^[a-z][a-z0-9-]*[a-z0-9]$/);
const ResourceNameSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z][a-z0-9-]*[a-z0-9]$/);
const RegionSchema = z
  .string()
  .min(3)
  .max(40)
  .regex(/^[a-z]+-[a-z]+\d+$/);
const SecretVersionSchema = z.string().regex(/^[1-9]\d*$/);

const CloudPreflightConfigSchema = z
  .object({
    project: ProjectIdSchema,
    region: RegionSchema,
    service: ResourceNameSchema,
    repository: ResourceNameSchema,
    serviceAccount: ResourceNameSchema,
    secret: ResourceNameSchema,
    secretVersion: SecretVersionSchema,
  })
  .strict();

export function parseCloudPreflightConfig(environment = process.env) {
  return CloudPreflightConfigSchema.parse({
    project: environment.COUNTERSTEP_GCP_PROJECT,
    region: environment.COUNTERSTEP_GCP_REGION ?? "us-central1",
    service: environment.COUNTERSTEP_GCP_SERVICE ?? "counterstep",
    repository:
      environment.COUNTERSTEP_GCP_REPOSITORY ?? "counterstep",
    serviceAccount:
      environment.COUNTERSTEP_GCP_SERVICE_ACCOUNT ?? "counterstep-runtime",
    secret:
      environment.COUNTERSTEP_GEMINI_SECRET ??
      "counterstep-gemini-api-key",
    secretVersion:
      environment.COUNTERSTEP_GEMINI_SECRET_VERSION ?? "1",
  });
}

function failureDetail(stderr) {
  if (stderr.includes("BILLING_DISABLED")) return "billing_disabled";
  if (stderr.includes("SERVICE_DISABLED")) return "api_disabled";
  if (stderr.includes("NOT_FOUND") || stderr.includes("not found")) {
    return "resource_not_found";
  }
  if (stderr.includes("PERMISSION_DENIED") || stderr.includes("does not have permission")) {
    return "permission_denied";
  }
  return "gcloud_check_failed";
}

function runGcloud(args) {
  return spawnSync("gcloud", [...args, "--quiet"], {
    encoding: "utf8",
    env: {
      ...process.env,
      CLOUDSDK_CORE_DISABLE_PROMPTS: "1",
    },
  });
}

function check(name, args, validate = () => true, required = true) {
  const result = runGcloud(args);
  if (result.error) {
    return {
      name,
      required,
      status: "failed",
      detail: result.error.code === "ENOENT" ? "gcloud_not_found" : "gcloud_check_failed",
    };
  }
  if (result.status !== 0) {
    return {
      name,
      required,
      status: required ? "failed" : "not_present",
      detail: failureDetail(result.stderr || ""),
    };
  }
  try {
    const validation = validate(result.stdout.trim());
    return validation === true
      ? { name, required, status: "passed" }
      : {
          name,
          required,
          status: "failed",
          detail:
            typeof validation === "string"
              ? validation
              : "unexpected_response",
        };
  } catch {
    return { name, required, status: "failed", detail: "invalid_response" };
  }
}

export function runCloudPreflight(config) {
  const serviceAccountEmail =
    `${config.serviceAccount}@${config.project}.iam.gserviceaccount.com`;
  const requiredApis = [
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "firestore.googleapis.com",
    "iam.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
  ];
  const checks = [
    check(
      "active_gcloud_account",
      ["auth", "list", "--filter=status:ACTIVE", "--format=value(account)"],
      (output) => output.length > 0,
    ),
    check(
      "project_access",
      [
        "projects",
        "describe",
        config.project,
        "--format=value(projectId)",
      ],
      (output) => output === config.project,
    ),
    check(
      "billing_enabled",
      [
        "billing",
        "projects",
        "describe",
        config.project,
        "--format=value(billingEnabled)",
      ],
      (output) =>
        output === "True" || output === "true" || "billing_disabled",
    ),
    ...requiredApis.map((api) =>
      check(
        `api:${api}`,
        [
          "services",
          "list",
          "--enabled",
          `--project=${config.project}`,
          `--filter=config.name=${api}`,
          "--format=value(config.name)",
        ],
        (output) => output === api || "api_disabled",
      ),
    ),
    check(
      "firestore_default_database",
      [
        "firestore",
        "databases",
        "describe",
        "--database=(default)",
        `--project=${config.project}`,
        "--format=value(name)",
      ],
      (output) => output.endsWith("/databases/(default)"),
    ),
    check(
      "artifact_repository",
      [
        "artifacts",
        "repositories",
        "describe",
        config.repository,
        `--location=${config.region}`,
        `--project=${config.project}`,
        "--format=value(name)",
      ],
      (output) => output.includes(`/repositories/${config.repository}`),
    ),
    check(
      "runtime_service_account",
      [
        "iam",
        "service-accounts",
        "describe",
        serviceAccountEmail,
        `--project=${config.project}`,
        "--format=value(email)",
      ],
      (output) => output === serviceAccountEmail,
    ),
    check(
      "gemini_secret_version",
      [
        "secrets",
        "versions",
        "describe",
        config.secretVersion,
        `--secret=${config.secret}`,
        `--project=${config.project}`,
        "--format=value(state)",
      ],
      (output) => output === "ENABLED",
    ),
    check(
      "cloud_run_service",
      [
        "run",
        "services",
        "describe",
        config.service,
        `--region=${config.region}`,
        `--project=${config.project}`,
        "--format=value(status.url)",
      ],
      (output) => output.startsWith("https://"),
      false,
    ),
  ];
  return {
    project: config.project,
    region: config.region,
    service: config.service,
    ready: checks.every(
      (item) => !item.required || item.status === "passed",
    ),
    checks,
  };
}

async function main() {
  try {
    const report = runCloudPreflight(parseCloudPreflightConfig());
    console.log(JSON.stringify(report, null, 2));
    if (!report.ready) process.exitCode = 1;
  } catch (error) {
    console.error(
      error instanceof Error
        ? `Cloud preflight configuration is invalid: ${error.message}`
        : "Cloud preflight configuration is invalid.",
    );
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;
if (invokedPath === import.meta.url) await main();
