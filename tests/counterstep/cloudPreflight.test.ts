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
      buildServiceAccount: "counterstep-build",
      serviceAccount: "counterstep-runtime",
    });
  });

  it.each([
    {},
    { COUNTERSTEP_GCP_PROJECT: "UPPERCASE" },
    {
      COUNTERSTEP_GCP_PROJECT: "counterstep-demo-123",
      COUNTERSTEP_GCP_REGION: "global",
    },
  ])("rejects ambiguous or unpinned configuration", (environment) => {
    expect(() => parseCloudPreflightConfig(environment)).toThrow();
  });

  it("locks the public Cloud Run demo to the fixture cost, quota, identity, and secret envelope", () => {
    const config = readFileSync("cloudbuild.yaml", "utf8");
    expect(config).toContain("--service-account=${_SERVICE_ACCOUNT}@$PROJECT_ID.iam.gserviceaccount.com");
    expect(config).toContain("COUNTERSTEP_AGENT_MODE=fixture");
    expect(config).toContain("COUNTERSTEP_REPOSITORY=memory");
    expect(config).not.toContain("COUNTERSTEP_AGENT_MODE=gemini");
    expect(config).not.toContain("COUNTERSTEP_REPOSITORY=firestore");
    expect(config).not.toContain("GOOGLE_GENAI_USE_ENTERPRISE");
    expect(config).not.toContain("GOOGLE_CLOUD_PROJECT=");
    expect(config).not.toContain("GOOGLE_CLOUD_LOCATION=");
    expect(config).not.toContain("FIRESTORE_DATABASE_ID=");
    expect(config).toContain("--memory=512Mi");
    expect(config).toContain("COUNTERSTEP_MAX_DAILY_RUNS=10");
    expect(config).toContain("--cpu-throttling");
    expect(config).toContain("--no-cpu-boost");
    expect(config).toContain("--timeout=30");
    expect(config).toContain("--concurrency=1");
    expect(config).toContain("--no-session-affinity");
    expect(config).toContain("--min=0");
    expect(config).toContain("--max=1");
    expect(config).toContain("--min-instances=0");
    expect(config).toContain("--max-instances=1");
    expect(config).toContain(
      "serviceAccount: projects/$PROJECT_ID/serviceAccounts/${_BUILD_SERVICE_ACCOUNT}@$PROJECT_ID.iam.gserviceaccount.com",
    );
    expect(config).toContain("logging: CLOUD_LOGGING_ONLY");
    expect(config).not.toContain("--set-secrets");
    expect(config).toContain("--remove-secrets=GEMINI_API_KEY");
    expect(config).not.toContain(":latest");
  });

  it("copies only build outputs that exist in the production image", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    expect(dockerfile).toContain("/app/.next/standalone");
    expect(dockerfile).toContain("/app/.next/static");
    expect(dockerfile).not.toContain("/app/public");
  });

  it("runs managed Firestore evidence with the isolated build identity", () => {
    const config = readFileSync("cloudbuild.managed-firestore.yaml", "utf8");
    expect(config).toContain(
      "COUNTERSTEP_MANAGED_FIRESTORE_CONFIRM_PROJECT=$PROJECT_ID",
    );
    expect(config).toContain("COUNTERSTEP_MANAGED_FIRESTORE_DATABASE_ID=(default)");
    expect(config).toContain(
      "COUNTERSTEP_MANAGED_FIRESTORE_WRITE_ACK=I_ACKNOWLEDGE_COUNTERSTEP_MANAGED_FIRESTORE_WRITES",
    );
    expect(config).toContain(
      "serviceAccount: projects/$PROJECT_ID/serviceAccounts/counterstep-build@$PROJECT_ID.iam.gserviceaccount.com",
    );
    expect(config).toContain("logging: CLOUD_LOGGING_ONLY");
    expect(config).not.toContain("GEMINI_API_KEY");
  });
});
