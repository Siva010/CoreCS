import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { getLesson, getWalkthroughs, renderWalkthrough } from "@/lib/content/loader";
import { Prose, Rendered } from "@/components/content/Rendered";
import { SubjectBadge } from "@/components/ui/badges";
import { WalkthroughStepper } from "@/components/pages/WalkthroughStepper";

export const dynamicParams = false;

export function generateStaticParams() {
  return getWalkthroughs().map((w) => ({ slug: w.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const w = getWalkthroughs().find((x) => x.id === slug);
  return { title: w?.title ?? "Walkthrough", description: w?.summary };
}

export default async function WalkthroughPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const w = await renderWalkthrough(slug);
  if (!w) notFound();
  const all = getWalkthroughs();
  const idx = all.findIndex((x) => x.id === slug);
  const next = all[idx + 1];
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-10">
      <div className="mb-3 text-[12px] font-semibold tracking-wider text-subtle uppercase">
        <Link href="/under-the-hood" className="hover:text-fg">Under the Hood</Link>
      </div>
      <h1 className="text-3xl font-semibold tracking-tight text-balance text-fg sm:text-4xl">{w.meta.title}</h1>
      <p className="mt-3 text-[17px] text-muted">{w.meta.summary}</p>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {w.meta.subjects.map((s) => (
          <SubjectBadge key={s} subject={s} />
        ))}
      </div>
      {w.intro && (
        <Prose className="mt-6">
          <Rendered hast={w.intro} />
        </Prose>
      )}
      <div className="mt-8">
        <WalkthroughStepper
          steps={w.steps.map((s) => ({
            layer: s.layer,
            title: s.title,
            content: (
              <Prose>
                <Rendered hast={s.hast} />
              </Prose>
            ),
          }))}
        />
      </div>
      {w.meta.related.length > 0 && (
        <div className="mt-10">
          <h2 className="mb-3 text-sm font-semibold tracking-wider text-subtle uppercase">Concepts behind each step</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {w.meta.related.map((id) => {
              const l = getLesson(id);
              return l ? (
                <Link key={id} href={l.href} className="rounded-xl border border-border bg-surface p-3 text-[14px] text-fg hover:border-accent/40 hover:text-accent">
                  {l.title}
                </Link>
              ) : null;
            })}
          </div>
        </div>
      )}
      {next && (
        <Link href={next.href} className="mt-10 flex items-center justify-between rounded-xl border border-border bg-surface p-4 hover:border-accent/40">
          <span>
            <span className="block text-[12px] text-subtle">Next walkthrough</span>
            <span className="font-medium text-fg">{next.title}</span>
          </span>
          <ArrowRight className="h-4 w-4 text-subtle" />
        </Link>
      )}
    </div>
  );
}
