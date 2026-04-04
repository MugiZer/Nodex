"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { DiagnosticFlow } from "@/components/DiagnosticFlow";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import type { GraphPayload } from "@/lib/types";

type DiagnosticExperienceProps = {
  graphId: string;
};

function parseResponseError(body: unknown): string {
  if (!body || typeof body !== "object") {
    return "Unable to load diagnostic data.";
  }

  const candidate = body as { message?: unknown; error?: unknown };
  if (typeof candidate.message === "string") {
    return candidate.message;
  }

  if (typeof candidate.error === "string") {
    return candidate.error;
  }

  return "Unable to load diagnostic data.";
}

export function DiagnosticExperience({ graphId }: DiagnosticExperienceProps) {
  const router = useRouter();
  const [payload, setPayload] = useState<GraphPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session) {
          const { error: signInError } = await supabase.auth.signInAnonymously();
          if (signInError) {
            throw new Error(signInError.message);
          }
        }

        const response = await fetch(`/api/graph/${graphId}`, {
          credentials: "include",
        });
        const body = (await response.json().catch(() => null)) as unknown;

        if (!response.ok) {
          throw new Error(parseResponseError(body));
        }

        if (!body || typeof body !== "object") {
          throw new Error("The diagnostic payload was malformed.");
        }

        const nextPayload = body as GraphPayload;
        if (cancelled) {
          return;
        }

        setPayload(nextPayload);
        setLoading(false);

        if (nextPayload.progress.length > 0) {
          router.replace(`/graph/${graphId}`);
        }
      } catch (fetchError) {
        if (cancelled) {
          return;
        }

        setError(fetchError instanceof Error ? fetchError.message : "Unable to load diagnostic data.");
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [graphId, router]);

  if (loading) {
    return <div className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">Loading diagnostic...</div>;
  }

  if (error || !payload) {
    return (
      <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-800 shadow-sm">
        <p className="font-semibold">Unable to load diagnostic</p>
        <p className="mt-2 text-sm">{error ?? "Unknown error"}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
          Diagnostic placement
        </p>
        <h1 className="mt-3 text-3xl font-semibold text-zinc-950">
          Find the learner&apos;s entry point
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600">
          This diagnostic selects the first usable node in the graph, then walks up or down
          using the generated placement questions.
        </p>
        <div className="mt-6 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
          <p className="font-medium text-zinc-950">{payload.graph.title}</p>
          <p className="mt-2">{payload.graph.description}</p>
        </div>
      </section>

      <DiagnosticFlow
        payload={payload}
        onComplete={(recommendedNodeId) => {
          if (recommendedNodeId) {
            window.sessionStorage.setItem(
              `foundation:diagnostic:${graphId}`,
              JSON.stringify({ recommendedNodeId }),
            );
          } else {
            window.sessionStorage.removeItem(`foundation:diagnostic:${graphId}`);
          }
          router.push(`/graph/${graphId}`);
        }}
      />
    </div>
  );
}
