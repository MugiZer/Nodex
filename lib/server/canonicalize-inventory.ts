import type {
  CandidateConfidenceBand,
  CanonicalizationSource,
  CanonicalizeInventoryEntry,
} from "@/lib/types";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizePromptText(value: string): string {
  return normalizeWhitespace(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim(),
  );
}

function normalizeTopicSlug(topic: string): string {
  return normalizeWhitespace(topic)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function tokenize(value: string): string[] {
  return normalizePromptText(value)
    .split(" ")
    .filter((part) => part.length > 0);
}

function containsNormalizedPhrase(prompt: string, phrase: string): boolean {
  const normalizedPhrase = normalizePromptText(phrase);
  if (normalizedPhrase.length === 0) {
    return false;
  }

  return new RegExp(`(^| )${escapeRegExp(normalizedPhrase)}( |$)`).test(prompt);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function allTokensPresent(promptTokens: Set<string>, phrase: string): boolean {
  const tokens = tokenize(phrase);
  return tokens.length > 0 && tokens.every((token) => promptTokens.has(token));
}

export const CANONICALIZE_INVENTORY: CanonicalizeInventoryEntry[] = [
  {
    subject: "mathematics",
    topic: "algebra",
    scope_summary:
      "symbols, expressions, equations, and functions used to represent and manipulate quantitative relationships",
    core_concepts: [
      "expressions",
      "equations",
      "functions",
      "inequalities",
      "polynomials",
      "factoring",
      "systems of equations",
    ],
    prerequisites: ["arithmetic"],
    downstream_topics: ["trigonometry", "calculus", "statistics"],
    level: "introductory",
    aliases: ["algebra", "elementary algebra", "functions and equations"],
    broad_prompt_aliases: ["math", "mathematics", "basic math"],
    starter_for_subject: "mathematics",
  },
  {
    subject: "mathematics",
    topic: "differential_calculus",
    scope_summary:
      "rates of change, slopes, and local behavior of functions using the derivative",
    core_concepts: [
      "limits",
      "continuity",
      "derivatives",
      "derivative rules",
      "implicit differentiation",
      "optimization",
      "curve sketching",
    ],
    prerequisites: ["algebra", "functions", "trigonometry"],
    downstream_topics: ["integral_calculus", "differential_equations", "multivariable_calculus"],
    level: "intermediate",
    aliases: ["differential calculus", "intro calculus", "calc 1"],
    broad_prompt_aliases: ["calculus"],
    starter_for_subject: null,
  },
  {
    subject: "physics",
    topic: "classical_mechanics",
    scope_summary:
      "motion, forces, energy, and momentum in systems governed by Newtonian mechanics",
    core_concepts: [
      "kinematics",
      "Newton's laws",
      "free-body diagrams",
      "work and energy",
      "momentum",
      "rotational motion",
      "oscillations",
    ],
    prerequisites: ["algebra", "trigonometry"],
    downstream_topics: ["electromagnetism", "differential_equations", "quantum_mechanics"],
    level: "intermediate",
    aliases: ["classical mechanics", "mechanics", "newtonian physics"],
    broad_prompt_aliases: ["physics"],
    starter_for_subject: "physics",
  },
  {
    subject: "computer_science",
    topic: "programming_fundamentals",
    scope_summary:
      "how programs represent data, control execution, and solve problems with code",
    core_concepts: [
      "variables",
      "control flow",
      "functions",
      "data structures",
      "iteration",
      "debugging",
      "modularity",
    ],
    prerequisites: ["basic arithmetic"],
    downstream_topics: ["data_structures", "algorithms", "software_engineering"],
    level: "introductory",
    aliases: ["programming fundamentals", "programming basics", "coding basics"],
    broad_prompt_aliases: ["computer science", "cs"],
    starter_for_subject: "computer_science",
  },
  {
    subject: "chemistry",
    topic: "general_chemistry",
    scope_summary:
      "atoms, bonding, reactions, and quantitative relationships that organize introductory chemistry",
    core_concepts: [
      "atomic structure",
      "periodic trends",
      "chemical bonding",
      "stoichiometry",
      "states of matter",
      "thermochemistry",
      "reaction types",
    ],
    prerequisites: ["arithmetic", "basic algebra"],
    downstream_topics: ["organic_chemistry", "physical_chemistry", "biochemistry"],
    level: "introductory",
    aliases: ["general chemistry", "chemistry basics", "intro chemistry"],
    broad_prompt_aliases: ["chemistry"],
    starter_for_subject: "chemistry",
  },
  {
    subject: "biology",
    topic: "cell_biology",
    scope_summary:
      "cell structure, molecular processes, and regulation of life at the cellular level",
    core_concepts: [
      "cell organelles",
      "membranes",
      "gene expression",
      "cell signaling",
      "metabolism",
      "cell cycle",
      "transport mechanisms",
    ],
    prerequisites: ["basic chemistry"],
    downstream_topics: ["genetics", "molecular_biology", "biochemistry"],
    level: "introductory",
    aliases: ["cell biology", "intro biology", "biology basics"],
    broad_prompt_aliases: ["biology"],
    starter_for_subject: "biology",
  },
  {
    subject: "economics",
    topic: "microeconomics",
    scope_summary:
      "individual decision making, markets, incentives, and resource allocation under scarcity",
    core_concepts: [
      "supply and demand",
      "elasticity",
      "consumer choice",
      "production costs",
      "market structures",
      "externalities",
      "game theory basics",
    ],
    prerequisites: ["basic algebra"],
    downstream_topics: ["macroeconomics", "industrial_organization", "behavioral_economics"],
    level: "introductory",
    aliases: ["microeconomics", "economics basics", "market economics"],
    broad_prompt_aliases: ["economics"],
    starter_for_subject: "economics",
  },
  {
    subject: "financial_literacy",
    topic: "personal_finance_fundamentals",
    scope_summary:
      "budgeting, saving, borrowing, and investing decisions for long-term personal financial health",
    core_concepts: [
      "budgeting",
      "cash flow",
      "interest",
      "credit",
      "saving",
      "investing basics",
      "risk management",
    ],
    prerequisites: ["basic arithmetic"],
    downstream_topics: ["retirement_planning", "portfolio_basics", "debt_management"],
    level: "introductory",
    aliases: ["personal finance", "finance basics", "money management"],
    broad_prompt_aliases: ["financial literacy", "finance"],
    starter_for_subject: "financial_literacy",
  },
  {
    subject: "statistics",
    topic: "descriptive_statistics",
    scope_summary:
      "summarizing, visualizing, and interpreting data using central tendency and variability",
    core_concepts: [
      "data distributions",
      "mean median mode",
      "variance",
      "standard deviation",
      "data visualization",
      "percentiles",
      "outliers",
    ],
    prerequisites: ["basic algebra"],
    downstream_topics: ["probability", "inferential_statistics", "regression_analysis"],
    level: "introductory",
    aliases: ["descriptive statistics", "statistics basics", "data summaries"],
    broad_prompt_aliases: ["statistics", "stats"],
    starter_for_subject: "statistics",
  },
  {
    subject: "engineering",
    topic: "statics",
    scope_summary:
      "forces, moments, and equilibrium in stationary engineering systems and structures",
    core_concepts: [
      "force vectors",
      "moments",
      "equilibrium",
      "free-body diagrams",
      "trusses",
      "centroids",
      "distributed loads",
    ],
    prerequisites: ["algebra", "trigonometry"],
    downstream_topics: ["dynamics", "mechanics_of_materials", "strength_of_materials"],
    level: "intermediate",
    aliases: ["statics", "engineering mechanics", "equilibrium of forces"],
    broad_prompt_aliases: ["engineering"],
    starter_for_subject: "engineering",
  },
  {
    subject: "philosophy",
    topic: "formal_logic",
    scope_summary:
      "valid inference, logical form, and symbolic reasoning in structured arguments",
    core_concepts: [
      "propositions",
      "truth tables",
      "logical connectives",
      "quantifiers",
      "proof strategies",
      "validity",
      "fallacies",
    ],
    prerequisites: ["reading comprehension"],
    downstream_topics: ["set_theory", "philosophy_of_language", "predicate_logic"],
    level: "introductory",
    aliases: ["formal logic", "symbolic logic", "logic basics"],
    broad_prompt_aliases: ["philosophy", "logic"],
    starter_for_subject: "philosophy",
  },
];

export type RankedCanonicalizeInventoryCandidate = {
  entry: CanonicalizeInventoryEntry;
  score: number;
  reasons: string[];
};

export type CanonicalizeGroundingPlan = {
  source: CanonicalizationSource;
  candidate_confidence_band: CandidateConfidenceBand;
  inventory_candidate_topics: string[];
  grounded_match: CanonicalizeInventoryEntry | null;
  grounded_candidates: CanonicalizeInventoryEntry[];
  ranked_candidates: RankedCanonicalizeInventoryCandidate[];
};

function scoreCandidate(
  prompt: string,
  promptTokens: Set<string>,
  entry: CanonicalizeInventoryEntry,
): RankedCanonicalizeInventoryCandidate {
  const reasons: string[] = [];
  let score = 0;

  for (const phrase of entry.broad_prompt_aliases) {
    const normalizedPhrase = normalizePromptText(phrase);
    if (prompt === normalizedPhrase) {
      score += 220;
      reasons.push(`exact_broad:${normalizedPhrase}`);
      continue;
    }

    if (containsNormalizedPhrase(prompt, normalizedPhrase)) {
      score += 150;
      reasons.push(`contains_broad:${normalizedPhrase}`);
      continue;
    }

    if (allTokensPresent(promptTokens, normalizedPhrase)) {
      score += 85;
      reasons.push(`tokens_broad:${normalizedPhrase}`);
    }
  }

  for (const phrase of entry.aliases) {
    const normalizedPhrase = normalizePromptText(phrase);
    if (prompt === normalizedPhrase) {
      score += 180;
      reasons.push(`exact_alias:${normalizedPhrase}`);
      continue;
    }

    if (containsNormalizedPhrase(prompt, normalizedPhrase)) {
      score += 120;
      reasons.push(`contains_alias:${normalizedPhrase}`);
      continue;
    }

    if (allTokensPresent(promptTokens, normalizedPhrase)) {
      score += 70;
      reasons.push(`tokens_alias:${normalizedPhrase}`);
    }
  }

  const normalizedTopic = normalizePromptText(entry.topic.replace(/_/g, " "));
  if (containsNormalizedPhrase(prompt, normalizedTopic)) {
    score += 60;
    reasons.push(`contains_topic:${normalizedTopic}`);
  }

  return {
    entry,
    score,
    reasons,
  };
}

export function rankCanonicalizeInventoryCandidates(
  prompt: string,
): RankedCanonicalizeInventoryCandidate[] {
  const normalizedPrompt = normalizePromptText(prompt);
  const promptTokens = new Set(tokenize(normalizedPrompt));

  return CANONICALIZE_INVENTORY.map((entry) =>
    scoreCandidate(normalizedPrompt, promptTokens, entry),
  )
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.entry.topic.localeCompare(right.entry.topic);
    });
}

export function planGroundedCanonicalization(prompt: string): CanonicalizeGroundingPlan {
  const rankedCandidates = rankCanonicalizeInventoryCandidates(prompt);
  const top = rankedCandidates[0] ?? null;
  const second = rankedCandidates[1] ?? null;
  const margin = top ? top.score - (second?.score ?? 0) : 0;

  if (!top) {
    return {
      source: "model_only",
      candidate_confidence_band: "none",
      inventory_candidate_topics: [],
      grounded_match: null,
      grounded_candidates: [],
      ranked_candidates: [],
    };
  }

  const constrainedCandidates = rankedCandidates
    .filter((candidate) => candidate.score >= top.score - 30)
    .slice(0, 3);
  const candidateTopics = constrainedCandidates.map((candidate) => candidate.entry.topic);

  if (top.score >= 150 && margin >= 40) {
    return {
      source: "grounded_match",
      candidate_confidence_band: "high",
      inventory_candidate_topics: [top.entry.topic],
      grounded_match: top.entry,
      grounded_candidates: [top.entry],
      ranked_candidates: rankedCandidates,
    };
  }

  if (top.score >= 120) {
    return {
      source: "grounded_plus_model",
      candidate_confidence_band: margin >= 25 ? "medium" : "medium",
      inventory_candidate_topics: candidateTopics,
      grounded_match: null,
      grounded_candidates: constrainedCandidates.map((candidate) => candidate.entry),
      ranked_candidates: rankedCandidates,
    };
  }

  return {
    source: "model_only",
    candidate_confidence_band: "low",
    inventory_candidate_topics: candidateTopics,
    grounded_match: null,
    grounded_candidates: [],
    ranked_candidates: rankedCandidates,
  };
}

export function isInventoryTopic(topic: string): boolean {
  const normalized = normalizeTopicSlug(topic);
  return CANONICALIZE_INVENTORY.some((entry) => entry.topic === normalized);
}
