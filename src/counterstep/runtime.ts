import "server-only";

import { FirestoreCounterstepRepository } from "./firestoreRepository";
import { InMemoryCounterstepRepository } from "./memoryRepository";
import type { CounterstepRepository } from "./repository";
import { CounterstepService } from "./service";

export const COUNTERSTEP_APP_VERSION = "0.1.0";
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

export type AgentMode = "gemini" | "fixture" | "no_execution";

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
    return process.env.GEMINI_API_KEY ? "gemini" : "no_execution";
  }
  if (process.env.NODE_ENV !== "production") return "fixture";
  return process.env.GEMINI_API_KEY ? "gemini" : "no_execution";
}

export function getGeminiModel(): string {
  return process.env.COUNTERSTEP_GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
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
