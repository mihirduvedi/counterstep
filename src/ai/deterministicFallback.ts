import type { GeneratedReceiptCopy } from "../core/schemas/index";
import { UI_LIMITS } from "../core/schemas/index";
import type { GraniteFactBundle } from "./factBundle";

// ─── Headline text per verdict ────────────────────────────────────────────────

const HEADLINE_BY_VERDICT: Record<string, string> = {
  within_declared_authority:
    "No authority deviations appear in the supplied trace.",
  review_recommended:
    "The supplied trace has findings for a manager to review.",
  material_deviations_found:
    "The supplied trace shows material deviations from the declared authority.",
  unable_to_assess_fully:
    "Material evidence gaps prevent a full authority assessment.",
};

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function headlineEvidence(bundle: GraniteFactBundle): {
  eventIds: string[];
  findingIds: string[];
} {
  if (bundle.verdictCode === "within_declared_authority") {
    return { eventIds: bundle.allowedEventIds, findingIds: [] };
  }

  const candidateFacts =
    bundle.verdictCode === "unable_to_assess_fully"
      ? bundle.limitations.map((limitation) => ({
          eventIds: limitation.eventIds,
          findingIds: limitation.findingIds,
        }))
      : bundle.findings.map((finding) => ({
          eventIds: finding.eventIds,
          findingIds: [finding.findingId],
        }));

  const eventLinkedFacts = candidateFacts.filter(
    (fact) => fact.eventIds.length > 0,
  );
  if (eventLinkedFacts.length > 0) {
    return {
      eventIds: unique(eventLinkedFacts.flatMap((fact) => fact.eventIds)),
      findingIds: unique(eventLinkedFacts.flatMap((fact) => fact.findingIds)),
    };
  }

  const firstFact = candidateFacts[0];
  if (firstFact) {
    return { eventIds: [], findingIds: firstFact.findingIds };
  }

  return { eventIds: bundle.allowedEventIds, findingIds: [] };
}

function outcomeEvidence(bundle: GraniteFactBundle): string[] {
  const findingEventIds = bundle.findings.flatMap(
    (finding) => finding.eventIds,
  );
  const limitationEventIds = bundle.limitations.flatMap(
    (limitation) => limitation.eventIds,
  );
  const relevant = unique([...findingEventIds, ...limitationEventIds]);
  return relevant.length > 0 ? relevant : bundle.allowedEventIds;
}

// ─── Main fallback function ───────────────────────────────────────────────────

/**
 * Produce a valid GeneratedReceiptCopy from a GraniteFactBundle without any
 * network or credentials. All cited IDs are drawn directly from bundle structures.
 */
export function deterministicFallback(
  bundle: GraniteFactBundle,
): GeneratedReceiptCopy {
  // headline
  const headlineText =
    HEADLINE_BY_VERDICT[bundle.verdictCode] ??
    "Receipt prepared from the supplied trace and authority envelope.";

  const headlineCitations = headlineEvidence(bundle);
  const headline: GeneratedReceiptCopy["headline"] = {
    text: headlineText,
    eventIds: headlineCitations.eventIds,
    findingIds: headlineCitations.findingIds,
  };

  // outcome
  const outcome: GeneratedReceiptCopy["outcome"] = {
    text: bundle.verdictQualifier,
    eventIds: outcomeEvidence(bundle),
  };

  // notableActions — from bundle.findings only (non-AR-TRACE-001)
  const notableActions: GeneratedReceiptCopy["notableActions"] = bundle.findings.map(
    (finding) => ({
      text: `${finding.label}: ${finding.description}`.slice(
        0,
        UI_LIMITS.NOTABLE_ACTION_MAX,
      ),
      eventIds: finding.eventIds,
      findingIds: [finding.findingId],
    }),
  );

  // limitations — from bundle.limitations only; NO findingIds in output schema
  const limitations: GeneratedReceiptCopy["limitations"] = bundle.limitations.map(
    (limitation) => ({
      text: limitation.text.slice(0, UI_LIMITS.LIMITATION_MAX),
      eventIds: limitation.eventIds,
    }),
  );

  return { headline, outcome, notableActions, limitations };
}
