"use client";

import { useEffect } from "react";

import {
  buildStoreRouteRequest,
} from "@/lib/server/generation/stage-inputs";
import { storeRouteRequestSchema } from "@/lib/server/generation/contracts";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import {
  CALCULUS_FOUNDATIONS_SMOKE_BUNDLE,
  type SmokeArtifactBundle,
} from "./dev-smoke-fixture";

type SmokeResponse<TData> = {
  ok: boolean;
  stage: string;
  data: TData;
  error: { code: string; message: string } | null;
  warnings: Array<{ code: string }>;
};

type SmokeHelper = {
  runFullSmoke: () => Promise<{ graph_id: string }>;
  runRetrievalSmoke: (graphId: string) => Promise<{ status: number; body: unknown }>;
  runAuthenticatedReadbackSmoke: (graphId: string) => Promise<{ status: number; body: unknown }>;
  buildArtifactBundle: () => Promise<SmokeArtifactBundle>;
  storeArtifactBundle: (bundle: SmokeArtifactBundle) => Promise<{ graph_id: string }>;
  cacheArtifactBundle: () => Promise<SmokeArtifactBundle>;
  getCachedArtifactBundle: () => SmokeArtifactBundle | undefined;
  storeCachedArtifactBundle: () => Promise<{ graph_id: string }>;
};

declare global {
  interface Window {
    __foundationSmoke?: SmokeHelper;
    __foundationSmokeBundle?: SmokeArtifactBundle;
  }
}

async function readResponseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text);
  }
}

async function postJson<TData>(
  path: string,
  body: Record<string, unknown>,
): Promise<SmokeResponse<TData>> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(body),
  });

  const json = await readResponseJson<SmokeResponse<TData>>(response);
  if (!response.ok || !json.ok) {
    throw new Error(
      `${path} failed with status ${response.status}: ${JSON.stringify(json.error)}`,
    );
  }

  return json;
}

async function ensureAnonymousSession(): Promise<void> {
  const client = createSupabaseBrowserClient();
  const { data } = await client.auth.getSession();
  if (data.session) {
    return;
  }

  const { error } = await client.auth.signInAnonymously();
  if (error) {
    throw new Error(`Failed to initialize anonymous smoke session: ${error.message}`);
  }
}

function parseMaybeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function buildArtifactBundle(): Promise<SmokeArtifactBundle> {
  const bundle = CALCULUS_FOUNDATIONS_SMOKE_BUNDLE;
  window.__foundationSmokeBundle = bundle;
  return bundle;
}

async function storeArtifactBundle(bundle: SmokeArtifactBundle): Promise<{ graph_id: string }> {
  const storeRequest = buildStoreRouteRequest({
    graph: bundle.graph,
    graphDraft: bundle.graphDraft,
    lessonArtifacts: bundle.lessonArtifacts,
    diagnosticArtifacts: bundle.diagnosticArtifacts,
    visualArtifacts: bundle.visualArtifacts,
  });
  storeRouteRequestSchema.parse(storeRequest);

  const store = await postJson<{
    graph_id: string;
    duplicate_of_graph_id?: string | null;
  }>("/api/generate/store", {
    ...storeRequest,
  });

  return { graph_id: store.data.graph_id };
}

export function DevSmokeBridge() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") {
      return;
    }

    const helper: SmokeHelper = {
      runFullSmoke: async () => {
        await ensureAnonymousSession();
        const bundle = await buildArtifactBundle();
        const store = await storeArtifactBundle(bundle);
        const readback = await fetch(`/api/graph/${store.graph_id}`, {
          credentials: "include",
        });

        if (!readback.ok) {
          throw new Error(
            `/api/graph/${store.graph_id} failed with status ${readback.status}`,
          );
        }

        return { graph_id: store.graph_id };
      },
      runRetrievalSmoke: async (graphId: string) => {
        await ensureAnonymousSession();

        const response = await fetch(`/api/graph/${graphId}`, {
          credentials: "include",
        });
        const text = await response.text();
        return {
          status: response.status,
          body: parseMaybeJson(text),
        };
      },
      runAuthenticatedReadbackSmoke: async (graphId: string) => {
        await ensureAnonymousSession();

        const response = await fetch(`/api/graph/${graphId}`, {
          credentials: "include",
        });
        const text = await response.text();
        return {
          status: response.status,
          body: parseMaybeJson(text),
        };
      },
      buildArtifactBundle,
      storeArtifactBundle,
      cacheArtifactBundle: buildArtifactBundle,
      getCachedArtifactBundle: () => window.__foundationSmokeBundle,
      storeCachedArtifactBundle: async () => {
        const bundle = window.__foundationSmokeBundle;
        if (!bundle) {
          throw new Error("No cached smoke bundle found. Run cacheArtifactBundle() first.");
        }

        return storeArtifactBundle(bundle);
      },
    };

    window.__foundationSmoke = helper;

    return () => {
      delete window.__foundationSmoke;
    };
  }, []);

  return null;
}
