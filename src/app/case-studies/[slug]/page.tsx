import Link from "next/link";
import { notFound } from "next/navigation";
import { getCaseStudies, getLesson, getSubject, renderCaseStudy } from "@/lib/content/loader";
import { Prose, Rendered } from "@/components/content/Rendered";
import { SubjectBadge } from "@/components/ui/badges";
import { BookmarkButton } from "@/components/lesson/LessonActions";
import { CaseStudyTracker } from "@/components/pages/CaseStudyTracker";
import { cn } from "@/lib/utils";

export const dynamicParams = false;

export function generateStaticParams() {
  return getCaseStudies().map((c) => ({ slug: c.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = getCaseStudies().find((x) => x.id === slug);
  return { title: c?.title ?? "Case study", description: c?.summary };
}

const STAGE_TONE: Record<string, string> = {
  symptoms: "text-bad",
  metrics: "text-warn",
  hypotheses: "text-d-advanced",
  investigation: "text-d-core",
  "root-cause": "text-bad",
  fix: "text-ok",
  prevention: "text-ok",
};

export default async function CaseStudyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await renderCaseStudy(slug);
  if (!c) notFound();
  const subj = getSubject(c.meta.subject);
  return (
    <div className="px-4 py-10 sm:px-6 lg:px-10">
      <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_240px]">
        <article className="min-w-0 max-w-3xl">
          <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold tracking-wider text-subtle uppercase">
            <Link href="/case-studies" className="hover:text-fg">Case Studies</Link>
            <span>/</span>
            <SubjectBadge subject={c.meta.subject} />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-balance text-fg sm:text-4xl">{c.meta.title}</h1>
          <p className="mt-3 text-[17px] text-muted">{c.meta.summary}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <BookmarkButton bkey={`case:${c.meta.id}`} />
            <CaseStudyTracker id={c.meta.id} title={c.meta.title} />
          </div>
          {c.intro && (
            <Prose className="mt-8">
              <Rendered hast={c.intro} />
            </Prose>
          )}
          {c.sections.map((s, i) => (
            <section key={s.id} id={s.id} className="scroll-mt-24 border-t border-border pt-8 mt-8">
              <h2 className={cn("mb-3 flex items-center gap-3 text-xl font-semibold tracking-tight", STAGE_TONE[s.id] ?? "text-fg")}>
                <span className="grid h-7 w-7 place-items-center rounded-full border border-border bg-surface font-mono text-[12px] text-muted">{i + 1}</span>
                {s.title}
              </h2>
              <Prose>
                <Rendered hast={s.hast} />
              </Prose>
            </section>
          ))}
        </article>
        <aside className="hidden xl:block">
          <div className="sticky top-20 space-y-6">
            <nav className="text-[13px]">
              <div className="mb-2 text-[11px] font-semibold tracking-wider text-subtle uppercase">Investigation path</div>
              <ol className="space-y-1 border-l border-border">
                {c.sections.map((s) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`} className="-ml-px block border-l border-transparent py-1 pl-3 text-muted hover:border-border-strong hover:text-fg">
                      {s.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
            <div>
              <div className="mb-2 text-[11px] font-semibold tracking-wider text-subtle uppercase">Concepts used</div>
              <ul className="space-y-1.5 text-[13px]">
                {c.meta.concepts.map((id) => {
                  const l = getLesson(id);
                  return l ? (
                    <li key={id}>
                      <Link href={l.href} className="text-muted hover:text-accent">
                        {l.title}
                      </Link>
                    </li>
                  ) : null;
                })}
              </ul>
              <p className="mt-3 text-[12px] text-subtle">{subj.title}</p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
