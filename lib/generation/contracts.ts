import type {
  ApiErrorEnvelope,
  GenerateRequest,
  GenerateResponse,
  StoreRequest,
  StoreResponse,
} from "@/lib/types";
import {
  apiErrorEnvelopeSchema,
  generateRequestSchema,
  generateResponseSchema,
  storeRequestSchema,
  storeResponseSchema,
} from "@/lib/schemas";

export type { ApiErrorEnvelope, GenerateRequest, GenerateResponse, StoreRequest, StoreResponse };

export function createGenerateRequest(input: GenerateRequest): GenerateRequest {
  return generateRequestSchema.parse(input);
}

export function createGenerateResponse(input: GenerateResponse): GenerateResponse {
  return generateResponseSchema.parse(input);
}

export function createStoreRequest(input: StoreRequest): StoreRequest {
  return storeRequestSchema.parse(input);
}

export function createStoreResponse(input: StoreResponse): StoreResponse {
  return storeResponseSchema.parse(input);
}

export function createApiErrorEnvelope(input: ApiErrorEnvelope): ApiErrorEnvelope {
  return apiErrorEnvelopeSchema.parse(input);
}
