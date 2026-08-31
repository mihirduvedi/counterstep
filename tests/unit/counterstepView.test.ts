import { describe, expect, it } from "vitest";

import { CLOSURE_QUALIFIER } from "../../src/counterstep/schemas.js";
import {
  buildRecoveryProgress,
  getRecoveryAnnouncement,
  getTerminalRunNotice,
} from "../../src/ui/counterstepView.js";

describe("Counterstep recovery progress view", () => {
  it("keeps every phase pending before a run exists", () => {
    expect(buildRecoveryProgress({}).map((phase) => phase.state)).toEqual([
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("marks earlier work complete and the current phase active", () => {
    expect(
      buildRecoveryProgress({ status: "authorizing" }).map(
        (phase) => phase.state,
      ),
    ).toEqual([
      "complete",
      "complete",
      "active",
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("shows exactly where a run without closure stopped", () => {
    expect(
      buildRecoveryProgress({
        status: "failed",
        events: [{ phase: "inspecting" }, { phase: "planning" }],
      }).map((phase) => phase.state),
    ).toEqual([
      "complete",
      "stopped",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("does not invent completed work when execution failed before inspection", () => {
    expect(
      buildRecoveryProgress({ status: "failed" }).map((phase) => phase.state),
    ).toEqual([
      "stopped",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("marks the full deterministic path complete only when closure exists", () => {
    expect(
      buildRecoveryProgress({
        status: "repaired",
        hasClosure: true,
      }).every((phase) => phase.state === "complete"),
    ).toBe(true);
  });
});

describe("Counterstep recovery announcements", () => {
  it("prioritizes actionable errors over background state", () => {
    expect(
      getRecoveryAnnouncement({
        demoReady: true,
        error: "The service is offline.",
        executing: true,
        resetting: true,
      }),
    ).toBe("Counterstep needs attention. The service is offline.");
  });

  it("announces the exact active phase", () => {
    expect(
      getRecoveryAnnouncement({
        demoReady: true,
        executing: true,
        resetting: false,
        run: {
          run: { status: "executing" },
          events: [],
        },
      }),
    ).toBe("Repair in progress. Apply only admitted transitions.");
  });

  it("qualifies a failed terminal run without claiming closure", () => {
    expect(
      getRecoveryAnnouncement({
        demoReady: true,
        executing: false,
        resetting: false,
        run: {
          run: { status: "failed" },
          events: [],
        },
      }),
    ).toBe("Recovery failed closed. Counterstep is not claiming repair.");
  });
});

describe("Counterstep terminal result notice", () => {
  it("surfaces the no-model fail-closed boundary beside the primary action", () => {
    expect(
      getTerminalRunNotice({
        run: {
          status: "failed",
          generationSource: "deterministic_no_execution",
        },
      }),
    ).toMatchObject({
      tone: "attention",
      title: "Execution unavailable · zero writes",
      evidenceHref: "#ledger-title",
    });
  });

  it("routes a validated repaired outcome to closure evidence", () => {
    expect(
      getTerminalRunNotice({
        run: {
          status: "repaired",
          generationSource: "gemini",
        },
        closure: {
          qualifier: CLOSURE_QUALIFIER,
        },
      }),
    ).toEqual({
      tone: "verified",
      eyebrow: "Verified outcome",
      title: "Repaired and verified",
      detail: CLOSURE_QUALIFIER,
      evidenceHref: "#closure-title",
      evidenceLabel: "Review closure evidence",
    });
  });
});
