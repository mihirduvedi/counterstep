import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

export type AuditFindingCode =
  | "REL-BUILD-001"
  | "REL-LICENSE-001"
  | "REL-PATH-001"
  | "REL-PRIVACY-001"
  | "REL-SECRET-001";

export type AuditFinding = {
  code: AuditFindingCode;
  file: string;
  detail: string;
};

export type TextScanOptions = {
  allowedBuildRoot?: string;
  scanEmailAddresses?: boolean;
  scanPrivateKeyMarkers?: boolean;
};

export type PackageLicenseAudit = {
  packageEntries: number;
  missingLicenses: string[];
};

export type AssetLicenseAudit = {
  appAssets: string[];
  unlicensedAssets: string[];
};

export type ReleaseAuditReport = {
  sourceFilesScanned: number;
  buildFilesScanned: number;
  packageEntries: number;
  appAssets: number;
  allowedFrameworkBuildRootReferences: number;
  findings: AuditFinding[];
};

const PackageMetadataSchema = z
  .object({
    license: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .passthrough();

const PackageLockSchema = z
  .object({
    packages: z.record(z.string(), PackageMetadataSchema),
  })
  .passthrough();

const APP_ASSET_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".jpeg",
  ".jpg",
  ".mp3",
  ".mp4",
  ".otf",
  ".png",
  ".svg",
  ".ttf",
  ".wav",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
]);

const EXAMPLE_EMAIL_DOMAINS = new Set([
  "example.com",
  "example.net",
  "example.org",
  "example.test",
  "invalid",
  "test",
]);

const FRAMEWORK_BUILD_METADATA = new Set([
  ".next/required-server-files.js",
  ".next/required-server-files.json",
  ".next/standalone/.next/required-server-files.json",
  ".next/standalone/server.js",
]);

const SOURCE_SCAN_IGNORES = new Set([".git", ".next", "coverage", "node_modules", "out"]);
const BUILD_SCAN_IGNORES = new Set(["cache", "dev", "node_modules"]);
const RELEASE_SOURCE_PATHS = [
  ".bob",
  ".devcontainer",
  ".env.example",
  ".dockerignore",
  ".github",
  "AGENTS.md",
  "Dockerfile",
  "LICENSE",
  "README.md",
  "cloudbuild.yaml",
  "docs",
  "eslint.config.mjs",
  "firestore.rules",
  "next.config.ts",
  "package-lock.json",
  "package.json",
  "public",
  "scripts",
  "src",
  "tests",
  "tsconfig.json",
  "vitest.config.ts",
  "work",
] as const;

function countOccurrences(text: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }

  return text.split(needle).length - 1;
}

function finding(
  code: AuditFindingCode,
  file: string,
  detail: string,
): AuditFinding {
  return { code, file, detail };
}

function isPlaceholderSecret(value: string): boolean {
  const normalized = value
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .toLowerCase();

  return (
    normalized.length === 0 ||
    /^<[^>]+>$/.test(normalized) ||
    /^(?:your|replace|example|dummy|fake|test)(?:[-_ ].*)?$/.test(normalized)
  );
}

function decodeText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) {
    return null;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function scanTextForReleaseFindings(
  file: string,
  originalText: string,
  options: TextScanOptions = {},
): { findings: AuditFinding[]; allowedBuildRootReferences: number } {
  let text = originalText;
  let allowedBuildRootReferences = 0;

  if (
    options.allowedBuildRoot &&
    FRAMEWORK_BUILD_METADATA.has(file)
  ) {
    allowedBuildRootReferences = countOccurrences(text, options.allowedBuildRoot);
    text = text.split(options.allowedBuildRoot).join("[NEXT_BUILD_ROOT]");
  }

  const findings: AuditFinding[] = [];

  if (
    options.scanPrivateKeyMarkers !== false &&
    /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/.test(text)
  ) {
    findings.push(finding("REL-SECRET-001", file, "Private-key material is present."));
  }

  const credentialTokens =
    text.match(/\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,255}|xox[baprs]-[A-Za-z0-9-]{20,})\b/g) ?? [];
  if (credentialTokens.some((token) => token !== "AKIAIOSFODNN7EXAMPLE")) {
    findings.push(finding("REL-SECRET-001", file, "A credential-shaped token is present."));
  }

  const secretAssignmentPattern =
    /^[ \t]*(?:GEMINI_API_KEY|WATSONX_API_KEY|IBM_CLOUD_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|BOB_API_KEY)[ \t]*=[ \t]*([^\r\n]*)$/gm;
  for (const match of text.matchAll(secretAssignmentPattern)) {
    const value = match[1] ?? "";
    if (!isPlaceholderSecret(value)) {
      findings.push(
        finding("REL-SECRET-001", file, "A credential environment variable has a populated value."),
      );
      break;
    }
  }

  if (/(?:\/Users\/[^/\s"']+|\/home\/[^/\s"']+|[A-Za-z]:\\Users\\[^\\\s"']+)/.test(text)) {
    findings.push(finding("REL-PATH-001", file, "A user-home absolute path is present."));
  }

  if (/\/(?:private\/)?var\/folders\/[^\s"']+/.test(text)) {
    findings.push(finding("REL-PATH-001", file, "A macOS per-user temporary path is present."));
  }

  if (options.scanEmailAddresses !== false) {
    const emailPattern = /\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,}|invalid|test)\b/gi;
    for (const match of text.matchAll(emailPattern)) {
      const domain = (match[1] ?? "").toLowerCase();
      if (!EXAMPLE_EMAIL_DOMAINS.has(domain)) {
        findings.push(
          finding("REL-PRIVACY-001", file, `A non-example email address is present (${domain}).`),
        );
        break;
      }
    }
  }

  return { findings, allowedBuildRootReferences };
}

export function auditPackageLicenses(packageLock: unknown): PackageLicenseAudit {
  const parsed = PackageLockSchema.parse(packageLock);
  const entries = Object.entries(parsed.packages).filter(([packagePath]) =>
    packagePath.startsWith("node_modules/"),
  );
  const missingLicenses = entries
    .filter(([, metadata]) => {
      const license = metadata.license;
      return license === undefined || license.length === 0;
    })
    .map(([packagePath]) => packagePath.replace(/^node_modules\//, ""))
    .sort();

  return {
    packageEntries: entries.length,
    missingLicenses,
  };
}

export function auditAssetLicenses(
  trackedPaths: readonly string[],
  assetLicenseManifest: string | null,
): AssetLicenseAudit {
  const appAssets = trackedPaths
    .filter(
      (file) =>
        file.startsWith("public/") ||
        file.startsWith("src/") ||
        file.startsWith("docs/screenshots/"),
    )
    .filter((file) => APP_ASSET_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .sort();
  const unlicensedAssets = appAssets.filter(
    (file) => !assetLicenseManifest?.includes(`\`${file}\``),
  );

  return { appAssets, unlicensedAssets };
}

async function walkFiles(
  root: string,
  relativeDirectory: string,
  ignoredDirectoryNames: ReadonlySet<string>,
): Promise<string[]> {
  const absoluteDirectory = path.join(root, relativeDirectory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) {
      continue;
    }

    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(root, relativePath, ignoredDirectoryNames)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

async function sourcePaths(root: string): Promise<string[]> {
  try {
    const output = execFileSync("git", [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      ...RELEASE_SOURCE_PATHS,
    ], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return z
      .array(z.string().min(1))
      .parse(output.split("\0").filter((file) => file.length > 0))
      .sort();
  } catch {
    return (await walkFiles(root, "", SOURCE_SCAN_IGNORES)).sort();
  }
}

async function readOptionalFile(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function runReleaseAudit(root: string): Promise<ReleaseAuditReport> {
  const normalizedRoot = path.resolve(root);
  const trackedPaths = await sourcePaths(normalizedRoot);
  const findings: AuditFinding[] = [];
  let sourceFilesScanned = 0;

  for (const file of trackedPaths) {
    const bytes = await readFile(path.join(normalizedRoot, file));
    const text = decodeText(bytes);
    if (text === null) {
      continue;
    }
    sourceFilesScanned += 1;
    findings.push(
      ...scanTextForReleaseFindings(file, text, {
        scanEmailAddresses: file !== "package-lock.json",
      }).findings,
    );
  }

  const packageLockText = await readFile(path.join(normalizedRoot, "package-lock.json"), "utf8");
  const packageLicenseAudit = auditPackageLicenses(JSON.parse(packageLockText) as unknown);
  for (const packageName of packageLicenseAudit.missingLicenses) {
    findings.push(
      finding("REL-LICENSE-001", "package-lock.json", `${packageName} has no declared license metadata.`),
    );
  }

  const assetManifest = await readOptionalFile(
    path.join(normalizedRoot, "docs", "ASSET_LICENSES.md"),
  );
  const assetLicenseAudit = auditAssetLicenses(trackedPaths, assetManifest);
  for (const asset of assetLicenseAudit.unlicensedAssets) {
    findings.push(
      finding("REL-LICENSE-001", asset, "App-owned media asset is missing from docs/ASSET_LICENSES.md."),
    );
  }

  let buildFiles: string[] = [];
  try {
    buildFiles = (await walkFiles(normalizedRoot, ".next", BUILD_SCAN_IGNORES)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    findings.push(
      finding("REL-BUILD-001", ".next", "Production build output is missing; run npm run build first."),
    );
  }

  let buildFilesScanned = 0;
  let allowedFrameworkBuildRootReferences = 0;
  for (const file of buildFiles) {
    const bytes = await readFile(path.join(normalizedRoot, file));
    const text = decodeText(bytes);
    if (text === null) {
      continue;
    }
    buildFilesScanned += 1;
    const result = scanTextForReleaseFindings(file, text, {
      allowedBuildRoot: normalizedRoot,
      scanEmailAddresses: false,
      scanPrivateKeyMarkers: false,
    });
    findings.push(...result.findings);
    allowedFrameworkBuildRootReferences += result.allowedBuildRootReferences;
  }

  return {
    sourceFilesScanned,
    buildFilesScanned,
    packageEntries: packageLicenseAudit.packageEntries,
    appAssets: assetLicenseAudit.appAssets.length,
    allowedFrameworkBuildRootReferences,
    findings: findings.sort(
      (left, right) =>
        left.file.localeCompare(right.file) || left.code.localeCompare(right.code),
    ),
  };
}

export function formatReleaseAudit(report: ReleaseAuditReport): string {
  const lines = [
    report.findings.length === 0 ? "Release audit passed." : "Release audit failed.",
    `Source text files scanned: ${report.sourceFilesScanned}`,
    `Build text files scanned: ${report.buildFilesScanned}`,
    `Dependency package entries checked: ${report.packageEntries}`,
    `App-owned media assets checked: ${report.appAssets}`,
    `Allowed Next.js build-root metadata references: ${report.allowedFrameworkBuildRootReferences}`,
  ];

  for (const item of report.findings) {
    lines.push(`${item.code} ${item.file}: ${item.detail}`);
  }

  return lines.join("\n");
}
