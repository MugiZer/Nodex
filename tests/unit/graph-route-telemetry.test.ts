import { describe, expect, it } from "vitest";

import { buildGraphRouteTelemetry } from "@/lib/server/generation/graph-route-telemetry";

describe("graph route telemetry", () => {
  it("counts repeated issue types and issue keys while recording the repair mode", () => {
    const telemetry = buildGraphRouteTelemetry({
      structure: {
        valid: false,
        issues: [
          {
            type: "redundant_edge",
            severity: "minor",
            nodes_involved: ["node_1", "node_2"],
            description: "The edge is redundant.",
            suggested_fix: "Remove the edge.",
          },
          {
            type: "redundant_edge",
            severity: "minor",
            nodes_involved: ["node_2", "node_3"],
            description: "Another edge is redundant.",
            suggested_fix: "Remove the edge.",
          },
          {
            type: "missing_hard_edge",
            severity: "major",
            nodes_involved: ["node_3", "node_4"],
            description: "A hard prerequisite is missing.",
            suggested_fix: "Add the prerequisite.",
          },
        ],
      },
      curriculum: {
        valid: false,
        issues: [
          {
            type: "incorrect_ordering",
            severity: "minor",
            nodes_involved: ["node_5"],
            missing_concept_title: null,
            description: "The topic appears too early.",
            suggested_fix: "Move the topic later.",
            curriculum_basis: "Standard introductions place this later.",
          },
          {
            type: "incorrect_ordering",
            severity: "minor",
            nodes_involved: ["node_6"],
            missing_concept_title: null,
            description: "Another topic appears too early.",
            suggested_fix: "Move the topic later.",
            curriculum_basis: "Standard introductions place this later.",
          },
        ],
      },
      resolutionSummary: [
        {
          issue_key: "structure:redundant_edge:node_1,node_2",
          issue_source: "structure_validator",
          issue_description: "Removed a redundant edge.",
          resolution_action: "Dropped the duplicate dependency.",
        },
        {
          issue_key: "curriculum:incorrect_ordering:node_5",
          issue_source: "curriculum_validator",
          issue_description: "Shifted the concept later.",
          resolution_action: "Kept the graph stable while deferring the topic.",
        },
      ],
      repairMode: "repair_fallback",
      curriculumAuditStatus: "accepted",
    });

    expect(telemetry).toEqual({
      outcome_bucket: "llm_reconcile_due_to_structure",
      repair_mode: "repair_fallback",
      curriculum_audit_status: "accepted",
      curriculum_outcome_bucket: "accepted_with_issues",
      structure_issue_type_counts: {
        redundant_edge: 2,
        missing_hard_edge: 1,
      },
      structure_issue_key_counts: {
        "structure:redundant_edge:node_1,node_2": 1,
        "structure:redundant_edge:node_2,node_3": 1,
        "structure:missing_hard_edge:node_3,node_4": 1,
      },
      curriculum_issue_type_counts: {
        incorrect_ordering: 2,
      },
      curriculum_issue_key_counts: {
        "curriculum:incorrect_ordering:node_5": 1,
        "curriculum:incorrect_ordering:node_6": 1,
      },
      resolution_summary_issue_key_counts: {
        "structure:redundant_edge:node_1,node_2": 1,
        "curriculum:incorrect_ordering:node_5": 1,
      },
    });
  });

  it("derives clean, repaired, and curriculum-driven outcome buckets", () => {
    const cleanTelemetry = buildGraphRouteTelemetry({
      structure: { valid: true, issues: [] },
      curriculum: { valid: true, issues: [] },
      resolutionSummary: [],
      repairMode: "deterministic_only",
      curriculumAuditStatus: "disabled_async",
    });

    const repairedTelemetry = buildGraphRouteTelemetry({
      structure: {
        valid: false,
        issues: [
          {
            type: "redundant_edge",
            severity: "minor",
            nodes_involved: ["node_1", "node_2"],
            description: "The edge is redundant.",
            suggested_fix: "Remove the edge.",
          },
        ],
      },
      curriculum: { valid: true, issues: [] },
      resolutionSummary: [],
      repairMode: "deterministic_only_repaired",
      curriculumAuditStatus: "disabled_async",
    });

    const curriculumDrivenTelemetry = buildGraphRouteTelemetry({
      structure: { valid: true, issues: [] },
      curriculum: {
        valid: false,
        issues: [
          {
            type: "incorrect_ordering",
            severity: "minor",
            nodes_involved: ["node_5"],
            missing_concept_title: null,
            description: "The topic appears too early.",
            suggested_fix: "Move the topic later.",
            curriculum_basis: "Standard introductions place this later.",
          },
        ],
      },
      resolutionSummary: [],
      repairMode: "llm_reconcile",
      curriculumAuditStatus: "accepted",
    });

    expect(cleanTelemetry.outcome_bucket).toBe("deterministic_only_clean");
    expect(cleanTelemetry.curriculum_outcome_bucket).toBe("disabled_async");
    expect(repairedTelemetry.outcome_bucket).toBe("deterministic_only_repaired");
    expect(repairedTelemetry.curriculum_outcome_bucket).toBe("disabled_async");
    expect(curriculumDrivenTelemetry.outcome_bucket).toBe(
      "llm_reconcile_due_to_curriculum",
    );
    expect(curriculumDrivenTelemetry.curriculum_outcome_bucket).toBe(
      "accepted_with_issues",
    );
  });
});
