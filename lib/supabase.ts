import { createBrowserClient, createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { requirePublicEnv, requireServerEnv } from "@/lib/env";
import type { Database, Json } from "@/supabase/database.types";

type CookieEntry = {
  name: string;
  value: string;
};

type CookieWrite = {
  name: string;
  value: string;
  options: {
    path?: string;
    domain?: string;
    expires?: Date;
    maxAge?: number;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: boolean | "lax" | "strict" | "none";
  };
};

export type FoundationDatabase = Database;
export type FoundationSupabaseClient = SupabaseClient<Database>;

let browserClient: FoundationSupabaseClient | null = null;
let serviceClient: FoundationSupabaseClient | null = null;

function parseCookieHeader(cookieHeader: string): CookieEntry[] {
  if (cookieHeader.trim().length === 0) {
    return [];
  }

  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const equalsIndex = part.indexOf("=");
      const rawName = equalsIndex >= 0 ? part.slice(0, equalsIndex) : part;
      const rawValue = equalsIndex >= 0 ? part.slice(equalsIndex + 1) : "";

      try {
        return {
          name: decodeURIComponent(rawName),
          value: decodeURIComponent(rawValue),
        };
      } catch {
        return {
          name: rawName,
          value: rawValue,
        };
      }
    });
}

function serializeBrowserCookie(write: CookieWrite): string {
  const segments = [
    `${encodeURIComponent(write.name)}=${encodeURIComponent(write.value)}`,
    `Path=${write.options.path ?? "/"}`,
  ];

  if (write.options.domain) {
    segments.push(`Domain=${write.options.domain}`);
  }

  if (typeof write.options.maxAge === "number") {
    segments.push(`Max-Age=${Math.trunc(write.options.maxAge)}`);
  }

  if (write.options.expires) {
    segments.push(`Expires=${write.options.expires.toUTCString()}`);
  }

  if (write.options.secure) {
    segments.push("Secure");
  }

  if (write.options.httpOnly) {
    segments.push("HttpOnly");
  }

  const sameSite = write.options.sameSite;
  if (sameSite === "lax" || sameSite === "strict" || sameSite === "none") {
    segments.push(`SameSite=${sameSite}`);
  } else if (sameSite === true) {
    segments.push("SameSite=Lax");
  }

  return segments.join("; ");
}

function createBrowserCookieMethods(): {
  getAll: () => CookieEntry[];
  setAll: (cookies: CookieWrite[], headers: Record<string, string>) => void;
} {
  if (typeof document === "undefined") {
    throw new Error("Browser Supabase client requires a browser environment.");
  }

  return {
    getAll: () =>
      document.cookie
        .split(";")
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .map((part) => {
          const equalsIndex = part.indexOf("=");
          const rawName = equalsIndex >= 0 ? part.slice(0, equalsIndex) : part;
          const rawValue = equalsIndex >= 0 ? part.slice(equalsIndex + 1) : "";

          return {
            name: decodeURIComponent(rawName),
            value: decodeURIComponent(rawValue),
          };
        }),
    setAll: (cookies) => {
      for (const cookie of cookies) {
        document.cookie = serializeBrowserCookie(cookie);
      }
    },
  };
}

function createRequestCookieMethods(request: Request): {
  getAll: () => CookieEntry[];
  setAll?: (cookies: CookieWrite[], headers: Record<string, string>) => void;
} {
  const cookieHeader = request.headers.get("cookie") ?? "";

  return {
    getAll: () => parseCookieHeader(cookieHeader),
    setAll: undefined,
  };
}

export function createSupabaseBrowserClient(): FoundationSupabaseClient {
  if (browserClient) {
    return browserClient;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) {
    throw new Error("Missing required public environment variable: NEXT_PUBLIC_SUPABASE_URL");
  }

  if (!anonKey) {
    throw new Error("Missing required public environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  browserClient = createBrowserClient<FoundationDatabase>(url, anonKey, {
    cookies: createBrowserCookieMethods(),
  });

  return browserClient;
}

export function createSupabaseServerClient(request: Request): FoundationSupabaseClient {
  const url = requirePublicEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = requirePublicEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  return createServerClient<FoundationDatabase>(url, anonKey, {
    cookies: createRequestCookieMethods(request),
  });
}

export function createSupabaseServiceRoleClient(): FoundationSupabaseClient {
  if (serviceClient) {
    return serviceClient;
  }

  const url = requirePublicEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireServerEnv("SUPABASE_SERVICE_ROLE_KEY");

  serviceClient = createClient<FoundationDatabase>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  return serviceClient;
}

export function resetSupabaseClientsForTests(): void {
  browserClient = null;
  serviceClient = null;
}

export type { CookieEntry, CookieWrite, Json };
