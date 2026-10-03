import { getSubject, renderTraps } from "@/lib/content/loader";
import { Prose, Rendered } from "@/components/content/Rendered";
import { PageHeader } from "@/components/ui/badges";
import { cn, SUBJECT_STYLE } from "@/lib/utils";

export const metadata = { title: "Interview Traps" };

export default async function TrapsPage() {
  const traps = await renderTraps();
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-10">
      <PageHeader
        eyebrow="Interview Traps"
        title="Misconceptions that sink good answers"
        description="Each of these sounds right, gets repeated in blog posts, and falls apart under one follow-up question. Learn the precise version — and the one-sentence correction to say out loud."
      >
        <nav className="mt-5 flex flex-wrap gap-2 text-[13px]">
          {(["os", "cn", "db", "x"] as const).map((s) =>
            traps.some((t) => t.meta.subject === s) ? (
              <a key={s} href={`#subject-${s}`} className={cn("rounded-full border px-3 py-1 font-medium", SUBJECT_STYLE[s].border, SUBJECT_STYLE[s].text)}>
                {getSubject(s).title} ({traps.filter((t) => t.meta.subject === s).length})
              </a>
            ) : null,
          )}
        </nav>
      </PageHeader>
      {(["os", "cn", "db", "x"] as const).map((s) => {
        const items = traps.filter((t) => t.meta.subject === s);
        if (!items.length) return null;
        return (
          <section key={s} id={`subject-${s}`} className="mb-12 scroll-mt-20">
            <h2 className={cn("mb-4 text-sm font-semibold tracking-wider uppercase", SUBJECT_STYLE[s].text)}>{getSubject(s).title}</h2>
            <div className="space-y-4">
              {items.map((t) => (
                <article key={t.meta.id} id={t.meta.id} className="scroll-mt-20 rounded-2xl border border-border bg-surface p-5">
                  <h3 className="mb-2 text-lg font-semibold text-fg">{t.meta.title}</h3>
                  <Prose>
                    <Rendered hast={t.hast} />
                  </Prose>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
