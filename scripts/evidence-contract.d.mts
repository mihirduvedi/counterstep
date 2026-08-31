export const CLOSURE_QUALIFIER: string;
export function computeClosureDigest(closure: unknown): string;
export function assertLiveHealth(
  health: unknown,
  options?: { requireCloud?: boolean },
): void;
export function assertLocalProductionRehearsalHealth(health: unknown): void;
export function assertLiveRunEvidence(view: unknown): void;
export function assertClosureAvailable(view: unknown): void;
export function assertDownloadedClosure(
  view: unknown,
  downloadedClosure: unknown,
): void;
