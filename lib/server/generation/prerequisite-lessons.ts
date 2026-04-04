import { z } from "zod";

import { ApiError } from "@/lib/errors";
import type { RequestLogContext } from "@/lib/logging";
import type { FlagshipLesson } from "@/lib/types";

import { executeLlmStage, type LlmStageDependencies } from "./llm-stage";

const PREREQUISITE_LESSON_MAX_TOKENS = 4000;
const PREREQUISITE_LESSON_TIMEOUT_MS = 60_000;

const prerequisiteLessonSchema = z
  .object({
    version: z.literal("flagship-v1"),
    predictionTrap: z
      .object({
        question: z.string().trim().min(1),
        obviousAnswer: z.string().trim().min(1),
        correctAnswer: z.string().trim().min(1),
        whyWrong: z.string().trim().min(1),
      })
      .strict(),
    guidedInsight: z
      .object({
        ground: z.string().trim().min(1),
        mechanism: z.string().trim().min(1),
        surprise: z.string().trim().min(1),
        reframe: z.string().trim().min(1),
      })
      .strict(),
    workedExample: z
      .object({
        setup: z.string().trim().min(1),
        naiveAttempt: z.string().trim().min(1),
        steps: z
          .array(
            z
              .object({
                action: z.string().trim().min(1),
                result: z.string().trim().min(1),
              })
              .strict(),
          )
          .length(3),
        takeaway: z.string().trim().min(1),
      })
      .strict(),
    whatIf: z
      .object({
        question: z.string().trim().min(1),
        options: z
          .array(
            z
              .object({
                text: z.string().trim().min(1),
                isCorrect: z.boolean(),
                explanation: z.string().trim().min(1),
              })
              .strict(),
          )
          .length(3),
      })
      .strict()
      .superRefine((value, ctx) => {
        if (value.options.filter((option) => option.isCorrect).length !== 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["options"],
            message: "Flagship whatIf must contain exactly one correct option.",
          });
        }
      }),
    masteryCheck: z
      .object({
        stem: z.string().trim().min(1),
        options: z
          .array(
            z
              .object({
                text: z.string().trim().min(1),
                isCorrect: z.boolean(),
                feedback: z.string().trim().min(1),
              })
              .strict(),
          )
          .length(4),
        forwardHook: z.string().trim().min(1),
      })
      .strict()
      .superRefine((value, ctx) => {
        if (value.options.filter((option) => option.isCorrect).length !== 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["options"],
            message: "Flagship masteryCheck must contain exactly one correct option.",
          });
        }
      }),
    anchor: z
      .object({
        summary: z.string().trim().min(1),
        bridge: z.string().trim().min(1),
      })
      .strict(),
  })
  .strict();

function buildPrerequisiteLessonSystemPrompt(): string {
  return `You are creating a flagship lesson for a prerequisite node that a learner must master before studying a main topic.

OUTPUT FORMAT: A single JSON object with 6 sections. No markdown fences, no commentary outside the JSON.

TEXT FORMATTING RULES (apply to ALL string values):
- Use $...$ for inline math where appropriate.
- Use $$...$$ for display math when the equation deserves its own line.
- Use **...** for key terms or emphasis on first introduction.
- Keep the lesson specific, concrete, and hand-authored in tone.
- Do not use markdown lists or headings inside the JSON strings.

SECTION 1 - predictionTrap
"predictionTrap": {
  "question": "...",
  "obviousAnswer": "...",
  "correctAnswer": "...",
  "whyWrong": "..."
}

SECTION 2 - guidedInsight
"guidedInsight": {
  "ground": "...",
  "mechanism": "...",
  "surprise": "...",
  "reframe": "..."
}

SECTION 3 - workedExample
"workedExample": {
  "setup": "...",
  "naiveAttempt": "...",
  "steps": [
    { "action": "...", "result": "..." },
    { "action": "...", "result": "..." },
    { "action": "...", "result": "..." }
  ],
  "takeaway": "..."
}

SECTION 4 - whatIf
"whatIf": {
  "question": "...",
  "options": [
    { "text": "...", "isCorrect": false, "explanation": "..." },
    { "text": "...", "isCorrect": true, "explanation": "..." },
    { "text": "...", "isCorrect": false, "explanation": "..." }
  ]
}

SECTION 5 - masteryCheck
"masteryCheck": {
  "stem": "...",
  "options": [
    { "text": "...", "isCorrect": false, "feedback": "..." },
    { "text": "...", "isCorrect": true, "feedback": "..." },
    { "text": "...", "isCorrect": false, "feedback": "..." },
    { "text": "...", "isCorrect": false, "feedback": "..." }
  ],
  "forwardHook": "..."
}

SECTION 6 - anchor
"anchor": {
  "summary": "...",
  "bridge": "..."
}

The lesson should:
- teach the prerequisite concept as the learner's next foundational step
- feel like a polished flagship lesson, not a brief review card
- connect directly to the target topic without solving the main topic yet
- use concrete examples and plausible misconceptions
- be self-contained and suitable for a learner who needs to close a foundation gap before moving on`;
}

function buildPrerequisiteLessonUserPrompt(input: {
  topic: string;
  prerequisiteName: string;
  diagnosticQuestions: string[];
}): string {
  return [
    `Target topic: ${input.topic}`,
    `Prerequisite to teach: ${input.prerequisiteName}`,
    `Diagnostic signals from the learner: ${input.diagnosticQuestions.join(" | ")}`,
    "",
    "Generate the flagship lesson JSON. Output only valid JSON, no other text.",
  ].join("\n");
}

export async function generatePrerequisiteFlagshipLesson(
  input: {
    topic: string;
    prerequisiteName: string;
    diagnosticQuestions: string[];
  },
  context?: RequestLogContext,
  dependencies: LlmStageDependencies<FlagshipLesson> = {},
): Promise<FlagshipLesson | null> {
  try {
    const result = await executeLlmStage({
      stage: "lessons",
      systemPrompt: buildPrerequisiteLessonSystemPrompt(),
      userPrompt: buildPrerequisiteLessonUserPrompt(input),
      schema: prerequisiteLessonSchema,
      failureCategory: "llm_output_invalid",
      timeoutMs: PREREQUISITE_LESSON_TIMEOUT_MS,
      maxTokens: PREREQUISITE_LESSON_MAX_TOKENS,
      maxAttempts: 1,
      context,
      dependencies,
      logDetails: {
        topic: input.topic,
        prerequisite_name: input.prerequisiteName,
      },
    });

    return result;
  } catch (error) {
    if (error instanceof ApiError) {
      return null;
    }

    return null;
  }
}

export async function generatePrerequisiteFlagshipLessons(
  input: {
    topic: string;
    prerequisiteNames: string[];
  },
  context?: RequestLogContext,
): Promise<Array<{ name: string; lesson: FlagshipLesson }>> {
  const results = await Promise.allSettled(
    input.prerequisiteNames.map(async (prerequisiteName) => {
      const lesson = await generatePrerequisiteFlagshipLesson(
        {
          topic: input.topic,
          prerequisiteName,
          diagnosticQuestions: [],
        },
        context,
      );

      if (!lesson) {
        return null;
      }

      return {
        name: prerequisiteName,
        lesson,
      };
    }),
  );

  return results.flatMap((result) => {
    if (result.status !== "fulfilled" || result.value === null) {
      return [];
    }

    return [result.value];
  });
}
