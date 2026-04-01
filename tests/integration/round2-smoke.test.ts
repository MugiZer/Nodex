import { randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { computeAvailableNodeIds } from "@/lib/domain/progress";
import { loadGraphPayload } from "@/lib/server/graph-read";
import { writeProgressAttempt } from "@/lib/server/progress-write";
import { createSupabaseServiceRoleClient } from "@/lib/supabase";
import type { ProgressWriteRequest } from "@/lib/types";

const hasSmokeEnv =
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

describe("Round 2 local db smoke", () => {
  const smokeTest = hasSmokeEnv ? it : it.skip;

  beforeAll(() => {
    if (!hasSmokeEnv) {
      console.warn("Skipping Round 2 smoke because Supabase env is not configured.");
    }
  });

  smokeTest(
    "creates, reads, and updates a temporary graph snapshot",
    async () => {
      const client = createSupabaseServiceRoleClient();
      const graphId = randomUUID();
      const node1Id = randomUUID();
      const node2Id = randomUUID();
      const userId = randomUUID();
      const createdAt = new Date().toISOString();

      try {
        const { error: graphInsertError } = await client.from("graphs").insert({
          id: graphId,
          title: "Smoke Graph",
          subject: "mathematics",
          topic: "smoke_graph",
          description:
            "Smoke Graph is the study of a temporary test graph. It encompasses one prerequisite node, one dependent node, and a single hard edge. It assumes prior knowledge of nothing beyond the test contract and serves as a foundation for smoke verification. Within mathematics, it is typically encountered at the introductory level.",
          version: 1,
          flagged_for_review: false,
          created_at: createdAt,
        });

        expect(graphInsertError).toBeNull();

        const { error: nodeInsertError } = await client.from("nodes").insert([
          {
            id: node1Id,
            graph_id: graphId,
            graph_version: 1,
            title: "Smoke Prerequisite",
            lesson_text: "Prerequisite lesson text.",
            static_diagram: "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
            p5_code: "",
            visual_verified: false,
            quiz_json: [
              {
                question: "Q1",
                options: ["A", "B", "C", "D"],
                correct_index: 1,
                explanation: "A",
              },
              {
                question: "Q2",
                options: ["A", "B", "C", "D"],
                correct_index: 1,
                explanation: "B",
              },
              {
                question: "Q3",
                options: ["A", "B", "C", "D"],
                correct_index: 1,
                explanation: "C",
              },
            ],
            diagnostic_questions: [
              {
                question: "Diag 1",
                options: ["A", "B", "C", "D"],
                correct_index: 1,
                difficulty_order: 1,
                node_id: node1Id,
              },
            ],
            position: 0,
            attempt_count: 0,
            pass_count: 0,
          },
          {
            id: node2Id,
            graph_id: graphId,
            graph_version: 1,
            title: "Smoke Dependent",
            lesson_text: "Dependent lesson text.",
            static_diagram: "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
            p5_code: "",
            visual_verified: false,
            quiz_json: [
              {
                question: "Q1",
                options: ["A", "B", "C", "D"],
                correct_index: 1,
                explanation: "A",
              },
              {
                question: "Q2",
                options: ["A", "B", "C", "D"],
                correct_index: 1,
                explanation: "B",
              },
              {
                question: "Q3",
                options: ["A", "B", "C", "D"],
                correct_index: 1,
                explanation: "C",
              },
            ],
            diagnostic_questions: [
              {
                question: "Diag 2",
                options: ["A", "B", "C", "D"],
                correct_index: 1,
                difficulty_order: 2,
                node_id: node2Id,
              },
            ],
            position: 1,
            attempt_count: 0,
            pass_count: 0,
          },
        ]);

        expect(nodeInsertError).toBeNull();

        const { error: edgeInsertError } = await client.from("edges").insert({
          from_node_id: node1Id,
          to_node_id: node2Id,
          type: "hard",
        });

        expect(edgeInsertError).toBeNull();

        const readBefore = await loadGraphPayload(graphId, userId, {
          createServiceClient: () => client,
        });

        expect(readBefore.graph.id).toBe(graphId);
        expect(readBefore.progress).toHaveLength(0);

        const progressRequest: ProgressWriteRequest = {
          graph_id: graphId,
          node_id: node1Id,
          score: 2,
          timestamp: "2026-04-01T12:20:00.000Z",
        };

        const writeResult = await writeProgressAttempt(progressRequest, userId, {
          createServiceClient: () => client,
        });

        expect(writeResult.progress.completed).toBe(true);
        expect(writeResult.available_node_ids).toEqual(
          expect.arrayContaining([node1Id, node2Id]),
        );

        const readAfter = await loadGraphPayload(graphId, userId, {
          createServiceClient: () => client,
        });

        const availableNodeIds = computeAvailableNodeIds(
          readAfter.nodes,
          readAfter.edges,
          readAfter.progress,
        );

        expect(availableNodeIds).toEqual(expect.arrayContaining([node1Id, node2Id]));
        expect(readAfter.progress).toHaveLength(1);
      } finally {
        await client.from("user_progress").delete().eq("user_id", userId);
        await client.from("edges").delete().in("from_node_id", [node1Id, node2Id]);
        await client.from("nodes").delete().in("id", [node1Id, node2Id]);
        await client.from("graphs").delete().eq("id", graphId);
      }
    },
  );
});
