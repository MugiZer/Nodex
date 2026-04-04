import type { ZodType } from "zod";

import { ApiError } from "@/lib/errors";

type ParseSchemaOrThrowInput<T> = {
  schema: ZodType<T>;
  value: unknown;
  errorCode: string;
  message: string;
  status?: number;
  schemaName: string;
  phase: string;
  details?: Record<string, unknown>;
};

export function parseSchemaOrThrow<T>({
  schema,
  value,
  errorCode,
  message,
  status = 500,
  schemaName,
  phase,
  details,
}: ParseSchemaOrThrowInput<T>): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw new ApiError(errorCode, message, status, {
    schema: schemaName,
    phase,
    validation_errors: parsed.error.issues,
    ...details,
  });
}
