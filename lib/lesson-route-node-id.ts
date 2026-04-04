export type NormalizedLessonNodeId = {
  raw: string;
  normalized: string;
  wasNormalized: boolean;
};

export function normalizeLessonNodeId(rawNodeId: string): NormalizedLessonNodeId {
  let normalized = rawNodeId;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const decoded = decodeURIComponent(normalized);
      if (decoded === normalized) {
        break;
      }
      normalized = decoded;
    } catch {
      break;
    }
  }

  return {
    raw: rawNodeId,
    normalized,
    wasNormalized: normalized !== rawNodeId,
  };
}

export function normalizeLessonNodeIdValue(rawNodeId: string): string {
  return normalizeLessonNodeId(rawNodeId).normalized;
}
