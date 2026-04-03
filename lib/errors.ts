import { NextResponse } from "next/server";

import type { StageError } from "@/lib/types";

export class ApiError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: unknown;

  public constructor(
    code: string,
    message: string,
    status = 400,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function isStageError(error: unknown): error is StageError {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as Partial<StageError>;
  return (
    typeof candidate.code === "string" &&
    typeof candidate.category === "string" &&
    typeof candidate.stage === "string" &&
    typeof candidate.message === "string" &&
    typeof candidate.retryable === "boolean"
  );
}

export function getStageErrorStatus(error: StageError): number {
  switch (error.category) {
    case "input_validation":
      return 400;
    case "dependency_missing":
      return 503;
    case "auth_failure":
      return 401;
    case "upstream_timeout":
      return 504;
    case "upstream_provider":
    case "parse_failure":
    case "contract_validation":
    case "artifact_consistency":
      return 502;
    case "deterministic_validation":
    case "id_remap_failure":
      return 422;
    case "fallback_activated":
      return 200;
    case "store_failure":
      return 503;
    case "persistence_unavailable":
      return 503;
    case "unexpected_internal":
    default:
      return 500;
  }
}

export function jsonError(error: ApiError): NextResponse {
  return NextResponse.json(
    {
      error: error.code,
      message: error.message,
      details: error.details ?? null,
    },
    { status: error.status },
  );
}

export function normalizeError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (isStageError(error)) {
    const details = {
      stage: error.stage,
      category: error.category,
      retryable: error.retryable,
      details: error.details ?? null,
    };

    return new ApiError(error.code, error.message, getStageErrorStatus(error), details);
  }

  if (error instanceof Error) {
    return new ApiError("UNEXPECTED_INTERNAL_ERROR", error.message, 500);
  }

  return new ApiError("UNEXPECTED_INTERNAL_ERROR", "An unexpected error occurred.", 500);
}
