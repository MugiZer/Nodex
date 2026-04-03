import type { GenerationStructureIssue } from "@/lib/types";

import type { CurriculumValidatorOutput } from "./contracts";

function createIssueKeyPrefix(source: "structure" | "curriculum", type: string): string {
  return `${source}:${type}`;
}

function normalizeConceptLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function createStructureCoverageIssueKey(issue: GenerationStructureIssue): string {
  return `${createIssueKeyPrefix("structure", issue.type)}:${[...issue.nodes_involved]
    .sort()
    .join(",")}`;
}

export function createCurriculumCoverageIssueKey(
  issue: CurriculumValidatorOutput["issues"][number],
): string {
  if (issue.type === "missing_concept" && issue.missing_concept_title) {
    return `${createIssueKeyPrefix("curriculum", issue.type)}:${normalizeConceptLabel(issue.missing_concept_title)}`;
  }

  return `${createIssueKeyPrefix("curriculum", issue.type)}:${[...issue.nodes_involved]
    .sort()
    .join(",")}`;
}
