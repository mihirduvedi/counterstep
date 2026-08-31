import { jsonResponse } from "@/counterstep/http";
import { listDemoScenarios } from "@/counterstep/scenarios";
import { ScenarioCatalogResponseSchema } from "@/counterstep/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return jsonResponse(
    ScenarioCatalogResponseSchema.parse({ scenarios: listDemoScenarios() }),
  );
}
