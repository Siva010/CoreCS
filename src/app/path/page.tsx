import Link from "next/link";
import { ArrowRight, Target } from "lucide-react";
import { getAllLessons, getRoadmaps, getStages, getSubjects } from "@/lib/content/loader";
import { layoutDag } from "@/lib/content/graph";
import { PageHeader } from "@/components/ui/badges";
import { DependencyGraph } from "@/components/pages/DependencyGraph";
import { LessonCheck, LevelCount } from "@/components/progress/ProgressBits";
import { RoadmapReadiness } from "@/components/pages/RoadmapReadiness";
import { cn, SUBJECT_STYLE } from "@/lib/utils";

export const metadata = { title: "Learning Path" };

export default function PathPage() {
  const lessons = getAllLessons();
  const stages = getStages();
  const subjects = getSubjects();
  const roadmaps = getRoadmaps();
  const graphs = [
    ...subjects
      .filter((s) => s.id !== "x")
      .map((s) => ({ id: s.id, label: s.title, layout: layoutDag(lessons.filter((l) => l.subject === s.id)) })),
    { id: "core", label: "Stages 1–2, all subjects", layout: layoutDag(lessons.filter((l) => l.stage <= 2)) },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-10">
      <PageHeader
        eyebrow="Learning Path"
        title="A dependency-aware route from beginner to senior touch"
        description="Concepts are ordered so that prerequisites always come first: packets before TCP before congestion control; transactions before isolation levels; processes before virtual memory. Follow the stages, or pick the roadmap that matches where you are."
      />

      <section className="space-y-8">
        {stages.map((st) => {
          const inStage = lessons.filter((l) => l.stage === st.n);
          return (
            <div key={st.n} className="rounded-2xl border border-border bg-surface">
              <div className="flex flex-wrap items-start gap-4 border-b border-border p-5">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-fg font-mono text-sm font-bold text-bg">{st.n}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-3">
                    <h2 className="text-xl font-semibold text-fg">Stage {st.n} — {st.title}</h2>
                    <LevelCount ids={inStage.map((l) => l.id)} />
                  </div>
                  <p className="mt-1 flex items-start gap-1.5 text-[14.5px] text-fg">
                    <Target className="mt-1 h-3.5 w-3.5 shrink-0 text-accent" />
                    <span>
                      <span className="font-medium">Goal:</span> {st.goal}
                    </span>
                  </p>
                  <p className="mt-1 text-[13.5px] text-muted">{st.description}</p>
                </div>
              </div>
              <div className="grid gap-px bg-border md:grid-cols-2 xl:grid-cols-4">
                {subjects.map((s) => {
                  const items = inStage.filter((l) => l.subject === s.id);
                  return (
                    <div key={s.id} className="bg-surface p-4">
                      <div className={cn("mb-2 text-[12px] font-semibold tracking-wider uppercase", SUBJECT_STYLE[s.id].text)}>{s.short}</div>
                      {items.length === 0 ? (
                        <p className="text-[13px] text-subtle">—</p>
                      ) : (
                        <ul className="space-y-1">
                          {items.map((l) => (
                            <li key={l.id}>
                              <Link href={l.href} className="flex items-start gap-2 text-[13.5px] text-muted hover:text-fg">
                                <LessonCheck id={l.id} className="mt-0.5 h-3.5 w-3.5" />
                                <span>{l.title}</span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>

      <section className="pt-14">
        <h2 className="text-2xl font-semibold tracking-tight">Prerequisite graph</h2>
        <p className="mt-2 mb-5 max-w-3xl text-muted">
          Every arrow is a declared prerequisite. Columns are computed from the longest prerequisite chain, so a concept never appears to the left of something it depends
          on.
        </p>
        <DependencyGraph graphs={graphs} />
      </section>

      <section id="roadmaps" className="scroll-mt-20 pt-14">
        <h2 className="text-2xl font-semibold tracking-tight">Interview roadmaps</h2>
        <p className="mt-2 mb-5 max-w-3xl text-muted">
          Study plans by experience level. Each one is honest about the difference between conceptual exposure and production experience.
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          {roadmaps.map((r) => (
            <Link key={r.id} href={`/path/${r.id}`} className="group flex flex-col rounded-2xl border border-border bg-surface p-5 hover:border-border-strong">
              <h3 className="text-lg font-semibold text-fg">{r.title}</h3>
              <p className="mt-1 text-[13px] text-subtle">{r.audience}</p>
              <p className="mt-3 text-[14px] text-muted">{r.summary}</p>
              <div className="mt-4">
                <RoadmapReadiness roadmapId={r.id} compact />
              </div>
              <span className="mt-auto flex items-center gap-1 pt-4 text-sm font-medium text-accent">
                Open roadmap <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
