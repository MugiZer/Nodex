// @vitest-environment jsdom

import React from "react";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getGraphDiagnosticResultKey } from "@/lib/diagnostic-session";

const replace = vi.fn();

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) =>
    React.createElement(
      "a",
      {
        href,
        className,
      },
      children,
    ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace,
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock("@/lib/supabase", () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { user: { id: "user-123" } } } })),
      signInAnonymously: vi.fn(),
    },
  }),
}));

import LessonPage from "@/app/graph/[id]/lesson/[nodeId]/page";

describe("LessonPage", () => {
  beforeEach(() => {
    replace.mockReset();
    window.sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("waits for prerequisite lesson context before showing a fatal load error", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("/api/graph/graph-123/lesson/")) {
        return new Response(
          JSON.stringify({
            ready: false,
            source: "prerequisite",
            node: null,
            graph_diagnostic_result: null,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (url.includes("/api/graph/graph-123/diagnostic")) {
        return new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({
          graph: {
            id: "graph-123",
            subject: "math",
            topic: "algebra",
            description: "desc",
            version: 1,
            flagged_for_review: false,
            created_at: "2026-04-04T00:00:00Z",
          },
          nodes: [],
          edges: [],
          progress: [],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    render(
      React.createElement(LessonPage, {
        params: {
          id: "graph-123",
          nodeId: "gap:0:basic-probability-theory",
        },
      }),
    );

    expect(await screen.findByRole("heading", { name: /restoring your lesson/i })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: /we couldn't load this lesson/i })).toBeNull();

    window.sessionStorage.setItem(
      getGraphDiagnosticResultKey("graph-123"),
      JSON.stringify({
        requestId: "request-123",
        graphId: "graph-123",
        topic: "algebra",
        gapNames: ["basic probability theory"],
        gapPrerequisites: [
          {
            name: "basic probability theory",
            questions: [
              {
                question: "Q1",
                options: ["A", "B", "C", "D"],
                correctIndex: 0,
                explanation: "Because.",
              },
            ],
          },
        ],
        gapPrerequisiteLessons: [],
        completedGapNodeIds: [],
      }),
    );

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 300));
    });

    expect(screen.getByText(/basic probability theory is part of the foundation/i)).not.toBeNull();
    expect(screen.queryByRole("heading", { name: /we couldn't load this lesson/i })).toBeNull();
  });

  it("normalizes encoded prerequisite route params before resolving the lesson", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("/api/graph/graph-123/lesson/gap%3A0%3Abasic-probability-theory")) {
        return new Response(
          JSON.stringify({
            ready: true,
            source: "prerequisite",
            node: {
              id: "gap:0:basic-probability-theory",
              title: "basic probability theory",
              position: -1,
              lesson_text: "basic probability theory is part of the foundation you need first.",
              isPrerequisite: true,
            },
            graph_diagnostic_result: null,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (url.includes("%253A")) {
        return new Response(JSON.stringify({ error: "double-encoded" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({
          graph: {
            id: "graph-123",
            subject: "math",
            topic: "algebra",
            description: "desc",
            version: 1,
            flagged_for_review: false,
            created_at: "2026-04-04T00:00:00Z",
          },
          nodes: [],
          edges: [],
          progress: [],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });

    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    render(
      React.createElement(LessonPage, {
        params: {
          id: "graph-123",
          nodeId: "gap%3A0%3Abasic-probability-theory",
        },
      }),
    );

    expect(
      await screen.findByText(/basic probability theory is part of the foundation/i),
    ).not.toBeNull();

    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("/api/graph/graph-123/lesson/gap%253A0%253Abasic-probability-theory"),
      ),
    ).toBe(false);
  });
});
