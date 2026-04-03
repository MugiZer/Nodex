import type {
  CurriculumValidatorOutput,
  CurriculumAuditStatus,
  GraphReconciliationMode,
  StructureValidatorOutput,
} from "@/lib/server/generation/contracts";
import type { GenerationResolutionSummaryEntry } from "@/lib/types";

import {
  createCurriculumCoverageIssueKey,
  createStructureCoverageIssueKey,
} from "./issue-keys";

export type GraphRouteOutcomeBucket =
  | "deterministic_only_clean"
  | "deterministic_only_repaired"
  | "llm_reconcile_due_to_structure"
  | "llm_reconcile_due_to_curriculum";

export type GraphRouteTelemetry = {
  outcome_bucket: GraphRouteOutcomeBucket;
  repair_mode: GraphReconciliationMode;
  curriculum_audit_status: CurriculumAuditStatus;
  curriculum_outcome_bucket:
    | "accepted_clean"
    | "accepted_with_issues"
    | "skipped_timeout"
    | "skipped_contract_failure"
    | "disabled_async";
  structure_issue_type_counts: Record<string, number>;
  structure_issue_key_counts: Record<string, number>;
  curriculum_issue_type_counts: Record<string, number>;
  curriculum_issue_key_counts: Record<string, number>;
  resolution_summary_issue_key_counts: Record<string, number>;
};

function countValues(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }

  return counts;
}

function countStructureIssueTypes(output: StructureValidatorOutput): Record<string, number> {
  return countValues(output.issues.map((issue) => issue.type));
}

function countCurriculumIssueTypes(output: CurriculumValidatorOutput): Record<string, number> {
  return countValues(output.issues.map((issue) => issue.type));
}

export function deriveCurriculumOutcomeBucket(input: {
  curriculum: CurriculumValidatorOutput;
  curriculumAuditStatus: CurriculumAuditStatus;
}): GraphRouteTelemetry["curriculum_outcome_bucket"] {
  switch (input.curriculumAuditStatus) {
    case "accepted":
      return input.curriculum.issues.length === 0
        ? "accepted_clean"
        : "accepted_with_issues";
    case "skipped_timeout":
    case "skipped_contract_failure":
    case "disabled_async":
      return input.curriculumAuditStatus;
    default:
      return "disabled_async";
  }
}

function deriveOutcomeBucket(input: {
  structure: StructureValidatorOutput;
  curriculum: CurriculumValidatorOutput;
  repairMode: GraphReconciliationMode;
}): GraphRouteOutcomeBucket {
  if (
    input.repairMode === "deterministic_only" ||
    input.repairMode === "deterministic_only_repaired"
  ) {
    return input.structure.issues.length === 0 && input.curriculum.issues.length === 0
      ? "deterministic_only_clean"
      : "deterministic_only_repaired";
  }

  if (input.structure.issues.length > 0) {
    return "llm_reconcile_due_to_structure";
  }

  if (input.curriculum.issues.length > 0) {
    return "llm_reconcile_due_to_curriculum";
  }

  return "llm_reconcile_due_to_structure";
}

export function buildGraphRouteTelemetry(input: {
  structure: StructureValidatorOutput;
  curriculum: CurriculumValidatorOutput;
  resolutionSummary: GenerationResolutionSummaryEntry[];
  repairMode: GraphReconciliationMode;
  curriculumAuditStatus: CurriculumAuditStatus;
}): GraphRouteTelemetry {
  return {
    outcome_bucket: deriveOutcomeBucket(input),
    repair_mode: input.repairMode,
    curriculum_audit_status: input.curriculumAuditStatus,
    curriculum_outcome_bucket: deriveCurriculumOutcomeBucket({
      curriculum: input.curriculum,
      curriculumAuditStatus: input.curriculumAuditStatus,
    }),
    structure_issue_type_counts: countStructureIssueTypes(input.structure),
    structure_issue_key_counts: countValues(
      input.structure.issues.map(createStructureCoverageIssueKey),
    ),
    curriculum_issue_type_counts: countCurriculumIssueTypes(input.curriculum),
    curriculum_issue_key_counts: countValues(
      input.curriculum.issues.map(createCurriculumCoverageIssueKey),
    ),
    resolution_summary_issue_key_counts: countValues(
      input.resolutionSummary.map((entry) => entry.issue_key),
    ),
  };
}
