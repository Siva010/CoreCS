"use client";
import { CircleCheck } from "lucide-react";
import { useHydrated, useProgress } from "@/lib/progress/store";

/** Logs a studied case study into practice history. */
export function CaseStudyTracker({ id, title }: { id: string; title: string }) {
  const hydrated = useHydrated((s) => s.hydrated);
  const history = useProgress((s) => s.history);
  const log = useProgress((s) => s.logHistory);
  const done = hydrated && history.some((h) => h.kind === "practice" && h.href === `/case-studies/${id}`);
  return (
    <button
      type="button"
      disabled={done}
      onClick={() => log({ kind: "practice", title: `Case study: ${title}`, href: `/case-studies/${id}` })}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[13px] font-medium text-muted hover:text-fg disabled:border-ok/40 disabled:bg-ok/10 disabled:text-ok"
    >
      <CircleCheck className="h-3.5 w-3.5" />
      {done ? "Studied" : "Mark as studied"}
    </button>
  );
}
