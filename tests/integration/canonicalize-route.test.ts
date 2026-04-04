import { describe, expect, it } from "vitest";

import { handleCanonicalizeRequest } from "@/app/api/generate/canonicalize/route";
import { ApiError } from "@/lib/errors";

describe("canonicalize route strict mode", () => {
  it("fails descriptively when draft times out and repair returns an invalid subject", async () => {
    const response = await handleCanonicalizeRequest(
      new Request("http://localhost/api/generate/canonicalize", {
        method: "POST",
        body: JSON.stringify({ prompt: "I want to learn trigonometry" }),
      }),
      {
        callModel: async ({ mode }) => {
          if (mode === "draft") {
            throw new ApiError(
              "UPSTREAM_TIMEOUT",
              "canonicalize draft timed out after 8000ms.",
              504,
            );
          }

          return {
            subject: "history",
            topic: "trigonometry",
            scope_summary:
              "relationships between angles and side lengths in triangles, extending to periodic functions on the unit circle",
            core_concepts: ["sine", "cosine", "tangent", "trigonometric identities"],
            prerequisites: ["algebra"],
            downstream_topics: ["calculus", "statistics", "physics"],
            level: "intermediate",
          } as never;
        },
      },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: "CANONICALIZE_FAILED",
      details: {
        initial_error: "canonicalize draft timed out after 8000ms.",
        repair_error:
          "Claude returned an accepted canonicalize payload that did not match the semantic draft schema.",
      },
    });
  });
});
