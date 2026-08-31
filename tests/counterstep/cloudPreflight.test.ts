import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { parseCloudPreflightConfig } from "../../scripts/cloud-preflight.mjs";

describe("read-only Cloud deployment preflight", () => {
  it("requires an explicit project and uses deployment-locked defaults", () => {
    expect(
      parseCloudPreflightConfig({
        COUNTERSTEP_GCP_PROJECT: "counterstep-demo-123",
      }),
    ).toStrictEqual({
      project: "counterstep-demo-123",
      region: "us-central1",
      service: "counterstep",
      repository: "counterstep",
      serviceAccount: "counterstep-runtime",
      secret: "counterstep-gemini-api-key",
      secretVersion: "1",
    });
  });

  it.each([
    {},
    { COUNTERSTEP_GCP_PROJECT: "UPPERCASE" },
    {
      COUNTERSTEP_GCP_PROJECT: "counterstep-demo-123",
      COUNTERSTEP_GEMINI_SECRET_VERSION: "latest",
    },
  ])("rejects ambiguous or unpinned configuration", (environment) => {
    expect(() => parseCloudPreflightConfig(environment)).toThrow();
  });

  it("locks Cloud Run to the P0 cost, identity, and secret envelope", () => {
    const config = readFileSync("cloudbuild.yaml", "utf8");
    expect(config).toContain("--service-account=${_SERVICE_ACCOUNT}@$PROJECT_ID.iam.gserviceaccount.com");
    expect(config).toContain("--set-secrets=GEMINI_API_KEY=counterstep-gemini-api-key:${_GEMINI_SECRET_VERSION}");
    expect(config).toContain("--memory=512Mi");
    expect(config).toContain("--timeout=60");
    expect(config).toContain("--concurrency=1");
    expect(config).toContain("--min-instances=0");
    expect(config).toContain("--max-instances=1");
    expect(config).not.toContain(":latest");
  });

  it("copies only build outputs that exist in the production image", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    expect(dockerfile).toContain("/app/.next/standalone");
    expect(dockerfile).toContain("/app/.next/static");
    expect(dockerfile).not.toContain("/app/public");
  });
});
