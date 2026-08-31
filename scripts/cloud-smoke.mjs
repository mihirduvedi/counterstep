#!/usr/bin/env node

import { assertLiveHealth } from "./evidence-contract.mjs";
import {
  parseSmokeRunCount,
  runSmokeJourneys,
} from "./smoke-journey.mjs";

const baseUrl = process.env.COUNTERSTEP_BASE_URL?.replace(/\/$/, "");
if (!baseUrl) {
  console.error("COUNTERSTEP_BASE_URL is required.");
  process.exit(1);
}

try {
  const configuredRuns = parseSmokeRunCount(
    process.env.COUNTERSTEP_SMOKE_RUNS,
    "COUNTERSTEP_SMOKE_RUNS",
  );
  const result = await runSmokeJourneys({
    baseUrl,
    runCount: configuredRuns,
    assertHealth: (health) =>
      assertLiveHealth(health, { requireCloud: true }),
  });
  console.log(
    JSON.stringify(
      { url: baseUrl, runs: result.journeys.map(({ summary }) => summary) },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
