import { errorResponse, jsonResponse, parseJsonBody } from "@/counterstep/http";
import {
  getAgentMode,
  getGeminiModel,
  getRuntime,
} from "@/counterstep/runtime";
import { StartRunRequestSchema } from "@/counterstep/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const input = await parseJsonBody(request, StartRunRequestSchema);
    const mode = getAgentMode();
    const generationSource =
      mode === "gemini"
        ? "gemini"
        : mode === "fixture"
          ? "deterministic_fixture"
          : "deterministic_no_execution";
    const { service } = getRuntime();
    const run = await service.createRun({
      ...input,
      generationSource,
      modelId: mode === "gemini" ? getGeminiModel() : undefined,
    });
    const view = await service.getRunView(run.runId);
    return jsonResponse(view, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
