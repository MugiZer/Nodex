import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/errors";
import { createRequestLogContext } from "@/lib/logging";
import {
  launchDetachedCurriculumAudit,
} from "@/lib/server/generation/curriculum-audit";
import {
  fetchCurriculumAuditRecord,
  persistCurriculumAuditRecord,
} from "@/lib/server/generation/curriculum-audit-store";
import type { FoundationSupabaseClient } from "@/lib/supabase";
import { runCurriculumValidator } from "@/lib/server/generation/stages/graph-pipeline";

import { DAY2_GRAPH_DRAFT } from "../harness/day2-generation";

function createCurriculumInput() {
  return {
    subject: "mathematics" as const,
    topic: "trigonometry",
    description:
      "Trigonometry is the study of relationships between angles and side lengths in triangles. It encompasses sine, cosine, tangent, trigonometric identities, the laws of sines and cosines, radian measure, and unit-circle reasoning. It assumes prior knowledge of algebra and Euclidean geometry and serves as a foundation for calculus and physics. Within mathematics, it is typically encountered at the intermediate level.",
    nodes: DAY2_GRAPH_DRAFT.nodes,
    edges: DAY2_GRAPH_DRAFT.edges,
  };
}

function createMissingTableClient(
  mode: "persist" | "fetch",
): FoundationSupabaseClient {
  const missingTableError = {
    code: "42P01",
    message: "Could not find the table 'public.generation_curriculum_audits' in the schema cache",
  };

  if (mode === "persist") {
    return {
      from: () => ({
        upsert: async () => ({
          error: missingTableError,
        }),
      }),
    } as unknown as FoundationSupabaseClient;
  }

  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: null,
            error: missingTableError,
          }),
        }),
      }),
    }),
  } as unknown as FoundationSupabaseClient;
}

describe("curriculum audit", () => {
  function sortEdges(
    edges: Array<{ from_node_id: string; to_node_id: string }>,
  ): Array<{ from_node_id: string; to_node_id: string }> {
    return [...edges].sort((left, right) =>
      left.from_node_id === right.from_node_id
        ? left.to_node_id.localeCompare(right.to_node_id)
        : left.from_node_id.localeCompare(right.from_node_id),
    );
  }

  it("builds a compact payload and short-json prompt", async () => {
    const calls: Array<{ systemPrompt: string; userPrompt: string }> = [];
    const context = createRequestLogContext("test curriculum audit");

    await runCurriculumValidator(
      createCurriculumInput(),
      context,
      {
        callModel: async ({ systemPrompt, userPrompt }) => {
          calls.push({ systemPrompt, userPrompt });
          return { valid: true, issues: [] };
        },
      },
      { executionMode: "detached" },
    );

    expect(calls).toHaveLength(1);
    const [{ systemPrompt, userPrompt }] = calls;
    expect(systemPrompt).toContain("Return at most 3 issues.");
    expect(systemPrompt).toContain("description field must be exactly one short sentence and no more than 160 characters");
    expect(systemPrompt).toContain("suggested_fix field must be exactly one short sentence and no more than 140 characters");
    expect(systemPrompt).toContain("curriculum_basis field must be exactly one short sentence and no more than 160 characters");
    const parsedPayload = JSON.parse(userPrompt);

    expect(Object.keys(parsedPayload).sort()).toEqual(
      ["description", "hard_edges", "nodes", "subject", "topic"].sort(),
    );
    expect(parsedPayload.nodes).toEqual(
      DAY2_GRAPH_DRAFT.nodes.map((node) => ({
        id: node.id,
        title: node.title,
        position: node.position,
      })),
    );
    expect(sortEdges(parsedPayload.hard_edges)).toEqual(
      sortEdges(
        DAY2_GRAPH_DRAFT.edges
          .filter((edge) => edge.type === "hard")
          .map((edge) => ({
            from_node_id: edge.from_node_id,
            to_node_id: edge.to_node_id,
          })),
      ),
    );
  });

  it("classifies malformed structured output as a contract failure", async () => {
    const context = createRequestLogContext("test curriculum audit");

    const result = await runCurriculumValidator(
      createCurriculumInput(),
      context,
      {
        callModel: async () => {
          throw new Error(
            "Failed to parse structured output as JSON: Unterminated string in JSON at position 42",
          );
        },
      },
      { executionMode: "detached" },
    );

    expect(result.auditStatus).toBe("skipped_contract_failure");
    expect(result.finalFailureCategory).toBe("llm_contract_violation");
    expect(result.failureSubtype).toBe("invalid_json");
    expect(result.attemptCount).toBe(1);
  });

  it("normalizes overlong detached audit fields instead of dropping the audit", async () => {
    const context = createRequestLogContext("test curriculum audit");

    const result = await runCurriculumValidator(
      createCurriculumInput(),
      context,
      {
        callModel: async () => ({
          valid: false,
          issues: [
            {
              type: "incorrect_ordering" as const,
              severity: "major" as const,
              nodes_involved: ["node_2"],
              missing_concept_title: null,
              description:
                "This description is intentionally too long because it keeps elaborating on a curriculum issue beyond the detached audit cap and should be truncated locally instead of failing the whole audit result.",
              suggested_fix:
                "Shorten the fix guidance by rewriting the node ordering so foundational limit manipulation precedes this downstream skill and keep the wording concise enough for the schema.",
              curriculum_basis:
                "Mainstream calculus curricula expect symbolic prerequisite work to appear before application-heavy limit tasks, and this sentence is intentionally long so local normalization has to clamp it.",
            },
          ],
        }),
      },
      { executionMode: "detached" },
    );

    expect(result.auditStatus).toBe("accepted");
    expect(result.output.issues).toHaveLength(1);
    expect(result.output.issues[0]?.description.length).toBeLessThanOrEqual(160);
    expect(result.output.issues[0]?.suggested_fix.length).toBeLessThanOrEqual(140);
    expect(result.output.issues[0]?.curriculum_basis.length).toBeLessThanOrEqual(160);
  });

  it("classifies upstream timeouts without retrying detached audits", async () => {
    const context = createRequestLogContext("test curriculum audit");

    const result = await runCurriculumValidator(
      createCurriculumInput(),
      context,
      {
        callModel: async () => {
          throw new ApiError("UPSTREAM_TIMEOUT", "curriculum_audit timed out after 1ms.", 504);
        },
      },
      { executionMode: "detached" },
    );

    expect(result.auditStatus).toBe("skipped_timeout");
    expect(result.finalFailureCategory).toBe("upstream_timeout");
    expect(result.failureSubtype).toBe("timeout");
    expect(result.attemptCount).toBe(1);
  });

  it("logs detached persistence failures separately from audit classification", async () => {
    const context = createRequestLogContext("test curriculum audit");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const persistAuditResult = vi.fn(async () => {
      throw new ApiError("STORE_ERROR", "Failed to persist curriculum audit result.", 500, {
        cause: "db unavailable",
      });
    });
    const runValidator = vi.fn(async () => ({
      output: {
        valid: true,
        issues: [],
      },
      auditStatus: "accepted" as const,
      outcomeBucket: "accepted_clean" as const,
      attemptCount: 1,
      finalFailureCategory: null,
      parseErrorSummary: null,
      failureSubtype: null,
      durationMs: 1,
      asyncAudit: true,
    }));

    try {
      launchDetachedCurriculumAudit(
        createCurriculumInput(),
        context,
        runValidator,
        undefined,
        {
          runInTests: true,
          persistAuditResult,
        },
      );

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(runValidator).toHaveBeenCalledTimes(1);
      expect(persistAuditResult).toHaveBeenCalledTimes(1);
      const loggedMessages = consoleErrorSpy.mock.calls
        .map((call) => call.map((value) => String(value)).join(" "))
        .join(" ");
      expect(loggedMessages).toContain("curriculum_audit_store");
      expect(loggedMessages).toContain("db unavailable");
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("skips missing curriculum audit storage without surfacing an error", async () => {
    const context = createRequestLogContext("test curriculum audit");
    const result = await persistCurriculumAuditRecord(
      {
        request_id: context.requestId,
        request_fingerprint: "fingerprint",
        subject: "mathematics",
        topic: "trigonometry",
        audit_status: "skipped_timeout",
        outcome_bucket: "skipped_timeout",
        attempt_count: 1,
        failure_category: "upstream_timeout",
        parse_error_summary: "curriculum_audit timed out after 11334ms.",
        duration_ms: 11334,
        issue_count: 0,
        async_audit: true,
      },
      context,
      {
        createServiceClient: () => createMissingTableClient("persist"),
      },
    );

    expect(result).toEqual({
      status: "skipped_missing_table",
    });
  });

  it("returns null when reading a missing curriculum audit table", async () => {
    const context = createRequestLogContext("test curriculum audit lookup");
    const audit = await fetchCurriculumAuditRecord(
      "11111111-1111-4111-8111-111111111111",
      context,
      {
        createServiceClient: () => createMissingTableClient("fetch"),
      },
    );

    expect(audit).toBeNull();
  });
});
