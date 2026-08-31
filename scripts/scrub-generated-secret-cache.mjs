#!/usr/bin/env node

import { readdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function parseGeminiKeyForCacheScrub(envLocalText) {
  const matches = envLocalText
    .split(/\r?\n/)
    .filter((line) => line.startsWith("GEMINI_API_KEY="));
  if (matches.length > 1) {
    throw new Error("GEMINI_API_KEY appears more than once in .env.local.");
  }
  if (matches.length === 0) return undefined;
  const value = matches[0].slice("GEMINI_API_KEY=".length);
  if (!value) return undefined;
  if (/[\s'"\0]/.test(value)) {
    throw new Error(
      "GEMINI_API_KEY must be an unquoted, single-line value before cache scrubbing.",
    );
  }
  return value;
}

async function readOptional(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function countExactMatches(directory, secretBuffer) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return { filesScanned: 0, matches: 0 };
    }
    throw error;
  }
  let filesScanned = 0;
  let matches = 0;
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await countExactMatches(path, secretBuffer);
      filesScanned += nested.filesScanned;
      matches += nested.matches;
    } else if (entry.isFile()) {
      const content = await readOptional(path);
      if (!content) continue;
      filesScanned += 1;
      if (content.includes(secretBuffer)) matches += 1;
    }
  }
  return { filesScanned, matches };
}

export async function scrubGeneratedSecretCache({ workspaceRoot }) {
  const envLocalBytes = await readOptional(join(workspaceRoot, ".env.local"));
  if (!envLocalBytes) {
    return { status: "skipped_no_env_file", filesScanned: 0, matches: 0 };
  }
  const key = parseGeminiKeyForCacheScrub(envLocalBytes.toString("utf8"));
  if (!key) {
    return { status: "skipped_no_key", filesScanned: 0, matches: 0 };
  }
  const cacheDirectory = join(workspaceRoot, ".next", "cache", "turbopack");
  const audit = await countExactMatches(cacheDirectory, Buffer.from(key));
  if (audit.matches === 0) return { status: "clean", ...audit };
  await rm(cacheDirectory, { recursive: true, force: true });
  return { status: "scrubbed", ...audit };
}

async function main() {
  const workspaceRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const result = await scrubGeneratedSecretCache({ workspaceRoot });
  if (result.status === "scrubbed") {
    console.log(
      `Removed generated Turbopack cache after detecting ${result.matches} exact server-secret match(es).`,
    );
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;
if (invokedPath === import.meta.url) {
  try {
    await main();
  } catch (error) {
    console.error(
      error instanceof Error
        ? `Generated-cache secret scrub failed: ${error.message}`
        : "Generated-cache secret scrub failed.",
    );
    process.exitCode = 1;
  }
}
