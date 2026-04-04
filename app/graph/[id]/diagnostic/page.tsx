import type { Metadata } from "next";

import { DiagnosticExperience } from "@/components/DiagnosticExperience";

export const metadata: Metadata = {
  title: "Foundation diagnostic",
  description: "Learner diagnostic placement",
};

export default async function DiagnosticPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-6 text-zinc-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <DiagnosticExperience graphId={id} />
      </div>
    </main>
  );
}

