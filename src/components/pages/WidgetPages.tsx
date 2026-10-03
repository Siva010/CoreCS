import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, ArrowRight, FlaskConical, Lightbulb } from "lucide-react";
import { getLesson, getSubject } from "@/lib/content/loader";
import { getWidget, WIDGETS, type WidgetKind } from "@/lib/registry";
import { PageHeader, SubjectBadge } from "@/components/ui/badges";
import { WidgetById } from "@/components/widgets";
import { cn, SUBJECT_STYLE } from "@/lib/utils";

export function WidgetIndex({ kind }: { kind: WidgetKind }) {
  const items = WIDGETS.filter((w) => w.kinds.includes(kind));
  const groups = (["os", "cn", "db"] as const).map((s) => ({ s, items: items.filter((w) => w.subject === s) }));
  const Icon = kind === "lab" ? FlaskConical : Activity;
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-10">
      <PageHeader
        eyebrow={kind === "lab" ? "Labs" : "Visualizations"}
        title={kind === "lab" ? "Hands-on labs and simulators" : "See the state transitions"}
        description={
          kind === "lab"
            ? "Simulators you can break on purpose: schedulers, page replacement, Banker's algorithm, TCP, DNS, subnetting, a real PostgreSQL, query plans, MVCC isolation, WAL recovery, replication and sharding. Every lab links back to the lessons that explain it."
            : "Interactive diagrams that show how state changes step by step — not decorative animation. Each one is embedded in the lessons it supports and available here on its own."
        }
      />
      <div className="space-y-10">
        {groups.map(({ s, items }) =>
          items.length ? (
            <section key={s}>
              <h2 className={cn("mb-3 text-sm font-semibold tracking-wider uppercase", SUBJECT_STYLE[s].text)}>{getSubject(s).title}</h2>
              <div className="grid gap-3 md:grid-cols-2">
                {items.map((w) => (
                  <Link
                    key={w.id}
                    href={kind === "lab" ? `/labs/${w.id}` : `/visualizations/${w.id}`}
                    className="group flex gap-4 rounded-xl border border-border bg-surface p-4 hover:border-border-strong"
                  >
                    <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-lg", SUBJECT_STYLE[s].bg)}>
                      <Icon className={cn("h-5 w-5", SUBJECT_STYLE[s].text)} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-fg group-hover:text-accent">{w.title}</span>
                      <span className="mt-0.5 block text-[13.5px] text-muted">{w.description}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null,
        )}
      </div>
    </div>
  );
}

export function WidgetPage({ id, kind }: { id: string; kind: WidgetKind }) {
  const w = getWidget(id);
  if (!w || !w.kinds.includes(kind)) notFound();
  const lessons = w.lessons.map((l) => getLesson(l)).filter((l) => !!l);
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-10">
      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold tracking-wider text-subtle uppercase">
          <Link href={kind === "lab" ? "/labs" : "/visualizations"} className="hover:text-fg">
            {kind === "lab" ? "Labs" : "Visualizations"}
          </Link>
          <span>/</span>
          <SubjectBadge subject={w.subject} />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-fg">{w.title}</h1>
        <p className="mt-2 max-w-3xl text-[16px] text-muted">{w.description}</p>
      </div>
      <div className="mb-6 rounded-xl border border-border bg-surface p-4">
        <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold tracking-wider text-subtle uppercase">
          <Lightbulb className="h-3.5 w-3.5 text-accent" /> Try this
        </div>
        <ul className="list-disc space-y-1 pl-5 text-[14px] text-muted">
          {w.tryThis.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>
      <div className="rounded-2xl border border-border bg-bg p-3 sm:p-5">
        <WidgetById id={w.id} />
      </div>
      {lessons.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-semibold tracking-wider text-subtle uppercase">Learn the concepts behind it</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {lessons.map((l) => (
              <Link key={l!.id} href={l!.href} className="group flex items-center justify-between rounded-xl border border-border bg-surface p-3 hover:border-accent/40">
                <span>
                  <span className="block text-[14px] font-medium text-fg group-hover:text-accent">{l!.title}</span>
                  <span className="block text-[12px] text-subtle">
                    {getSubject(l!.subject).short} · Level {l!.level}
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 text-subtle" />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
