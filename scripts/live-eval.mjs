#!/usr/bin/env node

import {
  assertClosureAvailable,
  assertDownloadedClosure,
  assertLiveHealth,
} from "./evidence-contract.mjs";

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
  assertLiveHealth(health);
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
  assertClosureAvailable(result);
  const closure = await json(
    `/api/remediation-runs/${encodeURIComponent(created.run.runId)}/closure-receipt`,
  );
  assertDownloadedClosure(result, closure);
  const summary = {
    runId: result.run.runId,
    modelId: result.run.modelId,
    status: result.run.status,
    toolCalls: result.run.toolCallCount,
    writes: result.run.writeCount,
    recordedEvents: result.events.length,
    closureDigest: result.closure?.integrity.digest,
    actionReceiptVerdict:
      result.closure?.remediation.actionReceipt.verdict,
  };
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
