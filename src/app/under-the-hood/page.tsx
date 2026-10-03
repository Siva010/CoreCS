import Link from "next/link";
import { getWalkthroughs } from "@/lib/content/loader";
import { PageHeader, SubjectBadge } from "@/components/ui/badges";

export const metadata = { title: "Under the Hood" };

export default function UnderTheHoodPage() {
  const items = getWalkthroughs();
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-10">
      <PageHeader
        eyebrow="Under the Hood"
        title="What actually happens when…?"
        description="End-to-end traces of the operations interviewers love. Each step is tagged with the layer doing the work — application, kernel, CPU, network, database — so you can see exactly where time goes and where things break."
      />
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((w) => (
          <Link key={w.id} href={w.href} className="group rounded-xl border border-border bg-surface p-4 hover:border-border-strong">
            <div className="flex items-start justify-between gap-3">
              <div className="font-medium text-fg group-hover:text-accent">{w.title}</div>
              <span className="shrink-0 font-mono text-[12px] text-subtle">{w.stepCount} steps</span>
            </div>
            <p className="mt-1 text-[13.5px] text-muted">{w.summary}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {w.subjects.map((s) => (
                <SubjectBadge key={s} subject={s} />
              ))}
            </div>
          </Link>
        ))}
        {!items.length && <p className="text-subtle">Walkthroughs are being written.</p>}
      </div>
    </div>
  );
}
