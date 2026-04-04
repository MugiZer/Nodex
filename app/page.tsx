"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { getPendingDiagnosticKey, type StoredPendingDiagnostic } from "@/lib/diagnostic-session";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import type { GenerateResponse } from "@/lib/types";

const LOADING_MESSAGES = [
  "Analyzing your learning goal...",
  "Mapping the knowledge space...",
  "Designing your learning path...",
  "Preparing your first lesson...",
];

const DEFAULT_ERROR_MESSAGE = "Something went wrong. Try again with a different topic.";
const EMPTY_PROMPT_MESSAGE = "Enter a topic to get started.";

export default function Home() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [loadingMessageVisible, setLoadingMessageVisible] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const shakeTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const client = createSupabaseBrowserClient();

    void (async () => {
      const { data } = await client.auth.getSession();

      if (!data.session) {
        const { error: signInError } = await client.auth.signInAnonymously();
        if (signInError) {
          setError("We could not start your session. Refresh and try again.");
        }
      }
    })();
  }, []);

  useEffect(() => {
    if (!loading) {
      return undefined;
    }

    setLoadingMessageIndex(0);
    setLoadingMessageVisible(true);

    let fadeTimer: number | null = null;
    let swapTimer: number | null = null;
    let active = true;

    const scheduleNextSwap = (): void => {
      swapTimer = window.setTimeout(() => {
        if (!active) {
          return;
        }

        setLoadingMessageVisible(false);

        fadeTimer = window.setTimeout(() => {
          if (!active) {
            return;
          }

          setLoadingMessageIndex((current) => (current + 1) % LOADING_MESSAGES.length);
          setLoadingMessageVisible(true);
          scheduleNextSwap();
        }, 300);
      }, 2700);
    };

    scheduleNextSwap();

    return () => {
      active = false;
      if (fadeTimer !== null) {
        window.clearTimeout(fadeTimer);
      }
      if (swapTimer !== null) {
        window.clearTimeout(swapTimer);
      }
    };
  }, [loading]);

  useEffect(() => {
    return () => {
      if (shakeTimeoutRef.current !== null) {
        window.clearTimeout(shakeTimeoutRef.current);
      }
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt.length === 0) {
      setValidationMessage(EMPTY_PROMPT_MESSAGE);
      setError(null);
      setShake(true);
      if (shakeTimeoutRef.current !== null) {
        window.clearTimeout(shakeTimeoutRef.current);
      }
      shakeTimeoutRef.current = window.setTimeout(() => {
        setShake(false);
      }, 400);
      return;
    }

    setLoading(true);
    setError(null);
    setValidationMessage(null);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ prompt: trimmedPrompt }),
      });

      const body = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        const message =
          body && typeof body === "object" && typeof (body as { message?: unknown }).message === "string"
            ? (body as { message: string }).message
            : DEFAULT_ERROR_MESSAGE;
        throw new Error(message);
      }

      const result = body as GenerateResponse;
      if (!result?.request_id || typeof result.request_id !== "string") {
        throw new Error(DEFAULT_ERROR_MESSAGE);
      }

      if (result.graph_id && result.status === "ready" && result.diagnostic === null) {
        router.push(`/graph/${result.graph_id}`);
        return;
      }

      if (result.diagnostic) {
        const stored: StoredPendingDiagnostic = {
          requestId: result.request_id,
          topic: result.topic,
          diagnostic: result.diagnostic,
        };
        window.sessionStorage.setItem(
          getPendingDiagnosticKey(result.request_id),
          JSON.stringify(stored),
        );

        if (result.graph_id && result.status === "ready") {
          router.push(`/diagnostic/${result.request_id}?graph_id=${result.graph_id}`);
          return;
        }

        router.push(`/diagnostic/${result.request_id}`);
        return;
      }

      if (result.status === "generating") {
        router.push(`/diagnostic/${result.request_id}`);
        return;
      }

      if (result.graph_id) {
        router.push(`/graph/${result.graph_id}`);
        return;
      }

      throw new Error(DEFAULT_ERROR_MESSAGE);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : DEFAULT_ERROR_MESSAGE);
      setLoading(false);
    }
  }

  const loadingMessage = LOADING_MESSAGES[loadingMessageIndex] ?? LOADING_MESSAGES[0];

  return (
    <main
      className="relative isolate flex min-h-screen items-center justify-center overflow-hidden px-5 py-14 text-slate-900 sm:px-6 sm:py-16"
      style={{
        background:
          "radial-gradient(circle at 14% 18%, rgba(96,165,250,0.14) 0%, rgba(96,165,250,0) 24%), radial-gradient(circle at 82% 16%, rgba(148,163,184,0.12) 0%, rgba(148,163,184,0) 23%), radial-gradient(circle at 50% 112%, rgba(186,230,253,0.14) 0%, rgba(186,230,253,0) 36%), linear-gradient(180deg, rgba(251,252,254,1) 0%, rgba(241,245,249,1) 54%, rgba(236,242,247,1) 100%)",
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute left-[-8rem] top-8 h-[30rem] w-[30rem] rounded-full bg-sky-300/12 blur-3xl" />
        <div className="absolute right-[-9rem] top-24 h-[34rem] w-[34rem] rounded-full bg-slate-400/10 blur-3xl" />
        <div className="absolute left-1/2 top-[-10rem] h-[22rem] w-[42rem] -translate-x-1/2 rounded-full bg-white/55 blur-3xl" />
        <div className="absolute bottom-[-12rem] left-1/2 h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-cyan-200/12 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.45)_0%,rgba(255,255,255,0.08)_42%,rgba(255,255,255,0)_70%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.15)_0%,rgba(255,255,255,0)_22%,rgba(255,255,255,0.12)_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_36%,rgba(15,23,42,0.03)_100%)]" />
      </div>

      <div className="relative z-10 w-full max-w-6xl">
        <div className="mx-auto max-w-[960px] rounded-[44px] border border-white/70 bg-white/56 px-5 py-9 shadow-[0_40px_120px_rgba(15,23,42,0.1)] backdrop-blur-2xl sm:px-8 sm:py-12 lg:px-12 lg:py-14">
          <div className="mx-auto max-w-[700px] text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/72 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-500 shadow-[0_1px_0_rgba(255,255,255,0.8)] backdrop-blur-md">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-400 shadow-[0_0_0_4px_rgba(56,189,248,0.12)]" />
              Foundation
            </div>

            <div className="mt-5 space-y-4 sm:mt-6 sm:space-y-[1.125rem]">
              <h1 className="text-balance text-[3.2rem] font-semibold leading-[0.92] tracking-[-0.07em] text-slate-950 sm:text-[4.6rem] lg:text-[4.9rem]">
                What do you want to learn?
              </h1>
              <p className="mx-auto max-w-[38rem] text-pretty text-[1rem] leading-7 text-slate-600 sm:text-[1.06rem] sm:leading-8">
                A calm, adaptive path that turns a single prompt into the next best
                lesson, diagnostics, and unlocks.
              </p>
            </div>

          </div>

          <div className="mx-auto mt-12 w-full max-w-[700px] sm:mt-14">
            {loading ? (
              <div className="relative flex min-h-[280px] flex-col items-center justify-center overflow-hidden rounded-[38px] border border-white/78 bg-[rgba(255,255,255,0.76)] px-6 py-11 text-center shadow-[0_30px_90px_rgba(15,23,42,0.12)] backdrop-blur-2xl sm:px-8">
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.55)_0%,rgba(255,255,255,0.1)_100%)]" />
                <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-sky-200/80 to-transparent" />
                <div className="absolute inset-x-6 top-4 h-16 rounded-[28px] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.8),transparent_75%)] opacity-70" />
                <div className="flex h-10 items-center rounded-full border border-slate-200/80 bg-slate-50/85 px-4 text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500 shadow-[0_1px_0_rgba(255,255,255,0.8)]">
                  Thinking
                </div>

                <div
                  className="relative mt-6 text-[1.1rem] font-medium tracking-[-0.03em] text-slate-700 transition-opacity duration-300 sm:text-[1.35rem]"
                  style={{
                    opacity: loadingMessageVisible ? 1 : 0,
                  }}
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {loadingMessage}
                </div>

                <div className="relative mt-3 max-w-[24rem] text-sm leading-6 text-slate-500">
                  Building the graph, diagnostics, and first path through the material.
                </div>

                <div className="relative mt-8 flex items-center gap-2" aria-hidden="true">
                  {[0, 1, 2].map((index) => (
                    <span
                      key={index}
                      className="h-2.5 w-2.5 rounded-full bg-slate-300 shadow-sm"
                      style={{
                        animation: "pulse 1.4s ease-in-out infinite",
                        animationDelay: `${index * 180}ms`,
                      }}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <form
                onSubmit={handleSubmit}
                className="relative overflow-hidden rounded-[38px] border border-white/78 bg-[rgba(255,255,255,0.78)] p-4 shadow-[0_30px_90px_rgba(15,23,42,0.12)] backdrop-blur-2xl sm:p-6 lg:p-7"
              >
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.58)_0%,rgba(255,255,255,0.08)_100%)]" />
                <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-sky-200/80 to-transparent" />
                <div className="absolute inset-x-6 top-5 h-16 rounded-[28px] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.82),transparent_72%)] opacity-70" />
                <div className="relative space-y-[1.125rem] sm:space-y-5">
                  <div className="text-left">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-slate-500">
                      Describe the concept, skill, or topic
                    </p>
                  </div>

                  <div className="relative">
                    <input
                      type="text"
                      value={prompt}
                      onChange={(event) => {
                        setPrompt(event.target.value);
                        setValidationMessage(null);
                        setError(null);
                      }}
                      placeholder="e.g. I want to learn how neural networks work"
                      aria-label="What do you want to learn?"
                      className={[
                        "h-16 w-full rounded-[22px] border border-slate-200/85 bg-[linear-gradient(180deg,rgba(255,255,255,0.92)_0%,rgba(248,250,252,0.96)_100%)] px-5 text-[1.02rem] text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_1px_0_rgba(255,255,255,0.55)] outline-none transition-all duration-200 placeholder:text-slate-400/85 placeholder:tracking-[-0.01em]",
                        "hover:border-slate-300 hover:bg-[linear-gradient(180deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,1)_100%)]",
                        "focus:border-sky-400 focus:bg-white focus:shadow-[0_0_0_4px_rgba(56,189,248,0.12),inset_0_1px_0_rgba(255,255,255,0.95)]",
                        shake ? "shake-input" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className={[
                      "inline-flex h-12 w-full items-center justify-center rounded-full bg-[linear-gradient(180deg,#0f172a_0%,#111827_100%)] px-8 text-[0.95rem] font-semibold tracking-[0.01em] text-white shadow-[0_14px_30px_rgba(15,23,42,0.16)] transition-all duration-200",
                      "hover:-translate-y-0.5 hover:shadow-[0_20px_40px_rgba(15,23,42,0.22)] hover:brightness-[1.02]",
                      "active:translate-y-0 active:shadow-[0_12px_24px_rgba(15,23,42,0.14)]",
                      "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-500/20 focus-visible:ring-offset-2 focus-visible:ring-offset-white/60",
                      "disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0 disabled:hover:shadow-[0_14px_30px_rgba(15,23,42,0.16)] disabled:hover:brightness-100",
                    ].join(" ")}
                  >
                    {"Build my learning path \u2192"}
                  </button>

                  <div className="flex items-center justify-center pt-1">
                    <div className="inline-flex items-center gap-2 rounded-full border border-slate-200/75 bg-white/68 px-4 py-1.5 text-[10px] font-medium uppercase tracking-[0.24em] text-slate-500 shadow-[0_1px_0_rgba(255,255,255,0.75)] backdrop-blur-md">
                      <span className="h-1.5 w-1.5 rounded-full bg-sky-400/80" />
                      <span>Adaptive path</span>
                      <span aria-hidden="true" className="text-slate-300">
                        &middot;
                      </span>
                      <span>Diagnostics first</span>
                      <span aria-hidden="true" className="text-slate-300">
                        &middot;
                      </span>
                      <span>Progressive unlocks</span>
                    </div>
                  </div>

                  <div aria-live="polite" aria-atomic="true" className="min-h-[1.5rem]">
                    {validationMessage ? (
                      <p className="mt-1 text-sm text-amber-600">{validationMessage}</p>
                    ) : null}
                    {error ? <p className="mt-1 text-sm text-rose-600">{error}</p> : null}
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>

      <style jsx global>{`
        @keyframes prompt-shake {
          0%,
          100% {
            transform: translateX(0);
          }
          20% {
            transform: translateX(-6px);
          }
          40% {
            transform: translateX(6px);
          }
          60% {
            transform: translateX(-4px);
          }
          80% {
            transform: translateX(4px);
          }
        }

        .shake-input {
          animation: prompt-shake 0.4s ease-in-out;
        }
      `}</style>
    </main>
  );
}
