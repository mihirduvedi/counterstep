import { serializeClosureReceipt } from "@/counterstep/closure";
import { ApiError, errorResponse } from "@/counterstep/http";
import { getRuntime } from "@/counterstep/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  try {
    const { runId } = await context.params;
    const closure = await getRuntime().repository.getClosure(runId);
    if (!closure) {
      throw new ApiError(
        404,
        "closure_not_found",
        "No closure receipt exists for this run.",
      );
    }
    return new Response(serializeClosureReceipt(closure), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="counterstep-closure-${runId}.json"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
