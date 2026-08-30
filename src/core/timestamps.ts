/**
 * RFC 3339 timestamp utilities.
 *
 * The PRD requires timestamps to be RFC 3339 with an explicit timezone.
 * We validate the string at the schema boundary, preserve it verbatim,
 * and compare the complete fractional instant for ordering and policy checks.
 */

import { z } from "zod";

const RFC3339_WITH_TZ_SCHEMA = z.iso.datetime({ offset: true });

/**
 * Returns true if `s` is a valid RFC 3339 string with an explicit timezone.
 */
export function isRfc3339WithTz(s: string): boolean {
  return RFC3339_WITH_TZ_SCHEMA.safeParse(s).success;
}

/**
 * Parse an RFC 3339 string to a millisecond epoch value for ordering/comparison.
 * Assumes the string has already been validated by isRfc3339WithTz.
 */
export function toInstantMs(ts: string): number {
  return Date.parse(ts);
}

type InstantParts = {
  wholeSecondMs: number;
  fractionalDigits: string;
};

function instantParts(ts: string): InstantParts {
  const fractionalMatch = ts.match(/\.(\d+)(?=Z|[+-]\d{2}:\d{2}$)/);
  const fractionalDigits = fractionalMatch?.[1] ?? "";
  const wholeSecond = fractionalMatch
    ? ts.replace(`.${fractionalDigits}`, "")
    : ts;
  return {
    wholeSecondMs: Date.parse(wholeSecond),
    fractionalDigits,
  };
}

/**
 * Compare two already-validated RFC 3339 instants without discarding digits
 * beyond JavaScript Date's millisecond precision.
 */
export function compareInstants(a: string, b: string): -1 | 0 | 1 {
  const left = instantParts(a);
  const right = instantParts(b);
  if (left.wholeSecondMs < right.wholeSecondMs) return -1;
  if (left.wholeSecondMs > right.wholeSecondMs) return 1;

  const length = Math.max(
    left.fractionalDigits.length,
    right.fractionalDigits.length,
  );
  for (let index = 0; index < length; index += 1) {
    const leftDigit = left.fractionalDigits[index] ?? "0";
    const rightDigit = right.fractionalDigits[index] ?? "0";
    if (leftDigit < rightDigit) return -1;
    if (leftDigit > rightDigit) return 1;
  }
  return 0;
}

/**
 * Returns true if instant(a) < instant(b), correctly across timezone offsets.
 */
export function instantBefore(a: string, b: string): boolean {
  return compareInstants(a, b) < 0;
}
