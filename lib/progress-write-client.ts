import type { ProgressWriteRequest } from "@/lib/types";

export function buildProgressWriteRequestBody(
  input: ProgressWriteRequest,
): ProgressWriteRequest {
  return {
    ...input,
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
}
