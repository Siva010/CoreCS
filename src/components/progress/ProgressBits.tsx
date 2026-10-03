"use client";
import Link from "next/link";
import { Check, Circle } from "lucide-react";
import { useManifest } from "@/components/providers/Providers";
import { useHydrated, useProgress } from "@/lib/progress/store";
import { areaLessons, groupMastery, LABEL_STYLE, type GroupMastery } from "@/lib/progress/mastery";
import type { SubjectId } from "@/lib/content/types";
import { cn, SUBJECT_STYLE } from "@/lib/utils";

export function LessonCheck({ id, className }: { id: string; className?: string }) {
  const hydrated = useHydrated((s) => s.hydrated);
  const done = useProgress((s) => !!s.lessons[id]?.completedAt);
  return hydrated && done ? (
    <Check className={cn("h-4 w-4 shrink-0 text-ok", className)} aria-label="Completed" />
  ) : (
    <Circle className={cn("h-4 w-4 shrink-0 text-border-strong", className)} aria-label="Not completed" />
  );
}

export function LevelCount({ ids }: { ids: string[] }) {
  const hydrated = useHydrated((s) => s.hydrated);
  const lessons = useProgress((s) => s.lessons);
  const done = hydrated ? ids.filter((id) => lessons[id]?.completedAt).length : 0;
  return (
    <span className="font-mono text-[12px] text-subtle">
      {done}/{ids.length}
    </span>
  );
}

export function MeterBar({ value, className, colorClass = "bg-accent" }: { value: number; className?: string; colorClass?: string }) {
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-2", className)} role="meter" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full transition-all", colorClass)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function useSubjectMastery(subject: SubjectId) {
  const manifest = useManifest();
  const hydrated = useHydrated((s) => s.hydrated);
  const state = useProgress();
  const subj = manifest.subjects.find((s) => s.id === subject)!;
  const lessons = manifest.lessons.filter((l) => l.subject === subject);
  const overall = groupMastery(lessons, state);
  const areas = subj.areas.map((a) => ({ area: a, m: groupMastery(areaLessons(manifest, subject, a), state) }));
  return { hydrated, subj, overall, areas };
}

export function MasteryLabel({ m }: { m: GroupMastery }) {
  return <span className={cn("font-medium", LABEL_STYLE[m.label])}>{m.label}</span>;
}

/** The compact "OS ████████░░ 82% · Concurrency: Strong" block. */
export function SubjectMasteryCard({ subject, href }: { subject: SubjectId; href?: string }) {
  const { hydrated, subj, overall, areas } = useSubjectMastery(subject);
  const style = SUBJECT_STYLE[subject];
  const body = (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div className={cn("font-semibold", style.text)}>{subj.title}</div>
        <div className="font-mono text-sm text-fg">{hydrated ? overall.score : 0}%</div>
      </div>
      <MeterBar value={hydrated ? overall.score : 0} className="mt-2" colorClass={style.dot} />
      <div className="mt-1 text-[12px] text-subtle">
        {hydrated ? overall.completed : 0}/{overall.total} lessons · {hydrated ? overall.attempted : 0} answers graded
      </div>
      <ul className="mt-3 space-y-1 text-[13px]">
        {areas.map(({ area, m }) => (
          <li key={area.id} className="flex items-center justify-between gap-2">
            <span className="text-muted">{area.title}</span>
            {hydrated ? <MasteryLabel m={m} /> : <span className="text-subtle">—</span>}
          </li>
        ))}
      </ul>
    </div>
  );
  return href ? (
    <Link href={href} className="block transition-transform hover:-translate-y-0.5">
      {body}
    </Link>
  ) : (
    body
  );
}

export function ContinueLearning() {
  const manifest = useManifest();
  const hydrated = useHydrated((s) => s.hydrated);
  const lessons = useProgress((s) => s.lessons);
  if (!hydrated) return null;
  const visited = Object.entries(lessons)
    .filter(([, p]) => p.visitedAt && !p.completedAt)
    .sort((a, b) => (b[1].visitedAt ?? 0) - (a[1].visitedAt ?? 0));
  const resume = visited.map(([id]) => manifest.lessons.find((l) => l.id === id)).find(Boolean);
  // Next unlocked: first lesson in curriculum order whose prerequisites are all complete and which is not complete.
  const done = (id: string) => !!lessons[id]?.completedAt;
  const nextUp = manifest.lessons.find((l) => !done(l.id) && l.stage <= 2 && l.prerequisites.every(done));
  if (!resume && !nextUp) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {resume && (
        <Link href={resume.href} className="rounded-xl border border-accent/40 bg-accent/5 p-4 hover:bg-accent/10">
          <div className="text-[11px] font-semibold tracking-wider text-accent uppercase">Continue where you left off</div>
          <div className="mt-1 font-medium text-fg">{resume.title}</div>
        </Link>
      )}
      {nextUp && nextUp.id !== resume?.id && (
        <Link href={nextUp.href} className="rounded-xl border border-border bg-surface p-4 hover:border-accent/40">
          <div className="text-[11px] font-semibold tracking-wider text-subtle uppercase">Next unlocked concept</div>
          <div className="mt-1 font-medium text-fg">{nextUp.title}</div>
        </Link>
      )}
    </div>
  );
}
