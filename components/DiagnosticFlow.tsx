"use client";

import { useMemo, useState } from "react";

import {
  getDiagnosticRecommendation,
  getDiagnosticStartNode,
  getNextDiagnosticNode,
} from "@/lib/domain/progress";
import type { DiagnosticAnswer, GraphPayload, Node } from "@/lib/types";

type DiagnosticFlowProps = {
  payload: GraphPayload;
  onComplete: (recommendedNodeId: string | null) => void;
};

function getQuestionForNode(node: Node) {
  return node.diagnostic_questions?.[0] ?? null;
}

export function DiagnosticFlow({ payload, onComplete }: DiagnosticFlowProps) {
  const startNode = useMemo(() => getDiagnosticStartNode(payload.nodes), [payload.nodes]);
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(startNode?.id ?? null);
  const [askedNodeIds, setAskedNodeIds] = useState<string[]>([]);
  const [answers, setAnswers] = useState<DiagnosticAnswer[]>([]);
  const [complete, setComplete] = useState(false);
  const recommendedNodeId = useMemo(
    () => (payload.nodes.length === 0 ? null : getDiagnosticRecommendation(payload.nodes, answers)),
    [answers, payload.nodes],
  );

  if (payload.nodes.length === 0 || !startNode) {
    return (
      <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
          Diagnostic unavailable
        </p>
        <h1 className="mt-3 text-2xl font-semibold text-zinc-950">
          This graph does not have diagnostic-ready nodes yet.
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          The graph payload was incomplete, so placement cannot begin safely.
        </p>
        <button
          type="button"
          className="mt-5 rounded-full bg-zinc-950 px-5 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800"
          onClick={() => onComplete(null)}
        >
          Continue
        </button>
      </section>
    );
  }

  const currentNode = currentNodeId
    ? payload.nodes.find((node) => node.id === currentNodeId) ?? startNode
    : startNode;
  const question = currentNode ? getQuestionForNode(currentNode) : null;

  const isFinished = complete || askedNodeIds.length >= 8 || !question || !currentNode;

  function finishDiagnostic(nextRecommendedNodeId: string | null) {
    setComplete(true);
    onComplete(nextRecommendedNodeId);
  }

  if (isFinished) {
    return (
      <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
          Diagnostic complete
        </p>
        <h1 className="mt-3 text-2xl font-semibold text-zinc-950">
          Recommended entry point
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          The learner should start at{" "}
          <span className="font-semibold text-zinc-950">
            {payload.nodes.find((node) => node.id === recommendedNodeId)?.title ?? recommendedNodeId ?? "the current node"}
          </span>
          .
        </p>
        <button
          type="button"
          className="mt-5 rounded-full bg-zinc-950 px-5 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800"
          onClick={() => finishDiagnostic(recommendedNodeId)}
        >
          Enter graph
        </button>
      </section>
    );
  }

  if (!question) {
    return (
      <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-zinc-600">No diagnostic question is available for this graph.</p>
        <button
          type="button"
          className="mt-4 rounded-full bg-zinc-950 px-5 py-2 text-sm font-semibold text-white"
          onClick={() => finishDiagnostic(recommendedNodeId)}
        >
          Continue
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
        Diagnostic {askedNodeIds.length + 1} / 8
      </p>
      <h1 className="mt-3 text-2xl font-semibold text-zinc-950">
        {currentNode.title}
      </h1>
      <p className="mt-2 text-sm text-zinc-600">{question.question}</p>
      <div className="mt-5 grid gap-3">
        {question.options.map((option, optionIndex) => (
          <button
            key={`${currentNode.id}-${optionIndex}`}
            type="button"
            className="rounded-2xl border border-zinc-200 px-4 py-3 text-left text-sm text-zinc-800 transition hover:border-zinc-400 hover:bg-zinc-50"
            onClick={() => {
              const correct = optionIndex === question.correct_index;
              const nextAnswers = [...answers, { node_id: currentNode.id, correct }];
              const nextAsked = [...askedNodeIds, currentNode.id];
              setAnswers(nextAnswers);
              setAskedNodeIds(nextAsked);

              const nextNode = getNextDiagnosticNode(
                payload.nodes,
                currentNode.id,
                nextAsked,
                correct,
              );

              if (!nextNode || nextAsked.length >= 8) {
                const finalNodeId = getDiagnosticRecommendation(payload.nodes, nextAnswers);
                finishDiagnostic(finalNodeId);
                return;
              }

              setCurrentNodeId(nextNode.id);
            }}
          >
            {option}
          </button>
        ))}
      </div>
    </section>
  );
}
