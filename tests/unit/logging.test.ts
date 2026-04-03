import { describe, expect, it, vi } from "vitest";

import { createRequestLogContext, logError } from "@/lib/logging";

describe("logging", () => {
  it("preserves structured details for non-Error throws", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      logError(
        createRequestLogContext("test"),
        "lessons",
        "Structured failure.",
        {
          code: "UPSTREAM_PROVIDER",
          detail: "Streaming is required",
        },
      );

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(String(consoleErrorSpy.mock.calls[0]?.[0] ?? "{}")) as {
        error_name?: string;
        error_details?: { code?: string; detail?: string };
      };

      expect(payload.error_name).toBe("NonErrorThrow");
      expect(payload.error_details).toMatchObject({
        code: "UPSTREAM_PROVIDER",
        detail: "Streaming is required",
      });
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
