"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  getGraphDiagnosticResultKey,
  type StoredGraphDiagnosticResult,
} from "@/lib/diagnostic-session";
import {
  createProgressCompletionHint,
  getProgressCompletionHintKey,
} from "@/lib/progress-session";
import { buildProgressWriteRequestBody } from "@/lib/progress-write-client";
import { renderLessonText } from "@/lib/lesson-text-parser";
import { normalizeLessonNodeId } from "@/lib/lesson-route-node-id";
import {
  buildAppendedPrerequisiteNodes,
  type AppendedPrerequisiteNode,
} from "@/lib/prerequisite-lessons";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import { formatLessonTitleForDisplay } from "@/lib/lesson-title-display";
import { progressWriteResponseSchema } from "@/lib/schemas";
import type { FlagshipLesson, GraphPayload, Node } from "@/lib/types";

type LessonPageProps = {
  params:
    | Promise<{
        id: string;
        nodeId: string;
      }>
    | {
        id: string;
        nodeId: string;
      };
};

type LessonRenderableNode = Node | AppendedPrerequisiteNode;

type LessonResolverResponse = {
  ready: boolean;
  source: "graph" | "prerequisite";
  node: LessonRenderableNode | null;
  graph_diagnostic_result: StoredGraphDiagnosticResult | null;
};

type GraphNodeLesson = {
  kind: "flagship" | "plain";
  title: string;
  lesson: FlagshipLesson;
} | {
  kind: "plain";
  title: string;
  text: string;
  lesson: null;
};

type LessonOption = {
  text: string;
  isCorrect: boolean;
  explanation?: string;
  feedback?: string;
};

const EMPTY_STATE_TITLE = "Lesson coming soon.";
const DEFAULT_LOADING_MESSAGE = "Loading your lesson...";
const DEFAULT_ERROR_MESSAGE = "Something went wrong. Try again with a different topic.";
const PROGRESS_SCORE = 3;
const PREREQUISITE_RESTORE_INTERVAL_MS = 200;
const PREREQUISITE_RESTORE_MAX_ATTEMPTS = 10;

function parseResponseError(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") {
    return fallback;
  }

  const candidate = body as { message?: unknown; error?: unknown };
  if (typeof candidate.message === "string" && candidate.message.trim().length > 0) {
    return candidate.message;
  }

  if (typeof candidate.error === "string" && candidate.error.trim().length > 0) {
    return candidate.error;
  }

  return fallback;
}

async function ensureAnonymousSession(): Promise<void> {
  const supabase = createSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();

  if (!data.session) {
    const { error } = await supabase.auth.signInAnonymously();
    if (error) {
      throw new Error(error.message);
    }
  }
}

async function fetchGraphPayload(graphId: string): Promise<GraphPayload> {
  await ensureAnonymousSession();

  const response = await fetch(`/api/graph/${graphId}`, {
    credentials: "include",
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(parseResponseError(body, DEFAULT_ERROR_MESSAGE));
  }

  if (!body || typeof body !== "object") {
    throw new Error("The lesson payload was malformed.");
  }

  return body as GraphPayload;
}

async function fetchStoredGraphDiagnosticResult(
  graphId: string,
): Promise<StoredGraphDiagnosticResult | null> {
  await ensureAnonymousSession();

  const response = await fetch(`/api/graph/${graphId}/diagnostic`, {
    credentials: "include",
    cache: "no-store",
  });

  if (response.status === 404) {
    return null;
  }

  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok || !body || typeof body !== "object") {
    throw new Error("We couldn't restore the prerequisite path for this lesson.");
  }

  return body as StoredGraphDiagnosticResult;
}

async function resolveLessonFromServer(
  graphId: string,
  nodeId: string,
): Promise<LessonResolverResponse> {
  await ensureAnonymousSession();

  const response = await fetch(`/api/graph/${graphId}/lesson/${encodeURIComponent(nodeId)}`, {
    credentials: "include",
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as unknown;

  if (!response.ok || !body || typeof body !== "object") {
    throw new Error("We couldn't resolve this lesson yet.");
  }

  return body as LessonResolverResponse;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFlagshipLesson(value: unknown): value is FlagshipLesson {
  if (!isRecord(value) || value.version !== "flagship-v1") {
    return false;
  }

  const predictionTrap = value.predictionTrap;
  const guidedInsight = value.guidedInsight;
  const workedExample = value.workedExample;
  const whatIf = value.whatIf;
  const masteryCheck = value.masteryCheck;
  const anchor = value.anchor;

  if (
    !isRecord(predictionTrap) ||
    !isRecord(guidedInsight) ||
    !isRecord(workedExample) ||
    !isRecord(whatIf) ||
    !isRecord(masteryCheck) ||
    !isRecord(anchor)
  ) {
    return false;
  }

  return (
    typeof predictionTrap.question === "string" &&
    typeof predictionTrap.obviousAnswer === "string" &&
    typeof predictionTrap.correctAnswer === "string" &&
    typeof predictionTrap.whyWrong === "string" &&
    typeof guidedInsight.ground === "string" &&
    typeof guidedInsight.mechanism === "string" &&
    typeof guidedInsight.surprise === "string" &&
    typeof guidedInsight.reframe === "string" &&
    typeof workedExample.setup === "string" &&
    typeof workedExample.naiveAttempt === "string" &&
    Array.isArray(workedExample.steps) &&
    workedExample.steps.every(
      (step) =>
        isRecord(step) &&
        typeof step.action === "string" &&
        typeof step.result === "string",
    ) &&
    typeof workedExample.takeaway === "string" &&
    typeof whatIf.question === "string" &&
    Array.isArray(whatIf.options) &&
    whatIf.options.every(
      (option) =>
        isRecord(option) &&
        typeof option.text === "string" &&
        typeof option.isCorrect === "boolean" &&
        typeof option.explanation === "string",
    ) &&
    typeof masteryCheck.stem === "string" &&
    Array.isArray(masteryCheck.options) &&
    masteryCheck.options.every(
      (option) =>
        isRecord(option) &&
        typeof option.text === "string" &&
        typeof option.isCorrect === "boolean" &&
        typeof option.feedback === "string",
    ) &&
    typeof masteryCheck.forwardHook === "string" &&
    typeof anchor.summary === "string" &&
    typeof anchor.bridge === "string"
  );
}

function parseGraphNodeLesson(node: LessonRenderableNode | null): GraphNodeLesson | null {
  if (!node || typeof node.lesson_text !== "string" || node.lesson_text.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(node.lesson_text) as unknown;
    if (isFlagshipLesson(parsed)) {
      return {
        kind: "flagship",
        title: node.title,
        lesson: parsed,
      };
    }

    return null;
  } catch {
    // Fall through to the plain-text rendering path.
  }

  return {
    kind: "plain",
    title: node.title,
    text: node.lesson_text,
    lesson: null,
  };
}

function rawParagraphs(text: string): ReactNode[] {
  return text
    .split(/\n\n/)
    .filter((paragraph) => paragraph.trim().length > 0)
    .map((paragraph, index) => (
      <p key={`${paragraph.slice(0, 12)}-${index}`} className="mb-4">
        {paragraph}
      </p>
    ));
}

class LessonTextBoundary extends React.Component<
  {
    text: string;
    className?: string;
  },
  {
    hasError: boolean;
  }
> {
  constructor(props: { text: string; className?: string }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidUpdate(previousProps: { text: string }): void {
    if (this.state.hasError && previousProps.text !== this.props.text) {
      this.setState({ hasError: false });
    }
  }

  render(): ReactNode {
    const { className = "", text } = this.props;
    const content = this.state.hasError ? rawParagraphs(text) : renderLessonText(text);

    return <div className={className}>{content}</div>;
  }
}

function LessonText({ text, className = "" }: { text: string; className?: string }): ReactNode {
  return <LessonTextBoundary text={text} className={className} />;
}

function seededHash(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function shuffleDeterministic<T>(items: T[], seed: string): T[] {
  const result = [...items];
  let state = seededHash(seed) || 1;

  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const swapIndex = state % (index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }

  return result;
}

function FadeIn({
  show,
  className = "",
  children,
}: {
  show: boolean;
  className?: string;
  children: ReactNode;
}): ReactNode {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!show) {
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      setVisible(true);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [show]);

  if (!show) {
    return null;
  }

  return (
    <div
      className={`transition-opacity duration-300 ease-out ${visible ? "opacity-100" : "opacity-0"} ${className}`}
    >
      {children}
    </div>
  );
}

function SectionMarker({ children }: { children: string }): ReactNode {
  return (
    <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-gray-400">
      {children}
    </p>
  );
}

function ChoiceCard({
  text,
  selected,
  disabled,
  onClick,
  toneClassName = "",
  children,
}: {
  text: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  toneClassName?: string;
  children?: ReactNode;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "w-full rounded-xl border border-gray-200 px-5 py-4 text-left transition-all duration-150 hover:shadow-md",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
        selected ? toneClassName : "bg-white",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="[&>p]:mb-0">
        <LessonText text={text} className="text-base leading-7 text-gray-800" />
      </div>
      {children}
    </button>
  );
}

function useLessonPageParams(
  params: LessonPageProps["params"],
): {
  id: string;
  nodeId: string;
} {
  if (typeof params === "object" && params !== null && "then" in params) {
    return React.use(params);
  }

  return params;
}

export default function LessonPage({ params }: LessonPageProps): ReactNode {
  const router = useRouter();
  const { id: graphId, nodeId: rawNodeId } = useLessonPageParams(params);
  const normalizedNodeId = useMemo(() => normalizeLessonNodeId(rawNodeId), [rawNodeId]);
  const nodeId = normalizedNodeId.normalized;
  const isPrerequisiteRoute = nodeId.startsWith("gap:");
  const [payload, setPayload] = useState<GraphPayload | null>(null);
  const [resolvedNode, setResolvedNode] = useState<LessonRenderableNode | null>(null);
  const [storedDiagnosticResult, setStoredDiagnosticResult] =
    useState<StoredGraphDiagnosticResult | null>(null);
  const [hasHydratedStoredDiagnostic, setHasHydratedStoredDiagnostic] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trapRevealed, setTrapRevealed] = useState(false);
  const [predictionSelected, setPredictionSelected] = useState<number | null>(null);
  const [whatIfSelected, setWhatIfSelected] = useState<number | null>(null);
  const [masterySelected, setMasterySelected] = useState<number | null>(null);
  const [masteryWrong, setMasteryWrong] = useState<Set<number>>(() => new Set());
  const [masteryCorrect, setMasteryCorrect] = useState(false);
  const [lessonComplete, setLessonComplete] = useState(false);
  const [returning, setReturning] = useState(false);

  const lessonWriteAttempted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | null = null;
    let attempts = 0;

    const hydrateStoredDiagnostic = async (): Promise<boolean> => {
      const raw = window.sessionStorage.getItem(getGraphDiagnosticResultKey(graphId));
      if (!raw) {
        try {
          const restored = await fetchStoredGraphDiagnosticResult(graphId);
          if (cancelled || !restored) {
            if (!cancelled) {
              setStoredDiagnosticResult(null);
            }
            return false;
          }

          window.sessionStorage.setItem(
            getGraphDiagnosticResultKey(graphId),
            JSON.stringify(restored),
          );
          setStoredDiagnosticResult(restored);
          return true;
        } catch {
          if (!cancelled) {
            setStoredDiagnosticResult(null);
          }
          return false;
        }
      }

      try {
        setStoredDiagnosticResult(JSON.parse(raw) as StoredGraphDiagnosticResult);
        return true;
      } catch (storageError) {
        console.error("Lesson page failed to parse stored diagnostic result.", {
          graphId,
          nodeId: rawNodeId,
          normalizedNodeId: nodeId,
          error: storageError instanceof Error ? storageError.message : String(storageError),
        });
        setStoredDiagnosticResult(null);
        return false;
      }
    };

    setHasHydratedStoredDiagnostic(false);

    if (!isPrerequisiteRoute) {
      void (async () => {
        await hydrateStoredDiagnostic();
        if (!cancelled) {
          setHasHydratedStoredDiagnostic(true);
        }
      })();
      return undefined;
    }

    void (async () => {
      if (await hydrateStoredDiagnostic()) {
        if (!cancelled) {
          setHasHydratedStoredDiagnostic(true);
        }
        return;
      }

      intervalId = window.setInterval(() => {
        attempts += 1;
        void (async () => {
          const hydrated = await hydrateStoredDiagnostic();
          if (hydrated || attempts >= PREREQUISITE_RESTORE_MAX_ATTEMPTS) {
            if (!cancelled) {
              setHasHydratedStoredDiagnostic(true);
            }
            if (intervalId !== null) {
              window.clearInterval(intervalId);
            }
          }
        })();
      }, PREREQUISITE_RESTORE_INTERVAL_MS);
    })();

    return () => {
      cancelled = true;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [graphId, isPrerequisiteRoute, nodeId, rawNodeId]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const nextPayload = await fetchGraphPayload(graphId);

        if (cancelled) {
          return;
        }

        setPayload(nextPayload);
        setLoading(false);
      } catch (fetchError) {
        if (cancelled) {
          return;
        }

        setError(fetchError instanceof Error ? fetchError.message : DEFAULT_ERROR_MESSAGE);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [graphId]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const resolved = await resolveLessonFromServer(graphId, nodeId);
        if (cancelled) {
          return;
        }

        if (resolved.graph_diagnostic_result) {
          window.sessionStorage.setItem(
            getGraphDiagnosticResultKey(graphId),
            JSON.stringify(resolved.graph_diagnostic_result),
          );
          setStoredDiagnosticResult(resolved.graph_diagnostic_result);
          setHasHydratedStoredDiagnostic(true);
        }

        setResolvedNode(resolved.node);
      } catch {
        if (!cancelled) {
          setResolvedNode(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [graphId, nodeId]);

  const appendedPrerequisiteNodes = useMemo(() => {
    const firstGraphPosition =
      payload?.nodes
        .slice()
        .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))[0]
        ?.position ?? 0;

    return buildAppendedPrerequisiteNodes(storedDiagnosticResult, firstGraphPosition);
  }, [payload?.nodes, storedDiagnosticResult]);

  const selectedNode = useMemo(() => {
    return (
      resolvedNode ??
      payload?.nodes.find((node) => node.id === nodeId) ??
      appendedPrerequisiteNodes.find((node) => node.id === nodeId) ??
      null
    );
  }, [appendedPrerequisiteNodes, nodeId, payload?.nodes, resolvedNode]);

  const lesson = useMemo(() => parseGraphNodeLesson(selectedNode), [selectedNode]);
  const flagshipLesson = lesson?.lesson ?? null;
  const isResolvingPrerequisiteNode =
    isPrerequisiteRoute &&
    !error &&
    (!hasHydratedStoredDiagnostic || (payload !== null && selectedNode === null));

  const completedNodeIds = useMemo(() => {
    const completedPersistedNodeIds =
      payload?.progress.filter((entry) => entry.completed).map((entry) => entry.node_id) ?? [];
    const completedGapNodeIds = storedDiagnosticResult?.completedGapNodeIds ?? [];

    return new Set([...completedPersistedNodeIds, ...completedGapNodeIds]);
  }, [payload, storedDiagnosticResult?.completedGapNodeIds]);

  const nodeCompletedAlready = selectedNode ? completedNodeIds.has(selectedNode.id) : false;
  const hasPlainTextLesson = Boolean(selectedNode?.lesson_text?.trim().length);

  const predictionOptions = useMemo(() => {
    if (!flagshipLesson) {
      return [];
    }

    const source = [
      {
        text: flagshipLesson.predictionTrap.obviousAnswer,
        isCorrect: false,
      },
      {
        text: flagshipLesson.predictionTrap.correctAnswer,
        isCorrect: true,
      },
    ];

    return shuffleDeterministic(source, `${graphId}:${nodeId}:${flagshipLesson.predictionTrap.question}`);
  }, [flagshipLesson, graphId, nodeId]);

  const whatIfOptions = useMemo<LessonOption[]>(() => {
    if (!flagshipLesson) {
      return [];
    }

    return flagshipLesson.whatIf.options.map((option) => ({
      text: option.text,
      isCorrect: option.isCorrect,
      explanation: option.explanation,
    }));
  }, [flagshipLesson]);

  const masteryOptions = useMemo(() => {
    if (!flagshipLesson) {
      return [];
    }

    return flagshipLesson.masteryCheck.options.map((option) => ({
      text: option.text,
      isCorrect: option.isCorrect,
      feedback: option.feedback,
    }));
  }, [flagshipLesson]);

  useEffect(() => {
    lessonWriteAttempted.current = false;
    setResolvedNode(null);
    setTrapRevealed(false);
    setPredictionSelected(null);
    setWhatIfSelected(null);
    setMasterySelected(null);
    setMasteryWrong(new Set());
    setMasteryCorrect(false);
    setLessonComplete(false);
    setReturning(false);
    setError(null);
  }, [nodeId]);

  async function handleReturnToGraph(): Promise<void> {
    if (!selectedNode) {
      router.replace(`/graph/${graphId}`);
      return;
    }

    if (nodeCompletedAlready || lessonWriteAttempted.current) {
      router.replace(`/graph/${graphId}`);
      return;
    }

    if ("isPrerequisite" in selectedNode) {
      const nextStored: StoredGraphDiagnosticResult = {
        requestId: storedDiagnosticResult?.requestId ?? "",
        graphId,
        topic: storedDiagnosticResult?.topic ?? "",
        gapNames: storedDiagnosticResult?.gapNames ?? [],
        gapPrerequisites: storedDiagnosticResult?.gapPrerequisites ?? [],
        gapPrerequisiteLessons:
          storedDiagnosticResult?.gapPrerequisiteLessons ?? [],
        completedGapNodeIds: Array.from(
          new Set([...(storedDiagnosticResult?.completedGapNodeIds ?? []), selectedNode.id]),
        ),
      };
      window.sessionStorage.setItem(
        getGraphDiagnosticResultKey(graphId),
        JSON.stringify(nextStored),
      );
      setStoredDiagnosticResult(nextStored);
      if (nextStored.requestId) {
        void fetch(`/api/graph/status/${nextStored.requestId}/diagnostic`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(nextStored),
        }).catch(() => undefined);
      }
      router.replace(`/graph/${graphId}`);
      return;
    }

    lessonWriteAttempted.current = true;
    setReturning(true);

    try {
      const response = await fetch("/api/progress", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(
          buildProgressWriteRequestBody({
            graph_id: graphId,
            node_id: selectedNode.id,
            score: PROGRESS_SCORE,
          }),
        ),
      });

      const body = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        throw new Error(parseResponseError(body, DEFAULT_ERROR_MESSAGE));
      }

      const validated = progressWriteResponseSchema.parse(body);
      const completionHint = createProgressCompletionHint({
        graphId,
        response: validated,
      });
      if (completionHint) {
        window.sessionStorage.setItem(
          getProgressCompletionHintKey(graphId),
          JSON.stringify(completionHint),
        );
      }

      router.replace(`/graph/${graphId}`);
    } catch (progressError) {
      lessonWriteAttempted.current = false;
      setReturning(false);
      setError(progressError instanceof Error ? progressError.message : DEFAULT_ERROR_MESSAGE);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white px-6 text-center text-gray-400">
        <p className="text-lg font-medium">{DEFAULT_LOADING_MESSAGE}</p>
      </main>
    );
  }

  if (isResolvingPrerequisiteNode) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white px-6 text-center text-gray-500">
        <div className="max-w-lg space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
            Restoring your lesson
          </h1>
          <p className="text-sm leading-6">
            We&apos;re reconnecting the prerequisite lesson before opening it.
          </p>
        </div>
      </main>
    );
  }

  if (isPrerequisiteRoute && !error && !selectedNode) {
    console.error("Lesson page could not resolve prerequisite node.", {
      graphId,
      nodeId: rawNodeId,
      normalizedNodeId: nodeId,
      nodeIdWasNormalized: normalizedNodeId.wasNormalized,
      hasHydratedStoredDiagnostic,
      hasStoredDiagnosticResult: storedDiagnosticResult !== null,
      hasPayload: payload !== null,
    });
  }

  if (error || !selectedNode) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white px-6 text-center text-gray-900">
        <div className="max-w-lg space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {"We couldn't load this lesson"}
          </h1>
          <p className="text-sm leading-6 text-gray-500">
            {isPrerequisiteRoute
              ? "We couldn't restore this prerequisite lesson. Try returning to the graph and reopening it."
              : "Try regenerating it or refreshing the page."}
          </p>
          <div className="pt-2">
            <Link
              href={`/graph/${graphId}`}
              className="text-sm font-medium text-gray-700 transition hover:text-gray-900"
            >
              {"\u2190 Back to graph"}
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (!lesson) {
    return (
      <main className="min-h-screen bg-white text-gray-900">
        <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-gray-100 bg-white/95 px-6 backdrop-blur">
          <h1 className="truncate text-sm font-medium text-gray-900">
            {formatLessonTitleForDisplay(selectedNode.title)}
          </h1>
          <Link
            href={`/graph/${graphId}`}
            className="text-sm text-gray-500 transition hover:text-gray-900"
          >
            {"\u2190 Back to graph"}
          </Link>
        </div>

        <div className="mx-auto max-w-2xl px-6 py-10 text-base leading-relaxed text-gray-800">
          <div className="space-y-8">
            <section className="space-y-4">
              <h2 className="text-xl font-semibold tracking-tight text-gray-900">{EMPTY_STATE_TITLE}</h2>
              {hasPlainTextLesson ? <LessonText text={selectedNode.lesson_text ?? ""} /> : null}
            </section>
          </div>
        </div>
      </main>
    );
  }

  if (lesson.kind === "plain") {
    return (
      <main className="min-h-screen bg-white text-gray-900">
        <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-gray-100 bg-white/95 px-6 backdrop-blur">
          <h1 className="truncate text-sm font-medium text-gray-900">
            {formatLessonTitleForDisplay(selectedNode.title)}
          </h1>
          <Link
            href={`/graph/${graphId}`}
            className="text-sm text-gray-500 transition hover:text-gray-900"
          >
            {"\u2190 Back to graph"}
          </Link>
        </div>

        <div className="mx-auto max-w-2xl px-6 py-10 text-base leading-relaxed text-gray-800">
          <section className="space-y-6">
            <LessonText text={lesson.text} />
            <button
              type="button"
              onClick={handleReturnToGraph}
              disabled={returning}
              className="rounded-lg bg-blue-500 px-6 py-2.5 font-medium text-white transition-colors duration-150 hover:bg-blue-600 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
            >
              {returning ? "Returning..." : "Complete lesson ->"}
            </button>
          </section>
        </div>
      </main>
    );
  }

  if (!flagshipLesson) {
    return (
      <main className="min-h-screen bg-white text-gray-900">
        <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-gray-100 bg-white/95 px-6 backdrop-blur">
          <h1 className="truncate text-sm font-medium text-gray-900">
            {formatLessonTitleForDisplay(selectedNode.title)}
          </h1>
          <Link
            href={`/graph/${graphId}`}
            className="text-sm text-gray-500 transition hover:text-gray-900"
          >
            {"\u2190 Back to graph"}
          </Link>
        </div>

        <div className="mx-auto max-w-2xl px-6 py-10 text-base leading-7 text-gray-800">
          <section className="space-y-4">
            <h2 className="text-xl font-semibold tracking-tight text-gray-900">{EMPTY_STATE_TITLE}</h2>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-gray-100 bg-white/95 px-6 backdrop-blur">
        <h1 className="truncate text-sm font-medium text-gray-900">
          {formatLessonTitleForDisplay(selectedNode.title)}
        </h1>
        <Link
          href={`/graph/${graphId}`}
          className="text-sm text-gray-500 transition hover:text-gray-900"
        >
          {"\u2190 Back to graph"}
        </Link>
      </div>

      <div className="mx-auto max-w-2xl px-6 py-10 text-base leading-relaxed text-gray-800">
        <section className="mb-16">
          <div className="mb-8 text-center">
            <div className="text-xl font-semibold tracking-tight text-gray-900">
              <LessonText
                text={flagshipLesson.predictionTrap.question}
                className="text-center"
              />
            </div>
          </div>

          <div className="space-y-3">
            {predictionOptions.map((option, index) => {
              const selected = predictionSelected === index;
              const correctSelection = selected && option.isCorrect;
              const wrongSelection = selected && !option.isCorrect;

              return (
                <div key={`${selectedNode.id}-prediction-${index}`} className="space-y-3">
                  <button
                    type="button"
                    disabled={predictionSelected !== null}
                    onClick={() => {
                      if (predictionSelected !== null) {
                        return;
                      }
                      setPredictionSelected(index);
                      setTrapRevealed(true);
                    }}
                    className={[
                      "w-full rounded-xl border border-gray-200 px-5 py-4 text-left transition-all duration-200 hover:shadow-md",
                      predictionSelected !== null ? "cursor-default" : "cursor-pointer",
                      correctSelection ? "border-l-4 border-emerald-400 bg-emerald-50" : "",
                      wrongSelection ? "border-l-4 border-amber-400 bg-amber-50" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    >
                      <div className="[&>p]:mb-0">
                        <LessonText
                          text={option.text}
                          className="text-base leading-relaxed text-gray-800"
                        />
                      </div>
                    </button>

                    <FadeIn show={selected}>
                      <div className="pl-1">
                      <p className="text-base font-medium text-gray-700">
                        {option.isCorrect ? "Exactly right - but let's understand why." : "Not quite."}
                      </p>
                      <div className="mt-1 text-base leading-relaxed text-gray-600">
                        <LessonText
                          text={
                            option.isCorrect
                              ? flagshipLesson.predictionTrap.correctAnswer
                              : flagshipLesson.predictionTrap.whyWrong
                          }
                        />
                      </div>
                    </div>
                  </FadeIn>
                </div>
              );
            })}
          </div>
        </section>

        <FadeIn show={trapRevealed}>
          <section className="mb-16">
            <div className="space-y-6">
              <div className="[&>p]:mb-0">
                <LessonText text={flagshipLesson.guidedInsight.ground} />
              </div>
              <div className="[&>p]:mb-0">
                <LessonText text={flagshipLesson.guidedInsight.mechanism} />
              </div>
              <div className="[&>p]:mb-0">
                <LessonText text={flagshipLesson.guidedInsight.surprise} />
              </div>
              <div className="border-l-4 border-blue-500 pl-5 text-lg leading-relaxed font-medium text-gray-800">
                <LessonText text={flagshipLesson.guidedInsight.reframe} />
              </div>
            </div>
          </section>
        </FadeIn>

        <FadeIn show={trapRevealed}>
          <section className="mb-16">
            <SectionMarker>IN PRACTICE</SectionMarker>

            <div className="space-y-4">
              <div className="[&>p]:mb-0">
                <LessonText text={flagshipLesson.workedExample.setup} />
              </div>

              <div className="rounded-lg bg-gray-50 p-4">
                <p className="mb-2 text-sm font-medium text-gray-700">The obvious approach:</p>
                <div className="[&>p]:mb-0 text-base leading-relaxed text-gray-700">
                  <LessonText text={flagshipLesson.workedExample.naiveAttempt} />
                </div>
              </div>

              <ol className="space-y-4">
                {flagshipLesson.workedExample.steps.map((step, index) => (
                  <li key={`${selectedNode.id}-step-${index}`} className="space-y-1">
                    <div className="flex items-start">
                      <span className="mr-3 font-bold text-blue-500">{index + 1}.</span>
                      <div className="font-medium text-gray-800">
                        <LessonText text={step.action} />
                      </div>
                    </div>
                    <div className="pl-8 text-base leading-relaxed italic text-gray-500">
                      <LessonText text={step.result} />
                    </div>
                  </li>
                ))}
              </ol>

              <div className="border-l-4 border-blue-500 pl-5">
                <LessonText text={flagshipLesson.workedExample.takeaway} />
              </div>
            </div>
          </section>
        </FadeIn>

        <FadeIn show={trapRevealed}>
          <section className="mb-16">
            <SectionMarker>CONSIDER THIS</SectionMarker>
            <div className="mb-4 text-lg font-medium text-gray-800">
              <LessonText text={flagshipLesson.whatIf.question} />
            </div>

            <div className="space-y-3">
              {whatIfOptions.map((option, index) => {
                const selected = whatIfSelected === index;
                return (
                  <div key={`${selectedNode.id}-whatif-${index}`} className="space-y-3">
                    <ChoiceCard
                      text={option.text}
                      selected={selected}
                      onClick={() => setWhatIfSelected(index)}
                    />
                    <FadeIn show={selected}>
                      <div className="pl-4 text-base leading-relaxed text-gray-600">
                        <LessonText text={option.explanation ?? ""} />
                      </div>
                    </FadeIn>
                  </div>
                );
              })}
            </div>
          </section>
        </FadeIn>

        <FadeIn show={trapRevealed}>
          <section className="mb-16">
            <SectionMarker>CHECK YOUR UNDERSTANDING</SectionMarker>
            <div className="mb-6 text-lg font-medium text-gray-800">
              <LessonText text={flagshipLesson.masteryCheck.stem} />
            </div>

            <div className="space-y-3">
              {masteryOptions.map((option, index) => {
                const selected = masterySelected === index;
                const isWrongChoice = masteryWrong.has(index);
                const isCorrectChoice = selected && option.isCorrect && masteryCorrect;

                return (
                  <div key={`${selectedNode.id}-mastery-${index}`} className="space-y-3">
                    <button
                      type="button"
                      disabled={isWrongChoice || masteryCorrect}
                      onClick={() => {
                        if (isWrongChoice || masteryCorrect) {
                          return;
                        }

                        setMasterySelected(index);

                        if (option.isCorrect) {
                          setMasteryCorrect(true);
                          return;
                        }

                        setMasteryWrong((current) => {
                          const next = new Set(current);
                          next.add(index);
                          return next;
                        });
                      }}
                      className={[
                        "w-full rounded-xl border border-gray-200 px-5 py-4 text-left transition-all duration-200 hover:shadow-md",
                        isWrongChoice ? "cursor-not-allowed opacity-50" : "cursor-pointer",
                        isCorrectChoice ? "border-l-4 border-emerald-500 bg-emerald-50" : "",
                        selected && !option.isCorrect ? "border-l-4 border-amber-400 bg-amber-50" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      <div className="[&>p]:mb-0">
                        <LessonText text={option.text} className="text-base leading-7 text-gray-800" />
                      </div>
                    </button>

                    <FadeIn show={selected && !option.isCorrect}>
                      <div className="pl-4 text-sm leading-6 text-gray-600">
                        <LessonText text={option.feedback} />
                      </div>
                    </FadeIn>
                  </div>
                );
              })}
            </div>

            <FadeIn show={masteryCorrect}>
              <div className="mt-6 space-y-3">
                <div className="text-base leading-relaxed text-gray-600">
                  <LessonText text={flagshipLesson.masteryCheck.forwardHook} />
                </div>
                <button
                  type="button"
                  onClick={() => setLessonComplete(true)}
                  className="rounded-lg bg-blue-500 px-6 py-2.5 font-medium text-white transition-colors duration-150 hover:bg-blue-600 hover:shadow-md"
                >
                  {"Complete lesson ->"}
                </button>
              </div>
            </FadeIn>
          </section>
        </FadeIn>

        <FadeIn show={lessonComplete}>
          <section className="mb-16">
            <div className="space-y-4">
              <div>
                <LessonText text={flagshipLesson.anchor.summary} />
              </div>
              <div className="italic text-gray-700 [&>p]:mb-0">
                <LessonText text={flagshipLesson.anchor.bridge} />
              </div>
              <button
                type="button"
                onClick={handleReturnToGraph}
                disabled={returning}
                className="rounded-lg bg-blue-500 px-6 py-2.5 font-medium text-white transition-colors duration-150 hover:bg-blue-600 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"
              >
                {returning ? "Returning..." : "Return to graph ->"}
              </button>
            </div>
          </section>
        </FadeIn>
      </div>
    </main>
  );
}
