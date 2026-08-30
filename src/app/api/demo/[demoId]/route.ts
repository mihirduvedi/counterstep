import { ApiError, errorResponse, jsonResponse } from "@/counterstep/http";
import { getRuntime } from "@/counterstep/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ demoId: string }> },
): Promise<Response> {
  try {
    const { demoId } = await context.params;
    const view = await getRuntime().service.getDemoView(demoId);
    if (!view) throw new ApiError(404, "demo_not_found", "Demo not found.");
    return jsonResponse(view);
  } catch (error) {
    return errorResponse(error);
  }
}
