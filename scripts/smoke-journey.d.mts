export type SmokeSummary = {
  run: number;
  runId: string;
  status: string;
  modelId: string;
  toolCalls: number;
  writes: number;
  recordedEvents: number;
  closureDigest: string;
  actionReceiptVerdict: string;
};

export type SmokeJourney = {
  summary: SmokeSummary;
  finalView: Record<string, unknown>;
  closure: Record<string, unknown>;
};

export function parseSmokeRunCount(
  value: string | undefined,
  variableName?: string,
): number;
export function requestJson(
  baseUrl: string,
  path: string,
  init?: RequestInit,
  fetchImpl?: typeof fetch,
): Promise<Record<string, unknown>>;
export function runSmokeJourney(input: {
  baseUrl: string;
  runNumber: number;
  request?: typeof requestJson;
}): Promise<SmokeJourney>;
export function runSmokeJourneys(input: {
  baseUrl: string;
  runCount: number;
  assertHealth: (health: unknown) => void;
  request?: typeof requestJson;
}): Promise<{
  health: Record<string, unknown>;
  journeys: SmokeJourney[];
}>;
