"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { QUESTION_LEVEL_LABELS, QUESTION_TYPE_LABELS, type QuestionData, type QuestionLevel } from "@/lib/content/types";
import { useHydrated, useProgress, type Attempt } from "@/lib/progress/store";
import { formatDue, GRADE_HINTS, GRADE_LABELS, type Grade } from "@/lib/progress/srs";
import { cn } from "@/lib/utils";
import { BookmarkButton } from "./LessonActions";

export const LEVEL_STYLE: Record<QuestionLevel, string> = {
  1: "border-d-beginner/40 bg-d-beginner/10 text-d-beginner",
  2: "border-d-core/40 bg-d-core/10 text-d-core",
  3: "border-d-advanced/40 bg-d-advanced/10 text-d-advanced",
  4: "border-d-senior/40 bg-d-senior/10 text-d-senior",
};

export function LevelTag({ level }: { level: QuestionLevel }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[11px] font-semibold", LEVEL_STYLE[level])}>
      L{level} · {QUESTION_LEVEL_LABELS[level]}
    </span>
  );
}

const GRADE_STYLE: Record<Grade, string> = {
  0: "hover:border-bad/50 hover:bg-bad/10 data-[on=true]:border-bad/60 data-[on=true]:bg-bad/15",
  1: "hover:border-warn/50 hover:bg-warn/10 data-[on=true]:border-warn/60 data-[on=true]:bg-warn/15",
  2: "hover:border-ok/50 hover:bg-ok/10 data-[on=true]:border-ok/60 data-[on=true]:bg-ok/15",
  3: "hover:border-accent/50 hover:bg-accent/10 data-[on=true]:border-accent/60 data-[on=true]:bg-accent/15",
};

export function GradeButtons({ onGrade, selected }: { onGrade: (g: Grade) => void; selected?: Grade }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {([0, 1, 2, 3] as Grade[]).map((g) => (
        <button
          key={g}
          type="button"
          data-on={selected === g}
          onClick={() => onGrade(g)}
          className={cn("rounded-lg border border-border bg-surface px-3 py-2 text-left transition-colors", GRADE_STYLE[g])}
        >
          <div className="text-[13px] font-semibold text-fg">{GRADE_LABELS[g]}</div>
          <div className="text-[11.5px] text-subtle">{GRADE_HINTS[g]}</div>
        </button>
      ))}
    </div>
  );
}

export function Html({ html, className }: { html: string; className?: string }) {
  return <div className={cn("prose prose-academy text-[15px]", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function QuestionCard({
  q,
  source = "lesson",
  lessonLink,
  defaultOpen = false,
  onGraded,
}: {
  q: QuestionData;
  source?: Attempt["source"];
  lessonLink?: { href: string; title: string };
  defaultOpen?: boolean;
  onGraded?: (g: Grade) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [justGraded, setJustGraded] = useState<Grade | undefined>();
  const hydrated = useHydrated((s) => s.hydrated);
  const progress = useProgress((s) => s.questions[q.id]);
  const grade = useProgress((s) => s.gradeQuestion);
  const [highlight, setHighlight] = useState(false);

  useEffect(() => {
    if (window.location.hash === `#${q.id}`) {
      setOpen(true);
      setHighlight(true);
      setTimeout(() => document.getElementById(q.id)?.scrollIntoView({ behavior: "smooth", block: "center" }), 150);
      setTimeout(() => setHighlight(false), 2500);
    }
  }, [q.id]);

  const last = hydrated ? progress?.attempts[progress.attempts.length - 1] : undefined;

  return (
    <article id={q.id} className={cn("scroll-mt-32 rounded-xl border bg-surface transition-shadow", highlight ? "border-accent shadow-[0_0_0_3px] shadow-accent/20" : "border-border")}>
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
        <LevelTag level={q.level} />
        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">{QUESTION_TYPE_LABELS[q.type]}</span>
        {last && (
          <span className="text-[11px] text-subtle">
            Last: <span className="font-medium text-muted">{GRADE_LABELS[last.grade]}</span> · review {formatDue(progress!.srs.due)}
          </span>
        )}
        <span className="ml-auto">
          <BookmarkButton bkey={`q:${q.id}`} label="" className="h-7 border-transparent px-1.5" />
        </span>
      </div>
      <div className="px-4 pt-2 pb-3">
        <h4 className="text-[15.5px] leading-snug font-semibold text-fg">{q.prompt}</h4>
        {lessonLink && (
          <Link href={lessonLink.href} className="mt-0.5 inline-block text-[12px] text-subtle hover:text-accent">
            from {lessonLink.title}
          </Link>
        )}
        {q.promptHtml && <Html html={q.promptHtml} className="mt-2" />}
      </div>
      <div className="border-t border-border px-4 py-3">
        {!open ? (
          <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-2 text-[13px] font-medium text-accent hover:underline">
            <Eye className="h-4 w-4" /> Answer it out loud first — then reveal
          </button>
        ) : (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold tracking-wider text-subtle uppercase">Model answer</span>
              <button type="button" onClick={() => setOpen(false)} className="flex items-center gap-1 text-[12px] text-subtle hover:text-fg">
                <EyeOff className="h-3.5 w-3.5" /> Hide
              </button>
            </div>
            <Html html={q.answerHtml} />
            <div className="mt-4 border-t border-border pt-3">
              <div className="mb-2 text-[12px] text-muted">How close was your answer? (feeds spaced repetition and mastery)</div>
              <GradeButtons
                selected={justGraded}
                onGrade={(g) => {
                  grade(q.id, q.lessonId, g, source);
                  setJustGraded(g);
                  onGraded?.(g);
                }}
              />
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
