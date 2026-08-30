import "server-only";

import type { ZodType } from "zod";

const MAX_JSON_BYTES = 24_000;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export async function parseJsonBody<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new ApiError(
      415,
      "unsupported_media_type",
      "Counterstep accepts application/json requests only.",
    );
  }
  const contentLength = Number.parseInt(
    request.headers.get("content-length") || "0",
    10,
  );
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BYTES) {
    throw new ApiError(413, "request_too_large", "Request body is too large.");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) {
    throw new ApiError(413, "request_too_large", "Request body is too large.");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json", "Request body is not valid JSON.");
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(
      400,
      "invalid_request",
      "Request does not match the strict Counterstep contract.",
    );
  }
  return parsed.data;
}

export function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return jsonResponse(
      { error: { code: error.code, message: error.message } },
      error.status,
    );
  }
  if (error instanceof Error) {
    const known = new Map<string, [number, string]>([
      ["Demo not found.", [404, "demo_not_found"]],
      ["Run not found.", [404, "run_not_found"]],
      ["Source receipt digest does not match the demo.", [409, "receipt_mismatch"]],
    ]).get(error.message);
    if (known) {
      return jsonResponse(
        { error: { code: known[1], message: error.message } },
        known[0],
      );
    }
  }
  return jsonResponse(
    {
      error: {
        code: "internal_error",
        message: "Counterstep could not complete the request.",
      },
    },
    500,
  );
}
