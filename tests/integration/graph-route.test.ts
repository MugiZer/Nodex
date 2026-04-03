import { describe, expect, it } from "vitest";

import { vi } from "vitest";
import { handleGraphReadRequest } from "@/app/api/graph/[id]/route";
import { handleGraphGenerateRequest } from "@/app/api/generate/graph/route";
import type { GenerationEdgeDraft, GenerationNodeDraft } from "@/lib/types";

import { DAY2_GRAPH_DRAFT } from "../harness/day2-generation";
import { TEST_GRAPH_ID, TEST_USER_ID, baseGraphPayloadFixture } from "../harness/fixtures";

function buildEdgeMisclassificationRepairDraft() {
  return {
    nodes: DAY2_GRAPH_DRAFT.nodes,
    edges: [
      ...DAY2_GRAPH_DRAFT.edges,
      {
        from_node_id: "node_2",
        to_node_id: "node_3",
        type: "hard" as const,
      },
    ],
  };
}

function buildIndependentFanInDraft() {
  return {
    nodes: [
      { id: "node_1", title: "Angle Measurement", position: 0 },
      { id: "node_2", title: "Right Triangle Ratios", position: 0 },
      { id: "node_3", title: "Unit Circle Basics", position: 0 },
      { id: "node_4", title: "Sine Function", position: 1 },
      { id: "node_5", title: "Cosine Function", position: 1 },
      { id: "node_6", title: "Tangent Function", position: 1 },
      { id: "node_7", title: "Sine Identities", position: 2 },
      { id: "node_8", title: "Cosine Identities", position: 2 },
      { id: "node_9", title: "Tangent Identities", position: 2 },
      { id: "node_10", title: "Trig Equations", position: 3 },
    ],
    edges: [
      { from_node_id: "node_1", to_node_id: "node_4", type: "hard" as const },
      { from_node_id: "node_2", to_node_id: "node_5", type: "hard" as const },
      { from_node_id: "node_3", to_node_id: "node_6", type: "hard" as const },
      { from_node_id: "node_4", to_node_id: "node_7", type: "hard" as const },
      { from_node_id: "node_5", to_node_id: "node_8", type: "hard" as const },
      { from_node_id: "node_6", to_node_id: "node_9", type: "hard" as const },
      { from_node_id: "node_7", to_node_id: "node_10", type: "hard" as const },
      { from_node_id: "node_8", to_node_id: "node_10", type: "hard" as const },
      { from_node_id: "node_9", to_node_id: "node_10", type: "hard" as const },
    ],
  };
}

describe("graph route", () => {
  it("returns mixed ready and pending lesson_status values in graph payloads", async () => {
    const mixedPayload = {
      ...baseGraphPayloadFixture,
      nodes: baseGraphPayloadFixture.nodes.map((node, index) =>
        index === 0
          ? node
          : {
              ...node,
              lesson_text: null,
              static_diagram: null,
              p5_code: null,
              quiz_json: null,
              diagnostic_questions: null,
              lesson_status: "pending" as const,
            },
      ),
    };

    const response = await handleGraphReadRequest(
      new Request(`http://localhost/api/graph/${TEST_GRAPH_ID}`),
      { params: Promise.resolve({ id: TEST_GRAPH_ID }) },
      {
        resolveAuthenticatedUserId: async () => TEST_USER_ID,
        fetchGraphPayload: async () => mixedPayload,
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      nodes: expect.arrayContaining([
        expect.objectContaining({ lesson_status: "ready" }),
        expect.objectContaining({
          lesson_status: "pending",
          lesson_text: null,
          static_diagram: null,
          quiz_json: null,
          diagnostic_questions: null,
        }),
      ]),
    });
  });

  it("lets polling observe pending to ready transitions without changing payload shape", async () => {
    let callCount = 0;

    const responsePending = await handleGraphReadRequest(
      new Request(`http://localhost/api/graph/${TEST_GRAPH_ID}`),
      { params: Promise.resolve({ id: TEST_GRAPH_ID }) },
      {
        resolveAuthenticatedUserId: async () => TEST_USER_ID,
        fetchGraphPayload: async () => {
          callCount += 1;
          if (callCount === 1) {
            return {
              ...baseGraphPayloadFixture,
              nodes: baseGraphPayloadFixture.nodes.map((node, index) =>
                index === 1
                  ? {
                      ...node,
                      lesson_text: null,
                      static_diagram: null,
                      p5_code: null,
                      quiz_json: null,
                      diagnostic_questions: null,
                      lesson_status: "pending" as const,
                    }
                  : node,
              ),
            };
          }

          return baseGraphPayloadFixture;
        },
      },
    );

    const responseReady = await handleGraphReadRequest(
      new Request(`http://localhost/api/graph/${TEST_GRAPH_ID}`),
      { params: Promise.resolve({ id: TEST_GRAPH_ID }) },
      {
        resolveAuthenticatedUserId: async () => TEST_USER_ID,
        fetchGraphPayload: async () => baseGraphPayloadFixture,
      },
    );

    await expect(responsePending.json()).resolves.toMatchObject({
      nodes: expect.arrayContaining([
        expect.objectContaining({
          id: baseGraphPayloadFixture.nodes[1]?.id,
          lesson_status: "pending",
        }),
      ]),
    });
    await expect(responseReady.json()).resolves.toMatchObject({
      nodes: expect.arrayContaining([
        expect.objectContaining({
          id: baseGraphPayloadFixture.nodes[1]?.id,
          lesson_status: "ready",
        }),
      ]),
    });
  });

  it("allows direct debug requests without boundary fields by skipping boundary validation", async () => {
    const response = await handleGraphGenerateRequest(
      new Request("http://localhost/api/generate/graph?debug=1", {
        method: "POST",
        body: JSON.stringify({
          subject: "mathematics",
          topic: "algebra",
          description:
            "Algebra is the study of symbols and the rules for manipulating them. It includes expressions, equations, functions, and factoring. It assumes prior knowledge of arithmetic and supports later study in calculus and physics. Within mathematics, it is typically encountered at the introductory level.",
        }),
      }),
      {
        graphGeneratorDependencies: {
          callModel: async () => DAY2_GRAPH_DRAFT,
        },
        curriculumValidatorDependencies: {
          callModel: async () => ({ valid: true, issues: [] }),
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      nodes: expect.any(Array),
      edges: expect.any(Array),
      debug: {
        request_id: expect.any(String),
        audit_status: "disabled_async",
        curriculum_audit_phase: "synchronous_placeholder",
        curriculum: {
          valid: true,
          issues: [],
        },
        reconciliation: {
          repair_mode: "deterministic_only",
        },
      },
    });
  });

  it("uses explicit boundary fields when provided on direct graph-route requests", async () => {
    const response = await handleGraphGenerateRequest(
      new Request("http://localhost/api/generate/graph?debug=1", {
        method: "POST",
        body: JSON.stringify({
          subject: "mathematics",
          topic: "algebra",
          description:
            "Algebra is the study of symbols and the rules for manipulating them. It includes expressions, equations, functions, and factoring. It assumes prior knowledge of arithmetic and supports later study in calculus and physics. Within mathematics, it is typically encountered at the introductory level.",
          prerequisites: ["arithmetic"],
          downstream_topics: ["calculus", "physics", "statistics"],
        }),
      }),
      {
        graphGeneratorDependencies: {
          callModel: async () => DAY2_GRAPH_DRAFT,
        },
        curriculumValidatorDependencies: {
          callModel: async () => ({ valid: true, issues: [] }),
        },
      },
    );

    expect(response.status).toBe(200);
  });

  it("returns reconciled nodes and edges for a valid graph request", async () => {
    const response = await handleGraphGenerateRequest(
      new Request("http://localhost/api/generate/graph", {
        method: "POST",
        body: JSON.stringify({
          subject: "philosophy",
          topic: "us_constitutional_structure",
          description:
            "U.S. Constitutional Structure is the study of the organization, articles, amendments, and foundational principles of the U.S. Constitution. It encompasses Articles of the Constitution, Separation of Powers, Checks and Balances, Federalism, The Bill of Rights, Constitutional Amendments, Enumerated vs Reserved Powers. It assumes prior knowledge of basic U.S. history, concept of government and law, understanding of democracy and serves as a foundation for constitutional law, civil liberties and rights, legislative process, judicial review, federalism and state governments, comparative constitutional systems. Within philosophy, it is typically encountered at the introductory level.",
        }),
      }),
      {
        graphGeneratorDependencies: {
          callModel: async () => DAY2_GRAPH_DRAFT,
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
      },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      nodes: GenerationNodeDraft[];
      edges: GenerationEdgeDraft[];
      debug?: unknown;
    };
    expect(body.edges).toEqual(DAY2_GRAPH_DRAFT.edges);
    expect(body.nodes).toHaveLength(DAY2_GRAPH_DRAFT.nodes.length);
    expect(body.debug).toBeUndefined();
    expect(body.nodes.some((node) => node.position === 0)).toBe(true);

    const positions = new Map<string, number>(
      body.nodes.map((node) => [node.id, node.position]),
    );

    for (const edge of body.edges.filter((entry) => entry.type === "hard")) {
      const fromPosition = positions.get(edge.from_node_id) ?? -1;
      const toPosition = positions.get(edge.to_node_id) ?? -1;
      expect(fromPosition).toBeLessThan(toPosition);
    }
  });

  it("returns debug metadata in development mode when debug=1", async () => {
    const response = await handleGraphGenerateRequest(
      new Request("http://localhost/api/generate/graph?debug=1", {
        method: "POST",
        body: JSON.stringify({
          subject: "philosophy",
          topic: "us_constitutional_structure",
          description:
            "U.S. Constitutional Structure is the study of the organization, articles, amendments, and foundational principles of the U.S. Constitution. It encompasses Articles of the Constitution, Separation of Powers, Checks and Balances, Federalism, The Bill of Rights, Constitutional Amendments, Enumerated vs Reserved Powers. It assumes prior knowledge of basic U.S. history, concept of government and law, understanding of democracy and serves as a foundation for constitutional law, civil liberties and rights, legislative process, judicial review, federalism and state governments, comparative constitutional systems. Within philosophy, it is typically encountered at the introductory level.",
        }),
      }),
      {
        graphGeneratorDependencies: {
          callModel: async () => DAY2_GRAPH_DRAFT,
        },
        curriculumValidatorDependencies: {
          callModel: async () => ({ valid: true, issues: [] }),
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      nodes: expect.any(Array),
      edges: expect.any(Array),
      debug: {
        request_id: expect.any(String),
        structure: { valid: true, issues: [] },
        curriculum: { valid: true, issues: [] },
        audit_status: "disabled_async",
        curriculum_audit_phase: "synchronous_placeholder",
        telemetry: {
          outcome_bucket: "deterministic_only_clean",
          repair_mode: "deterministic_only",
          curriculum_audit_status: "disabled_async",
          curriculum_outcome_bucket: "disabled_async",
          structure_issue_type_counts: {},
          structure_issue_key_counts: {},
          curriculum_issue_type_counts: {},
          curriculum_issue_key_counts: {},
          resolution_summary_issue_key_counts: {},
        },
        reconciliation: {
          resolution_summary: [],
          repair_mode: "deterministic_only",
        },
        timings: expect.objectContaining({
          graph_generate_ms: expect.any(Number),
          structure_validate_ms: expect.any(Number),
          curriculum_validate_ms: expect.any(Number),
          reconcile_ms: expect.any(Number),
          total_ms: expect.any(Number),
        }),
      },
    });
  });

  it("recomputes node positions deterministically when the model returns valid edges with bad positions", async () => {
    const badPositionNodes = DAY2_GRAPH_DRAFT.nodes.map((node, index) => ({
      ...node,
      position: DAY2_GRAPH_DRAFT.nodes.length - index,
    }));

    const response = await handleGraphGenerateRequest(
      new Request("http://localhost/api/generate/graph", {
        method: "POST",
        body: JSON.stringify({
          subject: "philosophy",
          topic: "us_constitutional_structure",
          description:
            "U.S. Constitutional Structure is the study of the organization, articles, amendments, and foundational principles of the U.S. Constitution. It encompasses Articles of the Constitution, Separation of Powers, Checks and Balances, Federalism, The Bill of Rights, Constitutional Amendments, Enumerated vs Reserved Powers. It assumes prior knowledge of basic U.S. history, concept of government and law, understanding of democracy and serves as a foundation for constitutional law, civil liberties and rights, legislative process, judicial review, federalism and state governments, comparative constitutional systems. Within philosophy, it is typically encountered at the introductory level.",
        }),
      }),
      {
        graphGeneratorDependencies: {
          callModel: async () => ({
            nodes: badPositionNodes,
            edges: DAY2_GRAPH_DRAFT.edges,
          }),
        },
        structureValidatorDependencies: {
          callModel: async () => ({ valid: true, issues: [] }),
        },
        curriculumValidatorDependencies: {
          callModel: async () => ({ valid: true, issues: [] }),
        },
        reconcilerDependencies: {
          callModel: async () => ({
            nodes: badPositionNodes,
            edges: DAY2_GRAPH_DRAFT.edges,
            resolution_summary: [],
          }),
        },
      },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      nodes: GenerationNodeDraft[];
      edges: GenerationEdgeDraft[];
    };
    expect(body.edges).toEqual(DAY2_GRAPH_DRAFT.edges);

    const positions = new Map<string, number>(
      body.nodes.map((node) => [node.id, node.position]),
    );

    for (const edge of body.edges.filter((entry) => entry.type === "hard")) {
      const fromPosition = positions.get(edge.from_node_id) ?? -1;
      const toPosition = positions.get(edge.to_node_id) ?? -1;
      expect(fromPosition).toBeLessThan(toPosition);
    }
  });

  it("defers curriculum validation out of the synchronous graph route", async () => {
    let structureCalls = 0;
    let curriculumCalls = 0;

    const response = await handleGraphGenerateRequest(
      new Request("http://localhost/api/generate/graph", {
        method: "POST",
        body: JSON.stringify({
          subject: "philosophy",
          topic: "us_constitutional_structure",
          description:
            "U.S. Constitutional Structure is the study of the organization, articles, amendments, and foundational principles of the U.S. Constitution. It encompasses Articles of the Constitution, Separation of Powers, Checks and Balances, Federalism, The Bill of Rights, Constitutional Amendments, Enumerated vs Reserved Powers. It assumes prior knowledge of basic U.S. history, concept of government and law, understanding of democracy and serves as a foundation for constitutional law, civil liberties and rights, legislative process, judicial review, federalism and state governments, comparative constitutional systems. Within philosophy, it is typically encountered at the introductory level.",
        }),
      }),
      {
        graphGeneratorDependencies: {
          callModel: async () => DAY2_GRAPH_DRAFT,
        },
        structureValidatorDependencies: {
          callModel: async () => {
            structureCalls += 1;
            return {
              valid: true,
              issues: [
                {
                  type: "redundant_edge" as const,
                  severity: "minor" as const,
                  nodes_involved: ["node_1", "node_2"],
                  description: "One edge is redundant.",
                  suggested_fix: "Remove the redundant edge.",
                },
              ],
            };
          },
        },
        curriculumValidatorDependencies: {
          callModel: async () => {
            curriculumCalls += 1;
            return {
              valid: true,
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
            };
          },
        },
        reconcilerDependencies: {
          callModel: async () => {
            throw new Error("reconciler LLM should not be called for deterministic repair");
          },
        },
      },
    );

    expect(response.status).toBe(200);
    expect(structureCalls).toBe(1);
    expect(curriculumCalls).toBe(0);
    await expect(response.json()).resolves.toMatchObject({
      nodes: expect.any(Array),
      edges: expect.any(Array),
    });
  });

  it("records a single detached curriculum contract failure without blocking route completion", async () => {
    let curriculumCalls = 0;
    const persistAuditResult = vi.fn(async () => undefined);

    const response = await handleGraphGenerateRequest(
      new Request("http://localhost/api/generate/graph?debug=1", {
        method: "POST",
        body: JSON.stringify({
          subject: "philosophy",
          topic: "us_constitutional_structure",
          description:
            "U.S. Constitutional Structure is the study of the organization, articles, amendments, and foundational principles of the U.S. Constitution. It encompasses Articles of the Constitution, Separation of Powers, Checks and Balances, Federalism, The Bill of Rights, Constitutional Amendments, Enumerated vs Reserved Powers. It assumes prior knowledge of basic U.S. history, concept of government and law, understanding of democracy and serves as a foundation for constitutional law, civil liberties and rights, legislative process, judicial review, federalism and state governments, comparative constitutional systems. Within philosophy, it is typically encountered at the introductory level.",
        }),
      }),
      {
        graphGeneratorDependencies: {
          callModel: async () => DAY2_GRAPH_DRAFT,
        },
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
      },
    );

    expect(response.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(curriculumCalls).toBe(1);
    expect(persistAuditResult).toHaveBeenCalledTimes(1);
    const firstPersistedAudit = persistAuditResult.mock.calls.at(0)?.at(0);
    expect(firstPersistedAudit).toMatchObject({
      audit_status: "skipped_contract_failure",
      outcome_bucket: "skipped_contract_failure",
      attempt_count: 1,
      failure_category: "llm_contract_violation",
      async_audit: true,
    });
    await expect(response.json()).resolves.toMatchObject({
      nodes: expect.any(Array),
      edges: expect.any(Array),
      debug: {
        request_id: expect.any(String),
        audit_status: "disabled_async",
        curriculum_audit_phase: "synchronous_placeholder",
      },
    });
  });

  it("rejects reconciled graphs that turn prerequisites into graph nodes when explicit boundaries are provided", async () => {
    const response = await handleGraphGenerateRequest(
      new Request("http://localhost/api/generate/graph", {
        method: "POST",
        body: JSON.stringify({
          subject: "mathematics",
          topic: "algebra",
          description:
            "Algebra is the study of symbols and the rules for manipulating them. It includes expressions, equations, functions, and factoring. It assumes prior knowledge of arithmetic and supports later study in calculus and physics. Within mathematics, it is typically encountered at the introductory level.",
          prerequisites: ["arithmetic"],
          downstream_topics: ["calculus", "physics", "statistics"],
        }),
      }),
      {
        graphGeneratorDependencies: {
          callModel: async () => ({
            ...DAY2_GRAPH_DRAFT,
            nodes: DAY2_GRAPH_DRAFT.nodes.map((node, index) =>
              index === 0
                ? {
                    ...node,
                    title: "Arithmetic Basics",
                  }
                : node,
            ),
          }),
        },
        curriculumValidatorDependencies: {
          callModel: async () => ({ valid: true, issues: [] }),
        },
      },
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: "GRAPH_BOUNDARY_VIOLATION",
    });
  });

  it("repairs the exact edge_misclassification fan-in locally without an LLM reconcile", async () => {
    const response = await handleGraphGenerateRequest(
      new Request("http://localhost/api/generate/graph?debug=1", {
        method: "POST",
        body: JSON.stringify({
          subject: "philosophy",
          topic: "us_constitutional_structure",
          description:
            "U.S. Constitutional Structure is the study of the organization, articles, amendments, and foundational principles of the U.S. Constitution. It encompasses Articles of the Constitution, Separation of Powers, Checks and Balances, Federalism, The Bill of Rights, Constitutional Amendments, Enumerated vs Reserved Powers. It assumes prior knowledge of basic U.S. history, concept of government and law, understanding of democracy and serves as a foundation for constitutional law, civil liberties and rights, legislative process, judicial review, federalism and state governments, comparative constitutional systems. Within philosophy, it is typically encountered at the introductory level.",
        }),
      }),
      {
        graphGeneratorDependencies: {
          callModel: async () => buildEdgeMisclassificationRepairDraft(),
        },
        reconcilerDependencies: {
          callModel: async () => {
            throw new Error("reconciler LLM should not be called for deterministic repair");
          },
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      debug: {
        request_id: expect.any(String),
        audit_status: "disabled_async",
        curriculum_audit_phase: "synchronous_placeholder",
        telemetry: {
          outcome_bucket: "deterministic_only_repaired",
          repair_mode: "deterministic_only_repaired",
          curriculum_audit_status: "disabled_async",
          curriculum_outcome_bucket: "disabled_async",
          structure_issue_type_counts: {
            edge_misclassification: 1,
          },
        },
        reconciliation: {
          repair_mode: "deterministic_only_repaired",
        },
      },
    });
  });

  it("records repair fallback telemetry when a capstone edge misclassification needs LLM recovery", async () => {
    let reconcileCalls = 0;
    const fanInDraft = buildIndependentFanInDraft();

    const response = await handleGraphGenerateRequest(
      new Request("http://localhost/api/generate/graph?debug=1", {
        method: "POST",
        body: JSON.stringify({
          subject: "philosophy",
          topic: "us_constitutional_structure",
          description:
            "U.S. Constitutional Structure is the study of the organization, articles, amendments, and foundational principles of the U.S. Constitution. It encompasses Articles of the Constitution, Separation of Powers, Checks and Balances, Federalism, The Bill of Rights, Constitutional Amendments, Enumerated vs Reserved Powers. It assumes prior knowledge of basic U.S. history, concept of government and law, understanding of democracy and serves as a foundation for constitutional law, civil liberties and rights, legislative process, judicial review, federalism and state governments, comparative constitutional systems. Within philosophy, it is typically encountered at the introductory level.",
        }),
      }),
      {
        graphGeneratorDependencies: {
          callModel: async () => fanInDraft,
        },
        reconcilerDependencies: {
          callModel: async () => {
            reconcileCalls += 1;

            if (reconcileCalls === 1) {
              return {
                nodes: fanInDraft.nodes,
                edges: fanInDraft.edges,
                resolution_summary: [],
              };
            }

            return {
              nodes: DAY2_GRAPH_DRAFT.nodes,
              edges: DAY2_GRAPH_DRAFT.edges,
              resolution_summary: [
                {
                  issue_key: "structure:edge_misclassification:node_10,node_7,node_8,node_9",
                  issue_source: "structure_validator" as const,
                  issue_description: "Shifted the graph into a valid shape after targeted repair.",
                  resolution_action: "Kept the graph stable after targeted repair.",
                },
              ],
            };
          },
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      debug: {
        telemetry: {
          repair_mode: "repair_fallback",
          outcome_bucket: "llm_reconcile_due_to_structure",
          curriculum_audit_status: "disabled_async",
          curriculum_outcome_bucket: "disabled_async",
          structure_issue_type_counts: {
            edge_misclassification: 1,
          },
        },
      },
    });
  });

  it("rejects reconciliation when resolution_summary does not cover remaining issue keys for a capstone repair", async () => {
    const fanInDraft = buildIndependentFanInDraft();

    const response = await handleGraphGenerateRequest(
      new Request("http://localhost/api/generate/graph", {
        method: "POST",
        body: JSON.stringify({
          subject: "philosophy",
          topic: "us_constitutional_structure",
          description:
            "U.S. Constitutional Structure is the study of the organization, articles, amendments, and foundational principles of the U.S. Constitution. It encompasses Articles of the Constitution, Separation of Powers, Checks and Balances, Federalism, The Bill of Rights, Constitutional Amendments, Enumerated vs Reserved Powers. It assumes prior knowledge of basic U.S. history, concept of government and law, understanding of democracy and serves as a foundation for constitutional law, civil liberties and rights, legislative process, judicial review, federalism and state governments, comparative constitutional systems. Within philosophy, it is typically encountered at the introductory level.",
        }),
      }),
      {
        graphGeneratorDependencies: {
          callModel: async () => fanInDraft,
        },
        reconcilerDependencies: {
          callModel: async () => ({
            nodes: DAY2_GRAPH_DRAFT.nodes,
            edges: DAY2_GRAPH_DRAFT.edges,
            resolution_summary: [
              {
                issue_key: "structure:edge_misclassification:node_1,node_2,node_3",
                issue_source: "structure_validator" as const,
                issue_description: "Claimed to resolve the wrong issue.",
                resolution_action: "No-op.",
              },
            ],
          }),
        },
      },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: "REPAIR_EXHAUSTED",
    });
  });
});
