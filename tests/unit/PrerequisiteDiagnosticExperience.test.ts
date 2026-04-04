// @vitest-environment jsdom

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getPendingDiagnosticKey } from "@/lib/diagnostic-session";
import type { PrerequisiteDiagnostic } from "@/lib/types";

const push = vi.fn();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push,
    replace,
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => ({
    get: (key: string) => (key === "graph_id" ? "graph-123" : null),
  }),
}));

import { PrerequisiteDiagnosticExperience } from "@/components/PrerequisiteDiagnosticExperience";

describe("PrerequisiteDiagnosticExperience", () => {
  beforeEach(() => {
    push.mockReset();
    replace.mockReset();
    window.sessionStorage.clear();
  });

  it("waits for stored diagnostic hydration instead of redirecting to the graph", async () => {
    render(React.createElement(PrerequisiteDiagnosticExperience, { requestId: "request-123" }));

    const heading = await screen.findByRole("heading", { name: /we couldn't load your diagnostic/i });
    expect(heading).not.toBeNull();
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(screen.queryByText(/skip diagnostic/i)).toBeNull();
  });

  it("does not route to the graph until the first lesson is confirmed ready", async () => {
    vi.useFakeTimers();

    const diagnostic: PrerequisiteDiagnostic = {
      prerequisites: [
        {
          name: "algebra",
          questions: [
            {
              question: "Q1",
              options: ["Correct Q1", "Wrong A", "Wrong B", "Wrong C"],
              correctIndex: 0,
              explanation: "Because.",
            },
            {
              question: "Q2",
              options: ["Correct Q2", "Wrong A", "Wrong B", "Wrong C"],
              correctIndex: 0,
              explanation: "Because.",
            },
          ],
        },
      ],
    };

    window.sessionStorage.setItem(
      getPendingDiagnosticKey("request-123"),
      JSON.stringify({
        requestId: "request-123",
        topic: "trigonometry",
        diagnostic,
      }),
    );

    let graphReady = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/graph/status/request-123/diagnostic")) {
        return new Response(
          JSON.stringify({
            requestId: "request-123",
            graphId: "graph-123",
            topic: "trigonometry",
            gapNames: ["algebra"],
            gapPrerequisites: diagnostic.prerequisites,
            gapPrerequisiteLessons: [],
            completedGapNodeIds: [],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (!url.includes("/api/graph/graph-123")) {
        throw new Error(`Unexpected fetch URL: ${url}`);
      }
      const nodes = [
        {
          lesson_status: graphReady ? ("ready" as const) : ("pending" as const),
        },
      ];

      return new Response(JSON.stringify({ nodes }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    try {
      render(React.createElement(PrerequisiteDiagnosticExperience, { requestId: "request-123" }));

      await act(async () => {
        await Promise.resolve();
      });

      fireEvent.click(screen.getByRole("button", { name: "Correct Q1" }));
      fireEvent.click(screen.getByRole("button", { name: "Correct Q2" }));

      await act(async () => {
        await Promise.resolve();
      });

      fireEvent.click(screen.getByRole("button", { name: /check my foundations/i }));

      await act(async () => {
        await Promise.resolve();
      });

      fireEvent.click(screen.getByRole("button", { name: /start learning/i }));

      expect(screen.getByRole("heading", { name: /finalizing your path/i })).not.toBeNull();
      expect(push).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });

      expect(push).not.toHaveBeenCalled();

      graphReady = true;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });

      expect(push).toHaveBeenCalledWith("/graph/graph-123");
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
