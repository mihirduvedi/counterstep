import "server-only";

import { runGeminiRecovery } from "./adkAgent";
import { getAgentMode, getGeminiModel, getRuntime } from "./runtime";
import type { PublicRunView } from "./schemas";

export async function executeCounterstepRun(
  runId: string,
): Promise<PublicRunView> {
  const { service } = getRuntime();
  const mode = getAgentMode();
  if (mode === "fixture") return service.runFixture(runId);
  if (mode === "gemini") {
    const parsedTimeout = Number.parseInt(
      process.env.COUNTERSTEP_AGENT_TIMEOUT_MS || "30000",
      10,
    );
    return runGeminiRecovery({
      service,
      runId,
      modelId: getGeminiModel(),
      timeoutMs:
        Number.isFinite(parsedTimeout) && parsedTimeout >= 5_000
          ? Math.min(parsedTimeout, 120_000)
          : 30_000,
    });
  }
  return service.failClosedWithoutExecution(
    runId,
    "gemini_not_configured",
    "No Gemini credential is configured, so Counterstep applied zero writes. Set GEMINI_API_KEY or explicitly use fixture mode for local contract testing.",
  );
}
