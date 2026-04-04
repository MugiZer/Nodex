"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import dagre from "dagre";
import {
  Background,
  BackgroundVariant,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeMouseHandler,
  type NodeProps,
  type ReactFlowInstance,
} from "reactflow";

import { getGraphDiagnosticResultKey, type StoredGraphDiagnosticResult } from "@/lib/diagnostic-session";
import {
  getProgressCompletionHintKey,
  type StoredProgressCompletionHint,
} from "@/lib/progress-session";
import { renderLessonText } from "@/lib/lesson-text-parser";
import { formatLessonTitleForDisplay } from "@/lib/lesson-title-display";
import {
  buildAppendedPrerequisiteNodes,
  type AppendedPrerequisiteNode,
  resolveActiveFlagshipNodeId,
} from "@/lib/prerequisite-lessons";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import type { Edge, FlagshipLesson, GraphPayload, Node } from "@/lib/types";

type GraphExperienceProps = {
  graphId: string;
};

type GraphNodeState = "blue" | "green" | "gray";

type GraphNodeData = {
  id: string;
  title: string;
  state: GraphNodeState;
  selected: boolean;
  isPrerequisite: boolean;
  onSelect: (nodeId: string) => void;
};

type NodeDetails = {
  objective: string;
  prerequisites: string[];
  unlocks: string[];
};

type GraphRenderableNode = Node | AppendedPrerequisiteNode;

type LessonResolverResponse = {
  ready: boolean;
  source: "graph" | "prerequisite";
  node: GraphRenderableNode | null;
  graph_diagnostic_result: StoredGraphDiagnosticResult | null;
};

type ParsedNodeLesson =
  | { kind: "empty" }
  | { kind: "plain"; text: string }
  | { kind: "flagship"; lesson: FlagshipLesson };

const NODE_WIDTH = 256;
const NODE_HEIGHT = 94;
const LOADING_MESSAGE = "Loading your learning path...";
const ERROR_TITLE = "We couldn't load this learning path";
const ERROR_SUBTITLE = "Try regenerating it or refreshing the page.";
const DEFAULT_ERROR = "We couldn't load this learning path.";
const GRAPH_POLL_INTERVAL_MS = 4000;
const MAX_GRAPH_POLL_ATTEMPTS = 24;
const MAX_GRAPH_POLL_WINDOW_MS = 120_000;

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

function parseNodeLesson(node: GraphRenderableNode | null): ParsedNodeLesson {
  if (!node || typeof node.lesson_text !== "string" || node.lesson_text.trim().length === 0) {
    return { kind: "empty" };
  }

  try {
    const parsed = JSON.parse(node.lesson_text) as unknown;
    if (isFlagshipLesson(parsed)) {
      return {
        kind: "flagship",
        lesson: parsed,
      };
    }

    return { kind: "empty" };
  } catch {
    // Fall through to plain-text rendering.
  }

  return {
    kind: "plain",
    text: node.lesson_text,
  };
}

function getNodeDisplayObjective(node: GraphRenderableNode): string {
  const lessonText = typeof node.lesson_text === "string" ? node.lesson_text.trim() : "";
  if (lessonText.length === 0) {
    return node.title;
  }

  try {
    const parsed = JSON.parse(lessonText) as unknown;
    if (isFlagshipLesson(parsed)) {
      const objective =
        parsed.anchor.summary.trim() || parsed.guidedInsight.reframe.trim() || node.title;
      return objective;
    }

    return node.title;
  } catch {
    return lessonText.split(/(?<=[.!?])\s+/)[0]?.trim() ?? node.title;
  }
}

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
      throw new Error("We could not start your learner session.");
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
    if (response.status === 401) {
      await ensureAnonymousSession();
      const retryResponse = await fetch(`/api/graph/${graphId}`, {
        credentials: "include",
        cache: "no-store",
      });
      const retryBody = (await retryResponse.json().catch(() => null)) as unknown;

      if (!retryResponse.ok) {
        throw new Error(parseResponseError(retryBody, DEFAULT_ERROR));
      }

      return retryBody as GraphPayload;
    }

    throw new Error(parseResponseError(body, DEFAULT_ERROR));
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
    throw new Error("We couldn't restore the prerequisite path for this graph.");
  }

  return body as StoredGraphDiagnosticResult;
}

async function resolveLessonRoute(
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
    throw new Error("This lesson is still restoring. Try again in a moment.");
  }

  return body as LessonResolverResponse;
}

function sortNodes<T extends { id: string; position: number }>(nodes: T[]): T[] {
  return [...nodes].sort((left, right) => {
    if (left.position !== right.position) {
      return left.position - right.position;
    }

    return left.id.localeCompare(right.id);
  });
}

function sortHardEdges(edges: Edge[]): Edge[] {
  return [...edges].sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === "hard" ? -1 : 1;
    }

    if (left.from_node_id !== right.from_node_id) {
      return left.from_node_id.localeCompare(right.from_node_id);
    }

    return left.to_node_id.localeCompare(right.to_node_id);
  });
}

function buildPathMap(nodes: Node[], edges: Edge[]): {
  primaryPathNodeIds: string[];
  flagshipNodeId: string | null;
} {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const incomingCounts = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  const outgoingHardEdges = new Map<string, Edge[]>();

  for (const edge of edges) {
    if (edge.type !== "hard") {
      continue;
    }

    if (!nodeMap.has(edge.from_node_id) || !nodeMap.has(edge.to_node_id)) {
      continue;
    }

    incomingCounts.set(edge.to_node_id, (incomingCounts.get(edge.to_node_id) ?? 0) + 1);

    const outgoing = outgoingHardEdges.get(edge.from_node_id) ?? [];
    outgoing.push(edge);
    outgoing.sort((left, right) => left.to_node_id.localeCompare(right.to_node_id));
    outgoingHardEdges.set(edge.from_node_id, outgoing);
  }

  const roots = sortNodes(nodes).filter((node) => (incomingCounts.get(node.id) ?? 0) === 0);
  const visited = new Set<string>();
  const primaryPathNodeIds: string[] = [];
  let current: Node | null = roots[0] ?? null;

  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    primaryPathNodeIds.push(current.id);

    const nextNodeId: string | undefined = (outgoingHardEdges.get(current.id) ?? [])
      .map((edge) => edge.to_node_id)
      .sort((left, right) => left.localeCompare(right))
      .find((nodeId) => !visited.has(nodeId));

    current = nextNodeId ? nodeMap.get(nextNodeId) ?? null : null;
  }

  const flagshipNodeId =
    primaryPathNodeIds
      .map((nodeId) => nodeMap.get(nodeId))
      .find(
        (node) =>
          node?.lesson_status === "ready" &&
          (node.lesson_text?.trim().length ?? 0) > 0,
      )?.id ?? primaryPathNodeIds[0] ?? null;

  return {
    primaryPathNodeIds,
    flagshipNodeId,
  };
}

function buildCombinedEdges(
  appendedPrerequisiteNodes: AppendedPrerequisiteNode[],
  graphNodes: Node[],
  graphEdges: Edge[],
): Edge[] {
  if (appendedPrerequisiteNodes.length === 0) {
    return graphEdges;
  }

  const rootGraphNodeIds = graphNodes
    .filter(
      (node) =>
        !graphEdges.some(
          (edge) => edge.type === "hard" && edge.to_node_id === node.id,
        ),
    )
    .map((node) => node.id);

  return [
    ...appendedPrerequisiteNodes.slice(0, -1).map((node, index) => ({
      from_node_id: node.id,
      to_node_id: appendedPrerequisiteNodes[index + 1]!.id,
      type: "hard" as const,
    })),
    ...rootGraphNodeIds.map((rootNodeId) => ({
      from_node_id: appendedPrerequisiteNodes[appendedPrerequisiteNodes.length - 1]!.id,
      to_node_id: rootNodeId,
      type: "hard" as const,
    })),
    ...graphEdges,
  ];
}

function computeAvailableRenderableNodeIds(
  nodes: GraphRenderableNode[],
  edges: Edge[],
  completedNodeIds: Set<string>,
): Set<string> {
  return new Set(
    nodes
      .filter((node) => {
        if (completedNodeIds.has(node.id)) {
          return true;
        }

        const incomingHardEdges = edges.filter(
          (edge) => edge.type === "hard" && edge.to_node_id === node.id,
        );

        return incomingHardEdges.every((edge) => completedNodeIds.has(edge.from_node_id));
      })
      .map((node) => node.id),
  );
}

function buildNodeDetails(input: {
  node: GraphRenderableNode;
  nodes: GraphRenderableNode[];
  edges: Edge[];
}): NodeDetails {
  const titleById = new Map(input.nodes.map((node) => [node.id, node.title]));
  const prerequisites = input.edges
    .filter((edge) => edge.type === "hard" && edge.to_node_id === input.node.id)
    .map((edge) => titleById.get(edge.from_node_id))
    .filter((title): title is string => typeof title === "string")
    .sort((left, right) => left.localeCompare(right));

  const unlocks = input.edges
    .filter((edge) => edge.type === "hard" && edge.from_node_id === input.node.id)
    .map((edge) => titleById.get(edge.to_node_id))
    .filter((title): title is string => typeof title === "string")
    .sort((left, right) => left.localeCompare(right));

  const objective = getNodeDisplayObjective(input.node);

  return {
    objective,
    prerequisites,
    unlocks,
  };
}

function getNodeState(input: {
  node: GraphRenderableNode;
  availableNodeIds: Set<string>;
  completedNodeIds: Set<string>;
}): GraphNodeState {
  if (input.completedNodeIds.has(input.node.id)) {
    return "green";
  }

  if (
    input.availableNodeIds.has(input.node.id) &&
    (!("lesson_status" in input.node) || input.node.lesson_status === "ready")
  ) {
    return "blue";
  }

  return "gray";
}

function layoutGraph(
  payload: GraphPayload,
  selectedNodeId: string | null,
  appendedPrerequisiteNodes: AppendedPrerequisiteNode[],
  completedGapNodeIds: Set<string>,
  onSelectNode: (nodeId: string) => void,
): {
  nodes: FlowNode<GraphNodeData>[];
  edges: FlowEdge[];
  flagshipNodeId: string | null;
} {
  const sortedNodes = sortNodes(payload.nodes);
  const combinedEdges = sortHardEdges(
    buildCombinedEdges(appendedPrerequisiteNodes, sortedNodes, payload.edges),
  );
  const combinedNodes = sortNodes<GraphRenderableNode>([
    ...appendedPrerequisiteNodes,
    ...sortedNodes,
  ]);
  const completedNodeIds = new Set([
    ...payload.progress.filter((entry) => entry.completed).map((entry) => entry.node_id),
    ...completedGapNodeIds,
  ]);
  const availableNodeIds = computeAvailableRenderableNodeIds(
    combinedNodes,
    combinedEdges,
    completedNodeIds,
  );
  const { flagshipNodeId: persistedFlagshipNodeId } = buildPathMap(sortedNodes, payload.edges);
  const activeFlagshipNodeId = resolveActiveFlagshipNodeId({
    prerequisiteNodes: appendedPrerequisiteNodes,
    completedNodeIds,
    persistedFlagshipNodeId,
  });

  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({
    rankdir: "TB",
    nodesep: 112,
    ranksep: 176,
    marginx: 80,
    marginy: 80,
  });

  for (const node of combinedNodes) {
    dagreGraph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  for (const edge of combinedEdges) {
    dagreGraph.setEdge(edge.from_node_id, edge.to_node_id);
  }

  dagre.layout(dagreGraph);

  const prerequisiteNodeIds = new Set(appendedPrerequisiteNodes.map((node) => node.id));

  const flowNodes = combinedNodes.map((node) => {
    const layoutNode = dagreGraph.node(node.id) as { x: number; y: number } | undefined;
    const selected = selectedNodeId === node.id;
    const state = getNodeState({
      node,
      availableNodeIds,
      completedNodeIds,
    });

    return {
      id: node.id,
      type: "learningNode",
      position: {
        x: (layoutNode?.x ?? 0) - NODE_WIDTH / 2,
        y: (layoutNode?.y ?? 0) - NODE_HEIGHT / 2,
      },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      draggable: false,
      selectable: false,
      data: {
        id: node.id,
        title: formatLessonTitleForDisplay(node.title),
        state,
        selected,
        isPrerequisite: "isPrerequisite" in node,
        onSelect: onSelectNode,
      },
    } satisfies FlowNode<GraphNodeData>;
  });

  const flowEdges = combinedEdges.map((edge) => {
    const isPrerequisiteEdge = prerequisiteNodeIds.has(edge.from_node_id);

    return {
      id: `${edge.from_node_id}-${edge.to_node_id}-${edge.type}`,
      source: edge.from_node_id,
      target: edge.to_node_id,
      type: "smoothstep",
      animated: false,
      style: {
        stroke: isPrerequisiteEdge ? "#7dd3fc" : "#b8c3d9",
        strokeWidth: isPrerequisiteEdge ? 2.1 : 1.6,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: isPrerequisiteEdge ? "#38bdf8" : "#8a94a6",
      },
    } satisfies FlowEdge;
  });

  return {
    nodes: flowNodes,
    edges: flowEdges,
    flagshipNodeId: activeFlagshipNodeId,
  };
}

const LearningNodeCard = memo(function LearningNodeCard({
  data,
}: NodeProps<GraphNodeData>) {
  const isBlue = data.state === "blue";
  const isGreen = data.state === "green";
  const isGray = data.state === "gray";

  const shellClass = data.isPrerequisite
    ? isGray
      ? "border-sky-200/90 bg-white/80 text-slate-500"
      : "border-sky-300/80 bg-[linear-gradient(145deg,rgba(240,249,255,0.96),rgba(207,250,254,0.95))] text-slate-900 shadow-[0_24px_60px_rgba(14,116,144,0.18)]"
    : isBlue
      ? "border-slate-900/80 bg-[linear-gradient(145deg,rgba(15,23,42,0.96),rgba(30,41,59,0.94))] text-white shadow-[0_32px_80px_rgba(15,23,42,0.26)]"
      : isGreen
        ? "border-emerald-300/70 bg-[linear-gradient(145deg,rgba(236,253,245,0.96),rgba(209,250,229,0.94))] text-slate-900 shadow-[0_24px_60px_rgba(16,185,129,0.18)]"
        : "border-slate-200/90 bg-[linear-gradient(145deg,rgba(255,255,255,0.82),rgba(226,232,240,0.78))] text-slate-500";

  const eyebrowClass = isGray
    ? "text-slate-400"
    : isBlue
      ? "text-white/55"
      : isGreen
        ? "text-emerald-700/80"
        : "text-slate-400";

  const titleClass = isGray ? "text-slate-500" : isBlue ? "text-white" : "text-slate-900";
  const detailClass = isGray
    ? "text-slate-400"
    : isBlue
      ? "text-white/72"
      : isGreen
        ? "text-emerald-900/70"
        : "text-slate-400";

  return (
    <button
      type="button"
      title={isGray ? "Coming soon" : data.title}
      onClick={() => data.onSelect(data.id)}
      className={[
        "group relative flex h-[94px] w-[256px] cursor-pointer flex-col justify-center overflow-hidden rounded-[30px] border px-5 py-4 text-left transition-all duration-200 ease-out",
        shellClass,
        data.selected
          ? "ring-2 ring-sky-300/80 ring-offset-4 ring-offset-[#edf2f7]"
          : "hover:-translate-y-1 hover:border-slate-300/90",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="pointer-events-none absolute inset-x-3 top-0 h-px bg-white/60" />
      <span className="pointer-events-none absolute right-3 top-3 h-10 w-10 rounded-full bg-white/10 blur-xl" />
      <Handle
        type="target"
        position={Position.Top}
        className="!border-0 !bg-transparent !opacity-0"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!border-0 !bg-transparent !opacity-0"
      />
      <span className={["text-[11px] font-semibold uppercase tracking-[0.3em]", eyebrowClass].join(" ")}>
        {data.isPrerequisite ? "Foundation" : isGreen ? "Complete" : isBlue ? "Ready" : "Locked"}
      </span>
      <span className={["mt-1 text-base font-semibold leading-6", titleClass].join(" ")}>
        {data.title}
      </span>
      {isGray ? (
        <span className={["mt-1 text-xs font-medium opacity-0 transition-opacity duration-150 group-hover:opacity-100", detailClass].join(" ")}>
          Complete the prior lessons to unlock this step.
        </span>
      ) : null}
      {isGreen ? (
        <span className={["mt-1 text-xs font-medium opacity-0 transition-opacity duration-150 group-hover:opacity-100", detailClass].join(" ")}>
          Reopen the lesson when you want a refresh.
        </span>
      ) : null}
      {isBlue ? (
        <span className={["mt-1 text-xs font-medium opacity-0 transition-opacity duration-150 group-hover:opacity-100", detailClass].join(" ")}>
          Open this lesson and keep the graph moving.
        </span>
      ) : null}
    </button>
  );
});

const NODE_TYPES = {
  learningNode: LearningNodeCard,
};

function hasPollingRelevantChange(
  current: GraphPayload | null,
  next: GraphPayload,
): boolean {
  if (!current) {
    return true;
  }

  if (current.nodes.length !== next.nodes.length || current.progress.length !== next.progress.length) {
    return true;
  }

  for (let index = 0; index < next.nodes.length; index += 1) {
    const currentNode = current.nodes[index];
    const nextNode = next.nodes[index];
    if (
      !currentNode ||
      currentNode.id !== nextNode.id ||
      currentNode.lesson_status !== nextNode.lesson_status ||
      currentNode.lesson_text !== nextNode.lesson_text
    ) {
      return true;
    }
  }

  for (let index = 0; index < next.progress.length; index += 1) {
    const currentEntry = current.progress[index];
    const nextEntry = next.progress[index];
    if (
      !currentEntry ||
      currentEntry.id !== nextEntry.id ||
      currentEntry.completed !== nextEntry.completed
    ) {
      return true;
    }
  }

  return false;
}

function LessonPreview({ lesson }: { lesson: ParsedNodeLesson }) {
  if (lesson.kind === "empty") {
    return <p className="text-sm leading-6 text-slate-400">Lesson coming soon.</p>;
  }

  if (lesson.kind === "plain") {
    return (
      <div className="space-y-3 text-sm leading-7 text-slate-600 [&_p]:mb-3">
        {renderLessonText(lesson.text)}
      </div>
    );
  }

  const { predictionTrap, guidedInsight, workedExample, anchor } = lesson.lesson;

  return (
    <div className="space-y-5 text-sm leading-7 text-slate-600">
      <div className="rounded-[28px] border border-amber-200/70 bg-[linear-gradient(180deg,rgba(255,251,235,0.96),rgba(254,243,199,0.7))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-amber-700">
          Prediction Trap
        </p>
        <div className="mt-3 font-medium text-slate-900 [&_p]:mb-0">
          {renderLessonText(predictionTrap.question)}
        </div>
        <div className="mt-3 text-slate-600 [&_p]:mb-0">
          <span className="font-medium text-slate-800">Obvious answer:</span>{" "}
          {renderLessonText(predictionTrap.obviousAnswer)}
        </div>
        <div className="mt-2 text-slate-600 [&_p]:mb-0">
          <span className="font-medium text-slate-800">Correct answer:</span>{" "}
          {renderLessonText(predictionTrap.correctAnswer)}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-400">
          Core Idea
        </p>
        <div className="[&_p]:mb-0">{renderLessonText(guidedInsight.ground)}</div>
        <div className="[&_p]:mb-0">{renderLessonText(guidedInsight.mechanism)}</div>
        <div className="[&_p]:mb-0">{renderLessonText(guidedInsight.surprise)}</div>
        <div className="font-medium text-slate-900 [&_p]:mb-0">
          {renderLessonText(guidedInsight.reframe)}
        </div>
      </div>

      <div className="space-y-2 rounded-[28px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(248,250,252,0.92),rgba(255,255,255,0.98))] p-5 shadow-[0_16px_40px_rgba(148,163,184,0.12)]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-400">
          Worked Example
        </p>
        <div className="[&_p]:mb-0">{renderLessonText(workedExample.setup)}</div>
        <div className="[&_p]:mb-0">{renderLessonText(workedExample.naiveAttempt)}</div>
        <div className="[&_p]:mb-0">{renderLessonText(workedExample.takeaway)}</div>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-400">
          Anchor
        </p>
        <div className="font-medium text-slate-900 [&_p]:mb-0">
          {renderLessonText(anchor.summary)}
        </div>
        <div className="[&_p]:mb-0">{renderLessonText(anchor.bridge)}</div>
      </div>
    </div>
  );
}

function LessonTextBlock({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}): ReactNode {
  return <div className={className}>{renderLessonText(text)}</div>;
}

function NodeDetailPanel({
  node,
  details,
  state,
  onClose,
  onStartLesson,
  lessonLaunchError,
  isLaunchingLesson,
}: {
  node: GraphRenderableNode;
  details: NodeDetails;
  state: GraphNodeState;
  onClose: () => void;
  onStartLesson: () => void;
  lessonLaunchError: string | null;
  isLaunchingLesson: boolean;
}) {
  const prerequisitesText =
    details.prerequisites.length > 0
      ? details.prerequisites.join(", ")
      : "None - this is your starting point";
  const unlocksText =
    details.unlocks.length > 0 ? details.unlocks.join(", ") : "Nothing yet";
  const parsedLesson = parseNodeLesson(node);
  const displayTitle = formatLessonTitleForDisplay(node.title);

  return (
    <aside
      className={[
        "pointer-events-auto absolute inset-y-0 right-0 z-20 flex h-full w-full max-w-[430px] flex-col overflow-hidden border-l border-white/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(241,245,249,0.94))] px-6 py-6 shadow-[-32px_0_90px_rgba(15,23,42,0.14)] backdrop-blur-2xl",
        "transform transition-transform duration-200 ease-out",
      ].join(" ")}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.18),transparent_70%)]" />
      <button
        type="button"
        onClick={onClose}
        aria-label="Close node details"
        className="absolute right-4 top-4 z-10 rounded-full border border-white/70 bg-white/70 p-2 text-slate-400 transition hover:border-slate-200 hover:bg-white hover:text-slate-700"
      >
        <span className="text-lg leading-none">×</span>
      </button>

      <div className="relative mt-6 flex min-h-0 flex-1 flex-col">
        {state === "blue" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="space-y-3">
              {"isPrerequisite" in node ? (
                <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-sky-600">
                  Foundation lesson
                </p>
              ) : null}
              <h2 className="text-[28px] font-semibold tracking-[-0.03em] text-slate-950">
                {formatLessonTitleForDisplay(node.title)}
              </h2>
              <LessonTextBlock
                text={details.objective}
                className="text-sm leading-7 text-slate-600 [&_p]:mb-0"
              />
            </div>

            <div className="mt-5 max-h-[38vh] overflow-y-auto rounded-[30px] border border-white/70 bg-white/80 p-5 shadow-[0_18px_50px_rgba(148,163,184,0.14)]">
              <LessonPreview lesson={parsedLesson} />
            </div>

            <button
              type="button"
              onClick={onStartLesson}
              disabled={isLaunchingLesson}
              className="mt-5 w-full rounded-full border border-slate-900 bg-slate-950 px-6 py-3 text-sm font-semibold text-white transition duration-200 ease-out hover:-translate-y-0.5 hover:bg-slate-800"
            >
              {isLaunchingLesson ? "Opening lesson..." : "Start lesson ->"}
            </button>
            {lessonLaunchError ? (
              <p className="mt-3 text-sm leading-6 text-amber-700">
                {lessonLaunchError}
              </p>
            ) : null}

            <div className="mt-6 grid gap-4 text-sm text-slate-500 sm:grid-cols-2">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-slate-400">
                  Prerequisites
                </p>
                <p className="mt-2 leading-6 text-slate-600">{prerequisitesText}</p>
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-slate-400">
                  Completing this unlocks
                </p>
                <p className="mt-2 leading-6 text-slate-600">{unlocksText}</p>
              </div>
            </div>
          </div>
        ) : state === "green" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="space-y-2">
              <h2
                aria-label={displayTitle}
                data-title={displayTitle}
                className="relative text-xl font-semibold tracking-tight text-transparent after:pointer-events-none after:absolute after:inset-0 after:text-gray-900 after:content-[attr(data-title)]"
              >
                {node.title} <span className="text-emerald-500">✓</span>
              </h2>
              <LessonTextBlock
                text={details.objective}
                className="text-sm leading-6 text-gray-600 [&_p]:mb-0"
              />
            </div>

            <div className="mt-4 max-h-[38vh] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-4">
              <LessonPreview lesson={parsedLesson} />
            </div>

            <button
              type="button"
              onClick={onStartLesson}
              className="mt-4 w-full rounded-lg border border-gray-300 px-6 py-2.5 font-medium text-gray-700 shadow-sm transition-colors duration-150 ease-out hover:border-gray-400 hover:bg-gray-50"
            >
              {"Review lesson ->"}
            </button>

            <div className="mt-6 rounded-2xl bg-gray-50 p-4 text-sm text-gray-600">
              <p className="font-medium text-gray-700">Completed.</p>
              <p className="mt-1 leading-6">
                This unlocked: {unlocksText}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="space-y-2">
              <h2 className="text-xl font-semibold tracking-tight text-gray-900">
                {node.title}
              </h2>
              <p className="text-sm leading-6 text-gray-400">Lesson coming soon.</p>
            </div>

            <div className="mt-6 space-y-4 text-sm text-gray-500">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-gray-400">
                  Prerequisites
                </p>
                <p className="mt-1 leading-6 text-gray-600">{prerequisitesText}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

export function GraphExperience({ graphId }: GraphExperienceProps) {
  const router = useRouter();
  const [payload, setPayload] = useState<GraphPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [storedDiagnosticResult, setStoredDiagnosticResult] =
    useState<StoredGraphDiagnosticResult | null>(null);
  const [storedProgressHint, setStoredProgressHint] =
    useState<StoredProgressCompletionHint | null>(null);
  const [lessonLaunchError, setLessonLaunchError] = useState<string | null>(null);
  const [isLaunchingLesson, setIsLaunchingLesson] = useState(false);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<GraphNodeData, FlowEdge> | null>(
    null,
  );
  const guidedOpenRef = useRef(false);
  const pollAttemptRef = useRef(0);
  const pollStartedAtRef = useRef<number | null>(null);
  const pollInFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const raw = window.sessionStorage.getItem(getGraphDiagnosticResultKey(graphId));
      if (raw) {
        try {
          setStoredDiagnosticResult(JSON.parse(raw) as StoredGraphDiagnosticResult);
          return;
        } catch {
          window.sessionStorage.removeItem(getGraphDiagnosticResultKey(graphId));
        }
      }

      try {
        const restored = await fetchStoredGraphDiagnosticResult(graphId);
        if (cancelled || !restored) {
          if (!cancelled) {
            setStoredDiagnosticResult(null);
          }
          return;
        }

        window.sessionStorage.setItem(
          getGraphDiagnosticResultKey(graphId),
          JSON.stringify(restored),
        );
        setStoredDiagnosticResult(restored);
      } catch {
        if (!cancelled) {
          setStoredDiagnosticResult(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [graphId]);

  useEffect(() => {
    const raw = window.sessionStorage.getItem(getProgressCompletionHintKey(graphId));
    if (!raw) {
      setStoredProgressHint(null);
      return;
    }

    try {
      setStoredProgressHint(JSON.parse(raw) as StoredProgressCompletionHint);
    } catch {
      setStoredProgressHint(null);
    }
  }, [graphId]);

  useEffect(() => {
    const prerequisiteLessons = storedDiagnosticResult?.gapPrerequisiteLessons ?? [];
    const prerequisiteGroups = storedDiagnosticResult?.gapPrerequisites ?? [];

    if (
      !storedDiagnosticResult?.requestId ||
      prerequisiteLessons.length >= prerequisiteGroups.length
    ) {
      return undefined;
    }

    let cancelled = false;
    const intervalId = window.setInterval(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/graph/status/${storedDiagnosticResult.requestId}`, {
            cache: "no-store",
          });
          if (!response.ok) {
            return;
          }

          const body = (await response.json().catch(() => null)) as {
            prerequisite_lessons_status?: "pending" | "ready" | "failed";
            prerequisite_lessons?: StoredGraphDiagnosticResult["gapPrerequisiteLessons"] | null;
          } | null;

          if (!body || cancelled) {
            return;
          }

          if (body.prerequisite_lessons_status === "failed") {
            window.clearInterval(intervalId);
            return;
          }

          if (
            body.prerequisite_lessons_status === "ready" &&
            Array.isArray(body.prerequisite_lessons)
          ) {
            const nextResult: StoredGraphDiagnosticResult = {
              ...storedDiagnosticResult,
              gapPrerequisiteLessons: body.prerequisite_lessons,
            };

            window.sessionStorage.setItem(
              getGraphDiagnosticResultKey(graphId),
              JSON.stringify(nextResult),
            );
            setStoredDiagnosticResult(nextResult);
            window.clearInterval(intervalId);
          }
        } catch {
          if (!cancelled) {
            // keep polling until the request settles
          }
        }
      })();
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [graphId, storedDiagnosticResult]);

  useEffect(() => {
    if (!payload || !storedProgressHint) {
      return undefined;
    }

    const serverCompletedNodeIds = new Set(
      payload.progress.filter((entry) => entry.completed).map((entry) => entry.node_id),
    );
    const shouldClearHint =
      storedProgressHint.completedNodeIds.length > 0 &&
      storedProgressHint.completedNodeIds.every((nodeId) => serverCompletedNodeIds.has(nodeId));

    if (!shouldClearHint) {
      return undefined;
    }

    window.sessionStorage.removeItem(getProgressCompletionHintKey(graphId));
    setStoredProgressHint(null);
    return undefined;
  }, [graphId, payload, storedProgressHint]);

  useEffect(() => {
    let cancelled = false;

    async function loadGraph(): Promise<void> {
      try {
        const nextPayload = await fetchGraphPayload(graphId);

        if (cancelled) {
          return;
        }

        setPayload((current) =>
          hasPollingRelevantChange(current, nextPayload) ? nextPayload : current,
        );
        setLoading(false);
        setError(null);
      } catch (fetchError) {
        if (cancelled) {
          return;
        }

        setError(fetchError instanceof Error ? fetchError.message : DEFAULT_ERROR);
        setLoading(false);
      }
    }

    void loadGraph();

    return () => {
      cancelled = true;
    };
  }, [graphId]);

  useEffect(() => {
    if (!payload) {
      return undefined;
    }

    const hasPendingNodes = payload.nodes.some((node) => node.lesson_status !== "ready");
    if (!hasPendingNodes) {
      pollAttemptRef.current = 0;
      pollStartedAtRef.current = null;
      pollInFlightRef.current = false;
      return undefined;
    }

    pollStartedAtRef.current ??= Date.now();
    let cancelled = false;
    const intervalId = window.setInterval(() => {
      if (pollInFlightRef.current) {
        return;
      }

      const elapsedMs = Date.now() - (pollStartedAtRef.current ?? Date.now());
      if (
        pollAttemptRef.current >= MAX_GRAPH_POLL_ATTEMPTS ||
        elapsedMs >= MAX_GRAPH_POLL_WINDOW_MS
      ) {
        window.clearInterval(intervalId);
        return;
      }

      pollAttemptRef.current += 1;
      pollInFlightRef.current = true;
      void (async () => {
        try {
          const nextPayload = await fetchGraphPayload(graphId);
          if (cancelled) {
            return;
          }

          setPayload((current) =>
            hasPollingRelevantChange(current, nextPayload) ? nextPayload : current,
          );
          setError(null);
        } catch {
          if (cancelled) {
            return;
          }
        } finally {
          pollInFlightRef.current = false;
        }
      })();
    }, GRAPH_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      pollInFlightRef.current = false;
    };
  }, [graphId, payload]);

  const appendedPrerequisiteNodes = useMemo(() => {
    const firstGraphPosition = sortNodes(payload?.nodes ?? [])[0]?.position ?? 0;
    return buildAppendedPrerequisiteNodes(storedDiagnosticResult, firstGraphPosition);
  }, [payload?.nodes, storedDiagnosticResult]);

  const combinedEdges = useMemo(
    () => buildCombinedEdges(appendedPrerequisiteNodes, payload?.nodes ?? [], payload?.edges ?? []),
    [appendedPrerequisiteNodes, payload?.edges, payload?.nodes],
  );

  const completedGapNodeIds = useMemo(
    () => new Set(storedDiagnosticResult?.completedGapNodeIds ?? []),
    [storedDiagnosticResult],
  );

  const completedProgressHintNodeIds = useMemo(
    () => new Set(storedProgressHint?.completedNodeIds ?? []),
    [storedProgressHint],
  );

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) {
      return null;
    }

    return (
      appendedPrerequisiteNodes.find((node) => node.id === selectedNodeId) ??
      payload?.nodes.find((node) => node.id === selectedNodeId) ??
      null
    );
  }, [appendedPrerequisiteNodes, payload?.nodes, selectedNodeId]);

  const handleNodeSelect = useCallback((nodeId: string) => {
    guidedOpenRef.current = true;
    setLessonLaunchError(null);
    setSelectedNodeId(nodeId);
  }, []);

  const handleFlowNodeClick = ((_event, node) => {
    handleNodeSelect(node.id);
  }) satisfies NodeMouseHandler;

  const graphView = useMemo(() => {
    if (!payload) {
      return null;
    }

    return layoutGraph(
      payload,
      selectedNodeId,
      appendedPrerequisiteNodes,
      new Set([...completedGapNodeIds, ...completedProgressHintNodeIds]),
      handleNodeSelect,
    );
  }, [
    appendedPrerequisiteNodes,
    completedGapNodeIds,
    completedProgressHintNodeIds,
    handleNodeSelect,
    payload,
    selectedNodeId,
  ]);

  const flagshipNodeId = graphView?.flagshipNodeId ?? null;

  useEffect(() => {
    if (selectedNodeId !== null) {
      guidedOpenRef.current = true;
    }
  }, [selectedNodeId]);

  useEffect(() => {
    if (!payload || guidedOpenRef.current) {
      return undefined;
    }

    if (!flagshipNodeId || selectedNodeId !== null) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      guidedOpenRef.current = true;
      setSelectedNodeId(flagshipNodeId);
    }, 1500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [flagshipNodeId, payload, selectedNodeId]);

  useEffect(() => {
    if (!flowInstance || !payload) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      flowInstance.fitView({ padding: 0.08, duration: 0 });
    }, selectedNodeId ? 220 : 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [flowInstance, payload, selectedNodeId]);

  const activeNode = selectedNode;

  const handleStartLesson = useCallback(async () => {
    if (!activeNode || isLaunchingLesson) {
      return;
    }

    setLessonLaunchError(null);
    setIsLaunchingLesson(true);

    try {
      const resolved = await resolveLessonRoute(graphId, activeNode.id);

      if (resolved.graph_diagnostic_result) {
        window.sessionStorage.setItem(
          getGraphDiagnosticResultKey(graphId),
          JSON.stringify(resolved.graph_diagnostic_result),
        );
        setStoredDiagnosticResult(resolved.graph_diagnostic_result);
      }

      if (!resolved.ready || !resolved.node) {
        throw new Error("This lesson is still restoring. Please wait a moment and try again.");
      }

      router.push(`/graph/${graphId}/lesson/${activeNode.id}`);
    } catch (launchError) {
      setLessonLaunchError(
        launchError instanceof Error
          ? launchError.message
          : "This lesson is still restoring. Please wait a moment and try again.",
      );
    } finally {
      setIsLaunchingLesson(false);
    }
  }, [activeNode, graphId, isLaunchingLesson, router]);

  if (loading) {
    return (
      <div className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-[linear-gradient(180deg,#f8fbff_0%,#edf2f7_100%)] text-center">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.15),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(15,23,42,0.12),transparent_32%)]" />
        <div className="relative rounded-full border border-white/80 bg-white/70 px-6 py-3 text-sm font-medium tracking-[0.18em] text-slate-500 shadow-[0_20px_60px_rgba(148,163,184,0.18)] backdrop-blur-xl">
          {LOADING_MESSAGE}
        </div>
      </div>
    );
  }

  if (error || !payload || !graphView) {
    return (
      <div className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-[linear-gradient(180deg,#f8fbff_0%,#edf2f7_100%)] px-6 text-center">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.15),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(15,23,42,0.12),transparent_32%)]" />
        <div className="relative max-w-md space-y-3 rounded-[32px] border border-white/80 bg-white/70 px-8 py-9 shadow-[0_28px_90px_rgba(15,23,42,0.1)] backdrop-blur-2xl">
          <h1 className="text-2xl font-semibold tracking-[-0.03em] text-slate-950">
            {ERROR_TITLE}
          </h1>
          <p className="text-sm leading-7 text-slate-500">{ERROR_SUBTITLE}</p>
          {error ? <p className="text-sm text-slate-400">{error}</p> : null}
        </div>
      </div>
    );
  }

  const combinedNodes = [...appendedPrerequisiteNodes, ...payload.nodes];
  const allCompletedNodeIds = new Set([
    ...payload.progress.filter((entry) => entry.completed).map((entry) => entry.node_id),
    ...completedGapNodeIds,
    ...completedProgressHintNodeIds,
  ]);
  const availableNodeIds = computeAvailableRenderableNodeIds(
    combinedNodes,
    combinedEdges,
    allCompletedNodeIds,
  );

  const panelOpen = activeNode !== null;
  const details = activeNode
    ? buildNodeDetails({
        node: activeNode,
        nodes: combinedNodes,
        edges: combinedEdges,
      })
    : null;
  const nodeState = activeNode
    ? getNodeState({
        node: activeNode,
        availableNodeIds,
        completedNodeIds: allCompletedNodeIds,
      })
    : null;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[linear-gradient(180deg,#f8fbff_0%,#eef2f7_44%,#e2e8f0_100%)] text-slate-900">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.2),transparent_24%),radial-gradient(circle_at_82%_18%,rgba(14,165,233,0.16),transparent_18%),radial-gradient(circle_at_bottom_right,rgba(15,23,42,0.12),transparent_34%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[linear-gradient(180deg,rgba(255,255,255,0.5),transparent)]" />
      <div
        className={[
          "relative h-full min-h-0 w-full transition-[padding-right] duration-200 ease-out",
          panelOpen ? "lg:pr-[430px]" : "lg:pr-0",
        ].join(" ")}
      >
        <div className="pointer-events-none absolute left-5 top-5 z-10 rounded-full border border-white/80 bg-white/70 px-4 py-2 shadow-[0_14px_38px_rgba(148,163,184,0.18)] backdrop-blur-xl">
          <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-slate-400">
            Foundation Graph
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-900">
            Explore the map, then open the next active lesson.
          </p>
        </div>
        <div className="h-full w-full">
          <ReactFlow
            nodes={graphView.nodes}
            edges={graphView.edges}
            nodeTypes={NODE_TYPES}
            onInit={setFlowInstance}
            onNodeClick={handleFlowNodeClick}
            fitView
            fitViewOptions={{ padding: 0.08 }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            panOnDrag
            zoomOnPinch
            zoomOnScroll
            zoomOnDoubleClick={false}
            proOptions={{ hideAttribution: true }}
            className="h-full w-full bg-transparent"
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1.25}
              color="#cbd5e1"
            />
          </ReactFlow>
        </div>

        {activeNode && details && nodeState ? (
          <div className="pointer-events-none absolute inset-0">
            <div
              className={[
                "absolute inset-y-0 right-0 z-20 w-full max-w-[430px] transform transition-transform duration-200 ease-out",
                panelOpen ? "translate-x-0" : "translate-x-full",
              ].join(" ")}
            >
              <NodeDetailPanel
                node={activeNode}
                details={details}
                state={nodeState}
                onClose={() => {
                  setSelectedNodeId(null);
                }}
                onStartLesson={() => {
                  void handleStartLesson();
                }}
                lessonLaunchError={lessonLaunchError}
                isLaunchingLesson={isLaunchingLesson}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
