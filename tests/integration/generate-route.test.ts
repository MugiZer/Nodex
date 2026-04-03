import { describe, expect, it, vi } from "vitest";

import { handleGenerateRequest } from "@/app/api/generate/route";
import { ApiError } from "@/lib/errors";
import { createRequestLogContext } from "@/lib/logging";
import { runGenerationPipeline } from "@/lib/server/generation/orchestrator";
import { computeStageTimeout } from "@/lib/server/generation/timeout-model";
import type { CanonicalizeModelSuccessDraft } from "@/lib/types";

import {
  DAY2_DIAGNOSTIC_NODES,
  DAY2_GRAPH_DRAFT,
  DAY2_LESSON_NODES,
  DAY2_VISUAL_NODES,
} from "../harness/day2-generation";

function createGraphVersionSelectBuilder(version = 0) {
  const builder = {
    select() {
      return builder;
    },
    eq() {
      return builder;
    },
    order() {
      return builder;
    },
    limit() {
      return Promise.resolve({
        data: version > 0 ? [{ version }] : [],
        error: null,
      });
    },
  };

  return builder;
}

function createStoreClient(graphId = "99999999-9999-4999-8999-999999999999") {
  const rpc = vi.fn().mockResolvedValue({
    data: [{ graph_id: graphId }],
    error: null,
  });

  return {
    client: {
      from(table: string) {
        if (table === "graphs") {
          return createGraphVersionSelectBuilder();
        }

        throw new Error(`Unexpected table access in test store client: ${table}`);
      },
      rpc,
    },
    rpc,
  };
}

function createCanonicalizeDraft(
  overrides: Partial<CanonicalizeModelSuccessDraft> = {},
): CanonicalizeModelSuccessDraft {
  return {
    subject: "mathematics",
    topic: "Trigonometry",
    scope_summary:
      "the relationships between angles and side lengths in triangles, extending to periodic functions on the unit circle",
    core_concepts: [
      "sine",
      "cosine",
      "tangent",
      "trigonometric identities",
      "laws of sines and cosines",
      "radian measure",
      "graphing patterns",
    ],
    prerequisites: ["algebra", "Euclidean geometry"],
    downstream_topics: ["calculus", "physics", "statistics"],
    level: "intermediate",
    ...overrides,
  };
}

function createStageDependencies() {
  const canonicalizeDraft = createCanonicalizeDraft();

  return {
    callModel: async () => canonicalizeDraft,
    graphGeneratorDependencies: {
      callModel: async () => DAY2_GRAPH_DRAFT,
    },
    structureValidatorDependencies: {
      callModel: async () => ({ valid: true, issues: [] }),
    },
    curriculumValidatorDependencies: {
      callModel: async () => ({ valid: true, issues: [] }),
    },
    reconcilerDependencies: {
      callModel: async () => ({
        nodes: DAY2_GRAPH_DRAFT.nodes,
        edges: DAY2_GRAPH_DRAFT.edges,
        resolution_summary: [],
      }),
    },
    incrementalEnrichmentDependencies: {
      lessonDependencies: {
        callModel: async () => ({
          lesson_text: DAY2_LESSON_NODES[0]!.lesson_text,
          static_diagram: DAY2_LESSON_NODES[0]!.static_diagram,
          quiz_json: DAY2_LESSON_NODES[0]!.quiz_json as [typeof DAY2_LESSON_NODES[0]["quiz_json"][number], typeof DAY2_LESSON_NODES[0]["quiz_json"][number], typeof DAY2_LESSON_NODES[0]["quiz_json"][number]],
        }),
      },
      diagnosticDependencies: {
        callModel: async () => ({
          diagnostic_questions: DAY2_DIAGNOSTIC_NODES[0]!.diagnostic_questions,
        }),
      },
      visualDependencies: {
        callModel: async () => ({
          p5_code: DAY2_VISUAL_NODES[0]!.p5_code,
          visual_verified: DAY2_VISUAL_NODES[0]!.visual_verified,
        }),
      },
    },
    triggerEnrichment: vi.fn(),
  };
}

function replaceNodeTitle(
  nodeId: string,
  title: string,
): typeof DAY2_GRAPH_DRAFT.nodes {
  return DAY2_GRAPH_DRAFT.nodes.map((node) =>
    node.id === nodeId
      ? {
          ...node,
          title,
        }
      : node,
  );
}

describe("day 2 generate orchestration", () => {
  it("short-circuits on a retrieval cache hit", async () => {
    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to learn trigonometry" }),
      }),
      {
        callModel: async () => createCanonicalizeDraft(),
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [
          {
            id: "77777777-7777-4777-8777-777777777777",
            similarity: 0.94,
            flagged_for_review: false,
            version: 2,
            created_at: "2026-04-01T00:00:00.000Z",
          },
        ],
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      graph_id: "77777777-7777-4777-8777-777777777777",
      cached: true,
    });
  });

  it("runs the full pipeline and stores a generated graph on a miss", async () => {
    const store = createStoreClient();
    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to learn trigonometry" }),
      }),
      {
        ...createStageDependencies(),
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [],
        createServiceClient: () => store.client as never,
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      graph_id: "99999999-9999-4999-8999-999999999999",
      cached: false,
    });
    expect(store.rpc).toHaveBeenCalledTimes(1);
  });

  it("continues generation when the curriculum validator times out", async () => {
    const store = createStoreClient();
    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to learn trigonometry" }),
      }),
      {
        ...createStageDependencies(),
        curriculumValidatorDependencies: {
          callModel: async () => {
            throw new ApiError(
              "UPSTREAM_TIMEOUT",
              "curriculum_validate timed out after 12000ms.",
              504,
            );
          },
        },
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [],
        createServiceClient: () => store.client as never,
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      graph_id: "99999999-9999-4999-8999-999999999999",
      cached: false,
    });
    expect(store.rpc).toHaveBeenCalledTimes(1);
  });

  it("records detached curriculum failures without blocking the generate route", async () => {
    const store = createStoreClient();
    let curriculumCalls = 0;
    const persistAuditResult = vi.fn(async () => undefined);

    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to learn trigonometry" }),
      }),
      {
        ...createStageDependencies(),
        curriculumValidatorDependencies: {
          callModel: async () => {
            curriculumCalls += 1;
            return {
              valid: true,
            } as never;
          },
        },
        curriculumAuditDependencies: {
          runInTests: true,
          persistAuditResult,
        },
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [],
        createServiceClient: () => store.client as never,
      },
    );

    expect(response.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(curriculumCalls).toBe(1);
    expect(persistAuditResult).toHaveBeenCalledTimes(1);
    const firstPersistedAudit = persistAuditResult.mock.calls.at(0)?.at(0);
    expect(firstPersistedAudit).toMatchObject({
      audit_status: "skipped_contract_failure",
      outcome_bucket: "skipped_contract_failure",
      failure_category: "llm_contract_violation",
      async_audit: true,
    });
    expect(store.rpc).toHaveBeenCalledTimes(1);
  });

  it("applies local canonicalize normalization without needing repair", async () => {
    const canonicalizeModes: string[] = [];

    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to learn trigonometry" }),
      }),
      {
        callModel: async ({ mode }) => {
          canonicalizeModes.push(mode);
          return createCanonicalizeDraft({
            topic: " Trigonometry Foundations ",
            core_concepts: [
              " tangent ",
              "cosine.",
              "sine",
              "graphing patterns",
              "laws of sines and cosines",
              "radian measure",
              "trigonometric identities",
              "sine",
            ],
            prerequisites: [" Euclidean geometry ", "algebra."],
            downstream_topics: [" physics ", "calculus.", "statistics "],
          });
        },
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [
          {
            id: "77777777-7777-4777-8777-777777777777",
            similarity: 0.91,
            flagged_for_review: false,
            version: 2,
            created_at: "2026-04-01T00:00:00.000Z",
          },
        ],
      },
    );

    expect(response.status).toBe(200);
    expect(canonicalizeModes).toEqual(["draft"]);
  });

  it("uses grounded inventory matching for deterministic broad starter prompts", async () => {
    const callModel = vi.fn();

    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to learn calculus" }),
      }),
      {
        callModel,
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [
          {
            id: "77777777-7777-4777-8777-777777777777",
            similarity: 0.93,
            flagged_for_review: false,
            version: 2,
            created_at: "2026-04-01T00:00:00.000Z",
          },
        ],
      },
    );

    expect(response.status).toBe(200);
    expect(callModel).not.toHaveBeenCalled();
  });

  it("uses one targeted repair call when the first canonical draft is underspecified", async () => {
    const canonicalizeModes: string[] = [];

    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to learn trigonometry" }),
      }),
      {
        callModel: async ({ mode }) => {
          canonicalizeModes.push(mode);
          if (mode === "draft") {
            return createCanonicalizeDraft({
              core_concepts: ["sine", "sine", "cosine"],
            });
          }

          return createCanonicalizeDraft();
        },
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [
          {
            id: "77777777-7777-4777-8777-777777777777",
            similarity: 0.92,
            flagged_for_review: false,
            version: 2,
            created_at: "2026-04-01T00:00:00.000Z",
          },
        ],
      },
    );

    expect(response.status).toBe(200);
    expect(canonicalizeModes).toEqual(["draft", "repair"]);
  });

  it("stops immediately for non-learning prompts", async () => {
    const embedDescription = vi.fn();

    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "Tell me a joke" }),
      }),
      {
        callModel: async () => ({ error: "NOT_A_LEARNING_REQUEST" as const }),
        embedDescription,
      },
    );

    expect(response.status).toBe(400);
    expect(embedDescription).not.toHaveBeenCalled();
  });

  it("fails before retrieve and store when canonicalize cannot be repaired", async () => {
    const store = createStoreClient();
    const embedDescription = vi.fn();
    const searchRetrievalCandidates = vi.fn();
    const context = createRequestLogContext("test generate");

    await expect(
      runGenerationPipeline("I want to learn trigonometry", context, {
        ...createStageDependencies(),
        callModel: async () =>
          createCanonicalizeDraft({
            core_concepts: ["sine", "sine", "cosine"],
            prerequisites: ["algebra"],
            downstream_topics: ["physics", "statistics", "calculus"],
          }),
        embedDescription,
        searchRetrievalCandidates,
        createServiceClient: () => store.client as never,
      }),
    ).rejects.toThrow();

    expect(embedDescription).not.toHaveBeenCalled();
    expect(searchRetrievalCandidates).not.toHaveBeenCalled();
    expect(store.rpc).not.toHaveBeenCalled();
  });

  it("returns a graph_id before incremental enrichment finishes", async () => {
    const store = createStoreClient();
    let releaseTrigger: (() => void) | null = null;
    const triggerEnrichment = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseTrigger = resolve;
        }),
    );

    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to learn trigonometry" }),
      }),
      {
        ...createStageDependencies(),
        triggerEnrichment,
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [],
        createServiceClient: () => store.client as never,
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      graph_id: "99999999-9999-4999-8999-999999999999",
      cached: false,
    });
    expect(store.rpc).toHaveBeenCalledTimes(1);
    expect(triggerEnrichment).toHaveBeenCalledTimes(1);
    const resumeEnrichment = releaseTrigger as (() => void) | null;
    if (resumeEnrichment !== null) {
      resumeEnrichment();
    }
  });

  it("stores skeleton nodes with pending status and null content fields", async () => {
    const store = createStoreClient();

    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to learn trigonometry" }),
      }),
      {
        ...createStageDependencies(),
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [],
        createServiceClient: () => store.client as never,
      },
    );

    expect(response.status).toBe(200);
    expect(store.rpc).toHaveBeenCalledTimes(1);
    const storeCallPayload = store.rpc.mock.calls[0]?.[1] as
      | {
          p_nodes?: Array<{
            lesson_status: string;
            lesson_text: null;
            static_diagram: null;
            p5_code: null;
            quiz_json: null;
            diagnostic_questions: null;
            visual_verified: boolean;
          }>;
        }
      | undefined;
    expect(storeCallPayload?.p_nodes).toBeDefined();
    expect(
      storeCallPayload?.p_nodes?.every(
        (node) =>
          node.lesson_status === "pending" &&
          node.lesson_text === null &&
          node.static_diagram === null &&
          node.p5_code === null &&
          node.quiz_json === null &&
          node.diagnostic_questions === null &&
          node.visual_verified === false,
      ),
    ).toBe(true);
  });

  it("stores the skeleton even when delegated enrichment fails later", async () => {
    const store = createStoreClient();
    const context = createRequestLogContext("test generate");

    await expect(
      runGenerationPipeline("I want to learn trigonometry", context, {
        ...createStageDependencies(),
        triggerEnrichment: async () => {
          throw new ApiError("DIAGNOSTICS_NODE_MISMATCH", "Bad node linkage.", 502);
        },
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [],
        createServiceClient: () => store.client as never,
      }),
    ).resolves.toMatchObject({
      response: {
        graph_id: "99999999-9999-4999-8999-999999999999",
        cached: false,
      },
    });

    expect(store.rpc).toHaveBeenCalledTimes(1);
  });

  it("fails before validators and store when graph generation returns an invalid proposal", async () => {
    const store = createStoreClient();
    const structureValidatorCall = vi.fn();
    const curriculumValidatorCall = vi.fn();
    const reconcilerCall = vi.fn();
    const context = createRequestLogContext("test generate");

    await expect(
      runGenerationPipeline("I want to learn trigonometry", context, {
        ...createStageDependencies(),
        graphGeneratorDependencies: {
          callModel: async () => ({
            nodes: DAY2_GRAPH_DRAFT.nodes,
            edges: [
              {
                from_node_id: "node_10",
                to_node_id: "node_1",
                type: "hard" as const,
              },
            ],
          }),
        },
        structureValidatorDependencies: {
          callModel: async () => {
            structureValidatorCall();
            return { valid: true, issues: [] };
          },
        },
        curriculumValidatorDependencies: {
          callModel: async () => {
            curriculumValidatorCall();
            return { valid: true, issues: [] };
          },
        },
        reconcilerDependencies: {
          callModel: async () => {
            reconcilerCall();
            return {
              nodes: DAY2_GRAPH_DRAFT.nodes,
              edges: DAY2_GRAPH_DRAFT.edges,
              resolution_summary: [],
            };
          },
        },
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [],
        createServiceClient: () => store.client as never,
      }),
    ).rejects.toThrow();

    expect(structureValidatorCall).not.toHaveBeenCalled();
    expect(curriculumValidatorCall).not.toHaveBeenCalled();
    expect(reconcilerCall).not.toHaveBeenCalled();
    expect(store.rpc).not.toHaveBeenCalled();
  });

  it("keeps curriculum detached and still completes the generate pipeline when reconcile can stay deterministic", async () => {
    const store = createStoreClient();
    const reconcilerModes: number[] = [];

    const invalidReconciledEdges = DAY2_GRAPH_DRAFT.edges.map((edge, index) =>
      index === 0
        ? {
            from_node_id: "node_10",
            to_node_id: "node_1",
            type: "hard" as const,
          }
        : edge,
    );

    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({
          prompt: "I want to learn the structure of the U.S. Constitution",
        }),
      }),
      {
        ...createStageDependencies(),
        curriculumValidatorDependencies: {
          callModel: async () => ({
            valid: false,
            issues: [
              {
                type: "incorrect_ordering" as const,
                severity: "minor" as const,
                nodes_involved: ["node_2"],
                missing_concept_title: null,
                description: "One concept appears slightly early.",
                suggested_fix: "Move the node later.",
                curriculum_basis:
                  "Most standard introductions sequence this concept after the foundation node.",
              },
            ],
          }),
        },
        reconcilerDependencies: {
          callModel: async () => {
            reconcilerModes.push(reconcilerModes.length + 1);
            if (reconcilerModes.length === 1) {
              return {
                nodes: DAY2_GRAPH_DRAFT.nodes,
                edges: invalidReconciledEdges,
                resolution_summary: [
                  {
                    issue_key: "curriculum:incorrect_ordering:node_2",
                    issue_source: "curriculum_validator" as const,
                    issue_description: "Initial repair returned one reversed hard edge.",
                    resolution_action: "Retry with corrected edge ordering.",
                  },
                ],
              };
            }

            return {
              nodes: DAY2_GRAPH_DRAFT.nodes,
              edges: DAY2_GRAPH_DRAFT.edges,
              resolution_summary: [
                {
                  issue_key: "curriculum:incorrect_ordering:node_2",
                  issue_source: "curriculum_validator" as const,
                  issue_description: "Corrected reversed hard edge ordering.",
                  resolution_action: "Restored forward prerequisite ordering.",
                },
              ],
            };
          },
        },
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [],
        createServiceClient: () => store.client as never,
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      graph_id: "99999999-9999-4999-8999-999999999999",
      cached: false,
    });
    expect(reconcilerModes).toEqual([]);
    expect(store.rpc).toHaveBeenCalledTimes(1);
  });

  it("returns a route-level boundary violation for arithmetic -> Arithmetic Basics", async () => {
    const store = createStoreClient();

    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to learn algebra" }),
      }),
      {
        ...createStageDependencies(),
        callModel: async () =>
          createCanonicalizeDraft({
            topic: "algebra",
            prerequisites: ["arithmetic"],
            downstream_topics: ["calculus", "physics", "statistics"],
          }),
        graphGeneratorDependencies: {
          callModel: async () => ({
            ...DAY2_GRAPH_DRAFT,
            nodes: replaceNodeTitle("node_1", "Arithmetic Basics"),
          }),
        },
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [],
        createServiceClient: () => store.client as never,
      },
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "GRAPH_BOUNDARY_VIOLATION",
      message:
        "reconcile failed deterministic validation: graph includes assumed prior knowledge as a node.",
      details: {
        node_id: "node_1",
        title: "Arithmetic Basics",
        prerequisite: "arithmetic",
      },
    });
    expect(store.rpc).not.toHaveBeenCalled();
  });

  it("allows the top-level generate route for functions and their graphs -> Graphs of Tangent and Reciprocal Functions", async () => {
    const store = createStoreClient();

    const response = await handleGenerateRequest(
      new Request("http://localhost/api/generate", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to learn trigonometry" }),
      }),
      {
        ...createStageDependencies(),
        callModel: async () =>
          createCanonicalizeDraft({
            prerequisites: ["functions and their graphs"],
          }),
        graphGeneratorDependencies: {
          callModel: async () => ({
            ...DAY2_GRAPH_DRAFT,
            nodes: replaceNodeTitle(
              "node_8",
              "Graphs of Tangent and Reciprocal Functions",
            ),
          }),
        },
        embedDescription: async () => [1, 0, 0],
        searchRetrievalCandidates: async () => [],
        createServiceClient: () => store.client as never,
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      graph_id: "99999999-9999-4999-8999-999999999999",
      cached: false,
    });
    expect(store.rpc).toHaveBeenCalledTimes(1);
  });
});
