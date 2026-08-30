import { ApiError, errorResponse, jsonResponse } from "@/counterstep/http";
import { getRuntime } from "@/counterstep/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  try {
    const { runId } = await context.params;
    const view = await getRuntime().service.getRunView(runId);
    if (!view) throw new ApiError(404, "run_not_found", "Run not found.");
    return jsonResponse(view);
  } catch (error) {
    return errorResponse(error);
  }
}
