import type {
  CanonicalOperation,
  GeneratedReceiptCopy,
  Verdict,
} from "../core/schemas/index";
import { UI_LIMITS, VERDICT_LABELS } from "../core/schemas/index";
import { deterministicFallback } from "./deterministicFallback";
import type { GraniteFactBundle } from "./factBundle";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ValidationResult =
  | { valid: true }
  | { valid: false; errors: string[] };

const LEXICAL_TOKEN_RE = /[A-Za-z]+(?:'[A-Za-z]+)?|\d+/g;
const SAFE_MANAGER_COPY_TOKENS = new Set([
  "a",
  "an",
  "and",
  "agent",
  "appear",
  "as",
  "at",
  "authority",
  "assessment",
  "based",
  "before",
  "by",
  "complete",
  "contains",
  "declared",
  "detected",
  "deviation",
  "deviations",
  "does",
  "envelope",
  "evidence",
  "finding",
  "findings",
  "for",
  "found",
  "from",
  "full",
  "fully",
  "gaps",
  "had",
  "has",
  "have",
  "in",
  "is",
  "it",
  "its",
  "manager",
  "material",
  "no",
  "not",
  "of",
  "on",
  "only",
  "or",
  "outcome",
  "prepared",
  "prevent",
  "receipt",
  "recommended",
  "review",
  "run",
  "shows",
  "supplied",
  "support",
  "task",
  "that",
  "the",
  "this",
  "to",
  "trace",
  "unable",
  "under",
  "violation",
  "warrant",
  "warrants",
  "was",
  "were",
  "with",
  "within",
]);

function addLexicalTokens(target: Set<string>, text: string): void {
  for (const match of text.matchAll(LEXICAL_TOKEN_RE)) {
    target.add(match[0].toLowerCase());
  }
}

function addEventLexicalTokens(
  target: Set<string>,
  event: GraniteFactBundle["events"][number],
): void {
  const scalarValues = [
    event.eventId,
    String(event.sequence),
    event.timestamp,
    event.actorType,
    event.actorId,
    event.operation,
    event.toolName,
    event.sourceSystem,
    event.destinationSystem,
    event.destinationBoundary,
    event.resourceType,
    event.status,
    event.actionKey,
  ];
  for (const value of scalarValues) {
    if (value !== undefined) addLexicalTokens(target, value);
  }
  for (const value of [
    ...event.dataCategories,
    ...event.adapterWarnings,
    ...event.riskTags,
  ]) {
    addLexicalTokens(target, value);
  }
  if (event.quantity) {
    addLexicalTokens(
      target,
      `${event.quantity.value} ${event.quantity.unit}`,
    );
  }
}

// ─── Support-set builder ──────────────────────────────────────────────────────

type SupportSets = {
  systems: Set<string>;
  operations: Set<string>;
  resourceTypes: Set<string>;
  dataCategories: Set<string>;
  quantities: Set<string>;
  actorIds: Set<string>;
  statuses: Set<string>;
  actionKeys: Set<string>;
  identifiers: Set<string>;
  lexicalTokens: Set<string>;
};

function buildPerItemSupportSets(
  itemEventIds: string[],
  itemFindingIds: string[],
  bundle: GraniteFactBundle,
  sourceTexts: string[] = [],
): SupportSets {
  const resolvedEventIds = new Set(itemEventIds);
  const citedFindingTexts: string[] = [];

  for (const finding of bundle.findings) {
    if (!itemFindingIds.includes(finding.findingId)) continue;
    finding.eventIds.forEach((id) => resolvedEventIds.add(id));
    citedFindingTexts.push(finding.label, finding.description);
  }
  for (const limitation of bundle.limitations) {
    if (!limitation.findingIds.some((id) => itemFindingIds.includes(id))) continue;
    limitation.eventIds.forEach((id) => resolvedEventIds.add(id));
    citedFindingTexts.push(limitation.text);
  }

  const cited = bundle.events.filter((event) =>
    resolvedEventIds.has(event.eventId),
  );

  const systems = new Set<string>();
  const operations = new Set<string>();
  const resourceTypes = new Set<string>();
  const dataCategories = new Set<string>();
  const quantities = new Set<string>();
  const actorIds = new Set<string>();
  const statuses = new Set<string>();
  const actionKeys = new Set<string>();
  const lexicalTokens = new Set<string>();
  const identifiers = new Set<string>([
    ...resolvedEventIds,
    ...itemFindingIds,
    bundle.verdictCode,
  ].map((value) => value.toLowerCase()));

  for (const ev of cited) {
    addEventLexicalTokens(lexicalTokens, ev);
    if (ev.sourceSystem) systems.add(ev.sourceSystem.toLowerCase());
    if (ev.destinationSystem) systems.add(ev.destinationSystem.toLowerCase());
    operations.add(ev.operation.toLowerCase());
    if (ev.resourceType) resourceTypes.add(ev.resourceType.toLowerCase());
    for (const dc of ev.dataCategories) dataCategories.add(dc.toLowerCase());
    if (ev.quantity) {
      quantities.add(`${ev.quantity.value} ${ev.quantity.unit}`);
    }
    actorIds.add(ev.actorId.toLowerCase());
    statuses.add(ev.status.toLowerCase());
    // actionKey is retained in ReducedCanonicalEvent for finding-description support
    if (ev.actionKey) actionKeys.add(ev.actionKey.toLowerCase());
  }

  for (const set of [
    systems,
    operations,
    resourceTypes,
    dataCategories,
    actorIds,
    statuses,
    actionKeys,
  ]) {
    set.forEach((value) => identifiers.add(value));
  }

  addLexicalTokens(lexicalTokens, bundle.verdictQualifier);

  for (const text of [...citedFindingTexts, ...sourceTexts]) {
    addLexicalTokens(lexicalTokens, text);
    for (const match of text.matchAll(QUOTED_ID_RE)) {
      identifiers.add(match[1].toLowerCase());
    }
    for (const match of text.matchAll(IDENTIFIER_TOKEN_RE)) {
      identifiers.add(match[0].toLowerCase());
    }
    for (const match of text.matchAll(QUANTITY_UNIT_RE)) {
      quantities.add(`${match[1]} ${match[2].toLowerCase()}`);
    }
    for (const match of text.matchAll(CONTROLLED_STATUS_RE)) {
      statuses.add(match[1].toLowerCase());
    }
  }

  return {
    systems,
    operations,
    resourceTypes,
    dataCategories,
    quantities,
    actorIds,
    statuses,
    actionKeys,
    identifiers,
    lexicalTokens,
  };
}

// ─── Check helpers ────────────────────────────────────────────────────────────

/** Check 1: missing citations */
function checkMissingCitations(copy: GeneratedReceiptCopy): string[] {
  const errors: string[] = [];

  if (copy.headline.eventIds.length === 0 && copy.headline.findingIds.length === 0) {
    errors.push("headline must have at least one eventId or findingId citation");
  }

  if (copy.outcome.eventIds.length === 0) {
    errors.push("outcome must have at least one eventId citation");
  }

  copy.notableActions.forEach((action, i) => {
    if (action.eventIds.length === 0 && action.findingIds.length === 0) {
      errors.push(`notableActions[${i}] must have at least one eventId or findingId citation`);
    }
  });

  return errors;
}

/** Check 2: unknown event IDs */
function checkUnknownEventIds(
  copy: GeneratedReceiptCopy,
  allowedEventIds: string[],
): string[] {
  const errors: string[] = [];
  const allowed = new Set(allowedEventIds);

  const allEventIds: Array<{ id: string; location: string }> = [
    ...copy.headline.eventIds.map((id) => ({ id, location: "headline.eventIds" })),
    ...copy.outcome.eventIds.map((id) => ({ id, location: "outcome.eventIds" })),
    ...copy.notableActions.flatMap((a, i) =>
      a.eventIds.map((id) => ({ id, location: `notableActions[${i}].eventIds` })),
    ),
    ...copy.limitations.flatMap((l, i) =>
      l.eventIds.map((id) => ({ id, location: `limitations[${i}].eventIds` })),
    ),
  ];

  for (const { id, location } of allEventIds) {
    if (!allowed.has(id)) {
      errors.push(`Unknown eventId "${id}" in ${location}`);
    }
  }

  return errors;
}

/** Check 3: unknown finding IDs */
function checkUnknownFindingIds(
  copy: GeneratedReceiptCopy,
  allowedFindingIds: string[],
): string[] {
  const errors: string[] = [];
  const allowed = new Set(allowedFindingIds);

  const allFindingIds: Array<{ id: string; location: string }> = [
    ...copy.headline.findingIds.map((id) => ({ id, location: "headline.findingIds" })),
    ...copy.notableActions.flatMap((a, i) =>
      a.findingIds.map((id) => ({ id, location: `notableActions[${i}].findingIds` })),
    ),
  ];

  for (const { id, location } of allFindingIds) {
    if (!allowed.has(id)) {
      errors.push(`Unknown findingId "${id}" in ${location}`);
    }
  }

  return errors;
}

/** Check 4: finding–event relationship (both directions) */
function checkFindingEventRelationship(
  copy: GeneratedReceiptCopy,
  bundle: GraniteFactBundle,
): string[] {
  const errors: string[] = [];

  // Build lookup: findingId → eventIds set (from both normal findings and limitations)
  const findingEventIds = new Map<string, Set<string>>();
  for (const f of bundle.findings) {
    findingEventIds.set(f.findingId, new Set(f.eventIds));
  }
  for (const l of bundle.limitations) {
    for (const fid of l.findingIds) {
      findingEventIds.set(fid, new Set(l.eventIds));
    }
  }

  const checkItem = (
    eventIds: string[],
    findingIds: string[],
    location: string,
  ) => {
    if (eventIds.length === 0 || findingIds.length === 0) return;

    const citedEventSet = new Set(eventIds);
    for (const findingId of findingIds) {
      const relatedEventIds = findingEventIds.get(findingId);
      if (relatedEventIds && !hasOverlap(relatedEventIds, citedEventSet)) {
        errors.push(
          `${location} findingId "${findingId}" has no eventId overlap with the cited eventIds`,
        );
      }
    }

    for (const eventId of citedEventSet) {
      const isRelated = findingIds.some((findingId) =>
        findingEventIds.get(findingId)?.has(eventId),
      );
      if (!isRelated) {
        errors.push(
          `${location} eventId "${eventId}" is unrelated to every cited findingId`,
        );
      }
    }
  };

  checkItem(
    copy.headline.eventIds,
    copy.headline.findingIds,
    "headline",
  );
  copy.notableActions.forEach((action, index) => {
    checkItem(
      action.eventIds,
      action.findingIds,
      `notableActions[${index}]`,
    );
  });

  return errors;
}

/**
 * A valid ID is not automatically relevant to the deterministic verdict. When
 * findings or limitations identify verdict-supporting events, headline and
 * outcome citations must stay within that evidence set. Limitation-only
 * verdicts with no event-linked evidence fall back to the allowed event set so
 * the required outcome citation can still be rendered.
 */
function checkVerdictCitationGrounding(
  copy: GeneratedReceiptCopy,
  bundle: GraniteFactBundle,
): string[] {
  if (bundle.verdictCode === "within_declared_authority") return [];

  const supportEventIds = new Set([
    ...bundle.findings.flatMap((finding) => finding.eventIds),
    ...bundle.limitations.flatMap((limitation) => limitation.eventIds),
  ]);
  if (supportEventIds.size === 0) return [];

  const supportFindingIds = new Set([
    ...bundle.findings.map((finding) => finding.findingId),
    ...bundle.limitations.flatMap((limitation) => limitation.findingIds),
  ]);
  const errors: string[] = [];

  for (const [location, eventIds] of [
    ["headline.eventIds", copy.headline.eventIds],
    ["outcome.eventIds", copy.outcome.eventIds],
  ] as const) {
    for (const eventId of eventIds) {
      if (!supportEventIds.has(eventId)) {
        errors.push(
          `${location} eventId "${eventId}" does not support the deterministic verdict`,
        );
      }
    }
  }

  if (
    copy.headline.eventIds.length === 0 &&
    !copy.headline.findingIds.some((findingId) =>
      supportFindingIds.has(findingId),
    )
  ) {
    errors.push(
      "headline must cite an event or finding that supports the deterministic verdict",
    );
  }

  return errors;
}

function hasOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const item of a) {
    if (b.has(item)) return true;
  }
  return false;
}

/** Check 5: prohibited assurance language */
const PROHIBITED_PHRASES = [
  "compliant",
  "certified",
  "secure",
  "safe",
  "tamper-proof",
  "complete audit",
];

function checkProhibitedAssuranceLanguage(copy: GeneratedReceiptCopy): string[] {
  const errors: string[] = [];
  const textsToCheck = [
    { text: copy.headline.text, location: "headline.text" },
    { text: copy.outcome.text, location: "outcome.text" },
    ...copy.notableActions.map((a, i) => ({
      text: a.text,
      location: `notableActions[${i}].text`,
    })),
  ];

  for (const { text, location } of textsToCheck) {
    const lower = text.toLowerCase();
    for (const phrase of PROHIBITED_PHRASES) {
      // Full-word match for single words; substring match for phrases with spaces
      const isPhrase = phrase.includes(" ");
      const found = isPhrase
        ? lower.includes(phrase)
        : new RegExp(`\\b${phrase}\\b`, "i").test(text);
      if (found) {
        errors.push(
          `Prohibited assurance language "${phrase}" found in ${location}`,
        );
      }
    }
  }

  return errors;
}

/** Check 6: unsupported facts */
// Quoted/backtick identifier pattern
const QUOTED_ID_RE = /["'`]([^"'`]+)["'`]/g;
// Numeric quantity-unit pattern
const QUANTITY_UNIT_RE = /\b(\d+)\s+(records|messages|bytes|files)\b/gi;
// Controlled-domain status values
const CONTROLLED_STATUSES = new Set(["succeeded", "failed", "cancelled", "unknown", "started"]);
const CONTROLLED_STATUS_RE = /\b(succeeded|failed|cancelled|unknown|started)\b/gi;
// Unquoted identifier-like values commonly used for systems, resources, data,
// actors, event IDs, finding IDs, and action keys.
const IDENTIFIER_TOKEN_RE = /\b[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)+\b/g;
const SYSTEM_CLAIM_RE =
  /\b(?:accessed|queried|contacted|read from|wrote to|sent to|exported to)\s+(?:the\s+)?["'`]?([A-Za-z][A-Za-z0-9_-]*)/gi;
const OPERATION_CLAIM_RE =
  /\b(?:performed|attempted|executed)\s+(?:an?\s+)?["'`]?([A-Za-z][A-Za-z0-9_-]*)["'`]?\s+(?:operation|action)\b/gi;
const RESOURCE_CLAIM_RE =
  /\b(?:created|read|retrieved|updated|deleted)\s+(?:an?\s+)?["'`]?([A-Za-z][A-Za-z0-9_-]*)["'`]?\s+(?:resource|record|file)\b/gi;
const LABELED_DATA_RE =
  /\bdata\s+(?:category|field)\s+(?:named\s+|called\s+|is\s+|was\s+|:\s*)["'`]?([A-Za-z][A-Za-z0-9_-]*)/gi;
const LABELED_ACTOR_RE =
  /\bactor(?:\s+id)?\s+(?:named\s+|called\s+|is\s+|was\s+|:\s*)["'`]?([A-Za-z][A-Za-z0-9_-]*)/gi;
const UNSUPPORTED_TASK_COMPLETION_RE =
  /\b(?:(?:agent|workflow|run)\s+(?:(?:has|had)\s+)?(?:completed|finished|fulfilled|accomplished)\s+(?:the\s+)?(?:declared\s+)?task|(?:the\s+)?(?:declared\s+)?task\s+(?:(?:has|had)\s+been\s+|(?:was|is)\s+)(?:completed|finished|fulfilled|accomplished))\b/i;
const UNSUPPORTED_RUN_COMPLETION_RE =
  /\b(?:run|trace|assessment|task)\s+(?:(?:is|was|appears|seems)\s+)?(?:complete|completed|finished)\b/i;
const OPERATION_CLAIM_SUBJECT =
  String.raw`(?:the\s+)?(?:agent|workflow|tool|run|event|action|system|it|they)`;
const OPERATION_CLAIM_OBJECT =
  String.raw`(?:records?|messages?|files?|data|resources?|items?|funds?)`;
const OPERATION_AUXILIARY =
  String.raw`(?:(?:can|could|did|does|do|will|would|may|might|must|should|has|had|was|were|is|are)\s+)?`;

function operationClaimPattern(forms: string, passiveForms: string): RegExp {
  return new RegExp(
    String.raw`\b${OPERATION_CLAIM_SUBJECT}\s+${OPERATION_AUXILIARY}(?:${forms})\b|\b${OPERATION_CLAIM_OBJECT}\s+(?:(?:has|had)\s+been\s+|(?:was|were|is|are)\s+)(?:${passiveForms})\b`,
    "i",
  );
}

const CONTROLLED_OPERATION_CLAIMS: Array<{
  operation: CanonicalOperation;
  pattern: RegExp;
}> = [
  {
    operation: "read",
    pattern: operationClaimPattern("read|reads|reading", "read"),
  },
  {
    operation: "retrieve",
    pattern: operationClaimPattern(
      "retrieve|retrieves|retrieved|retrieving",
      "retrieved",
    ),
  },
  {
    operation: "create",
    pattern: operationClaimPattern("create|creates|created|creating", "created"),
  },
  {
    operation: "update",
    pattern: operationClaimPattern("update|updates|updated|updating", "updated"),
  },
  {
    operation: "delete",
    pattern: operationClaimPattern("delete|deletes|deleted|deleting", "deleted"),
  },
  {
    operation: "send",
    pattern: operationClaimPattern("send|sends|sent|sending", "sent"),
  },
  {
    operation: "execute",
    pattern: operationClaimPattern(
      "execute|executes|executed|executing",
      "executed",
    ),
  },
  {
    operation: "approve",
    pattern: operationClaimPattern(
      "approve|approves|approved|approving",
      "approved",
    ),
  },
  {
    operation: "error",
    pattern: operationClaimPattern("errored|erroring", "errored"),
  },
];

function hasValue(set: Set<string>, value: string): boolean {
  return set.has(value.toLowerCase());
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && new Set(a).size === new Set(b).size &&
    a.every((id) => b.includes(id));
}

function checkUnsupportedFacts(
  copy: GeneratedReceiptCopy,
  bundle: GraniteFactBundle,
): string[] {
  const errors: string[] = [];

  type ItemWithCitations = {
    text: string;
    eventIds: string[];
    findingIds: string[];
    location: string;
    sourceTexts?: string[];
  };

  const items: ItemWithCitations[] = [
    {
      text: copy.headline.text,
      eventIds: copy.headline.eventIds,
      findingIds: copy.headline.findingIds,
      location: "headline.text",
    },
    {
      text: copy.outcome.text,
      eventIds: copy.outcome.eventIds,
      findingIds: [],
      location: "outcome.text",
    },
    ...copy.notableActions.map((a, i) => ({
      text: a.text,
      eventIds: a.eventIds,
      findingIds: a.findingIds,
      location: `notableActions[${i}].text`,
    })),
    ...copy.limitations.map((limitation, index) => ({
      text: limitation.text,
      eventIds: limitation.eventIds,
      findingIds: bundle.limitations[index]?.findingIds ?? [],
      location: `limitations[${index}].text`,
      sourceTexts: bundle.limitations[index]
        ? [bundle.limitations[index].text]
        : [],
    })),
  ];

  for (const item of items) {
    const support = buildPerItemSupportSets(
      item.eventIds,
      item.findingIds,
      bundle,
      item.sourceTexts,
    );
    const text = item.text;
    const loc = item.location;

    // Quoted/backtick identifiers — check against all domain sets
    const quotedMatches = [...text.matchAll(QUOTED_ID_RE)];
    for (const match of quotedMatches) {
      const token = match[1].toLowerCase();
      if (
        !support.identifiers.has(token)
      ) {
        errors.push(
          `Unsupported quoted identifier "${match[1]}" in ${loc} cannot be resolved to cited events`,
        );
      }
    }

    for (const match of text.matchAll(IDENTIFIER_TOKEN_RE)) {
      const token = match[0].toLowerCase();
      if (!support.identifiers.has(token)) {
        errors.push(
          `Unsupported identifier "${match[0]}" in ${loc} cannot be resolved to cited evidence`,
        );
      }
    }

    // Numeric quantity-unit claims
    const qMatches = [...text.matchAll(QUANTITY_UNIT_RE)];
    for (const match of qMatches) {
      const token = `${match[1]} ${match[2].toLowerCase()}`;
      if (!support.quantities.has(token)) {
        errors.push(
          `Unsupported quantity claim "${token}" in ${loc} not found in cited events`,
        );
      }
    }

    // Controlled status values
    const statusMatches = [...text.matchAll(CONTROLLED_STATUS_RE)];
    for (const match of statusMatches) {
      const token = match[1].toLowerCase();
      if (CONTROLLED_STATUSES.has(token) && !support.statuses.has(token)) {
        errors.push(
          `Controlled status value "${token}" in ${loc} does not match any cited event status`,
        );
      }
    }

    for (const { operation, pattern } of CONTROLLED_OPERATION_CLAIMS) {
      if (pattern.test(text) && !support.operations.has(operation)) {
        errors.push(
          `Unsupported operation claim "${operation}" in ${loc} not found in cited events`,
        );
      }
    }

    if (
      UNSUPPORTED_TASK_COMPLETION_RE.test(text) ||
      UNSUPPORTED_RUN_COMPLETION_RE.test(text)
    ) {
      errors.push(
        `Unsupported task-completion claim in ${loc}; run termination does not prove task outcome`,
      );
    }

    for (const match of text.matchAll(LEXICAL_TOKEN_RE)) {
      const token = match[0].toLowerCase();
      if (
        !SAFE_MANAGER_COPY_TOKENS.has(token) &&
        !support.lexicalTokens.has(token)
      ) {
        errors.push(
          `Unsupported lexical claim token "${match[0]}" in ${loc} is absent from cited evidence`,
        );
      }
    }

    const labeledChecks: Array<{
      regex: RegExp;
      supported: Set<string>;
      category: string;
    }> = [
      { regex: SYSTEM_CLAIM_RE, supported: support.systems, category: "system" },
      { regex: OPERATION_CLAIM_RE, supported: support.operations, category: "operation" },
      { regex: RESOURCE_CLAIM_RE, supported: support.resourceTypes, category: "resource" },
      { regex: LABELED_DATA_RE, supported: support.dataCategories, category: "data category" },
      { regex: LABELED_ACTOR_RE, supported: support.actorIds, category: "actor" },
    ];

    for (const check of labeledChecks) {
      for (const match of text.matchAll(check.regex)) {
        if (!hasValue(check.supported, match[1])) {
          errors.push(
            `Unsupported ${check.category} claim "${match[1]}" in ${loc} not found in cited evidence`,
          );
        }
      }
    }
  }

  return errors;
}

/** Limitations must preserve the structured source ordering and event links. */
function checkLimitationGrounding(
  copy: GeneratedReceiptCopy,
  bundle: GraniteFactBundle,
): string[] {
  if (copy.limitations.length !== bundle.limitations.length) {
    return [
      `limitations must contain exactly ${bundle.limitations.length} evidence-derived item(s)`,
    ];
  }

  const errors: string[] = [];
  copy.limitations.forEach((limitation, index) => {
    const source = bundle.limitations[index];
    if (!source || limitation.text !== source.text) {
      errors.push(
        `limitations[${index}] text must exactly match the evidence limitation`,
      );
    }
    if (!source || !sameIds(limitation.eventIds, source.eventIds)) {
      errors.push(
        `limitations[${index}] eventIds do not match the corresponding evidence limitation`,
      );
    }
  });
  return errors;
}

/** Check 7: UI length limits */
function checkUiLengthLimits(copy: GeneratedReceiptCopy): string[] {
  const errors: string[] = [];

  if (copy.headline.text.length > UI_LIMITS.HEADLINE_MAX) {
    errors.push(
      `headline.text exceeds ${UI_LIMITS.HEADLINE_MAX} characters (got ${copy.headline.text.length})`,
    );
  }
  if (copy.outcome.text.length > UI_LIMITS.OUTCOME_MAX) {
    errors.push(
      `outcome.text exceeds ${UI_LIMITS.OUTCOME_MAX} characters (got ${copy.outcome.text.length})`,
    );
  }
  copy.notableActions.forEach((a, i) => {
    if (a.text.length > UI_LIMITS.NOTABLE_ACTION_MAX) {
      errors.push(
        `notableActions[${i}].text exceeds ${UI_LIMITS.NOTABLE_ACTION_MAX} characters (got ${a.text.length})`,
      );
    }
  });
  copy.limitations.forEach((l, i) => {
    if (l.text.length > UI_LIMITS.LIMITATION_MAX) {
      errors.push(
        `limitations[${i}].text exceeds ${UI_LIMITS.LIMITATION_MAX} characters (got ${l.text.length})`,
      );
    }
  });

  return errors;
}

/** Check 8: deterministic verdict language and evidence qualifier. */
const VERDICT_HEADLINE_MARKERS: Record<Verdict, RegExp[]> = {
  within_declared_authority: [
    /\bwithin (?:the )?declared authority\b/i,
    /\bno (?:authority |material )?deviations?\b/i,
  ],
  review_recommended: [
    /\breview recommended\b/i,
    /\bmanager review\b/i,
    /\bwarrant(?:s|ed)? review\b/i,
    /\bfor a manager to review\b/i,
  ],
  material_deviations_found: [/\bmaterial deviations?\b/i],
  unable_to_assess_fully: [
    /\bunable to assess(?: fully)?\b/i,
    /\bdoes not support a complete authority assessment\b/i,
    /\bauthority assessment incomplete\b/i,
    /\bprevent(?:s)? a full authority assessment\b/i,
  ],
};

const NEGATED_MATERIAL_DEVIATION_RE =
  /\bno material deviations?(?: (?:were|was))?(?: found)?\b/gi;

function verdictScanText(verdictCode: Verdict, text: string): string {
  return verdictCode === "material_deviations_found"
    ? text.replace(NEGATED_MATERIAL_DEVIATION_RE, "")
    : text;
}

function hasVerdictMarker(verdictCode: Verdict, text: string): boolean {
  const scannable = verdictScanText(verdictCode, text);
  return VERDICT_HEADLINE_MARKERS[verdictCode].some((marker) =>
    marker.test(scannable),
  );
}

function checkVerdictLanguage(
  copy: GeneratedReceiptCopy,
  bundle: GraniteFactBundle,
): string[] {
  const errors: string[] = [];
  if (!copy.outcome.text.includes(bundle.verdictQualifier)) {
    errors.push(
      `outcome.text must contain the exact deterministic verdict qualifier "${bundle.verdictQualifier}"`,
    );
  }

  if (!hasVerdictMarker(bundle.verdictCode, copy.headline.text)) {
    errors.push(
      `headline.text must express deterministic verdict "${bundle.verdictCode}"`,
    );
  }

  const verdictText = `${copy.headline.text}\n${copy.outcome.text}`;
  for (const verdictCode of Object.keys(VERDICT_LABELS) as Verdict[]) {
    if (verdictCode === bundle.verdictCode) continue;

    const scannable = verdictScanText(verdictCode, verdictText);
    const hasWrongCode = scannable.toLowerCase().includes(verdictCode);
    const hasWrongLabel = scannable
      .toLowerCase()
      .includes(VERDICT_LABELS[verdictCode].toLowerCase());
    const hasWrongMarker = hasVerdictMarker(verdictCode, verdictText);
    if (hasWrongCode || hasWrongLabel || hasWrongMarker) {
      errors.push(
        `headline/outcome text contradicts deterministic verdict with "${verdictCode}" language`,
      );
    }
  }

  return errors;
}

const NEGATED_FINDING_PATTERN =
  String.raw`\b(?:no|zero)\s+(?:material\s+)?(?:findings?|deviations?|violations?|issues?)(?:\s+(?:were|was|are|is))?(?:\s+(?:found|detected|identified|present))?|\b(?:findings?|deviations?|violations?|issues?)\s+(?:were|was|are|is)\s+(?:not|never)\s+(?:found|detected|identified|present)|\b(?:(?:this|the)\s+)?(?:run|trace|assessment)\s+(?:does|do|did)\s+not\s+have\s+(?:any\s+)?(?:findings?|deviations?|violations?|issues?)|\b(?:(?:this|the)\s+)?(?:run|trace|assessment)\s+(?:has|have|had)\s+no\s+(?:findings?|deviations?|violations?|issues?)|\bwithout\s+(?:any\s+)?(?:findings?|deviations?|violations?|issues?)|\bthere\s+(?:are|were|is|was)\s+no\s+(?:findings?|deviations?|violations?|issues?)`;
const POSITIVE_FINDING_PATTERN =
  /\b(?:findings?|deviations?|violations?|issues?)\s+(?:(?:were|was|are|is)\s+)?(?:found|detected|identified|present)\b|\bcontains\s+(?:material\s+)?(?:findings?|deviations?|violations?|issues?)\b|\b(?:(?:this|the)\s+)?(?:run|trace|assessment)\s+(?:has|have|had)\s+(?:findings?|deviations?|violations?|issues?)\b|\bthere\s+(?:are|were|is|was)\s+(?:findings?|deviations?|violations?|issues?)\b/i;

function checkHeadlineFindingConsistency(
  copy: GeneratedReceiptCopy,
  bundle: GraniteFactBundle,
): string[] {
  const headline = copy.headline.text;
  if (
    bundle.allowedFindingIds.length > 0 &&
    new RegExp(NEGATED_FINDING_PATTERN, "i").test(headline)
  ) {
    return [
      "headline.text cannot negate deterministic findings or limitations",
    ];
  }

  if (bundle.allowedFindingIds.length === 0) {
    const withoutGroundedNegation = headline.replace(
      new RegExp(NEGATED_FINDING_PATTERN, "gi"),
      "",
    );
    if (POSITIVE_FINDING_PATTERN.test(withoutGroundedNegation)) {
      return [
        "headline.text cannot introduce findings absent from deterministic evidence",
      ];
    }
  }
  return [];
}

/**
 * Deterministic text anchors keep trust-critical semantics decidable. Granite
 * may select and order notable findings, but every rendered sentence stays a
 * canonical server projection. This avoids trying to prove semantic entailment
 * from arbitrary model prose with an open-ended list of forbidden phrases.
 */
function checkDeterministicTextProjection(
  copy: GeneratedReceiptCopy,
  bundle: GraniteFactBundle,
): string[] {
  const expected = deterministicFallback(bundle);
  const errors: string[] = [];

  if (copy.headline.text !== expected.headline.text) {
    errors.push(
      `headline.text must exactly match the deterministic verdict projection "${expected.headline.text}"`,
    );
  }

  if (copy.outcome.text !== expected.outcome.text) {
    errors.push(
      `outcome.text must exactly match the deterministic evidence projection "${expected.outcome.text}"`,
    );
  }
  const usedProjectionIndexes = new Set<number>();
  copy.notableActions.forEach((action, index) => {
    const projectionIndex = expected.notableActions.findIndex(
      (candidate) => JSON.stringify(candidate) === JSON.stringify(action),
    );
    if (projectionIndex === -1) {
      errors.push(
        `notableActions[${index}] must exactly match a cited deterministic finding projection`,
      );
      return;
    }
    if (usedProjectionIndexes.has(projectionIndex)) {
      errors.push(
        `notableActions[${index}] duplicates a deterministic finding projection`,
      );
      return;
    }
    usedProjectionIndexes.add(projectionIndex);
  });

  return errors;
}

// ─── Main validator ───────────────────────────────────────────────────────────

export function validateClaims(
  copy: GeneratedReceiptCopy,
  bundle: GraniteFactBundle,
): ValidationResult {
  const errors: string[] = [
    ...checkMissingCitations(copy),
    ...checkUnknownEventIds(copy, bundle.allowedEventIds),
    ...checkUnknownFindingIds(copy, bundle.allowedFindingIds),
    ...checkFindingEventRelationship(copy, bundle),
    ...checkVerdictCitationGrounding(copy, bundle),
    ...checkProhibitedAssuranceLanguage(copy),
    ...checkLimitationGrounding(copy, bundle),
    ...checkUnsupportedFacts(copy, bundle),
    ...checkUiLengthLimits(copy),
    ...checkVerdictLanguage(copy, bundle),
    ...checkHeadlineFindingConsistency(copy, bundle),
    ...checkDeterministicTextProjection(copy, bundle),
  ];

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true };
}
