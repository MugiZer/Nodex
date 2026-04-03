import { describe, expect, it } from "vitest";

import {
  apiErrorEnvelopeSchema,
  canonicalizeResolvedSuccessSchema,
  diagnosticNodeSchema,
  generationCurriculumIssueSchema,
  generationCurriculumAuditPhaseSchema,
  generationCurriculumAuditStatusSchema,
  generationCurriculumOutcomeBucketSchema,
  generationCurriculumValidationResultSchema,
  curriculumAuditRecordSchema,
  generationDiagnosticBundleSchema,
  generationExecutionPathSchema,
  generationFailureCategorySchema,
  generationGraphDraftSchema,
  generationLessonBundleSchema,
  generationLogEventSchema,
  generationLogLevelSchema,
  generationReconciledGraphSchema,
  generationResolutionSummaryEntrySchema,
  generationRunStateSchema,
  generationStageNameSchema,
  generationStoreEligibilitySchema,
  generationStructureIssueSchema,
  generationStructureValidationResultSchema,
  generationVisualBundleSchema,
  generateRequestSchema,
  generateResponseSchema,
  lessonNodeSchema,
  retrievalDecisionSchema,
  graphRouteDebugSchema,
  graphCurriculumAuditReadResponseSchema,
  storeRequestSchema,
  storeResponseSchema,
  visualNodeSchema,
} from "@/lib/schemas";
import { storeRouteRequestSchema } from "@/lib/server/generation/contracts";
import {
  appendGenerationLogEntry,
  createGenerationRunState,
  withCanonicalizedPrompt,
  withDiagnosticBundle,
  withFinalGraphId,
  withGeneratedGraphDraft,
  withGenerationExecutionPath,
  withLessonBundle,
  withReconciledGraph,
  withRetrievalDecision,
  withStoreEligibility,
  withValidatorOutputs,
  withVisualBundle,
} from "@/lib/generation/state";
import type {
  CanonicalizeResolvedSuccess,
  DiagnosticQuestion,
  Edge,
  GenerationCurriculumValidationResult,
  GenerationDiagnosticBundle,
  GenerationGraphDraft,
  GenerationLessonBundle,
  GenerationReconciledGraph,
  GenerationStoreEligibility,
  GenerationStructureValidationResult,
  GenerationVisualBundle,
  Graph,
  Node,
  RetrievalCandidate,
  RetrievalDecision,
  QuizItem,
  StoreRequest,
} from "@/lib/types";
import { resolveCanonicalizeDraft } from "@/lib/server/canonicalize-output";

const graphId = "11111111-1111-4111-8111-111111111111";
const persistedNodeIds = Array.from({ length: 10 }, (_, index) =>
  `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);
const draftNodeIds = Array.from({ length: 10 }, (_, index) => `node_${index + 1}`);

function makeQuiz(question: string, explanation: string): QuizItem {
  return {
    question,
    options: ["A", "B", "C", "D"],
    correct_index: 1,
    explanation,
  };
}

function makeDiagnosticQuestion(nodeId: string, difficulty: number): DiagnosticQuestion {
  return {
    question: `Diagnostic for ${nodeId}`,
    options: ["A", "B", "C", "D"],
    correct_index: 2,
    difficulty_order: difficulty,
    node_id: nodeId,
  };
}

function makeBaseNode(index: number): Node {
  return {
    id: persistedNodeIds[index - 1] ?? persistedNodeIds[0],
    graph_id: graphId,
    graph_version: 1,
    title: `Node ${index}`,
    lesson_text: null,
    static_diagram: null,
    p5_code: null,
    visual_verified: false,
    quiz_json: null,
    diagnostic_questions: null,
    lesson_status: "pending",
    position: index - 1,
    attempt_count: 0,
    pass_count: 0,
  };
}

function makeLessonBundle(): GenerationLessonBundle {
  return {
    nodes: persistedNodeIds.map((nodeId, index) => ({
      ...makeBaseNode(index + 1),
      id: nodeId,
      lesson_text: `Lesson ${index + 1}`,
      static_diagram: `<svg data-node="${index + 1}"></svg>`,
      quiz_json: [
        makeQuiz(`Question ${index + 1}.1`, "Because 1"),
        makeQuiz(`Question ${index + 1}.2`, "Because 2"),
        makeQuiz(`Question ${index + 1}.3`, "Because 3"),
      ],
    })),
  };
}

function makeDiagnosticBundle(): GenerationDiagnosticBundle["nodes"] {
  const lessonNodes = makeLessonBundle().nodes;

  return persistedNodeIds.map((nodeId, index) => ({
    ...lessonNodes[index]!,
    diagnostic_questions: [makeDiagnosticQuestion(nodeId, index + 1)],
  }));
}

function makeVisualBundle(): GenerationVisualBundle {
  const lessonNodes = makeLessonBundle().nodes;

  return {
    nodes: persistedNodeIds.map((nodeId, index) => ({
      ...lessonNodes[index]!,
      id: nodeId,
      p5_code: `function setup(){createCanvas(480,320);}function draw(){}`,
      visual_verified: index % 2 === 0,
    })),
  };
}

describe("generation contracts", () => {
  it("creates and validates a generation run state", () => {
    const initialState = createGenerationRunState({
      requestId: "request-1",
      prompt: "I want to learn algebra",
      requestRoute: "POST /api/generate",
      startedAt: "2026-04-01T12:00:00.000Z",
    });

    expect(initialState.request_id).toBe("request-1");
    expect(initialState.prompt_hash).toHaveLength(12);
    expect(() => generationRunStateSchema.parse(initialState)).not.toThrow();

    const canonicalized: CanonicalizeResolvedSuccess = resolveCanonicalizeDraft({
      subject: "mathematics",
      topic: "Algebra",
      scope_summary:
        "symbols, expressions, and the rules for manipulating abstract quantities",
      core_concepts: [
        "expressions",
        "equations",
        "functions",
        "inequalities",
        "polynomials",
        "factoring",
        "systems of equations",
      ],
      prerequisites: ["arithmetic"],
      downstream_topics: ["calculus", "discrete mathematics", "physics"],
      level: "introductory",
    });

    const retrievalCandidates: RetrievalCandidate[] = [
      {
        id: graphId,
        similarity: 0.92,
        flagged_for_review: false,
        version: 1,
        created_at: "2026-04-01T11:59:00.000Z",
      },
    ];

    const retrievalDecision: RetrievalDecision = {
      graph_id: graphId,
      reason: "usable_unflagged_match",
      candidate: retrievalCandidates[0]!,
    };

    const graphDraft: GenerationGraphDraft = {
      nodes: draftNodeIds.map((nodeId, index) => ({
        id: nodeId,
        title: `Node ${index + 1}`,
        position: index,
      })),
      edges: draftNodeIds.slice(1).map((nodeId, index) => ({
        from_node_id: draftNodeIds[index]!,
        to_node_id: nodeId,
        type: "hard",
      })) as Edge[],
    };

    const structureResult: GenerationStructureValidationResult = {
      valid: true,
      issues: [],
    };

    const curriculumResult: GenerationCurriculumValidationResult = {
      valid: true,
      issues: [],
    };

    const reconciledGraph: GenerationReconciledGraph = {
      ...graphDraft,
      resolution_summary: [],
    };

    const lessonBundle = makeLessonBundle();
    const diagnosticBundle = { nodes: makeDiagnosticBundle() };
    const visualBundle = makeVisualBundle();
    const storeEligibility: GenerationStoreEligibility = {
      eligible: true,
      reason: "ready_to_store",
    };

    const updatedState = withFinalGraphId(
      withStoreEligibility(
        withVisualBundle(
          withDiagnosticBundle(
            withLessonBundle(
              withReconciledGraph(
                withValidatorOutputs(
                  withGeneratedGraphDraft(
                    withRetrievalDecision(
                      withGenerationExecutionPath(
                        withCanonicalizedPrompt(initialState, canonicalized),
                        "generate",
                      ),
                      retrievalCandidates,
                      retrievalDecision,
                    ),
                    graphDraft,
                  ),
                  structureResult,
                  curriculumResult,
                ),
                reconciledGraph,
              ),
              lessonBundle,
            ),
            diagnosticBundle,
          ),
          visualBundle,
        ),
        storeEligibility,
      ),
      graphId,
    );

    const loggedState = appendGenerationLogEntry(updatedState, {
      request_id: "request-1",
      stage: "graph_generator",
      event: "start",
      level: "info",
      message: "Graph generation started.",
      timestamp: "2026-04-01T12:00:01.000Z",
      duration_ms: 1,
      details: { attempt: 1 },
    });

    expect(generationRunStateSchema.parse(loggedState)).toEqual(loggedState);
    expect(canonicalizeResolvedSuccessSchema.parse(loggedState.canonicalized)).toEqual(
      loggedState.canonicalized,
    );
  });

  it("validates stage schemas and route envelopes", () => {
    expect(generationStageNameSchema.parse("reconciler")).toBe("reconciler");
    expect(generationExecutionPathSchema.parse("generate")).toBe("generate");
    expect(
      generationFailureCategorySchema.parse("llm_contract_violation"),
    ).toBe("llm_contract_violation");
    expect(generationLogLevelSchema.parse("warn")).toBe("warn");
    expect(generationLogEventSchema.parse("retry")).toBe("retry");
    expect(
      generationCurriculumAuditStatusSchema.parse("disabled_async"),
    ).toBe("disabled_async");
    expect(
      generationCurriculumOutcomeBucketSchema.parse("accepted_clean"),
    ).toBe("accepted_clean");
    expect(
      generationCurriculumAuditPhaseSchema.parse("synchronous_placeholder"),
    ).toBe("synchronous_placeholder");

    expect(() =>
      generationStructureIssueSchema.parse({
        type: "missing_hard_edge",
        severity: "major",
        nodes_involved: [persistedNodeIds[0]!],
        description: "Node 2 is missing a prerequisite.",
        suggested_fix: "Add a hard edge from node 1 to node 2.",
      }),
    ).not.toThrow();

    expect(() =>
      generationCurriculumIssueSchema.parse({
        type: "incorrect_ordering",
        severity: "minor",
        nodes_involved: [persistedNodeIds[1]!],
        missing_concept_title: null,
        description: "Topic order is slightly off.",
        suggested_fix: "Move the application node later.",
        curriculum_basis: "Most curricula introduce the definition before application.",
      }),
    ).not.toThrow();

    expect(() =>
      generationStructureValidationResultSchema.parse({
        valid: true,
        issues: [],
      }),
    ).not.toThrow();

    expect(() =>
      generationCurriculumValidationResultSchema.parse({
        valid: true,
        issues: [],
      }),
    ).not.toThrow();
    expect(() =>
      graphRouteDebugSchema.parse({
        request_id: "request-1",
        structure: {
          valid: true,
          issues: [],
        },
        curriculum: {
          valid: true,
          issues: [],
        },
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
        timings: {
          graph_generate_ms: 1,
          structure_validate_ms: 1,
          curriculum_validate_ms: 1,
          reconcile_ms: 1,
          total_ms: 1,
        },
      }),
    ).not.toThrow();

    expect(
      curriculumAuditRecordSchema.parse({
        request_id: "request-1",
        request_fingerprint: "fingerprint-1",
        subject: "mathematics",
        topic: "algebra",
        audit_status: "skipped_contract_failure",
        outcome_bucket: "skipped_contract_failure",
        attempt_count: 1,
        failure_category: "llm_contract_violation",
        parse_error_summary:
          "Failed to parse structured output as JSON: Unterminated string in JSON at position 10.",
        duration_ms: 123,
        issue_count: 0,
        async_audit: true,
        created_at: "2026-04-01T12:00:00.000Z",
        updated_at: "2026-04-01T12:00:01.000Z",
      }),
    ).toMatchObject({
      request_id: "request-1",
      audit_status: "skipped_contract_failure",
    });

    expect(
      graphCurriculumAuditReadResponseSchema.parse({
        request_id: "request-1",
        audit: null,
      }),
    ).toEqual({
      request_id: "request-1",
      audit: null,
    });

    expect(() =>
      generationResolutionSummaryEntrySchema.parse({
        issue_key: "structure:redundant_edge:node_1,node_2",
        issue_source: "both",
        issue_description: "Merged duplicate findings.",
        resolution_action: "Rewrote the edge set once.",
      }),
    ).not.toThrow();

    expect(() =>
      generationGraphDraftSchema.parse({
        nodes: draftNodeIds.map((nodeId, index) => ({
          id: nodeId,
          title: `Node ${index + 1}`,
          position: index,
        })),
        edges: draftNodeIds.slice(1).map((nodeId, index) => ({
          from_node_id: draftNodeIds[index]!,
          to_node_id: nodeId,
          type: "hard",
        })),
      }),
    ).not.toThrow();

    expect(() => generationLessonBundleSchema.parse(makeLessonBundle())).not.toThrow();
    expect(() => generationDiagnosticBundleSchema.parse({ nodes: makeDiagnosticBundle() })).not.toThrow();
    expect(() => generationVisualBundleSchema.parse(makeVisualBundle())).not.toThrow();
    expect(() => lessonNodeSchema.parse(makeLessonBundle().nodes[0])).not.toThrow();
    expect(() => diagnosticNodeSchema.parse(makeDiagnosticBundle()[0])).not.toThrow();
    expect(() => visualNodeSchema.parse(makeVisualBundle().nodes[0])).not.toThrow();
    expect(() =>
      generationReconciledGraphSchema.parse({
        ...generationGraphDraftSchema.parse({
          nodes: draftNodeIds.map((nodeId, index) => ({
            id: nodeId,
            title: `Node ${index + 1}`,
            position: index,
          })),
          edges: draftNodeIds.slice(1).map((nodeId, index) => ({
            from_node_id: draftNodeIds[index]!,
            to_node_id: nodeId,
            type: "hard",
          })),
        }),
        resolution_summary: [],
      }),
    ).not.toThrow();
    expect(() => generationStoreEligibilitySchema.parse({ eligible: true, reason: "ready_to_store" })).not.toThrow();
    expect(() =>
      retrievalDecisionSchema.parse({
        graph_id: graphId,
        reason: "usable_unflagged_match",
        candidate: {
          id: graphId,
          similarity: 0.95,
          flagged_for_review: false,
          version: 1,
          created_at: "2026-04-01T12:00:00.000Z",
        },
      }),
    ).not.toThrow();
    expect(() => generateRequestSchema.parse({ prompt: "I want to learn algebra" })).not.toThrow();
    expect(() => generateResponseSchema.parse({ graph_id: graphId, cached: false })).not.toThrow();
    expect(() =>
      storeRequestSchema.parse({
        graph: {
          id: graphId,
          title: "Algebra Foundations",
          subject: "mathematics",
          topic: "algebra",
          description:
            "Algebra is the study of symbols and the rules for manipulating them. It encompasses expressions, equations, functions, inequalities, polynomials, factoring, and systems of equations. It assumes prior knowledge of arithmetic and serves as a foundation for calculus and discrete mathematics. Within mathematics, it is typically encountered at the introductory level.",
          version: 1,
          flagged_for_review: false,
          created_at: "2026-04-01T12:00:00.000Z",
        } satisfies Graph,
        nodes: makeLessonBundle().nodes,
        edges: persistedNodeIds.slice(1).map((_, index) => ({
          from_node_id: persistedNodeIds[index]!,
          to_node_id: persistedNodeIds[index + 1]!,
          type: "hard" as const,
        })),
      } satisfies StoreRequest),
    ).not.toThrow();
    const generatedStoreNodes = draftNodeIds.map((nodeId, index) => ({
      id: nodeId,
      title: `Node ${index + 1}`,
      position: index,
      lesson_text: `Lesson ${index + 1}`,
      static_diagram: `<svg data-node="${index + 1}"></svg>`,
      p5_code: index % 2 === 0 ? "" : "function setup(){createCanvas(480,320);} function draw(){}",
      visual_verified: index % 2 === 1,
      quiz_json: [
        makeQuiz(`Question ${index + 1}.1`, "Because 1"),
        makeQuiz(`Question ${index + 1}.2`, "Because 2"),
        makeQuiz(`Question ${index + 1}.3`, "Because 3"),
      ],
      diagnostic_questions: [makeDiagnosticQuestion(nodeId, index + 1)],
    }));

    expect(() =>
      storeRouteRequestSchema.parse({
        graph: {
          id: graphId,
          title: "Algebra Foundations",
          subject: "mathematics",
          topic: "algebra",
          description:
            "Algebra is the study of symbols and the rules for manipulating them. It encompasses expressions, equations, functions, inequalities, polynomials, factoring, and systems of equations. It assumes prior knowledge of arithmetic and serves as a foundation for calculus and discrete mathematics. Within mathematics, it is typically encountered at the introductory level.",
          version: 1,
          flagged_for_review: false,
          created_at: "2026-04-01T12:00:00.000Z",
        },
        nodes: generatedStoreNodes,
        edges: draftNodeIds.slice(1).map((nodeId, index) => ({
          from_node_id: draftNodeIds[index]!,
          to_node_id: nodeId,
          type: "hard" as const,
        })),
      }),
    ).not.toThrow();
    expect(() => storeResponseSchema.parse({ graph_id: graphId })).not.toThrow();
    expect(() =>
      apiErrorEnvelopeSchema.parse({
        error: "UNEXPECTED_INTERNAL_ERROR",
        message: "Something went wrong.",
        details: null,
      }),
    ).not.toThrow();
  });
});
