import { describe, expect, it } from "vitest";

import {
  aggregateGraphRouteLogs,
  bucketLatencyMs,
} from "../../scripts/graph-route-summary.mjs";

describe("graph route summary", () => {
  it("buckets graph-route logs by repair mode, outcome, and latency", () => {
    expect(bucketLatencyMs(9500)).toBe("<=10s");
    expect(bucketLatencyMs(15000)).toBe("<=20s");
    expect(bucketLatencyMs(32000)).toBe("<=45s");

    const summary = aggregateGraphRouteLogs([
      {
        route: "POST /api/generate/graph",
        stage: "graph_generate",
        event: "success",
        telemetry: {
          repair_mode: "deterministic_only_repaired",
          outcome_bucket: "deterministic_only_repaired",
          curriculum_audit_status: "disabled_async",
          curriculum_outcome_bucket: "disabled_async",
          structure_issue_type_counts: {
            edge_misclassification: 1,
          },
          structure_issue_key_counts: {
            "structure:edge_misclassification:node_1,node_2,node_3": 1,
          },
          curriculum_issue_type_counts: {},
          curriculum_issue_key_counts: {},
          resolution_summary_issue_key_counts: {
            "structure:edge_misclassification:node_1,node_2,node_3": 1,
          },
        },
        timings_ms: {
          total: 14999,
        },
      },
      {
        route: "POST /api/generate/graph",
        stage: "graph_generate",
        event: "success",
        telemetry: {
          repair_mode: "repair_fallback",
          outcome_bucket: "llm_reconcile_due_to_structure",
          curriculum_audit_status: "accepted",
          curriculum_outcome_bucket: "accepted_clean",
          structure_issue_type_counts: {
            orphaned_subgraph: 1,
          },
          structure_issue_key_counts: {
            "structure:orphaned_subgraph:node_10": 1,
          },
          curriculum_issue_type_counts: {},
          curriculum_issue_key_counts: {},
          resolution_summary_issue_key_counts: {
            "structure:orphaned_subgraph:node_10": 1,
          },
        },
        timings_ms: {
          total: 41234,
        },
      },
    ]);

    expect(summary).toEqual({
      runs: 2,
      repair_mode_counts: {
        deterministic_only_repaired: 1,
        repair_fallback: 1,
      },
      outcome_bucket_counts: {
        deterministic_only_repaired: 1,
        llm_reconcile_due_to_structure: 1,
      },
      curriculum_audit_status_counts: {
        disabled_async: 1,
        accepted: 1,
      },
      curriculum_outcome_bucket_counts: {
        disabled_async: 1,
        accepted_clean: 1,
      },
      structure_issue_type_counts: {
        edge_misclassification: 1,
        orphaned_subgraph: 1,
      },
      structure_issue_key_counts: {
        "structure:edge_misclassification:node_1,node_2,node_3": 1,
        "structure:orphaned_subgraph:node_10": 1,
      },
      curriculum_issue_type_counts: {},
      curriculum_issue_key_counts: {},
      resolution_summary_issue_key_counts: {
        "structure:edge_misclassification:node_1,node_2,node_3": 1,
        "structure:orphaned_subgraph:node_10": 1,
      },
      latency_bucket_counts: {
        "<=20s": 1,
        "<=45s": 1,
      },
    });
  });
});
