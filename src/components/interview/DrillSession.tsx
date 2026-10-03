"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, RotateCcw, SkipForward, Timer, X } from "lucide-react";
import type { QuestionData } from "@/lib/content/types";
import { QuestionCard } from "@/components/lesson/QuestionCard";
import { useManifest } from "@/components/providers/Providers";
import { useProgress, type Attempt } from "@/lib/progress/store";
import { GRADE_LABELS, type Grade } from "@/lib/progress/srs";
import { cn } from "@/lib/utils";

const THINK_TIME: Record<number, number> = { 1: 45, 2: 90, 3: 150, 4: 240 };

function ThinkTimer({ seconds, resetKey }: { seconds: number; resetKey: string }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    setLeft(seconds);
    const t = setInterval(() => setLeft((l) => l - 1), 1000);
    return () => clearInterval(t);
  }, [seconds, resetKey]);
  const over = left < 0;
  const mm = Math.floor(Math.abs(left) / 60);
  const ss = String(Math.abs(left) % 60).padStart(2, "0");
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono text-[13px]", over ? "text-warn" : "text-muted")} title="Suggested speaking time for this level">
      <Timer className="h-3.5 w-3.5" />
      {over ? "+" : ""}
      {mm}:{ss}
    </span>
  );
}

export function DrillSession({
  title,
  questions,
  source,
  onExit,
  timed,
}: {
  title: string;
  questions: QuestionData[];
  source: Attempt["source"];
  onExit: () => void;
  timed?: boolean;
}) {
  const manifest = useManifest();
  const logHistory = useProgress((s) => s.logHistory);
  const [i, setI] = useState(0);
  const [grades, setGrades] = useState<Record<string, Grade>>({});
  const done = i >= questions.length;
  const lessonsById = useMemo(() => new Map(manifest.lessons.map((l) => [l.id, l])), [manifest]);

  useEffect(() => {
    if (done && Object.keys(grades).length) {
      const right = Object.values(grades).filter((g) => g >= 2).length;
      logHistory({ kind: source === "review" ? "review" : "drill", title, right, total: Object.keys(grades).length, href: "/interview" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  if (!questions.length) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-8 text-center">
        <p className="text-muted">No questions match this selection.</p>
        <button type="button" onClick={onExit} className="mt-4 text-sm font-medium text-accent hover:underline">
          Back
        </button>
      </div>
    );
  }

  if (done) {
    const counts = [0, 1, 2, 3].map((g) => Object.values(grades).filter((x) => x === g).length);
    const weak = questions.filter((q) => (grades[q.id] ?? 0) <= 1);
    const weakLessons = [...new Set(weak.map((q) => q.lessonId))].map((id) => lessonsById.get(id)).filter(Boolean);
    return (
      <div className="rounded-2xl border border-border bg-surface p-6">
        <h2 className="text-xl font-semibold text-fg">Session complete — {title}</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((g) => (
            <div key={g} className="rounded-xl border border-border bg-surface-2 p-3">
              <div className="text-[12px] text-subtle">{GRADE_LABELS[g as Grade]}</div>
              <div className="font-mono text-2xl font-semibold">{counts[g]}</div>
            </div>
          ))}
        </div>
        {weakLessons.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-2 text-sm font-semibold text-fg">Where you would lose points — revise these first</h3>
            <ul className="space-y-1">
              {weakLessons.map((l) => (
                <li key={l!.id}>
                  <Link href={`${l!.href}?mode=15`} className="text-[14px] text-accent hover:underline">
                    {l!.title} (15-minute revision)
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-6 text-[13px] text-subtle">Questions you rated Again or Hard come back soon in your revision queue; Good and Easy ones are spaced out further.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={() => { setI(0); setGrades({}); }} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium hover:bg-surface-2">
            <RotateCcw className="h-4 w-4" /> Repeat
          </button>
          <button type="button" onClick={onExit} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-accent-fg">
            New session <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  const q = questions[i];
  const lesson = lessonsById.get(q.lessonId);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={onExit} className="inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
          <X className="h-4 w-4" /> End
        </button>
        <div className="text-sm font-medium text-fg">{title}</div>
        <div className="ml-auto flex items-center gap-3">
          {timed && <ThinkTimer seconds={THINK_TIME[q.level]} resetKey={q.id} />}
          <span className="font-mono text-[13px] text-subtle">
            {i + 1}/{questions.length}
          </span>
        </div>
      </div>
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full bg-accent transition-all" style={{ width: `${(i / questions.length) * 100}%` }} />
      </div>
      <QuestionCard
        key={q.id}
        q={q}
        source={source}
        lessonLink={lesson ? { href: lesson.href, title: lesson.title } : undefined}
        onGraded={(g) => {
          setGrades((m) => ({ ...m, [q.id]: g }));
          setTimeout(() => setI((x) => x + 1), 350);
        }}
      />
      <div className="mt-3 flex justify-end">
        <button type="button" onClick={() => setI((x) => x + 1)} className="inline-flex items-center gap-1 text-[13px] text-subtle hover:text-fg">
          Skip <SkipForward className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
