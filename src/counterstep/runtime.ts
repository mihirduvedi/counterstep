import "server-only";

import { z } from "zod";

import { FirestoreCounterstepRepository } from "./firestoreRepository";
import { InMemoryCounterstepRepository } from "./memoryRepository";
import type { CounterstepRepository } from "./repository";
import {
  RunExecutionAdmissionSchema,
  type RunExecutionAdmission,
} from "./schemas";
import { CounterstepService } from "./service";

export const COUNTERSTEP_APP_VERSION = "0.1.0";
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

export type AgentMode = "gemini" | "fixture" | "no_execution";
export type GeminiBackend = "gemini-api" | "vertex-ai" | "unconfigured";

const DailyRunLimitEnvironmentSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(10_000);

type Runtime = {
  version: "counterstep-runtime-v2";
  repository: CounterstepRepository;
  service: CounterstepService;
};

const globalRuntime = globalThis as typeof globalThis & {
  __counterstepRuntime?: Runtime;
};

export function getAgentMode(): AgentMode {
  const configured = process.env.COUNTERSTEP_AGENT_MODE;
  if (configured === "fixture") return "fixture";
  if (configured === "no_execution") return "no_execution";
  if (configured === "gemini") {
    return getGeminiBackend() === "unconfigured" ? "no_execution" : "gemini";
  }
  if (process.env.NODE_ENV !== "production") return "fixture";
  return getGeminiBackend() === "unconfigured" ? "no_execution" : "gemini";
}

export function getGeminiBackend(): GeminiBackend {
  const enterpriseMode = ["1", "true"].includes(
    (process.env.GOOGLE_GENAI_USE_ENTERPRISE ?? "").toLowerCase(),
  );
  if (
    enterpriseMode &&
    process.env.GOOGLE_CLOUD_PROJECT &&
    process.env.GOOGLE_CLOUD_LOCATION
  ) {
    return "vertex-ai";
  }
  if (process.env.GEMINI_API_KEY) return "gemini-api";
  return "unconfigured";
}

export function getGeminiModel(): string {
  return process.env.COUNTERSTEP_GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
}

export function getDailyRunLimit(): number {
  return DailyRunLimitEnvironmentSchema.parse(
    process.env.COUNTERSTEP_MAX_DAILY_RUNS ?? "10",
  );
}

export function getRunExecutionAdmission(
  now: Date = new Date(),
): RunExecutionAdmission {
  const timestamp = now.toISOString();
  return RunExecutionAdmissionSchema.parse({
    dateKey: timestamp.slice(0, 10),
    maxRuns: getDailyRunLimit(),
    timestamp,
  });
}

export function getRuntime(): Runtime {
  if (globalRuntime.__counterstepRuntime?.version === "counterstep-runtime-v2") {
    return globalRuntime.__counterstepRuntime;
  }
  const repository: CounterstepRepository =
    process.env.COUNTERSTEP_REPOSITORY === "firestore"
      ? new FirestoreCounterstepRepository()
      : new InMemoryCounterstepRepository();
  const runtime = {
    version: "counterstep-runtime-v2" as const,
    repository,
    service: new CounterstepService(repository, {
      appVersion: COUNTERSTEP_APP_VERSION,
    }),
  };
  globalRuntime.__counterstepRuntime = runtime;
  return runtime;
}

export function isCloudRun(): boolean {
  return Boolean(process.env.K_SERVICE || process.env.K_REVISION);
}
