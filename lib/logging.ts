import crypto from "node:crypto";

import { ApiError } from "@/lib/errors";

export type RequestLogContext = {
  requestId: string;
  route: string;
  startedAtMs: number;
};

export function createRequestLogContext(route: string, requestId?: string): RequestLogContext {
  return {
    requestId: requestId ?? crypto.randomUUID(),
    route,
    startedAtMs: Date.now(),
  };
}

export function hashPrompt(prompt: string): string {
  return crypto.createHash("sha256").update(prompt).digest("hex").slice(0, 12);
}

export function logInfo(
  context: RequestLogContext,
  stage: string,
  event: "start" | "success" | "retry",
  message: string,
  data?: Record<string, unknown>,
): void {
  console.log(
    JSON.stringify({
      level: "info",
      route: context.route,
      request_id: context.requestId,
      stage,
      event,
      duration_ms: Date.now() - context.startedAtMs,
      message,
      ...data,
    }),
  );
}

export function logWarn(
  context: RequestLogContext,
  stage: string,
  event: "start" | "success" | "retry",
  message: string,
  data?: Record<string, unknown>,
): void {
  console.log(
    JSON.stringify({
      level: "warn",
      route: context.route,
      request_id: context.requestId,
      stage,
      event,
      duration_ms: Date.now() - context.startedAtMs,
      message,
      ...data,
    }),
  );
}

export function logError(
  context: RequestLogContext,
  stage: string,
  message: string,
  error: unknown,
  data?: Record<string, unknown>,
): void {
  const payload = createErrorLogPayload(error);

  console.error(
    JSON.stringify({
      level: "error",
      route: context.route,
      request_id: context.requestId,
      stage,
      event: "error",
      duration_ms: Date.now() - context.startedAtMs,
      message,
      ...payload,
      ...data,
    }),
  );
}

function createErrorLogPayload(error: unknown): Record<string, unknown> {
  if (error instanceof ApiError) {
    return {
      error_name: error.name,
      error_message: error.message,
      error_details: error.details ?? null,
    };
  }

  if (error instanceof Error) {
    return { error_name: error.name, error_message: error.message };
  }

  if (error && typeof error === "object") {
    const candidate = error as { code?: unknown; message?: unknown; details?: unknown };
    if (typeof candidate.message === "string") {
      return {
        error_name: typeof candidate.code === "string" ? candidate.code : "StructuredError",
        error_message: candidate.message,
        error_details: candidate.details ?? error,
      };
    }

    return {
      error_name: "NonErrorThrow",
      error_message: "A non-Error value was thrown.",
      error_details: error,
    };
  }

  return { error_value: String(error) };
}
