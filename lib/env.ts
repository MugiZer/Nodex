export const REQUIRED_SERVER_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

export const REQUIRED_PUBLIC_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

type RequiredServerEnvKey = (typeof REQUIRED_SERVER_ENV_KEYS)[number];
type RequiredPublicEnvKey = (typeof REQUIRED_PUBLIC_ENV_KEYS)[number];
export type RequiredEnvKey = RequiredServerEnvKey | RequiredPublicEnvKey;

function getEnvValue(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getOptionalEnv(name: string): string | undefined {
  return getEnvValue(name);
}

export function requireServerEnv(name: RequiredServerEnvKey): string {
  const value = getEnvValue(name);
  if (!value) {
    throw new Error(`Missing required server environment variable: ${name}`);
  }

  return value;
}

export function requirePublicEnv(name: RequiredPublicEnvKey): string {
  const value = getEnvValue(name);
  if (!value) {
    throw new Error(`Missing required public environment variable: ${name}`);
  }

  return value;
}

export function getSupabaseUrl(): string {
  return requirePublicEnv("NEXT_PUBLIC_SUPABASE_URL");
}

export function requireEnvValue(name: RequiredEnvKey): string {
  return name.startsWith("NEXT_PUBLIC_")
    ? requirePublicEnv(name as RequiredPublicEnvKey)
    : requireServerEnv(name as RequiredServerEnvKey);
}

export function assertRequiredEnvKeys(
  routeName: string,
  keys: readonly RequiredEnvKey[],
): void {
  for (const key of keys) {
    if (!getEnvValue(key)) {
      throw new Error(`${routeName} is missing required environment variable ${key}`);
    }
  }
}
