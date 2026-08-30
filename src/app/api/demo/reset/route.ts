import { errorResponse, jsonResponse, parseJsonBody } from "@/counterstep/http";
import { getRuntime } from "@/counterstep/runtime";
import { ResetDemoRequestSchema } from "@/counterstep/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    await parseJsonBody(request, ResetDemoRequestSchema);
    const view = await getRuntime().service.resetDemo();
    return jsonResponse(view, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
