"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  getGraphDiagnosticResultKey,
  getPendingDiagnosticKey,
  type StoredGraphDiagnosticResult,
  type StoredPrerequisiteLesson,
  type StoredPendingDiagnostic,
} from "@/lib/diagnostic-session";
import { renderLessonText } from "@/lib/lesson-text-parser";
import type { PrerequisiteDiagnostic } from "@/lib/types";

type GraphStatusResponse = {
  status: "generating" | "ready" | "failed";
  graph_id: string | null;
  prerequisite_lessons_status: "pending" | "ready" | "failed";
  prerequisite_lessons: StoredPrerequisiteLesson[] | null;
};

type GraphReadinessResponse = {
  nodes: Array<{
    lesson_status: "pending" | "ready" | "failed";
  }>;
};

type ResultState = {
  gapNames: string[];
  solidNames: string[];
};

type PrerequisiteDiagnosticExperienceProps = {
  requestId: string;
};

type Answers = Record<string, number>;

const POLL_INTERVAL_MS = 2500;
const DIAGNOSTIC_SHELL_CLASS =
  "relative z-10 mx-auto w-full max-w-6xl rounded-[44px] border border-white/70 bg-white/56 px-5 py-9 shadow-[0_40px_120px_rgba(15,23,42,0.1)] backdrop-blur-2xl sm:px-8 sm:py-12 lg:px-12 lg:py-14";
const DIAGNOSTIC_CONTENT_CLASS = "mx-auto w-full max-w-[700px]";
const DIAGNOSTIC_TITLE_CLASS =
  "text-[2.75rem] font-semibold leading-[0.94] tracking-[-0.07em] text-slate-950 sm:text-[3rem]";
const DIAGNOSTIC_SUBTITLE_CLASS = "text-[1rem] leading-7 text-slate-600 sm:text-[1.06rem] sm:leading-8";
const DIAGNOSTIC_SUBTLE_LABEL_CLASS = "text-[10px] font-semibold uppercase tracking-[0.34em] text-slate-500";
const DIAGNOSTIC_SECONDARY_BUTTON_CLASS =
  "rounded-full border border-slate-200/80 bg-white/72 px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-[0_1px_0_rgba(255,255,255,0.8)] transition-all duration-200 hover:border-slate-300 hover:bg-white hover:shadow-[0_8px_20px_rgba(15,23,42,0.08)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-500/15";
const DIAGNOSTIC_PRIMARY_BUTTON_CLASS =
  "rounded-full bg-[linear-gradient(180deg,#0f172a_0%,#111827_100%)] px-6 py-2.5 font-semibold text-white shadow-[0_14px_30px_rgba(15,23,42,0.16)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_20px_40px_rgba(15,23,42,0.22)] hover:brightness-[1.02] active:translate-y-0 active:shadow-[0_12px_24px_rgba(15,23,42,0.14)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky-500/20 focus-visible:ring-offset-2 focus-visible:ring-offset-white/60 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0 disabled:hover:shadow-[0_14px_30px_rgba(15,23,42,0.16)] disabled:hover:brightness-100";
const DIAGNOSTIC_OPTION_CLASS =
  "rounded-[18px] border border-slate-200/85 bg-white/85 px-4 py-3 text-left transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 hover:shadow-[0_8px_20px_rgba(15,23,42,0.06)]";
const DIAGNOSTIC_OPTION_SELECTED_CLASS =
  "border-sky-400 bg-sky-50 text-sky-950 shadow-[0_0_0_4px_rgba(56,189,248,0.08)]";
const GRAPH_READY_POLL_INTERVAL_MS = 2500;
const GRAPH_READY_MAX_ATTEMPTS = 48;

function DiagnosticChrome({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className={DIAGNOSTIC_SHELL_CLASS}>
      <div className={DIAGNOSTIC_CONTENT_CLASS}>{children}</div>
    </div>
  );
}

function getQuestionKey(prerequisiteName: string, questionIndex: number): string {
  return `${prerequisiteName}::${questionIndex}`;
}

function scoreDiagnostic(
  diagnostic: PrerequisiteDiagnostic,
  answers: Answers,
): ResultState {
  const gapNames: string[] = [];
  const solidNames: string[] = [];

  for (const prerequisite of diagnostic.prerequisites) {
    let correctCount = 0;

    prerequisite.questions.forEach((question, index) => {
      const answer = answers[getQuestionKey(prerequisite.name, index)];
      if (answer === question.correctIndex) {
        correctCount += 1;
      }
    });

    if (correctCount === 2) {
      solidNames.push(prerequisite.name);
    } else {
      gapNames.push(prerequisite.name);
    }
  }

  return { gapNames, solidNames };
}

function buildStoredResult(input: {
  requestId: string;
  diagnostic: PrerequisiteDiagnostic | null;
  graphId: string;
  topic: string;
  gapNames: string[];
  gapPrerequisiteLessons: StoredPrerequisiteLesson[];
}): StoredGraphDiagnosticResult {
  return {
    requestId: input.requestId,
    graphId: input.graphId,
    topic: input.topic,
    gapNames: input.gapNames,
    gapPrerequisites:
      input.diagnostic?.prerequisites.filter((prerequisite) =>
        input.gapNames.includes(prerequisite.name),
      ) ?? [],
    gapPrerequisiteLessons: input.gapPrerequisiteLessons,
    completedGapNodeIds: [],
  };
}

async function persistGraphDiagnosticResult(
  requestId: string,
  storedResult: StoredGraphDiagnosticResult,
): Promise<void> {
  const response = await fetch(`/api/graph/status/${requestId}/diagnostic`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify(storedResult),
  });

  if (!response.ok) {
    throw new Error("We couldn't persist your prerequisite path.");
  }
}

async function confirmGraphHasReadyLesson(graphId: string): Promise<boolean> {
  const response = await fetch(`/api/graph/${graphId}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    return false;
  }

  const body = (await response.json().catch(() => null)) as GraphReadinessResponse | null;
  return Boolean(body?.nodes.some((node) => node.lesson_status === "ready"));
}

export function PrerequisiteDiagnosticExperience({
  requestId,
}: PrerequisiteDiagnosticExperienceProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [stored, setStored] = useState<StoredPendingDiagnostic | null>(null);
  const [hasHydratedStored, setHasHydratedStored] = useState(false);
  const [answers, setAnswers] = useState<Answers>({});
  const [graphStatus, setGraphStatus] = useState<GraphStatusResponse>({
    status: searchParams.get("graph_id") ? "ready" : "generating",
    graph_id: searchParams.get("graph_id"),
    prerequisite_lessons_status: "pending",
    prerequisite_lessons: null,
  });
  const [view, setView] = useState<"questions" | "results" | "finalizing">("questions");
  const [result, setResult] = useState<ResultState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHasHydratedStored(false);

    const raw = window.sessionStorage.getItem(getPendingDiagnosticKey(requestId));
    if (!raw) {
      setStored(null);
      setHasHydratedStored(true);
      return;
    }

    try {
      setStored(JSON.parse(raw) as StoredPendingDiagnostic);
    } catch {
      setStored(null);
      setError("Diagnostic data was malformed.");
    } finally {
      setHasHydratedStored(true);
    }
  }, [requestId]);

  useEffect(() => {
    if (graphStatus.status === "ready" && graphStatus.graph_id) {
      return undefined;
    }

    if (graphStatus.status === "failed") {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      void (async () => {
        const response = await fetch(`/api/graph/status/${requestId}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          return;
        }

        const body = (await response.json().catch(() => null)) as GraphStatusResponse | null;
        if (!body) {
          return;
        }

        setGraphStatus(body);
      })();
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [graphStatus.graph_id, graphStatus.status, requestId]);

  useEffect(() => {
    if (
      !stored?.diagnostic ||
      graphStatus.prerequisite_lessons_status !== "ready" ||
      !graphStatus.prerequisite_lessons
    ) {
      return;
    }

    const storedGraphId = graphStatus.graph_id ?? searchParams.get("graph_id");
    if (!storedGraphId) {
      return;
    }

    const currentRaw = window.sessionStorage.getItem(getGraphDiagnosticResultKey(storedGraphId));
    const currentResult = currentRaw
      ? (JSON.parse(currentRaw) as StoredGraphDiagnosticResult)
      : null;
    const nextResult: StoredGraphDiagnosticResult = {
      requestId,
      graphId: storedGraphId,
      topic: stored?.topic ?? currentResult?.topic ?? "",
      gapNames: currentResult?.gapNames ?? result?.gapNames ?? [],
      gapPrerequisites: currentResult?.gapPrerequisites ?? stored?.diagnostic?.prerequisites ?? [],
      gapPrerequisiteLessons: graphStatus.prerequisite_lessons,
      completedGapNodeIds: currentResult?.completedGapNodeIds ?? [],
    };

    window.sessionStorage.setItem(
      getGraphDiagnosticResultKey(storedGraphId),
      JSON.stringify(nextResult),
    );

    void persistGraphDiagnosticResult(requestId, nextResult).catch(() => undefined);
  }, [
    graphStatus.graph_id,
    graphStatus.prerequisite_lessons,
    graphStatus.prerequisite_lessons_status,
    requestId,
    result?.gapNames,
    searchParams,
    stored?.diagnostic,
    stored?.diagnostic?.prerequisites,
    stored?.topic,
  ]);

  useEffect(() => {
    if (view !== "results" || !result) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setView("finalizing");
    }, 2000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    graphStatus.graph_id,
    requestId,
    result,
    view,
  ]);

  useEffect(() => {
    if (view !== "finalizing") {
      return undefined;
    }

    let cancelled = false;
    let attemptCount = 0;
    let timerId: number | null = null;

    const routeWhenReady = async (): Promise<void> => {
      const graphId = graphStatus.graph_id ?? searchParams.get("graph_id");
      if (!graphId) {
        if (!cancelled) {
          timerId = window.setTimeout(() => {
            void routeWhenReady();
          }, GRAPH_READY_POLL_INTERVAL_MS);
        }
        return;
      }

      let isReady = false;
      try {
        isReady = await confirmGraphHasReadyLesson(graphId);
      } catch {
        isReady = false;
      }

      if (cancelled) {
        return;
      }

      if (isReady) {
        const storedResult = buildStoredResult({
          requestId,
          diagnostic: stored?.diagnostic ?? null,
          graphId,
          topic: stored?.topic ?? "",
          gapNames: result?.gapNames ?? [],
          gapPrerequisiteLessons: graphStatus.prerequisite_lessons ?? [],
        });
        window.sessionStorage.setItem(
          getGraphDiagnosticResultKey(graphId),
          JSON.stringify(storedResult),
        );
        await persistGraphDiagnosticResult(requestId, storedResult);
        window.sessionStorage.removeItem(getPendingDiagnosticKey(requestId));
        router.push(`/graph/${graphId}`);
        return;
      }

      attemptCount += 1;
      if (attemptCount >= GRAPH_READY_MAX_ATTEMPTS) {
        setError(
          "Your first lesson is still preparing. Please return to the prompt and try again in a moment.",
        );
        return;
      }

      timerId = window.setTimeout(() => {
        void routeWhenReady();
      }, GRAPH_READY_POLL_INTERVAL_MS);
    };

    void routeWhenReady();

    return () => {
      cancelled = true;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, [
    graphStatus.graph_id,
    graphStatus.prerequisite_lessons,
    requestId,
    result,
    router,
    searchParams,
    stored?.diagnostic,
    stored?.topic,
    view,
  ]);

  const diagnostic = stored?.diagnostic ?? null;
  const totalQuestions = useMemo(() => {
    if (!diagnostic) {
      return 0;
    }

    return diagnostic.prerequisites.reduce(
      (sum, prerequisite) => sum + prerequisite.questions.length,
      0,
    );
  }, [diagnostic]);

  const answeredCount = Object.keys(answers).length;

  function continueToGraph(): void {
    setView("finalizing");
  }

  if (error) {
    return (
      <DiagnosticChrome>
        <div className="py-8 text-center">
          <h1 className={DIAGNOSTIC_TITLE_CLASS}>Something went wrong.</h1>
          <p className={`${DIAGNOSTIC_SUBTITLE_CLASS} mx-auto mt-3 max-w-[28rem]`}>{error}</p>
        </div>
      </DiagnosticChrome>
    );
  }

  if (!hasHydratedStored) {
    return (
      <DiagnosticChrome>
        <div className="space-y-3 text-center">
          <h1 className={DIAGNOSTIC_TITLE_CLASS}>Resuming your diagnostic...</h1>
          <p className={DIAGNOSTIC_SUBTITLE_CLASS}>
            We&apos;re checking the saved prerequisite check before continuing.
          </p>
        </div>
      </DiagnosticChrome>
    );
  }

  if (graphStatus.status === "failed") {
    return (
      <DiagnosticChrome>
        <div className="space-y-4 text-center">
          <h1 className={DIAGNOSTIC_TITLE_CLASS}>
            Something went wrong. Try again with a different topic.
          </h1>
          <p className={`${DIAGNOSTIC_SUBTITLE_CLASS} mx-auto max-w-[28rem]`}>
            We couldn&apos;t finish preparing the diagnostic flow.
          </p>
          <button
            type="button"
            onClick={() => router.push("/")}
            className={DIAGNOSTIC_SECONDARY_BUTTON_CLASS}
          >
            Return to prompt
          </button>
        </div>
      </DiagnosticChrome>
    );
  }

  if (!diagnostic) {
    return (
      <DiagnosticChrome>
        <div className="space-y-4 text-center">
          <h1 className={DIAGNOSTIC_TITLE_CLASS}>We couldn&apos;t load your diagnostic</h1>
          <p className={`${DIAGNOSTIC_SUBTITLE_CLASS} mx-auto max-w-[28rem]`}>
            Start again from the prompt so we can restore the prerequisite check and learning path.
          </p>
          <button
            type="button"
            onClick={() => router.push("/")}
            className={DIAGNOSTIC_SECONDARY_BUTTON_CLASS}
          >
            Return to prompt
          </button>
        </div>
      </DiagnosticChrome>
    );
  }

  if (view === "finalizing") {
    return (
      <DiagnosticChrome>
        <div className="space-y-3 text-center">
          <h1 className={DIAGNOSTIC_TITLE_CLASS}>Finalizing your path...</h1>
          <p className={DIAGNOSTIC_SUBTITLE_CLASS}>
            We&apos;re waiting for the first lesson node to confirm before opening the graph.
          </p>
        </div>
      </DiagnosticChrome>
    );
  }

  if (view === "results" && result) {
    const hasGaps = result.gapNames.length > 0;

    return (
      <DiagnosticChrome>
        <div className="space-y-6">
          <div>
            <h1 className={DIAGNOSTIC_TITLE_CLASS}>
              {hasGaps ? "Almost there." : "You're ready."}
            </h1>
            <p className={`${DIAGNOSTIC_SUBTITLE_CLASS} mt-2`}>
              {hasGaps ? "We found a few foundations to revisit." : "Your foundations are strong."}
            </p>
          </div>

          <div className="space-y-3 rounded-[32px] border border-white/78 bg-white/76 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur-xl">
            {diagnostic.prerequisites.map((prerequisite) => {
              const isGap = result.gapNames.includes(prerequisite.name);
              return (
                <div key={prerequisite.name} className="border-b border-slate-100 pb-3 last:border-b-0 last:pb-0">
                  <div className="flex items-center gap-3">
                    <span className={isGap ? "text-amber-500" : "text-emerald-500"}>
                      {isGap ? "\u2022" : "\u2713"}
                    </span>
                    <span className="font-medium text-slate-900">{prerequisite.name}</span>
                  </div>
                  {isGap ? (
                    <div className="mt-3 space-y-3">
                      {prerequisite.questions.map((question, index) => {
                        const selected = answers[getQuestionKey(prerequisite.name, index)];
                        if (selected === question.correctIndex) {
                          return null;
                        }

                        return (
                          <div
                            key={`${prerequisite.name}-${index}`}
                            className="rounded-[20px] border border-amber-200/60 bg-amber-50/75 p-4"
                          >
                            <div className="text-sm text-slate-800">{renderLessonText(question.question)}</div>
                            <p className="mt-2 text-sm text-slate-700">
                              Correct answer: {question.options[question.correctIndex]}
                            </p>
                            <p className="mt-1 text-sm text-slate-600">{question.explanation}</p>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {hasGaps ? (
            <p className="text-sm text-slate-600">
              We&apos;ve identified gaps in {result.gapNames.join(", ")}. We&apos;ll add foundation review nodes to your path.
            </p>
          ) : null}

          <button
            type="button"
            onClick={continueToGraph}
            className={DIAGNOSTIC_PRIMARY_BUTTON_CLASS}
          >
            {hasGaps ? "Start your learning path \u2192" : "Start learning \u2192"}
          </button>
        </div>
      </DiagnosticChrome>
    );
  }

  return (
    <DiagnosticChrome>
      <div className="space-y-8">
        <div className="space-y-3 text-center">
          <h1 className={DIAGNOSTIC_TITLE_CLASS}>Let&apos;s check your foundations</h1>
          <p className={DIAGNOSTIC_SUBTITLE_CLASS}>
            Before diving into {(stored?.topic ?? "this topic").replaceAll("_", " ")}, let&apos;s make sure you&apos;re ready
          </p>
        </div>

        <div className="space-y-8">
          {diagnostic.prerequisites.map((prerequisite) => (
            <section key={prerequisite.name} className="space-y-4">
              <p className={DIAGNOSTIC_SUBTLE_LABEL_CLASS}>
                {prerequisite.name}
              </p>
              {prerequisite.questions.map((question, questionIndex) => {
                const questionKey = getQuestionKey(prerequisite.name, questionIndex);
                const selected = answers[questionKey];

                return (
                  <div
                    key={questionKey}
                    className="rounded-[32px] border border-white/78 bg-white/76 p-5 shadow-[0_24px_70px_rgba(15,23,42,0.08)] backdrop-blur-xl"
                  >
                    <div className="text-base text-slate-900">{renderLessonText(question.question)}</div>
                    <div className="mt-4 grid gap-3">
                      {question.options.map((option, optionIndex) => (
                        <button
                          key={`${questionKey}-${optionIndex}`}
                          type="button"
                          onClick={() =>
                            setAnswers((current) => ({
                              ...current,
                              [questionKey]: optionIndex,
                            }))
                          }
                          className={[
                            "cursor-pointer rounded-[18px] border px-4 py-3 text-left transition-all duration-200 hover:shadow-[0_8px_20px_rgba(15,23,42,0.06)]",
                            selected === optionIndex
                              ? DIAGNOSTIC_OPTION_SELECTED_CLASS
                              : DIAGNOSTIC_OPTION_CLASS,
                          ].join(" ")}
                        >
                          {renderLessonText(option)}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>
          ))}
        </div>

        <div className="space-y-3 text-center">
          <button
            type="button"
            disabled={answeredCount !== totalQuestions}
            onClick={() => {
              const nextResult = scoreDiagnostic(diagnostic, answers);
              setResult(nextResult);
              setView(graphStatus.graph_id ? "results" : "finalizing");
            }}
            className={DIAGNOSTIC_PRIMARY_BUTTON_CLASS}
          >
            {"Check my foundations \u2192"}
          </button>
        </div>
      </div>
    </DiagnosticChrome>
  );
}
