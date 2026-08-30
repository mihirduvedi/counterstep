import { afterEach, describe, expect, it, vi } from "vitest";
import { adaptNativeTrace } from "../../src/adapters/nativeTrace.js";
import { deterministicFallback } from "../../src/ai/deterministicFallback.js";
import { buildFactBundle, type GraniteFactBundle } from "../../src/ai/factBundle.js";
import {
  generateReceiptCopy,
  RECEIPT_COPY_TOTAL_TIMEOUT_MS,
} from "../../src/ai/generateReceiptCopy.js";
import {
  callGranite,
  type GraniteCaller,
} from "../../src/ai/graniteClient.js";
import { runPolicyEngine } from "../../src/core/policyEngine.js";
import { ReceiptCopyGenerationResultSchema } from "../../src/core/schemas/index.js";
import {
  fixtureA,
  fixtureB,
  sharedAuthority,
} from "../../src/fixtures/index.js";

function makeBundle(): GraniteFactBundle {
  const adapter = adaptNativeTrace(fixtureA);
  const policy = runPolicyEngine({
    events: adapter.events,
    accounting: adapter.accounting,
    authority: sharedAuthority,
    traceCompletionStatus: fixtureA.status,
  });

  return buildFactBundle({
    events: adapter.events,
    findings: policy.findings,
    accounting: adapter.accounting,
    verdict: policy.verdict,
    authority: sharedAuthority,
    hasAssessmentLimitation: policy.hasAssessmentLimitation,
  });
}

function makeMaterialDeviationBundle(): GraniteFactBundle {
  const adapter = adaptNativeTrace(fixtureB);
  const policy = runPolicyEngine({
    events: adapter.events,
    accounting: adapter.accounting,
    authority: sharedAuthority,
    traceCompletionStatus: fixtureB.status,
  });

  return buildFactBundle({
    events: adapter.events,
    findings: policy.findings,
    accounting: adapter.accounting,
    verdict: policy.verdict,
    authority: sharedAuthority,
    hasAssessmentLimitation: policy.hasAssessmentLimitation,
  });
}

function makeLimitationBundle(): GraniteFactBundle {
  const adapter = adaptNativeTrace(fixtureA);
  const events = adapter.events.map((event, index) =>
    index === 0 ? { ...event, operation: "unknown" as const } : event,
  );
  const policy = runPolicyEngine({
    events,
    accounting: adapter.accounting,
    authority: sharedAuthority,
    traceCompletionStatus: fixtureA.status,
  });

  return buildFactBundle({
    events,
    findings: policy.findings,
    accounting: adapter.accounting,
    verdict: policy.verdict,
    authority: sharedAuthority,
    hasAssessmentLimitation: policy.hasAssessmentLimitation,
  });
}

function validGraniteText(bundle: GraniteFactBundle): string {
  return JSON.stringify(deterministicFallback(bundle));
}

describe("generateReceiptCopy", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns a validated Granite result after one valid call", async () => {
    const bundle = makeBundle();
    const caller = vi.fn<GraniteCaller>().mockResolvedValue({
      ok: true,
      text: validGraniteText(bundle),
      modelId: "ibm/test-granite",
      apiVersion: "2025-10-25",
    });

    const result = await generateReceiptCopy(bundle, { callGranite: caller });

    expect(ReceiptCopyGenerationResultSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({
      generationSource: "granite",
      modelId: "ibm/test-granite",
      modelApiVersion: "2025-10-25",
    });
    expect(caller).toHaveBeenCalledTimes(1);
    expect(caller.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("renders a compact Granite finding selection into exact deterministic copy", async () => {
    const bundle = makeMaterialDeviationBundle();
    const selectedIds = [
      bundle.findings.at(-1)?.findingId,
      bundle.findings[0]?.findingId,
    ].filter((findingId): findingId is string => findingId !== undefined);
    const caller = vi.fn<GraniteCaller>().mockResolvedValue({
      ok: true,
      text: JSON.stringify({ notableFindingIds: selectedIds }),
      modelId: "ibm/test-granite",
      apiVersion: "2025-10-25",
    });

    const result = await generateReceiptCopy(bundle, { callGranite: caller });

    expect(result.generationSource).toBe("granite");
    expect(result.copy.notableActions.map((action) => action.findingIds[0])).toEqual(
      selectedIds,
    );
    const fallbackByFindingId = new Map(
      deterministicFallback(bundle).notableActions.map((action) => [
        action.findingIds[0],
        action,
      ]),
    );
    expect(result.copy.notableActions).toEqual(
      selectedIds.map((findingId) => fallbackByFindingId.get(findingId)),
    );
  });

  it("repairs an unknown compact selection ID without accepting a generated claim", async () => {
    const bundle = makeMaterialDeviationBundle();
    const selectedId = bundle.findings[0]?.findingId;
    expect(selectedId).toBeDefined();
    const caller = vi
      .fn<GraniteCaller>()
      .mockResolvedValueOnce({
        ok: true,
        text: JSON.stringify({ notableFindingIds: ["finding-invented"] }),
        modelId: "ibm/test-granite",
        apiVersion: "2025-10-25",
      })
      .mockResolvedValueOnce({
        ok: true,
        text: JSON.stringify({ notableFindingIds: [selectedId] }),
        modelId: "ibm/test-granite",
        apiVersion: "2025-10-25",
      });

    const result = await generateReceiptCopy(bundle, { callGranite: caller });

    expect(result.generationSource).toBe("granite");
    expect(result.copy.notableActions[0]?.findingIds).toEqual([selectedId]);
    expect(caller.mock.calls[1]?.[1]?.repairErrors).toContain(
      'Unknown notable finding ID "finding-invented"',
    );
  });

  it("passes validation errors to one repair call and accepts valid repair", async () => {
    const bundle = makeBundle();
    const caller = vi
      .fn<GraniteCaller>()
      .mockResolvedValueOnce({
        ok: true,
        text: '{"invalid":true}',
        modelId: "ibm/test-granite",
        apiVersion: "2025-10-25",
      })
      .mockResolvedValueOnce({
        ok: true,
        text: validGraniteText(bundle),
        modelId: "ibm/test-granite",
        apiVersion: "2025-10-25",
      });

    const result = await generateReceiptCopy(bundle, { callGranite: caller });

    expect(result.generationSource).toBe("granite");
    expect(caller).toHaveBeenCalledTimes(2);
    const repairOptions = caller.mock.calls[1]?.[1];
    expect(repairOptions?.repairErrors?.length).toBeGreaterThan(0);
    expect(repairOptions?.signal).toBe(caller.mock.calls[0]?.[1]?.signal);
  });

  it("returns fallback after two invalid model responses", async () => {
    const bundle = makeBundle();
    const caller = vi.fn<GraniteCaller>().mockResolvedValue({
      ok: true,
      text: "not-json",
      modelId: "ibm/test-granite",
      apiVersion: "2025-10-25",
    });

    const result = await generateReceiptCopy(bundle, { callGranite: caller });

    expect(result.generationSource).toBe("deterministic_fallback");
    expect(ReceiptCopyGenerationResultSchema.safeParse(result).success).toBe(true);
    expect(caller).toHaveBeenCalledTimes(2);
  });

  it("repairs then falls back when model prose is whitespace-only", async () => {
    const bundle = makeBundle();
    const invalidCopy = deterministicFallback(bundle);
    invalidCopy.headline.text = "   ";
    const caller = vi.fn<GraniteCaller>().mockResolvedValue({
      ok: true,
      text: JSON.stringify(invalidCopy),
      modelId: "ibm/test-granite",
      apiVersion: "2025-10-25",
    });

    const result = await generateReceiptCopy(bundle, { callGranite: caller });

    expect(result.generationSource).toBe("deterministic_fallback");
    expect(result.copy.headline.text.trim().length).toBeGreaterThan(0);
    expect(caller).toHaveBeenCalledTimes(2);
  });

  it("repairs then falls back when the model contradicts the deterministic verdict", async () => {
    const bundle = makeBundle();
    const invalidCopy = deterministicFallback(bundle);
    invalidCopy.headline.text =
      "The supplied trace contains material deviations.";
    invalidCopy.outcome.text =
      "Material deviations found. Based on the supplied trace and authority envelope.";
    const caller = vi.fn<GraniteCaller>().mockResolvedValue({
      ok: true,
      text: JSON.stringify(invalidCopy),
      modelId: "ibm/test-granite",
      apiVersion: "2025-10-25",
    });

    const result = await generateReceiptCopy(bundle, { callGranite: caller });

    expect(result.generationSource).toBe("deterministic_fallback");
    expect(result.copy.outcome.text).toBe(bundle.verdictQualifier);
    expect(caller).toHaveBeenCalledTimes(2);
  });

  it("repairs then falls back when verdict copy cites unrelated allowed events", async () => {
    const bundle = makeMaterialDeviationBundle();
    const invalidCopy = deterministicFallback(bundle);
    invalidCopy.headline.eventIds = ["evt-000001"];
    invalidCopy.headline.findingIds = [];
    invalidCopy.outcome.eventIds = ["evt-000001"];
    const caller = vi.fn<GraniteCaller>().mockResolvedValue({
      ok: true,
      text: JSON.stringify(invalidCopy),
      modelId: "ibm/test-granite",
      apiVersion: "2025-10-25",
    });

    const result = await generateReceiptCopy(bundle, { callGranite: caller });

    expect(result.generationSource).toBe("deterministic_fallback");
    expect(result.copy.outcome.eventIds).not.toContain("evt-000001");
    expect(caller).toHaveBeenCalledTimes(2);
  });

  it("repairs then falls back when model prose invents an uncited operation", async () => {
    const bundle = makeBundle();
    const invalidCopy = deterministicFallback(bundle);
    invalidCopy.notableActions = [{
      text: "The agent sent funds.",
      eventIds: ["evt-000001"],
      findingIds: [],
    }];
    const caller = vi.fn<GraniteCaller>().mockResolvedValue({
      ok: true,
      text: JSON.stringify(invalidCopy),
      modelId: "ibm/test-granite",
      apiVersion: "2025-10-25",
    });

    const result = await generateReceiptCopy(bundle, { callGranite: caller });

    expect(result.generationSource).toBe("deterministic_fallback");
    expect(result.copy.notableActions).toHaveLength(0);
    expect(caller).toHaveBeenCalledTimes(2);
  });

  it("repairs then falls back when model prose negates an evidence limitation", async () => {
    const bundle = makeLimitationBundle();
    const invalidCopy = deterministicFallback(bundle);
    expect(invalidCopy.limitations.length).toBeGreaterThan(0);
    invalidCopy.limitations[0].text = "No limitation applies.";
    const caller = vi.fn<GraniteCaller>().mockResolvedValue({
      ok: true,
      text: JSON.stringify(invalidCopy),
      modelId: "ibm/test-granite",
      apiVersion: "2025-10-25",
    });

    const result = await generateReceiptCopy(bundle, { callGranite: caller });

    expect(result.generationSource).toBe("deterministic_fallback");
    expect(result.copy.limitations[0].text).toBe(bundle.limitations[0].text);
    expect(caller).toHaveBeenCalledTimes(2);
  });

  it("repairs then falls back when model prose invents a person and outcome", async () => {
    const bundle = makeBundle();
    const invalidCopy = deterministicFallback(bundle);
    invalidCopy.headline.text =
      "No deviations were found; Alice earned a promotion and profits doubled.";
    const caller = vi.fn<GraniteCaller>().mockResolvedValue({
      ok: true,
      text: JSON.stringify(invalidCopy),
      modelId: "ibm/test-granite",
      apiVersion: "2025-10-25",
    });

    const result = await generateReceiptCopy(bundle, { callGranite: caller });

    expect(result.generationSource).toBe("deterministic_fallback");
    expect(result.copy.headline.text).not.toContain("Alice");
    expect(caller).toHaveBeenCalledTimes(2);
  });

  it("repairs then falls back when model prose negates a cited finding", async () => {
    const bundle = makeMaterialDeviationBundle();
    const invalidCopy = deterministicFallback(bundle);
    invalidCopy.notableActions[0].text = "No findings were found.";
    const caller = vi.fn<GraniteCaller>().mockResolvedValue({
      ok: true,
      text: JSON.stringify(invalidCopy),
      modelId: "ibm/test-granite",
      apiVersion: "2025-10-25",
    });

    const result = await generateReceiptCopy(bundle, { callGranite: caller });

    expect(result.generationSource).toBe("deterministic_fallback");
    expect(result.copy.notableActions[0].text).not.toBe(
      "No findings were found.",
    );
    expect(caller).toHaveBeenCalledTimes(2);
  });

  it("repairs then falls back when a headline negates deterministic findings", async () => {
    const bundle = makeMaterialDeviationBundle();
    const invalidCopy = deterministicFallback(bundle);
    invalidCopy.headline.text =
      "Material deviations found; no findings were found.";
    invalidCopy.notableActions = [];
    const caller = vi.fn<GraniteCaller>().mockResolvedValue({
      ok: true,
      text: JSON.stringify(invalidCopy),
      modelId: "ibm/test-granite",
      apiVersion: "2025-10-25",
    });

    const result = await generateReceiptCopy(bundle, { callGranite: caller });

    expect(result.generationSource).toBe("deterministic_fallback");
    expect(result.copy.notableActions.length).toBeGreaterThan(0);
    expect(caller).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      caseName: "a within-authority run claims findings",
      buildBundle: makeBundle,
      headline: "Within declared authority; this run has findings.",
    },
    {
      caseName: "a material-deviation run denies findings",
      buildBundle: makeMaterialDeviationBundle,
      headline: "Material deviations found; this run does not have findings.",
    },
    {
      caseName: "a material-deviation run claims task completion",
      buildBundle: makeMaterialDeviationBundle,
      headline: "Material deviations found; the task is complete.",
    },
  ])("repairs then falls back when $caseName", async ({ buildBundle, headline }) => {
    const bundle = buildBundle();
    const invalidCopy = deterministicFallback(bundle);
    invalidCopy.headline.text = headline;
    const caller = vi.fn<GraniteCaller>().mockResolvedValue({
      ok: true,
      text: JSON.stringify(invalidCopy),
      modelId: "ibm/test-granite",
      apiVersion: "2025-10-25",
    });

    const result = await generateReceiptCopy(bundle, { callGranite: caller });

    expect(result.generationSource).toBe("deterministic_fallback");
    expect(result.copy.headline.text).not.toBe(headline);
    expect(caller).toHaveBeenCalledTimes(2);
  });

  it("returns fallback when the model dependency rejects", async () => {
    const bundle = makeBundle();
    const caller = vi
      .fn<GraniteCaller>()
      .mockRejectedValue(new Error("unexpected client rejection"));

    const result = await generateReceiptCopy(bundle, { callGranite: caller });

    expect(result.generationSource).toBe("deterministic_fallback");
    expect(caller).toHaveBeenCalledTimes(1);
  });

  it("uses fallback mode without making any network request", async () => {
    const bundle = makeBundle();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("GRANITE_MODE", "fallback");

    const result = await generateReceiptCopy(bundle);

    expect(result.generationSource).toBe("deterministic_fallback");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards an external abort signal into the Granite client fetch", async () => {
    const bundle = makeBundle();
    vi.stubEnv("GRANITE_MODE", "live");
    vi.stubEnv("WATSONX_API_KEY", "test-key");
    vi.stubEnv("WATSONX_URL", "https://us-south.ml.cloud.ibm.com");
    vi.stubEnv("WATSONX_PROJECT_ID", "test-project");
    vi.stubEnv("WATSONX_MODEL_ID", "ibm/test-granite");

    const fetchMock = vi.fn((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener(
          "abort",
          () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          },
          { once: true },
        );
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const resultPromise = callGranite(bundle, { signal: controller.signal });
    controller.abort();
    const result = await resultPromise;

    expect(result).toEqual({ ok: false, reason: "iam_error" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("enforces one eight-second deadline across all model attempts", async () => {
    vi.useFakeTimers();
    const bundle = makeBundle();
    let receivedSignal: AbortSignal | undefined;
    let attempt = 0;
    const caller = vi.fn<GraniteCaller>((_bundle, options) => {
      attempt += 1;
      receivedSignal = options?.signal;

      if (attempt === 1) {
        return new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                ok: true,
                text: "not-json",
                modelId: "ibm/test-granite",
                apiVersion: "2025-10-25",
              }),
            7_000,
          );
        });
      }

      return new Promise((resolve) => {
        options?.signal?.addEventListener(
          "abort",
          () => resolve({ ok: false, reason: "timeout" }),
          { once: true },
        );
      });
    });

    const resultPromise = generateReceiptCopy(bundle, { callGranite: caller });
    await vi.advanceTimersByTimeAsync(7_000);
    expect(caller).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(
      RECEIPT_COPY_TOTAL_TIMEOUT_MS - 7_001,
    );
    expect(receivedSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const result = await resultPromise;

    expect(receivedSignal?.aborted).toBe(true);
    expect(result.generationSource).toBe("deterministic_fallback");
    expect(caller).toHaveBeenCalledTimes(2);
  });
});
