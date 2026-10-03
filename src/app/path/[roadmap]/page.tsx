import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleCheck, FlaskConical, Info, TriangleAlert } from "lucide-react";
import { getCaseStudies, getLesson, getRoadmaps } from "@/lib/content/loader";
import { getWidget } from "@/lib/registry";
import { PageHeader } from "@/components/ui/badges";
import { LessonCheck } from "@/components/progress/ProgressBits";
import { RoadmapReadiness } from "@/components/pages/RoadmapReadiness";
import { formatMinutes } from "@/lib/utils";

export const dynamicParams = false;

export function generateStaticParams() {
  return getRoadmaps().map((r) => ({ roadmap: r.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ roadmap: string }> }) {
  const { roadmap } = await params;
  const r = getRoadmaps().find((x) => x.id === roadmap);
  return { title: r ? `${r.title} roadmap` : "Roadmap" };
}

function PracticeItem({ text }: { text: string }) {
  const [scheme, id] = text.includes(":") ? text.split(":") : ["", ""];
  if (scheme === "lab") {
    const w = getWidget(id);
    if (w) return <Link href={w.kinds.includes("lab") ? `/labs/${id}` : `/visualizations/${id}`} className="text-accent hover:underline">Lab: {w.title}</Link>;
  }
  if (scheme === "case") {
    const c = getCaseStudies().find((x) => x.id === id);
    if (c) return <Link href={c.href} className="text-accent hover:underline">Case study: {c.title}</Link>;
  }
  return <span>{text}</span>;
}

export default async function RoadmapPage({ params }: { params: Promise<{ roadmap: string }> }) {
  const { roadmap } = await params;
  const r = getRoadmaps().find((x) => x.id === roadmap);
  if (!r) notFound();
  const total = r.phases.flatMap((p) => p.lessons).map((id) => getLesson(id)).filter(Boolean);
  const minutes = total.reduce((n, l) => n + (l?.minutes ?? 0), 0);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-10">
      <PageHeader eyebrow={<Link href="/path#roadmaps" className="hover:text-fg">Learning Path / Roadmaps</Link>} title={r.title} description={r.summary}>
        <p className="mt-3 text-sm text-subtle">
          For: {r.audience} · {total.length} lessons · ~{formatMinutes(minutes)} of reading, plus practice
        </p>
      </PageHeader>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <div className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="mb-3 font-semibold text-fg">By the end you should be able to…</h2>
            <ul className="space-y-2 text-[14.5px] text-muted">
              {r.expectations.map((e) => (
                <li key={e} className="flex gap-2">
                  <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
                  {e}
                </li>
              ))}
            </ul>
          </div>

          {r.phases.map((ph, i) => (
            <section key={ph.title} className="rounded-2xl border border-border bg-surface">
              <div className="border-b border-border p-5">
                <div className="text-[12px] font-semibold tracking-wider text-subtle uppercase">
                  Phase {i + 1} · {ph.weeks}
                </div>
                <h2 className="mt-1 text-lg font-semibold text-fg">{ph.title}</h2>
                <p className="mt-1 text-[14px] text-muted">{ph.focus}</p>
              </div>
              <div className="grid gap-5 p-5 md:grid-cols-2">
                <div>
                  <div className="mb-2 text-[12px] font-semibold tracking-wider text-subtle uppercase">Lessons</div>
                  <ol className="space-y-1.5">
                    {ph.lessons.map((id) => {
                      const l = getLesson(id);
                      if (!l) return null;
                      return (
                        <li key={id}>
                          <Link href={l.href} className="flex items-start gap-2 text-[14px] text-fg hover:text-accent">
                            <LessonCheck id={id} className="mt-0.5 h-3.5 w-3.5" />
                            {l.title}
                          </Link>
                        </li>
                      );
                    })}
                  </ol>
                </div>
                <div>
                  <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold tracking-wider text-subtle uppercase">
                    <FlaskConical className="h-3.5 w-3.5" /> Practice
                  </div>
                  <ul className="space-y-1.5 text-[14px] text-muted">
                    {ph.practice.map((p) => (
                      <li key={p}>
                        <PracticeItem text={p} />
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>
          ))}

          {r.extras?.map((x) => (
            <div key={x.title} className="rounded-2xl border border-border bg-surface p-5">
              <h2 className="mb-2 flex items-center gap-2 font-semibold text-fg">
                <Info className="h-4 w-4 text-accent" /> {x.title}
              </h2>
              <p className="text-[14.5px] leading-relaxed text-muted">{x.body.replace(/\*/g, "")}</p>
            </div>
          ))}
        </div>

        <aside className="space-y-5">
          <div className="lg:sticky lg:top-20 space-y-5">
            <RoadmapReadiness roadmapId={r.id} />
            <div className="rounded-2xl border border-warn/40 bg-warn/5 p-5">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-warn">
                <TriangleAlert className="h-4 w-4" /> Honest limits
              </h2>
              {r.notCovered.map((n) => (
                <p key={n} className="mb-2 text-[13.5px] text-muted last:mb-0">
                  {n}
                </p>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
