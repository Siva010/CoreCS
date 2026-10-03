import Link from "next/link";
import { getQuestionIndex } from "@/lib/content/loader";
import { QUESTION_TYPE_LABELS, QUESTION_TYPES } from "@/lib/content/types";
import { PageHeader } from "@/components/ui/badges";
import { InterviewHub } from "@/components/interview/InterviewHub";

export const metadata = { title: "Interview Mode" };

const LEVELS = [
  ["L1 · Basic", "Definitions and fundamentals.", "What is TCP?"],
  ["L2 · Intermediate", "Mechanism and reasoning.", "Explain the three-way handshake."],
  ["L3 · Advanced", "Trade-offs and failure scenarios.", "Why does TCP need sequence numbers and acknowledgements?"],
  ["L4 · Senior Touch", "Open-ended engineering questions.", "P99 latency is rising with low CPU and slightly higher packet loss. How would you investigate?"],
];

export default function InterviewPage() {
  const index = getQuestionIndex();
  const typeCounts = QUESTION_TYPES.map((t) => [t, index.filter((q) => q.type === t).length] as const).filter(([, n]) => n > 0);
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-10">
      <PageHeader
        eyebrow="Interview Mode"
        title="Practice the way interviews actually escalate"
        description="Every topic has questions at four levels. Interviewers start with a definition and keep asking “why?” until you run out of mechanism. Train for the follow-ups, not the first question."
      >
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {LEVELS.map(([t, d, ex]) => (
            <div key={t} className="rounded-xl border border-border bg-surface p-3">
              <div className="text-sm font-semibold text-fg">{t}</div>
              <div className="text-[12.5px] text-muted">{d}</div>
              <div className="mt-1.5 text-[12.5px] text-subtle italic">“{ex}”</div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[13px] text-subtle">
          Question types in the bank: {typeCounts.map(([t, n]) => `${QUESTION_TYPE_LABELS[t]} (${n})`).join(" · ")}. Also see the{" "}
          <Link href="/traps" className="text-accent hover:underline">
            Interview Traps
          </Link>{" "}
          — misconceptions that sink otherwise good answers.
        </p>
      </PageHeader>
      <InterviewHub index={index} />
    </div>
  );
}
