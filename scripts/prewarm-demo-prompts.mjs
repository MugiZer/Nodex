const baseUrl = process.env.FOUNDATION_BASE_URL ?? "http://localhost:3000";

const demoPrompts = [
  "teach me backpropagation",
  "i want to learn trigonometry",
  "teach me mitosis",
];

async function prewarmPrompt(prompt) {
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ prompt }),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Prewarm failed for "${prompt}" with status ${response.status}: ${JSON.stringify(body)}`,
    );
  }

  return {
    prompt,
    graphId: body?.graph_id ?? null,
    cached: body?.cached ?? null,
  };
}

async function main() {
  console.log(`Prewarming demo prompts against ${baseUrl}`);

  for (const prompt of demoPrompts) {
    const result = await prewarmPrompt(prompt);
    console.log(
      `- ${result.prompt} -> graph_id=${result.graphId} cached=${String(result.cached)}`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
