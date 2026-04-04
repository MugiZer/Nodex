import type {
  FlagshipLesson,
  PrerequisiteDiagnostic,
  PrerequisiteDiagnosticGroup,
} from "@/lib/types";

export type StoredPrerequisiteLesson = {
  name: string;
  lesson: FlagshipLesson;
};

export type StoredPendingDiagnostic = {
  requestId: string;
  topic: string;
  diagnostic: PrerequisiteDiagnostic;
};

export type StoredGraphDiagnosticResult = {
  requestId: string;
  graphId: string;
  topic: string;
  gapNames: string[];
  gapPrerequisites: PrerequisiteDiagnosticGroup[];
  gapPrerequisiteLessons: StoredPrerequisiteLesson[];
  completedGapNodeIds: string[];
};

export function getPendingDiagnosticKey(requestId: string): string {
  return `foundation:pending-diagnostic:${requestId}`;
}

export function getGraphDiagnosticResultKey(graphId: string): string {
  return `foundation:graph-diagnostic:${graphId}`;
}
