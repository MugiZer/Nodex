"use client";

import { useMemo, useState, type ReactNode } from "react";

import { P5Sketch } from "@/components/P5Sketch";
import { renderLessonText } from "@/lib/lesson-text-parser";
import { formatLessonTitleForDisplay } from "@/lib/lesson-title-display";
import type { Node, QuizItem } from "@/lib/types";

type NodePanelProps = {
  node: Node | null;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (nodeId: string, score: number) => Promise<void>;
};

function createInitialAnswers(quizJson: QuizItem[] | null): number[] {
  return quizJson ? Array.from({ length: quizJson.length }, () => -1) : [];
}

function NodeQuizSection({
  nodeId,
  quiz,
  submitting,
  error,
  onSubmit,
}: {
  nodeId: string;
  quiz: QuizItem[];
  submitting: boolean;
  error: string | null;
  onSubmit: (nodeId: string, score: number) => Promise<void>;
}): ReactNode {
  const [answers, setAnswers] = useState<number[]>(() => createInitialAnswers(quiz));

  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">
        Mastery Quiz
      </h3>
      <div className="space-y-4">
        {quiz.map((item, questionIndex) => (
          <fieldset
            key={`${nodeId}-${questionIndex}`}
            className="rounded-2xl border border-zinc-200 p-4"
          >
            <legend className="px-1 text-sm font-medium text-zinc-900">
              {questionIndex + 1}. {item.question}
            </legend>
            <div className="mt-3 space-y-2">
              {item.options.map((option, optionIndex) => (
                <label
                  key={`${nodeId}-${questionIndex}-${optionIndex}`}
                  className="flex cursor-pointer items-center gap-3 rounded-xl border border-transparent px-3 py-2 text-sm text-zinc-700 transition hover:border-zinc-200 hover:bg-zinc-50"
                >
                  <input
                    type="radio"
                    name={`${nodeId}-question-${questionIndex}`}
                    checked={answers[questionIndex] === optionIndex}
                    onChange={() => {
                      setAnswers((current) => {
                        const next = [...current];
                        next[questionIndex] = optionIndex;
                        return next;
                      });
                    }}
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      <button
        type="button"
        disabled={submitting || quiz.length === 0}
        onClick={async () => {
          const score = quiz.reduce((total, item, index) => {
            return total + (answers[index] === item.correct_index ? 1 : 0);
          }, 0);
          await onSubmit(nodeId, score);
        }}
        className="inline-flex items-center justify-center rounded-full bg-zinc-950 px-5 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "Submitting..." : "Submit Quiz"}
      </button>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </section>
  );
}

export function NodePanel({
  node,
  submitting,
  error,
  onClose,
  onSubmit,
}: NodePanelProps) {
  const content = useMemo(() => {
    if (!node) {
      return null;
    }

    const canRenderInteractiveVisual =
      node.visual_verified && (node.p5_code?.trim().length ?? 0) > 0;

    return {
      canRenderInteractiveVisual,
      staticDiagramMarkup: { __html: node.static_diagram ?? "" },
    };
  }, [node]);

  if (!node) {
    return (
      <aside className="rounded-3xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 shadow-sm">
        Select a node to open its lesson.
      </aside>
    );
  }

  const quiz = node.quiz_json ?? [];
  const lessonContent = node.lesson_text?.trim() ?? "";

  return (
    <aside className="flex h-full flex-col gap-5 rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
            Node
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-zinc-950">
            {formatLessonTitleForDisplay(node.title)}
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Position {node.position} · {node.lesson_status}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-zinc-200 px-3 py-1 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          Close
        </button>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">
          Lesson
        </h3>
        {lessonContent.length > 0 ? (
          <div className="space-y-3 text-sm leading-6 text-zinc-700 [&_p]:mb-3">
            {renderLessonText(lessonContent)}
          </div>
        ) : (
          <p className="text-sm leading-6 text-zinc-500">Lesson content is not ready yet.</p>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-zinc-500">
          Visual
        </h3>
        {content?.canRenderInteractiveVisual ? (
          <P5Sketch code={node.p5_code ?? ""} />
        ) : node.static_diagram ? (
          <div
            className="overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50 p-3 [&_svg]:h-auto [&_svg]:w-full"
            dangerouslySetInnerHTML={content?.staticDiagramMarkup ?? { __html: "" }}
          />
        ) : (
          <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
            No visual is available for this lesson yet.
          </div>
        )}
      </section>

      <NodeQuizSection
        key={node.id}
        nodeId={node.id}
        quiz={quiz}
        submitting={submitting}
        error={error}
        onSubmit={onSubmit}
      />
    </aside>
  );
}
