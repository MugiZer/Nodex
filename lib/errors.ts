import { NextResponse } from "next/server";

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

  if (error instanceof Error) {
    return new ApiError("UNEXPECTED_INTERNAL_ERROR", error.message, 500);
  }

  return new ApiError("UNEXPECTED_INTERNAL_ERROR", "An unexpected error occurred.", 500);
}
