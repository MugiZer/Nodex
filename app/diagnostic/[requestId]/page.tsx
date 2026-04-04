import type { Metadata } from "next";

import { PrerequisiteDiagnosticExperience } from "@/components/PrerequisiteDiagnosticExperience";

export const metadata: Metadata = {
  title: "Foundation diagnostic",
  description: "Prerequisite diagnostic",
};

export default async function DiagnosticPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { requestId } = await params;

  return (
    <main
      className="relative isolate min-h-screen overflow-hidden px-5 py-14 text-slate-900 sm:px-6 sm:py-16"
      style={{
        background:
          "radial-gradient(circle at 14% 18%, rgba(96,165,250,0.14) 0%, rgba(96,165,250,0) 24%), radial-gradient(circle at 82% 16%, rgba(148,163,184,0.12) 0%, rgba(148,163,184,0) 23%), radial-gradient(circle at 50% 112%, rgba(186,230,253,0.14) 0%, rgba(186,230,253,0) 36%), linear-gradient(180deg, rgba(251,252,254,1) 0%, rgba(241,245,249,1) 54%, rgba(236,242,247,1) 100%)",
      }}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[-8rem] top-8 h-[30rem] w-[30rem] rounded-full bg-sky-300/12 blur-3xl" />
        <div className="absolute right-[-9rem] top-24 h-[34rem] w-[34rem] rounded-full bg-slate-400/10 blur-3xl" />
        <div className="absolute left-1/2 top-[-10rem] h-[22rem] w-[42rem] -translate-x-1/2 rounded-full bg-white/55 blur-3xl" />
        <div className="absolute bottom-[-12rem] left-1/2 h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-cyan-200/12 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.45)_0%,rgba(255,255,255,0.08)_42%,rgba(255,255,255,0)_70%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.15)_0%,rgba(255,255,255,0)_22%,rgba(255,255,255,0.12)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(15,23,42,0.02)_1px,transparent_1px),linear-gradient(rgba(15,23,42,0.02)_1px,transparent_1px)] bg-[size:120px_120px] opacity-[0.08] [mask-image:radial-gradient(circle_at_center,black_45%,transparent_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_36%,rgba(15,23,42,0.03)_100%)]" />
      </div>
      <PrerequisiteDiagnosticExperience requestId={requestId} />
    </main>
  );
}
