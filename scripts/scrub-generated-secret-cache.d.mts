export type CacheScrubResult = {
  status:
    | "skipped_no_env_file"
    | "skipped_no_key"
    | "clean"
    | "scrubbed";
  filesScanned: number;
  matches: number;
};

export function parseGeminiKeyForCacheScrub(
  envLocalText: string,
): string | undefined;
export function scrubGeneratedSecretCache(input: {
  workspaceRoot: string;
}): Promise<CacheScrubResult>;
