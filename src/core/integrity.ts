import { createHash } from "crypto";

/**
 * Compute the SHA-256 digest of the exact uploaded UTF-8 bytes
 * before any JSON parsing or normalization.
 *
 * Returns the lowercase hex string.
 */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Encode a string as UTF-8 bytes and compute its SHA-256.
 */
export function sha256HexFromString(input: string): string {
  const bytes = new TextEncoder().encode(input);
  return sha256Hex(bytes);
}
