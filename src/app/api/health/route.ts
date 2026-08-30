import { jsonResponse } from "@/counterstep/http";
import {
  COUNTERSTEP_APP_VERSION,
  getAgentMode,
  getGeminiModel,
  getRuntime,
  isCloudRun,
} from "@/counterstep/runtime";
import { HealthResponseSchema } from "@/counterstep/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const { repository } = getRuntime();
  const payload = HealthResponseSchema.parse({
    ok: true,
    appVersion: COUNTERSTEP_APP_VERSION,
    deployment: isCloudRun() ? "cloud-run" : "local",
    repository: repository.kind,
    repositoryReachable: await repository.ping(),
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    agentMode: getAgentMode(),
    modelId: getGeminiModel(),
    agentFramework: "google-adk-typescript",
  });
  return jsonResponse(payload, payload.repositoryReachable ? 200 : 503);
}
