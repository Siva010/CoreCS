import Link from "next/link";
import { notFound } from "next/navigation";
import { getLessonsBySubject, getSubjectByPath, getSubjects, renderSectionsFor } from "@/lib/content/loader";
import { Prose, Rendered } from "@/components/content/Rendered";
import { PageHeader } from "@/components/ui/badges";
import { cn, SUBJECT_STYLE } from "@/lib/utils";

export const dynamicParams = false;

export function generateStaticParams() {
  return getSubjects().map((s) => ({ subject: s.path }));
}

export async function generateMetadata({ params }: { params: Promise<{ subject: string }> }) {
  const { subject } = await params;
  return { title: `${getSubjectByPath(subject)?.title ?? ""} cheat sheet` };
}

export default async function CheatSheet({ params }: { params: Promise<{ subject: string }> }) {
  const { subject } = await params;
  const subj = getSubjectByPath(subject);
  if (!subj) notFound();
  const lessons = getLessonsBySubject(subj.id);
  const rendered = await Promise.all(lessons.map(async (l) => ({ l, sections: await renderSectionsFor(l.id, ["mental-model", "quick-revision"]) })));
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-10">
      <PageHeader
        eyebrow={<Link href="/revision" className="hover:text-fg">Revision / Cheat sheet</Link>}
        title={`${subj.title} on one page`}
        description="The mental model and the revision bullets for every lesson, in curriculum order. Read top to bottom the night before; follow a link wherever a line feels unfamiliar."
      />
      {subj.levels.map((lvl) => {
        const items = rendered.filter((r) => r.l.level === lvl.n);
        if (!items.length) return null;
        return (
          <section key={lvl.n} className="mb-10">
            <h2 className={cn("mb-4 text-sm font-semibold tracking-wider uppercase", SUBJECT_STYLE[subj.id].text)}>
              Level {lvl.n} · {lvl.title}
            </h2>
            <div className="space-y-4">
              {items.map(({ l, sections }) => (
                <article key={l.id} className="break-inside-avoid rounded-2xl border border-border bg-surface p-5">
                  <h3 className="mb-2 text-lg font-semibold">
                    <Link href={l.href} className="text-fg hover:text-accent">
                      {l.title}
                    </Link>
                  </h3>
                  {sections.map((s) => (
                    <div key={s.key} className={s.key === "quick-revision" ? "mt-2 border-t border-border pt-2" : ""}>
                      <Prose className="text-[14.5px]">
                        <Rendered hast={s.hast} />
                      </Prose>
                    </div>
                  ))}
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
