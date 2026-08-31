export type CloudPreflightConfig = {
  project: string;
  region: string;
  service: string;
  repository: string;
  serviceAccount: string;
  secret: string;
  secretVersion: string;
};
export function parseCloudPreflightConfig(
  environment?: Record<string, string | undefined>,
): CloudPreflightConfig;
export function runCloudPreflight(config: CloudPreflightConfig): {
  project: string;
  region: string;
  service: string;
  ready: boolean;
  checks: Array<{
    name: string;
    required: boolean;
    status: string;
    detail?: string;
  }>;
};
