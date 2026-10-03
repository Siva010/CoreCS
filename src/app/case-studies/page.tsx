import Link from "next/link";
import { getCaseStudies, getLesson, getSubject } from "@/lib/content/loader";
import { PageHeader } from "@/components/ui/badges";
import { cn, SUBJECT_STYLE } from "@/lib/utils";

export const metadata = { title: "Case Studies" };

const PIPELINE = ["Symptoms", "Metrics", "Hypotheses", "Investigation", "Root cause", "Fix", "Prevention"];

export default function CaseStudiesPage() {
  const cases = getCaseStudies();
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-10">
      <PageHeader
        eyebrow="Case Studies"
        title="Production incidents, reasoned through"
        description="Realistic incidents from backend systems. Each one walks the same disciplined path an experienced engineer follows — and shows which concepts made the diagnosis possible."
      >
        <div className="mt-5 flex flex-wrap items-center gap-1.5 text-[12.5px]">
          {PIPELINE.map((p, i) => (
            <span key={p} className="flex items-center gap-1.5">
              <span className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-muted">{p}</span>
              {i < PIPELINE.length - 1 && <span className="text-subtle">→</span>}
            </span>
          ))}
        </div>
      </PageHeader>
      <div className="space-y-10">
        {(["os", "cn", "db", "x"] as const).map((s) => {
          const items = cases.filter((c) => c.subject === s);
          if (!items.length) return null;
          return (
            <section key={s}>
              <h2 className={cn("mb-3 text-sm font-semibold tracking-wider uppercase", SUBJECT_STYLE[s].text)}>{getSubject(s).title}</h2>
              <div className="grid gap-3 md:grid-cols-2">
                {items.map((c) => (
                  <Link key={c.id} href={c.href} className="group rounded-xl border border-border bg-surface p-4 hover:border-border-strong">
                    <div className="font-medium text-fg group-hover:text-accent">{c.title}</div>
                    <p className="mt-1 text-[13.5px] text-muted">{c.summary}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {c.concepts.slice(0, 4).map((id) => (
                        <span key={id} className="rounded-full border border-border px-2 py-0.5 text-[11.5px] text-subtle">
                          {getLesson(id)?.title ?? id}
                        </span>
                      ))}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
        {!cases.length && <p className="text-subtle">Case studies are being written.</p>}
      </div>
    </div>
  );
}
