// @vitest-environment jsdom

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-katex", () => ({
  BlockMath: ({ math }: { math: string }) =>
    React.createElement("div", { "data-testid": "block-math" }, math),
  InlineMath: ({ math }: { math: string }) =>
    React.createElement("span", { "data-testid": "inline-math" }, math),
}));

import { renderLessonText } from "@/lib/lesson-text-parser";

describe("renderLessonText", () => {
  it("wraps plain text in a paragraph", () => {
    const { container } = render(React.createElement(React.Fragment, null, renderLessonText("Plain text.")));

    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.querySelector("p")?.textContent).toBe("Plain text.");
  });

  it("renders inline math with InlineMath", () => {
    render(React.createElement(React.Fragment, null, renderLessonText("Use $x^2$ here.")));

    expect(screen.getByTestId("inline-math").textContent).toBe("x^2");
  });

  it("renders display math with BlockMath", () => {
    render(React.createElement(React.Fragment, null, renderLessonText("Show $$E = mc^2$$ now.")));

    expect(screen.getByTestId("block-math").textContent).toBe("E = mc^2");
  });

  it("renders bold text with a strong tag", () => {
    const { container } = render(React.createElement(React.Fragment, null, renderLessonText("This is **bold**.")));

    const strong = container.querySelector("strong.font-semibold");
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe("bold");
  });

  it("splits paragraphs on blank lines", () => {
    const { container } = render(
      React.createElement(React.Fragment, null, renderLessonText("First paragraph.\n\nSecond paragraph.")),
    );

    expect(container.querySelectorAll("p")).toHaveLength(2);
    expect(container.querySelectorAll("p")[0]?.textContent).toBe("First paragraph.");
    expect(container.querySelectorAll("p")[1]?.textContent).toBe("Second paragraph.");
  });

  it("renders mixed formatting in a single string", () => {
    const { container } = render(
      React.createElement(
        React.Fragment,
        null,
        renderLessonText("Intro **bold** and $x^2$.\n\nThen $$E = mc^2$$ with *emphasis*."),
      ),
    );

    expect(container.querySelectorAll("p")).toHaveLength(2);
    expect(container.querySelectorAll("[data-testid='inline-math']")).toHaveLength(1);
    expect(container.querySelectorAll("[data-testid='block-math']")).toHaveLength(1);
    expect(container.querySelector("strong.font-semibold")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("emphasis");
  });
});
