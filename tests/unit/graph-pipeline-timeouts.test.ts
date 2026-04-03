import { describe, expect, it } from "vitest";

import { computeStageTimeout } from "@/lib/server/generation/stages/graph-pipeline";

describe("graph pipeline timeouts", () => {
  it("derives stage timeouts from token budgets and the throughput floor", () => {
    expect(computeStageTimeout(2400)).toBe(43000);
    expect(computeStageTimeout(900)).toBe(18000);
    expect(computeStageTimeout(500)).toBe(11334);
    expect(computeStageTimeout(1800)).toBe(33000);
  });
});
