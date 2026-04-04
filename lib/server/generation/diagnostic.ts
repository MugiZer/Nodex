import { z } from "zod";

import { ApiError } from "@/lib/errors";
import type { RequestLogContext } from "@/lib/logging";

import {
  prerequisiteDiagnosticSchema,
  type PrerequisiteDiagnostic,
} from "./contracts";
import { executeLlmStage, type LlmStageDependencies } from "./llm-stage";

const PREREQUISITE_DIAGNOSTIC_MAX_TOKENS = 2500;
const PREREQUISITE_DIAGNOSTIC_TIMEOUT_MS = 30_000;
const MAX_PREREQUISITES = 5;

const diagnosticSchema = prerequisiteDiagnosticSchema.superRefine((value, ctx) => {
  for (let index = 0; index < value.prerequisites.length; index += 1) {
    const prerequisite = value.prerequisites[index];
    if (prerequisite.questions.length !== 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["prerequisites", index, "questions"],
        message: "Each prerequisite must contain exactly 2 questions.",
      });
    }
  }
});

export type PrerequisiteDiagnosticDependencies =
  LlmStageDependencies<PrerequisiteDiagnostic>;

function buildSystemPrompt(): string {
  return `You are generating a prerequisite diagnostic for a learner who wants to study a specific topic. They claim to understand the prerequisites listed below. Generate exactly 2 multiple-choice questions per prerequisite to verify genuine understanding.

OUTPUT FORMAT: A single JSON object. No markdown fences, no commentary.

{
  "prerequisites": [
    {
      "name": "prerequisite name exactly as provided",
      "questions": [
        {
          "question": "A concrete question testing understanding, not just recall",
          "options": ["option A", "option B", "option C", "option D"],
          "correctIndex": 0,
          "explanation": "1-2 sentences explaining why the correct answer is right"
        },
        {
          "question": "...",
          "options": ["...", "...", "...", "..."],
          "correctIndex": 2,
          "explanation": "..."
        }
      ]
    }
  ]
}

QUESTION QUALITY RULES:
- Each question must test whether the learner can APPLY the concept, not just define it.
- Bad: "What is a derivative?" Good: "If f(x) = x³, what is f'(2)?"
- Bad: "What does a matrix represent?" Good: "If you multiply a 3×2 matrix by a 2×4 matrix, what dimensions is the result?"
- Each wrong option should represent a specific, plausible misconception.
- Questions should be answerable in 10-15 seconds by someone who genuinely understands the prerequisite.
- Use $...$ for inline math where appropriate (KaTeX syntax).
- Do NOT use markdown headers, bullets, or formatting beyond math delimiters.`;
}

function buildUserPrompt(topic: string, prerequisites: string[]): string {
  return [
    `Topic the learner wants to study: ${topic}`,
    `Prerequisites to diagnose: ${prerequisites.join(", ")}`,
    "",
    "Generate the diagnostic JSON. Output only valid JSON, no other text.",
  ].join("\n");
}

export async function generatePrerequisiteDiagnostic(
  input: {
    topic: string;
    prerequisites: string[];
  },
  context?: RequestLogContext,
  dependencies: PrerequisiteDiagnosticDependencies = {},
): Promise<PrerequisiteDiagnostic | null> {
  const prerequisites = input.prerequisites
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .slice(0, MAX_PREREQUISITES);

  if (prerequisites.length === 0) {
    return {
      prerequisites: [],
    };
  }

  try {
    const result = await executeLlmStage({
      stage: "prerequisite_diagnostic",
      systemPrompt: buildSystemPrompt(),
      userPrompt: buildUserPrompt(input.topic, prerequisites),
      schema: diagnosticSchema,
      failureCategory: "llm_output_invalid",
      timeoutMs: PREREQUISITE_DIAGNOSTIC_TIMEOUT_MS,
      maxTokens: PREREQUISITE_DIAGNOSTIC_MAX_TOKENS,
      maxAttempts: 2,
      context,
      dependencies,
      logDetails: {
        topic: input.topic,
        prerequisite_count: prerequisites.length,
      },
    });

    return {
      prerequisites: result.prerequisites.map((prerequisite) => ({
        name: prerequisite.name,
        questions: [
          {
            question: prerequisite.questions[0]!.question,
            options: [
              prerequisite.questions[0]!.options[0]!,
              prerequisite.questions[0]!.options[1]!,
              prerequisite.questions[0]!.options[2]!,
              prerequisite.questions[0]!.options[3]!,
            ],
            correctIndex: prerequisite.questions[0]!.correctIndex,
            explanation: prerequisite.questions[0]!.explanation,
          },
          {
            question: prerequisite.questions[1]!.question,
            options: [
              prerequisite.questions[1]!.options[0]!,
              prerequisite.questions[1]!.options[1]!,
              prerequisite.questions[1]!.options[2]!,
              prerequisite.questions[1]!.options[3]!,
            ],
            correctIndex: prerequisite.questions[1]!.correctIndex,
            explanation: prerequisite.questions[1]!.explanation,
          },
        ],
      })),
    };
  } catch (error) {
    if (error instanceof ApiError) {
      return null;
    }

    return null;
  }
}
