import { ApiError } from "@/lib/errors";
import {
  createSupabaseServerClient,
  type FoundationSupabaseClient,
} from "@/lib/supabase";

export type AuthDependencies = {
  createServerClient?: (request: Request) => FoundationSupabaseClient;
  resolveAuthenticatedUserId?: (request: Request) => Promise<string>;
};

export async function resolveAuthenticatedUserId(
  request: Request,
  dependencies: AuthDependencies = {},
): Promise<string> {
  if (dependencies.resolveAuthenticatedUserId) {
    return dependencies.resolveAuthenticatedUserId(request);
  }

  const client = dependencies.createServerClient?.(request) ?? createSupabaseServerClient(request);
  const { data, error } = await client.auth.getUser();

  if (error) {
    throw new ApiError(
      "UNAUTHENTICATED",
      "Unable to verify the current Supabase session.",
      401,
      { cause: error.message },
    );
  }

  if (!data.user) {
    throw new ApiError(
      "UNAUTHENTICATED",
      "A valid Supabase learner session is required.",
      401,
    );
  }

  return data.user.id;
}
