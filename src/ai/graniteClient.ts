import { z } from "zod";
import type { GraniteFactBundle } from "./factBundle";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GraniteCallSuccess = {
  ok: true;
  text: string;
  modelId: string;
  apiVersion: string;
};

export type GraniteCallResult =
  | GraniteCallSuccess
  | {
      ok: false;
      reason:
        | "missing_credentials"
        | "iam_error"
        | "timeout"
        | "http_error"
        | "network_error";
    };

export type GraniteCallOptions = {
  repairErrors?: string[];
  signal?: AbortSignal;
};

export type GraniteCaller = (
  bundle: GraniteFactBundle,
  options?: GraniteCallOptions,
) => Promise<GraniteCallResult>;

// ─── Response schemas ─────────────────────────────────────────────────────────

const IamResponseSchema = z
  .object({
    access_token: z.string().min(1),
    expires_in: z.number().int().positive().optional(),
    expiration: z.number().int().positive().optional(),
  })
  .passthrough();

const WatsonxChatResponseSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            message: z
              .object({ content: z.string().min(1) })
              .passthrough(),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

// ─── Prompt builder ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  "You prioritize already-verified policy findings for an AI operations manager. " +
  "You do not write claims, infer missing facts, change verdicts, or execute actions. " +
  "Return JSON only.";

const OUTPUT_CONTRACT = `Return exactly one JSON object with this shape:
{"notableFindingIds":["finding-..."]}
Do not add keys. Select at most five IDs from the supplied findings. Use each ID at most once. Put the most decision-relevant findings first. If there are no findings, return an empty array.`;

function buildPrompt(
  bundle: GraniteFactBundle,
  repairErrors?: string[],
): string {
  const selectionFacts = {
    verdictCode: bundle.verdictCode,
    task: bundle.task,
    findings: bundle.findings.map((finding) => ({
      findingId: finding.findingId,
      severity: finding.severity,
      ruleId: finding.ruleId,
      label: finding.label,
      description: finding.description,
      eventIds: finding.eventIds,
    })),
  };
  const bundleJson = JSON.stringify(selectionFacts);

  if (repairErrors && repairErrors.length > 0) {
    return (
      "Your previous response had the following validation errors:\n" +
      repairErrors.map((e) => `- ${e}`).join("\n") +
      "\n\nPlease produce a corrected response.\n" +
      OUTPUT_CONTRACT +
      "\nThe verified finding projection is:\n" +
      bundleJson
    );
  }

  return (
    "Prioritize the verified findings for an AI operations manager.\n" +
    OUTPUT_CONTRACT +
    "\nThe verified finding projection is:\n" +
    bundleJson
  );
}

// ─── IAM token exchange ───────────────────────────────────────────────────────

function forwardAbort(
  source: AbortSignal | undefined,
  destination: AbortController,
): () => void {
  if (!source) return () => undefined;
  if (source.aborted) {
    destination.abort();
    return () => undefined;
  }

  const abort = () => destination.abort();
  source.addEventListener("abort", abort, { once: true });
  return () => source.removeEventListener("abort", abort);
}

type IamToken = {
  accessToken: string;
  expiresAtMs: number;
};

type CachedIamToken = IamToken & {
  apiKey: string;
};

let cachedIamToken: CachedIamToken | undefined;

/** Test-only reset so isolated mocked credential cases cannot share a token. */
export function _resetGraniteTokenCacheForTests(): void {
  cachedIamToken = undefined;
}

async function exchangeIamToken(
  apiKey: string,
  signal?: AbortSignal,
): Promise<IamToken | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  const stopForwardingAbort = forwardAbort(signal, controller);

  try {
    const response = await fetch(
      "https://iam.cloud.ibm.com/identity/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ibm:params:oauth:grant-type:apikey",
          apikey: apiKey,
        }).toString(),
        signal: controller.signal,
        redirect: "error",
      },
    );

    if (!response.ok) {
      return null;
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return null;
    }

    const parsed = IamResponseSchema.safeParse(json);
    if (!parsed.success) return null;

    const now = Date.now();
    const expiresAtMs = parsed.data.expiration
      ? parsed.data.expiration * 1000
      : now + (parsed.data.expires_in ?? 3600) * 1000;
    return {
      accessToken: parsed.data.access_token,
      expiresAtMs,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    stopForwardingAbort();
  }
}

async function getIamToken(
  apiKey: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const minimumRemainingLifetimeMs = 60_000;
  if (
    cachedIamToken?.apiKey === apiKey &&
    cachedIamToken.expiresAtMs - Date.now() > minimumRemainingLifetimeMs
  ) {
    return cachedIamToken.accessToken;
  }

  const token = await exchangeIamToken(apiKey, signal);
  if (!token) return null;
  cachedIamToken = { apiKey, ...token };
  return token.accessToken;
}

// ─── Main client ──────────────────────────────────────────────────────────────

export async function callGranite(
  bundle: GraniteFactBundle,
  options?: GraniteCallOptions,
): Promise<GraniteCallResult> {
  // Step 1: parse GRANITE_MODE alone with .catch("fallback")
  const mode = z
    .enum(["fallback", "live"])
    .catch("fallback")
    .parse(process.env["GRANITE_MODE"]);

  if (mode !== "live") {
    return { ok: false, reason: "missing_credentials" };
  }

  const publicLiveEnabled = z
    .enum(["true", "false"])
    .catch("false")
    .parse(process.env["GRANITE_ALLOW_PUBLIC_LIVE"]);
  if (
    process.env["VERCEL_ENV"] === "production" &&
    publicLiveEnabled !== "true"
  ) {
    return { ok: false, reason: "missing_credentials" };
  }

  // Step 2: parse live credentials
  const LiveConfigSchema = z.object({
    WATSONX_API_KEY: z.string().min(1),
    WATSONX_URL: z.string().url().startsWith("https://"),
    WATSONX_PROJECT_ID: z.string().min(1),
    WATSONX_MODEL_ID: z.string().min(1),
  });

  const configResult = LiveConfigSchema.safeParse(process.env);
  if (!configResult.success) {
    return { ok: false, reason: "missing_credentials" };
  }

  const {
    WATSONX_API_KEY,
    WATSONX_URL,
    WATSONX_PROJECT_ID,
    WATSONX_MODEL_ID,
  } = configResult.data;

  // Step 3: IAM token exchange
  const accessToken = await getIamToken(WATSONX_API_KEY, options?.signal);
  if (!accessToken) {
    return { ok: false, reason: "iam_error" };
  }

  // Step 4: watsonx inference call
  const prompt = buildPrompt(bundle, options?.repairErrors);
  const requestBody = {
    model_id: WATSONX_MODEL_ID,
    project_id: WATSONX_PROJECT_ID,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
    max_completion_tokens: 256,
  };

  const apiVersion = "2025-10-25";
  const baseUrl = WATSONX_URL.replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  const stopForwardingAbort = forwardAbort(options?.signal, controller);

  try {
    const response = await fetch(
      `${baseUrl}/ml/v1/text/chat?version=${apiVersion}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
        redirect: "error",
      },
    );

    if (!response.ok) {
      if (response.status === 401 && cachedIamToken?.accessToken === accessToken) {
        cachedIamToken = undefined;
      }
      return { ok: false, reason: "http_error" };
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return { ok: false, reason: "http_error" };
    }

    const parsed = WatsonxChatResponseSchema.safeParse(json);
    if (!parsed.success) {
      return { ok: false, reason: "http_error" };
    }

    const text = parsed.data.choices[0].message.content;
    return { ok: true, text, modelId: WATSONX_MODEL_ID, apiVersion };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, reason: "timeout" };
    }
    return { ok: false, reason: "network_error" };
  } finally {
    clearTimeout(timer);
    stopForwardingAbort();
  }
}
