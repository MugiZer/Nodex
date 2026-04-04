"use client";

import type { Edge } from "@/lib/types";
import { edgeEndpoints, type GraphLayoutNode } from "@/lib/domain/graph-ui";
import { formatLessonTitleForDisplay } from "@/lib/lesson-title-display";

type GraphCanvasProps = {
  nodes: GraphLayoutNode[];
  edges: Edge[];
  onSelectNode: (nodeId: string) => void;
  selectedNodeId: string | null;
};

const STATE_STYLES: Record<
  GraphLayoutNode["state"],
  { border: string; background: string; text: string }
> = {
  locked: {
    border: "border-zinc-300",
    background: "bg-zinc-100",
    text: "text-zinc-500",
  },
  available: {
    border: "border-sky-400",
    background: "bg-sky-50",
    text: "text-sky-900",
  },
  recommended: {
    border: "border-amber-400",
    background: "bg-amber-50",
    text: "text-amber-900",
  },
  completed: {
    border: "border-emerald-400",
    background: "bg-emerald-50",
    text: "text-emerald-900",
  },
  active: {
    border: "border-zinc-950",
    background: "bg-zinc-950",
    text: "text-white",
  },
};

function edgeClassName(type: Edge["type"]): string {
  return type === "hard" ? "stroke-zinc-800" : "stroke-zinc-300";
}

export function GraphCanvas({
  nodes,
  edges,
  onSelectNode,
  selectedNodeId,
}: GraphCanvasProps) {
  const width = Math.max(920, Math.max(...nodes.map((node) => node.x)) + 240);
  const height = Math.max(560, Math.max(...nodes.map((node) => node.y)) + 120);

  return (
    <div className="overflow-auto rounded-3xl border border-zinc-200 bg-white shadow-sm">
      <div className="relative" style={{ width, height }}>
        <svg
          className="absolute inset-0"
          width={width}
          height={height}
          aria-hidden="true"
        >
          {edges.map((edge) => {
            const endpoints = edgeEndpoints(nodes, edge);
            if (!endpoints) {
              return null;
            }

            return (
              <line
                key={`${edge.from_node_id}-${edge.to_node_id}-${edge.type}`}
                x1={endpoints.x1}
                y1={endpoints.y1}
                x2={endpoints.x2}
                y2={endpoints.y2}
                className={edgeClassName(edge.type)}
                strokeWidth={edge.type === "hard" ? 3 : 2}
                style={edge.type === "soft" ? { strokeDasharray: "6 6" } : undefined}
              />
            );
          })}
        </svg>

        {nodes.map((node) => {
          const styles = STATE_STYLES[node.state];
          const isSelected = selectedNodeId === node.id;

          return (
            <button
              key={node.id}
              type="button"
              onClick={() => onSelectNode(node.id)}
              className={[
                "absolute w-52 rounded-2xl border px-4 py-3 text-left shadow-sm transition",
                styles.border,
                styles.background,
                styles.text,
                isSelected ? "ring-2 ring-zinc-950 ring-offset-2" : "",
                node.state === "locked" ? "cursor-not-allowed opacity-70" : "cursor-pointer",
              ].join(" ")}
              style={{ left: node.x, top: node.y }}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold leading-5">
                  {formatLessonTitleForDisplay(node.title)}
                </h3>
                <span className="rounded-full border border-current px-2 py-0.5 text-[10px] uppercase tracking-[0.2em]">
                  {node.state}
                </span>
              </div>
              <p className="mt-2 text-xs opacity-80">Position {node.position}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
