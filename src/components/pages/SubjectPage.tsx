import Link from "next/link";
import { Activity, ArrowRight, Clock, FlaskConical, MessagesSquare, Siren } from "lucide-react";
import { getCaseStudies, getLessonsBySubject, getLevelGraph, getSubject } from "@/lib/content/loader";
import type { SubjectId } from "@/lib/content/types";
import { WIDGETS } from "@/lib/registry";
import { DepthBadge, PageHeader } from "@/components/ui/badges";
import { LessonCheck, LevelCount, SubjectMasteryCard } from "@/components/progress/ProgressBits";
import { cn, formatMinutes, SUBJECT_STYLE } from "@/lib/utils";

export function SubjectPage({ subject, track }: { subject: SubjectId; track?: "sql" }) {
  const subj = getSubject(subject);
  const all = getLessonsBySubject(subject);
  const levels = subj.levels.filter((l) => (track ? l.track === track : true));
  const lessons = track ? all.filter((l) => levels.some((lv) => lv.n === l.level)) : all;
  const minutes = lessons.reduce((n, l) => n + l.minutes, 0);
  const questions = lessons.reduce((n, l) => n + l.questionCount, 0);
  const graph = getLevelGraph();
  const style = SUBJECT_STYLE[subject];
  const widgets = WIDGETS.filter((w) => w.subject === subject && (!track || w.lessons.some((id) => lessons.some((l) => l.id === id))));
  const cases = getCaseStudies().filter((c) => c.subject === subject);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8 lg:py-12">
      <PageHeader
        eyebrow={track === "sql" ? "Curriculum · SQL track" : subject === "x" ? "Curriculum · Cross-domain" : "Curriculum"}
        title={track === "sql" ? "SQL" : subj.title}
        description={
          track === "sql"
            ? "From your first SELECT to window functions and the classic interview problem patterns — practiced against a real PostgreSQL running in your browser. Pair it with Indexing and Query Execution to understand why queries are fast or slow."
            : subj.description
        }
      >
        <p className="mt-2 text-sm text-muted">
          {lessons.length} concepts across {levels.length} levels · ~{formatMinutes(minutes)} of study · {questions} interview questions
        </p>
        {lessons[0] && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-surface p-5">
            <div>
              <p className="eyebrow">Start learning</p>
              <p className="mt-2 text-xs text-subtle">
                {subj.title} · Level {lessons[0].level}
              </p>
              <p className="mt-0.5 text-lg font-semibold tracking-tight text-fg">{lessons[0].title}</p>
              <span className="mt-1 inline-block">
                <DepthBadge depth={lessons[0].depth} />
              </span>
            </div>
            <Link href={lessons[0].href} className="inline-flex h-10 items-center gap-2 rounded-md bg-fg px-5 text-sm font-medium text-bg transition-opacity hover:opacity-90">
              Start <ArrowRight className="size-4" />
            </Link>
          </div>
        )}
      </PageHeader>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-10">
          {track === "sql" && (
            <Link href="/labs/sql-playground" className="flex items-center gap-4 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong" style={{ borderLeftWidth: 2, borderLeftColor: "var(--db)" }}>
              <FlaskConical className="size-5 text-db" />
              <div className="flex-1">
                <div className="text-sm font-medium text-fg">Open the SQL Playground</div>
                <div className="text-xs text-muted">Real PostgreSQL (WebAssembly) with a seeded schema and graded exercises.</div>
              </div>
              <ArrowRight className="size-4 text-subtle" />
            </Link>
          )}
          {levels.map((lvl) => {
            const items = lessons.filter((l) => l.level === lvl.n);
            const deps = [
              ...new Set(
                graph
                  .filter((e) => e.to === `${subject}:${lvl.n}`)
                  .map((e) => e.from)
                  .filter((f) => f !== `${subject}:${lvl.n}`),
              ),
            ];
            return (
              <section key={lvl.n} id={`level-${lvl.n}`} className="scroll-mt-24">
                <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-mono text-sm text-subtle tabular-nums">{String(lvl.n).padStart(2, "0")}</span>
                  <h2 className="text-xl font-semibold tracking-tight text-fg">{lvl.title}</h2>
                  {items.length > 0 && (
                    <span className="ml-auto">
                      <LevelCount ids={items.map((l) => l.id)} />
                    </span>
                  )}
                </div>
                <p className="mb-2 text-sm text-muted">{lvl.summary}</p>
                {deps.length > 0 && (
                  <p className="mb-3 text-xs text-subtle">
                    Builds on:{" "}
                    {deps.map((d, i) => {
                      const [s, n] = d.split(":");
                      const sd = getSubject(s as SubjectId);
                      const lv = sd.levels.find((x) => String(x.n) === n);
                      return (
                        <span key={d}>
                          {i > 0 && ", "}
                          <Link href={`/${sd.path}#level-${n}`} className="hover:text-fg hover:underline">
                            {sd.short} L{n} {lv?.title}
                          </Link>
                        </span>
                      );
                    })}
                  </p>
                )}
                {items.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border p-4 text-sm text-subtle">Lessons for this level are being written.</p>
                ) : (
                  <ol className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
                    {items.map((l, i) => (
                      <li key={l.id}>
                        <Link href={l.href} className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-2">
                          <span className="mt-0.5 w-8 shrink-0 font-mono text-xs text-subtle tabular-nums">
                            {lvl.n}.{i + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-fg">{l.title}</div>
                            <div className="mt-0.5 line-clamp-2 text-xs text-muted">{l.summary}</div>
                          </div>
                          <div className="hidden shrink-0 flex-col items-end gap-1.5 sm:flex">
                            <DepthBadge depth={l.depth} compact />
                            <span className="text-2xs text-subtle">
                              {formatMinutes(l.minutes)} · {l.questionCount} Q
                            </span>
                          </div>
                          <LessonCheck id={l.id} className="mt-0.5 size-3.5" />
                        </Link>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            );
          })}
        </div>

        <aside className="space-y-6">
          <div className="lg:sticky lg:top-20 space-y-6">
            <SubjectMasteryCard subject={subject} />
            {widgets.length > 0 && (
              <div className="rounded-lg border border-border bg-surface p-4">
                <p className="eyebrow mb-3 flex items-center gap-1.5">
                  <Activity className="size-3.5" /> Labs & visualizations
                </p>
                <ul className="space-y-1.5 text-sm">
                  {widgets.map((w) => (
                    <li key={w.id}>
                      <Link href={w.kinds.includes("lab") ? `/labs/${w.id}` : `/visualizations/${w.id}`} className="text-muted transition-colors hover:text-fg">
                        {w.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {cases.length > 0 && !track && (
              <div className="rounded-lg border border-border bg-surface p-4">
                <p className="eyebrow mb-3 flex items-center gap-1.5">
                  <Siren className="size-3.5" /> Case studies
                </p>
                <ul className="space-y-1.5 text-sm">
                  {cases.map((c) => (
                    <li key={c.id}>
                      <Link href={c.href} className="text-muted transition-colors hover:text-fg">
                        {c.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Link href={`/interview?subject=${subject}`} className="flex items-center justify-between rounded-lg border border-border bg-surface p-4 text-sm font-medium text-fg transition-colors hover:border-border-strong">
              Practice {track === "sql" ? "SQL" : subj.short} in Interview Mode <ArrowRight className="size-4 text-subtle" />
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
