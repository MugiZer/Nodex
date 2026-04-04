import type { Metadata } from "next";

import { GraphExperience } from "@/components/GraphExperience";

export const metadata: Metadata = {
  title: "Foundation graph",
  description: "Learner graph view",
};

export default async function GraphPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <main className="h-screen w-screen overflow-hidden bg-[#edf2f7] text-slate-950">
      <GraphExperience graphId={id} />
    </main>
  );
}
