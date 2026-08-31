import type {
  ActionEvent,
  PublicRunView,
  RemediationRunStatus,
} from "../counterstep/schemas";

export type RecoveryPhaseKey =
  | "inspecting"
  | "planning"
  | "authorizing"
  | "executing"
  | "verifying"
  | "closure";

export type RecoveryPhaseState =
  | "pending"
  | "active"
  | "complete"
  | "stopped";

export type RecoveryPhaseItem = {
  key: RecoveryPhaseKey;
  label: string;
  detail: string;
  state: RecoveryPhaseState;
};

export type TerminalRunNotice = {
  tone: "verified" | "attention";
  eyebrow: string;
  title: string;
  detail: string;
  evidenceHref: "#closure-title" | "#ledger-title";
  evidenceLabel: string;
};

type ProgressInput = {
  status?: RemediationRunStatus;
  events?: ReadonlyArray<Pick<ActionEvent, "phase">>;
  hasClosure?: boolean;
};

type AnnouncementInput = {
  demoReady: boolean;
  error?: string;
  executing: boolean;
  resetting: boolean;
  run?: {
    run: Pick<PublicRunView["run"], "status">;
    events: ReadonlyArray<Pick<ActionEvent, "phase">>;
    closure?: Pick<NonNullable<PublicRunView["closure"]>, "qualifier">;
  };
};

type TerminalRunInput = {
  run: Pick<
    PublicRunView["run"],
    "status" | "generationSource"
  >;
  closure?: Pick<NonNullable<PublicRunView["closure"]>, "qualifier">;
};

const TERMINAL_STATUSES = new Set<RemediationRunStatus>([
  "repaired",
  "partially_repaired",
  "blocked",
  "unable_to_verify",
  "failed",
]);

const PHASE_DEFINITIONS = [
  {
    key: "inspecting",
    label: "Inspect",
    detail: "Read current resource versions",
  },
  {
    key: "planning",
    label: "Plan",
    detail: "Propose a cited finite recovery",
  },
  {
    key: "authorizing",
    label: "Authorize",
    detail: "Check the exact authority tuple",
  },
  {
    key: "executing",
    label: "Repair",
    detail: "Apply only admitted transitions",
  },
  {
    key: "verifying",
    label: "Verify",
    detail: "Re-read final sandbox state",
  },
  {
    key: "closure",
    label: "Close",
    detail: "Issue the deterministic outcome",
  },
] as const satisfies ReadonlyArray<{
  key: RecoveryPhaseKey;
  label: string;
  detail: string;
}>;

const CORE_PHASE_ORDER = new Map<RemediationRunStatus, number>([
  ["inspecting", 0],
  ["planning", 1],
  ["authorizing", 2],
  ["executing", 3],
  ["verifying", 4],
]);

function phaseItemState(
  index: number,
  activeIndex: number,
  terminal: boolean,
  hasClosure: boolean,
): RecoveryPhaseState {
  if (terminal && hasClosure) return "complete";
  if (terminal) {
    if (index < activeIndex) return "complete";
    if (index === activeIndex) return "stopped";
    return "pending";
  }
  if (index < activeIndex) return "complete";
  if (index === activeIndex) return "active";
  return "pending";
}

export function buildRecoveryProgress({
  status,
  events = [],
  hasClosure = false,
}: ProgressInput): RecoveryPhaseItem[] {
  if (!status) {
    return PHASE_DEFINITIONS.map((phase) => ({
      ...phase,
      state: "pending" as const,
    }));
  }

  const terminal = TERMINAL_STATUSES.has(status);
  const directIndex = CORE_PHASE_ORDER.get(status);
  const eventIndexes = events.flatMap((event) => {
    const index = CORE_PHASE_ORDER.get(event.phase);
    return index === undefined ? [] : [index];
  });
  const activeIndex = terminal
    ? Math.max(0, ...eventIndexes)
    : directIndex ?? 0;

  return PHASE_DEFINITIONS.map((phase, index) => ({
    ...phase,
    state: phaseItemState(index, activeIndex, terminal, hasClosure),
  }));
}

export function getRecoveryAnnouncement({
  demoReady,
  error,
  executing,
  resetting,
  run,
}: AnnouncementInput): string {
  if (error) return `Counterstep needs attention. ${error}`;
  if (resetting) return "Resetting the synthetic sandbox.";
  if (executing && run) {
    const active = buildRecoveryProgress({
      status: run.run.status,
      events: run.events,
      hasClosure: Boolean(run.closure),
    }).find((phase) => phase.state === "active");
    return active
      ? `${active.label} in progress. ${active.detail}.`
      : "Counterstep is starting the bounded recovery.";
  }
  if (run?.run.status === "repaired") {
    return "Recovery complete. Every declared goal was verified from fresh state.";
  }
  if (run?.run.status === "partially_repaired") {
    return "Recovery complete with unresolved goals. Review the deterministic closure evidence.";
  }
  if (run?.run.status === "blocked") {
    return "Recovery blocked by deterministic authority or transition controls.";
  }
  if (run?.run.status === "unable_to_verify") {
    return "Recovery stopped because final state could not be verified.";
  }
  if (run?.run.status === "failed") {
    return "Recovery failed closed. Counterstep is not claiming repair.";
  }
  return demoReady
    ? "Synthetic incident ready. Two reversible repairs are available."
    : "Loading the synthetic incident.";
}

export function getTerminalRunNotice(
  run: TerminalRunInput | null,
): TerminalRunNotice | null {
  if (!run || !TERMINAL_STATUSES.has(run.run.status)) return null;

  const evidenceHref = run.closure ? "#closure-title" : "#ledger-title";
  const evidenceLabel = run.closure
    ? "Review closure evidence"
    : "Review run evidence";

  switch (run.run.status) {
    case "repaired":
      return {
        tone: "verified",
        eyebrow: "Verified outcome",
        title: "Repaired and verified",
        detail:
          run.closure?.qualifier ??
          "Every declared recovery goal was proven from fresh sandbox state.",
        evidenceHref,
        evidenceLabel,
      };
    case "partially_repaired":
      return {
        tone: "attention",
        eyebrow: "Qualified outcome",
        title: "Some effects remain unresolved",
        detail:
          run.closure?.qualifier ??
          "Counterstep verified the reversible repairs it could prove and preserved the unresolved goals.",
        evidenceHref,
        evidenceLabel,
      };
    case "blocked":
      return {
        tone: "attention",
        eyebrow: "Deterministic stop",
        title: "Recovery was blocked",
        detail:
          "An authority, transition, or state check rejected the requested path before an unsafe write could be admitted.",
        evidenceHref,
        evidenceLabel,
      };
    case "unable_to_verify":
      return {
        tone: "attention",
        eyebrow: "Evidence boundary",
        title: "Final state could not be verified",
        detail:
          "Counterstep could not obtain enough current-state evidence to make a trustworthy closure claim.",
        evidenceHref,
        evidenceLabel,
      };
    case "failed":
      return run.run.generationSource === "deterministic_no_execution"
        ? {
            tone: "attention",
            eyebrow: "Fail-closed outcome",
            title: "Execution unavailable · zero writes",
            detail:
              "Valid Gemini execution was unavailable, so Counterstep stopped before recovery and left current resource state unchanged.",
            evidenceHref,
            evidenceLabel,
          }
        : {
            tone: "attention",
            eyebrow: "Fail-closed outcome",
            title: "Recovery did not reach trustworthy closure",
            detail:
              "Counterstep stopped the run and will not claim repair without valid execution and fresh final evidence.",
            evidenceHref,
            evidenceLabel,
          };
  }
  return null;
}
