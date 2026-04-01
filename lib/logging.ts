import crypto from "node:crypto";

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

export function logError(
  context: RequestLogContext,
  stage: string,
  message: string,
  error: unknown,
  data?: Record<string, unknown>,
): void {
  const payload =
    error instanceof Error
      ? { error_name: error.name, error_message: error.message }
      : { error_value: String(error) };

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
