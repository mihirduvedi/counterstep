#!/usr/bin/env node

const baseUrl = (process.env.COUNTERSTEP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");

async function json(path, init) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

try {
  const health = await json("/api/health");
  if (health.agentMode !== "gemini" || !health.geminiConfigured) {
    throw new Error("Live evaluation requires a running server in configured Gemini mode.");
  }
  const demo = await json("/api/demo/reset", { method: "POST", body: "{}" });
  const created = await json("/api/remediation-runs", {
    method: "POST",
    body: JSON.stringify({
      demoId: demo.demo.demoId,
      sourceReceiptDigest: demo.demo.sourceReceiptDigest,
    }),
  });
  const result = await json(`/api/remediation-runs/${encodeURIComponent(created.run.runId)}/execute`, {
    method: "POST",
    body: "{}",
  });
  const summary = {
    runId: result.run.runId,
    modelId: result.run.modelId,
    status: result.run.status,
    toolCalls: result.run.toolCallCount,
    writes: result.run.writeCount,
    recordedEvents: result.events.length,
    closureDigest: result.closure?.integrity.digest,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (result.run.status !== "repaired" || !result.closure) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
