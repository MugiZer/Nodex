import { renderToString } from "react-dom/server";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { DiagnosticFlow } from "@/components/DiagnosticFlow";
import type { GraphPayload } from "@/lib/types";

import { baseGraphPayloadFixture } from "../harness/fixtures";

describe("DiagnosticFlow", () => {
  it("renders a safe fallback when the graph has no diagnostic nodes", () => {
    const payload: GraphPayload = {
      ...baseGraphPayloadFixture,
      nodes: [],
      edges: [],
      progress: [],
    };

    const html = renderToString(
      React.createElement(DiagnosticFlow, {
        payload,
        onComplete: vi.fn(),
      }),
    );

    expect(html).toContain("This graph does not have diagnostic-ready nodes yet.");
    expect(html).toContain("Diagnostic unavailable");
  });
});
