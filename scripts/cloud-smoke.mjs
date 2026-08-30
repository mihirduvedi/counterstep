#!/usr/bin/env node

const baseUrl = process.env.COUNTERSTEP_BASE_URL?.replace(/\/$/, "");
if (!baseUrl) {
  console.error("COUNTERSTEP_BASE_URL is required.");
  process.exit(1);
}

async function json(path, init) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

try {
  const health = await json("/api/health");
  if (health.deployment !== "cloud-run") throw new Error("Target does not identify as Cloud Run.");
  if (health.repository !== "firestore" || !health.repositoryReachable) {
    throw new Error("Target is not connected to reachable Firestore persistence.");
  }
  if (health.agentMode !== "gemini" || !health.geminiConfigured) {
    throw new Error("Target is not running in Gemini mode.");
  }
  const demo = await json("/api/demo/reset", { method: "POST", body: "{}" });
  const created = await json("/api/remediation-runs", {
    method: "POST",
    body: JSON.stringify({
      demoId: demo.demo.demoId,
      sourceReceiptDigest: demo.demo.sourceReceiptDigest,
    }),
  });
  const finalView = await json(`/api/remediation-runs/${encodeURIComponent(created.run.runId)}/execute`, {
    method: "POST",
    body: "{}",
  });
  const closureResponse = await fetch(
    `${baseUrl}/api/remediation-runs/${encodeURIComponent(created.run.runId)}/closure-receipt`,
  );
  if (!closureResponse.ok) throw new Error("Closure receipt download failed.");
  const closure = await closureResponse.json();
  console.log(JSON.stringify({
    url: baseUrl,
    runId: finalView.run.runId,
    status: finalView.run.status,
    writes: finalView.run.writeCount,
    closureDigest: closure.integrity?.digest,
  }, null, 2));
  if (finalView.run.status !== "repaired" || finalView.run.writeCount !== 2) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
