import type {
  CanonicalEvent,
  CoverageSummary,
  RawEventAccounting,
} from "./schemas/index";
import { CoverageSummarySchema } from "./schemas/index";

export class CoverageInvariantError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super("Adapter output failed coverage invariants");
    this.name = "CoverageInvariantError";
    this.issues = issues;
  }
}

type ComputeCoverageInput = {
  rawEventCount: number;
  events: CanonicalEvent[];
  accounting: RawEventAccounting[];
};

/**
 * Compute one shared coverage summary for policy, model facts, UI, and export.
 * The raw count comes from the validated source trace rather than from adapter
 * output, so an adapter cannot make silently dropped events look accounted for.
 */
export function computeCoverage(input: ComputeCoverageInput): CoverageSummary {
  const { rawEventCount, events, accounting } = input;
  const issues: string[] = [];

  if (!Number.isSafeInteger(rawEventCount) || rawEventCount < 0) {
    issues.push("rawEventCount must be a nonnegative safe integer");
  }
  if (accounting.length !== rawEventCount) {
    issues.push(
      `Expected ${rawEventCount} accounting records, received ${accounting.length}`,
    );
  }

  const eventIds = new Set<string>();
  const eventsById = new Map<string, CanonicalEvent>();
  for (const event of events) {
    if (eventIds.has(event.eventId)) {
      issues.push(`Duplicate canonical eventId "${event.eventId}"`);
    }
    eventIds.add(event.eventId);
    eventsById.set(event.eventId, event);
  }

  const rawPointers = new Set<string>();
  const accountingCounts = new Map<string, number>();
  for (const entry of accounting) {
    if (rawPointers.has(entry.rawPointer)) {
      issues.push(`Duplicate accounting rawPointer "${entry.rawPointer}"`);
    }
    rawPointers.add(entry.rawPointer);

    if (entry.status === "mapped" && entry.canonicalEventIds.length === 0) {
      issues.push(
        `Mapped accounting record "${entry.rawPointer}" has no canonical event`,
      );
    }
    if (entry.status !== "mapped" && entry.canonicalEventIds.length > 0) {
      issues.push(
        `${entry.status} accounting record "${entry.rawPointer}" references a canonical event`,
      );
    }
    if (entry.status !== "mapped" && !entry.reason) {
      issues.push(
        `${entry.status} accounting record "${entry.rawPointer}" has no reason`,
      );
    }

    for (const eventId of entry.canonicalEventIds) {
      if (!eventIds.has(eventId)) {
        issues.push(
          `Accounting record "${entry.rawPointer}" references unknown eventId "${eventId}"`,
        );
      }
      accountingCounts.set(
        eventId,
        (accountingCounts.get(eventId) ?? 0) + 1,
      );
      const event = eventsById.get(eventId);
      if (event && event.rawPointer !== entry.rawPointer) {
        issues.push(
          `Canonical eventId "${eventId}" rawPointer does not match its accounting record`,
        );
      }
      if (event && event.sourceEventId !== entry.sourceEventId) {
        issues.push(
          `Canonical eventId "${eventId}" sourceEventId does not match its accounting record`,
        );
      }
    }
  }

  for (const event of events) {
    if (accountingCounts.get(event.eventId) !== 1) {
      issues.push(
        `Canonical eventId "${event.eventId}" must appear in exactly one accounting record`,
      );
    }
  }

  if (issues.length > 0) {
    throw new CoverageInvariantError(issues);
  }

  return CoverageSummarySchema.parse({
    rawEvents: rawEventCount,
    accountedRawEvents: accounting.length,
    mapped: accounting.filter((entry) => entry.status === "mapped").length,
    metadataOnly: accounting.filter(
      (entry) => entry.status === "metadata-only",
    ).length,
    unparsed: accounting.filter((entry) => entry.status === "unparsed").length,
    canonicalEvents: events.length,
  });
}

export function formatCoverageSummary(coverage: CoverageSummary): string {
  return (
    `${coverage.accountedRawEvents} of ${coverage.rawEvents} raw events accounted for: ` +
    `${coverage.mapped} mapped, ${coverage.metadataOnly} metadata-only, ` +
    `${coverage.unparsed} unparsed.`
  );
}
