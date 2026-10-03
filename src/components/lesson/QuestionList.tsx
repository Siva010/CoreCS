"use client";
import { useMemo, useState } from "react";
import { QUESTION_LEVEL_LABELS, type QuestionData, type QuestionLevel } from "@/lib/content/types";
import { cn } from "@/lib/utils";
import { QuestionCard } from "./QuestionCard";
import { useLessonMode } from "./LessonShell";

const LEVEL_BLURB: Record<QuestionLevel, string> = {
  1: "Definitions and fundamentals — you should never miss these.",
  2: "Mechanisms and reasoning — the usual follow-ups.",
  3: "Trade-offs and failure scenarios — where strong candidates separate.",
  4: "Open-ended engineering questions. Answer with a process, not a fact.",
};

export function QuestionList({ questions }: { questions: QuestionData[] }) {
  const { mode } = useLessonMode();
  const [filter, setFilter] = useState<QuestionLevel | 0>(0);
  // In 30-minute revision mode, focus on the core questions.
  const pool = useMemo(() => (mode === "30" ? questions.filter((q) => q.level <= 2) : questions), [questions, mode]);
  const levels = ([1, 2, 3, 4] as QuestionLevel[]).filter((l) => pool.some((q) => q.level === l));
  const shown = filter ? pool.filter((q) => q.level === filter) : pool;

  if (!questions.length) return <p className="text-sm text-subtle">No questions yet.</p>;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-1.5">
        {([0, ...levels] as (QuestionLevel | 0)[]).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setFilter(l)}
            className={cn(
              "rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors",
              filter === l ? "border-fg bg-fg text-bg" : "border-border bg-surface text-muted hover:text-fg",
            )}
          >
            {l === 0 ? `All (${pool.length})` : `L${l} ${QUESTION_LEVEL_LABELS[l]} (${pool.filter((q) => q.level === l).length})`}
          </button>
        ))}
        {mode === "30" && <span className="text-[12px] text-subtle">30-minute mode shows Basic and Intermediate only.</span>}
      </div>
      {levels
        .filter((l) => !filter || l === filter)
        .map((l) => (
          <div key={l} className="mb-8">
            <h3 className="mb-1 text-base font-semibold text-fg">
              {l >= 3 ? "Advanced Questions — " : ""}
              {QUESTION_LEVEL_LABELS[l]}
            </h3>
            <p className="mb-3 text-[13px] text-subtle">{LEVEL_BLURB[l]}</p>
            <div className="space-y-3">
              {shown
                .filter((q) => q.level === l)
                .map((q) => (
                  <QuestionCard key={q.id} q={q} />
                ))}
            </div>
          </div>
        ))}
    </div>
  );
}
