import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  parseGeminiKeyForCacheScrub,
  scrubGeneratedSecretCache,
} from "../../scripts/scrub-generated-secret-cache.mjs";

const temporaryDirectories: string[] = [];

async function makeWorkspace() {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "counterstep-cache-scrub-test-"),
  );
  temporaryDirectories.push(workspaceRoot);
  const cacheDirectory = join(workspaceRoot, ".next", "cache", "turbopack");
  await mkdir(cacheDirectory, { recursive: true });
  return { workspaceRoot, cacheDirectory };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("generated Turbopack secret cache scrub", () => {
  it("parses one unquoted key without echoing or accepting ambiguous input", () => {
    expect(parseGeminiKeyForCacheScrub("GEMINI_API_KEY=fake-key\n")).toBe(
      "fake-key",
    );
    expect(parseGeminiKeyForCacheScrub("COUNTERSTEP_AGENT_MODE=gemini\n")).toBe(
      undefined,
    );
    expect(() =>
      parseGeminiKeyForCacheScrub(
        "GEMINI_API_KEY=first\nGEMINI_API_KEY=second\n",
      ),
    ).toThrow("appears more than once");
    expect(() =>
      parseGeminiKeyForCacheScrub('GEMINI_API_KEY="quoted"\n'),
    ).toThrow("unquoted");
  });

  it("removes the complete generated cache when any file contains the key", async () => {
    const { workspaceRoot, cacheDirectory } = await makeWorkspace();
    await writeFile(
      join(workspaceRoot, ".env.local"),
      "GEMINI_API_KEY=fake-cache-secret\n",
    );
    await writeFile(join(cacheDirectory, "metadata.sst"), "safe metadata");
    await writeFile(
      join(cacheDirectory, "payload.sst"),
      "prefix fake-cache-secret suffix",
    );

    await expect(scrubGeneratedSecretCache({ workspaceRoot })).resolves.toEqual({
      status: "scrubbed",
      filesScanned: 2,
      matches: 1,
    });
    await expect(access(cacheDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves a generated cache with no exact key copy", async () => {
    const { workspaceRoot, cacheDirectory } = await makeWorkspace();
    await writeFile(
      join(workspaceRoot, ".env.local"),
      "GEMINI_API_KEY=fake-cache-secret\n",
    );
    const cacheFile = join(cacheDirectory, "metadata.sst");
    await writeFile(cacheFile, "safe metadata");

    await expect(scrubGeneratedSecretCache({ workspaceRoot })).resolves.toEqual({
      status: "clean",
      filesScanned: 1,
      matches: 0,
    });
    await expect(readFile(cacheFile, "utf8")).resolves.toBe("safe metadata");
  });
});
