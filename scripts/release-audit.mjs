#!/usr/bin/env node

import process from "node:process";

import {
  formatReleaseAudit,
  runReleaseAudit,
} from "../src/release/audit.ts";

try {
  const report = await runReleaseAudit(process.cwd());
  console.log(formatReleaseAudit(report));
  if (report.findings.length > 0) {
    process.exitCode = 1;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown release-audit failure.";
  console.error(`Release audit could not run: ${message}`);
  process.exitCode = 1;
}
