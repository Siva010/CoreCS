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
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-10">
      <PageHeader
        eyebrow={<span className={style.text}>{track === "sql" ? "Databases · SQL track" : subject === "x" ? "Cross-domain" : "Academy"}</span>}
        title={track === "sql" ? "SQL" : subj.title}
        description={
          track === "sql"
            ? "From your first SELECT to window functions and the classic interview problem patterns — practiced against a real PostgreSQL running in your browser. Pair it with Indexing and Query Execution to understand why queries are fast or slow."
            : subj.description
        }
      >
        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
          <span>{lessons.length} concept lessons</span>
          <span className="flex items-center gap-1.5">
            <Clock className="h-4 w-4" /> ~{formatMinutes(minutes)} of study
          </span>
          <span className="flex items-center gap-1.5">
            <MessagesSquare className="h-4 w-4" /> {questions} interview questions
          </span>
        </div>
      </PageHeader>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-10">
          {track === "sql" && (
            <Link href="/labs/sql-playground" className="flex items-center gap-4 rounded-xl border border-db/40 bg-db/5 p-4 hover:bg-db/10">
              <FlaskConical className="h-6 w-6 text-db" />
              <div className="flex-1">
                <div className="font-medium text-fg">Open the SQL Playground</div>
                <div className="text-sm text-muted">Real PostgreSQL (WebAssembly) with a seeded schema and graded exercises.</div>
              </div>
              <ArrowRight className="h-4 w-4 text-subtle" />
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
                <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className={cn("font-mono text-sm font-semibold", style.text)}>Level {lvl.n}</span>
                  <h2 className="text-xl font-semibold tracking-tight text-fg">{lvl.title}</h2>
                  {items.length > 0 && <LevelCount ids={items.map((l) => l.id)} />}
                </div>
                <p className="mb-2 text-[14.5px] text-muted">{lvl.summary}</p>
                {deps.length > 0 && (
                  <p className="mb-3 text-[12.5px] text-subtle">
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
                  <p className="rounded-xl border border-dashed border-border p-4 text-sm text-subtle">Lessons for this level are being written.</p>
                ) : (
                  <ol className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
                    {items.map((l) => (
                      <li key={l.id}>
                        <Link href={l.href} className="group flex items-start gap-3 px-4 py-3 hover:bg-surface-2/60">
                          <LessonCheck id={l.id} className="mt-0.5" />
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-fg group-hover:text-accent">{l.title}</div>
                            <div className="mt-0.5 line-clamp-2 text-[13px] text-muted">{l.summary}</div>
                          </div>
                          <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
                            <DepthBadge depth={l.depth} compact />
                            <span className="text-[11.5px] text-subtle">
                              {formatMinutes(l.minutes)} · {l.questionCount} Q
                            </span>
                          </div>
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
              <div className="rounded-xl border border-border bg-surface p-4">
                <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold tracking-wider text-subtle uppercase">
                  <Activity className="h-3.5 w-3.5" /> Labs & visualizations
                </div>
                <ul className="space-y-1.5 text-[13.5px]">
                  {widgets.map((w) => (
                    <li key={w.id}>
                      <Link href={w.kinds.includes("lab") ? `/labs/${w.id}` : `/visualizations/${w.id}`} className="text-muted hover:text-accent">
                        {w.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {cases.length > 0 && !track && (
              <div className="rounded-xl border border-border bg-surface p-4">
                <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold tracking-wider text-subtle uppercase">
                  <Siren className="h-3.5 w-3.5" /> Case studies
                </div>
                <ul className="space-y-1.5 text-[13.5px]">
                  {cases.map((c) => (
                    <li key={c.id}>
                      <Link href={c.href} className="text-muted hover:text-accent">
                        {c.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Link href={`/interview?subject=${subject}`} className="flex items-center justify-between rounded-xl border border-border bg-surface p-4 text-sm font-medium text-fg hover:border-accent/40">
              Practice {track === "sql" ? "SQL" : subj.short} in Interview Mode <ArrowRight className="h-4 w-4 text-subtle" />
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
