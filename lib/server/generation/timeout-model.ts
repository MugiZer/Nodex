export const LLM_THROUGHPUT_FLOOR_TOKENS_PER_SEC = 60;
export const LLM_OVERHEAD_MS = 3000;

export function computeStageTimeout(maxTokens: number): number {
  return (
    Math.ceil((maxTokens / LLM_THROUGHPUT_FLOOR_TOKENS_PER_SEC) * 1000) +
    LLM_OVERHEAD_MS
  );
}
