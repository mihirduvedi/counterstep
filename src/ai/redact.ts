/**
 * Model-bound redaction.
 *
 * Recursively walks a value tree, replacing sensitive fields with "[REDACTED]"
 * before the value is ever sent toward a model endpoint.
 *
 * Rules (applied in order per key/value pair):
 *  1. Key is `authorization` or contains `x-api-key` (case-insensitive) → REDACTED
 *  2. Key substring-matches: token, secret, api_key, apikey, password, credential, passwd → REDACTED
 *  3. Value is `{ secret: true, …rest }` → entire node REDACTED
 *  4. Key is exactly `input` or `output` at any depth → REDACTED
 *  5. String contains a bearer credential or inline secret assignment → REDACTED
 *  6. Value matches a common credential token format → REDACTED
 *  7. Value is a string matching email pattern → REDACTED
 *  8. Value is a string with length ≥ 20 AND Shannon entropy ≥ 4.5 → REDACTED
 *
 * Pure function — never mutates input.
 */

// Secret key substrings (case-insensitive comparison applied externally)
const SECRET_KEY_SUBSTRINGS = [
  "token",
  "secret",
  "api_key",
  "apikey",
  "password",
  "credential",
  "passwd",
] as const;

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;
const BEARER_RE = /\bbearer\s+\S+/i;
const INLINE_SECRET_ASSIGNMENT_RE =
  /\b(?:authorization|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|token|secret|password|passwd|credential)\b\s*[:=]\s*\S+/i;
const COMMON_CREDENTIAL_VALUE_RE =
  /\b(?:(?:AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA)[A-Z0-9]{16}|(?:sk_(?:live|test)_|sk-|gh[pousr]_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{6,}|AIza[A-Za-z0-9_-]{20,})\b/;

function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const ch of s) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function isSecretKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (lower === "authorization" || lower.includes("x-api-key")) return true;
  const normalized = lower.replace(/[^a-z0-9]/g, "");
  if (normalized.includes("apikey")) return true;
  for (const sub of SECRET_KEY_SUBSTRINGS) {
    if (lower.includes(sub)) return true;
  }
  return false;
}

function isRawBodyKey(key: string): boolean {
  const lower = key.toLowerCase();
  return lower === "input" || lower === "output";
}

function isSecretTaggedObject(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>)["secret"] === true
  );
}

function isHighEntropySecret(value: string): boolean {
  return value.length >= 20 && shannonEntropy(value) >= 4.5;
}

/**
 * Recursively redact sensitive values from `value`.
 * Returns a new deep copy; the input is never mutated.
 */
export function redactForModel(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactForModel(item));
  }

  if (typeof value === "object" && value !== null) {
    if (isSecretTaggedObject(value)) {
      return "[REDACTED]";
    }
    const entries: Array<[string, unknown]> = [];
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretKey(key) || isRawBodyKey(key)) {
        entries.push([key, "[REDACTED]"]);
      } else {
        entries.push([key, redactForModel(val)]);
      }
    }
    return Object.fromEntries(entries);
  }

  if (typeof value === "string") {
    if (BEARER_RE.test(value)) return "[REDACTED]";
    if (INLINE_SECRET_ASSIGNMENT_RE.test(value)) return "[REDACTED]";
    if (COMMON_CREDENTIAL_VALUE_RE.test(value)) return "[REDACTED]";
    if (EMAIL_RE.test(value)) return "[REDACTED]";
    if (isHighEntropySecret(value)) return "[REDACTED]";
  }

  // Primitive (number, boolean, null, undefined) — pass through unchanged
  return value;
}
