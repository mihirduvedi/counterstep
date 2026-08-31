export const LOCAL_REHEARSAL_SCHEMA_VERSION: string;
export const LOCAL_REHEARSAL_PROJECT_ID: "demo-counterstep";
export const LOCAL_REHEARSAL_EMULATOR_HOST: "127.0.0.1:8087";
export const LOCAL_REHEARSAL_FIREBASE_TOOLS_VERSION: "15.28.2";
export const LOCAL_REHEARSAL_EVIDENCE_BOUNDARY: string;

export type LocalRehearsalConfig = {
  workspaceRoot: string;
  emulatorHost: "127.0.0.1:8087";
  projectId: "demo-counterstep";
  geminiApiKey: string;
  geminiModel: string;
  imageTag: string;
  appPort: 8080;
  baseUrl: "http://127.0.0.1:8080";
  outputDirectory: string;
};

export function parseLocalRehearsalConfig(input: {
  environment: NodeJS.ProcessEnv;
  envLocalText: string;
  workspaceRoot: string;
}): LocalRehearsalConfig;
export function buildContainerEnvironment(
  config: LocalRehearsalConfig,
): Record<string, string>;
export function serializeContainerEnvironment(
  environment: Record<string, string>,
): string;
export function buildDockerRunArgs(input: {
  config: LocalRehearsalConfig;
  containerName: string;
  envFilePath: string;
}): string[];
export function validateLocalProductionRehearsalManifest(
  manifest: unknown,
): Record<string, unknown>;
export const LocalProductionRehearsalManifestSchema: {
  parse(value: unknown): Record<string, unknown>;
};
