import Link from "next/link";
import { FileText } from "lucide-react";
import { getSubjects } from "@/lib/content/loader";
import { REVISION_MODES } from "@/lib/content/types";
import { PageHeader } from "@/components/ui/badges";
import { RevisionDashboard } from "@/components/pages/RevisionDashboard";
import { cn, SUBJECT_STYLE } from "@/lib/utils";

export const metadata = { title: "Revision" };

export default function RevisionPage() {
  const subjects = getSubjects();
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-10">
      <PageHeader
        eyebrow="Revision"
        title="Useful the night before — and every week before that"
        description="Spaced repetition keeps answers fresh; time-boxed revision modes let you refresh a concept in 5, 15 or 30 minutes; cheat sheets compress a whole subject onto one page."
      />
      <div className="mb-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {REVISION_MODES.map((m) => (
          <div key={m.id} className="rounded-xl border border-border bg-surface p-4">
            <div className="font-mono text-lg font-semibold text-fg">{m.label}</div>
            <p className="mt-1 text-[13px] text-muted">{m.blurb}</p>
          </div>
        ))}
      </div>

      <RevisionDashboard />

      <section className="mt-12">
        <h2 className="mb-1 text-xl font-semibold tracking-tight">One-page cheat sheets</h2>
        <p className="mb-4 text-[14px] text-muted">Every lesson&apos;s mental model and revision bullets for a subject, on a single printable page.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {subjects.map((s) => (
            <Link key={s.id} href={`/revision/${s.path}`} className="group flex items-center gap-3 rounded-xl border border-border bg-surface p-4 hover:border-border-strong">
              <FileText className={cn("h-5 w-5", SUBJECT_STYLE[s.id].text)} />
              <span className="font-medium text-fg group-hover:text-accent">{s.title}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
