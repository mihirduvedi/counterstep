import { executeCounterstepRun } from "@/counterstep/execution";
import { ApiError, errorResponse, jsonResponse, parseJsonBody } from "@/counterstep/http";
import { getRuntime } from "@/counterstep/runtime";
import { ResetDemoRequestSchema } from "@/counterstep/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  try {
    await parseJsonBody(request, ResetDemoRequestSchema);
    const { runId } = await context.params;
    const current = await getRuntime().service.getRunView(runId);
    if (!current) throw new ApiError(404, "run_not_found", "Run not found.");
    const claimed = await getRuntime().repository.claimRunForExecution(runId);
    if (!claimed) {
      throw new ApiError(
        409,
        "run_already_started",
        "This remediation run has already started.",
      );
    }
    const finalView = await executeCounterstepRun(runId);
    return jsonResponse(finalView);
  } catch (error) {
    return errorResponse(error);
  }
}
