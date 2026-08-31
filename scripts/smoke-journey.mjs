import {
  assertClosureAvailable,
  assertDownloadedClosure,
} from "./evidence-contract.mjs";

export function parseSmokeRunCount(value, variableName = "smoke run count") {
  const raw = value ?? "2";
  if (!/^[1-5]$/.test(raw)) {
    throw new Error(`${variableName} must be an integer from 1 through 5.`);
  }
  return Number(raw);
}

export async function requestJson(baseUrl, path, init, fetchImpl = fetch) {
  const response = await fetchImpl(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${path} returned a non-JSON response (${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(
      `${path} returned ${response.status}: ${JSON.stringify(payload)}`,
    );
  }
  return payload;
}

export async function runSmokeJourney({
  baseUrl,
  runNumber,
  request = requestJson,
}) {
  const demo = await request(baseUrl, "/api/demo/reset", {
    method: "POST",
    body: "{}",
  });
  const created = await request(baseUrl, "/api/remediation-runs", {
    method: "POST",
    body: JSON.stringify({
      demoId: demo.demo.demoId,
      sourceReceiptDigest: demo.demo.sourceReceiptDigest,
    }),
  });
  const runId = created.run.runId;
  const finalView = await request(
    baseUrl,
    `/api/remediation-runs/${encodeURIComponent(runId)}/execute`,
    { method: "POST", body: "{}" },
  );
  assertClosureAvailable(finalView);
  const closure = await request(
    baseUrl,
    `/api/remediation-runs/${encodeURIComponent(runId)}/closure-receipt`,
  );
  assertDownloadedClosure(finalView, closure);
  return {
    summary: {
      run: runNumber,
      runId,
      status: finalView.run.status,
      modelId: finalView.run.modelId,
      toolCalls: finalView.run.toolCallCount,
      writes: finalView.run.writeCount,
      recordedEvents: finalView.events.length,
      closureDigest: closure.integrity.digest,
      actionReceiptVerdict:
        closure.remediation.actionReceipt.verdict,
    },
    finalView,
    closure,
  };
}

export async function runSmokeJourneys({
  baseUrl,
  runCount,
  assertHealth,
  request = requestJson,
}) {
  const health = await request(baseUrl, "/api/health");
  assertHealth(health);
  const journeys = [];
  for (let index = 0; index < runCount; index += 1) {
    journeys.push(
      await runSmokeJourney({
        baseUrl,
        runNumber: index + 1,
        request,
      }),
    );
  }
  return { health, journeys };
}
