// Server-renderable content blocks used by the Markdown renderer.
import Link from "next/link";
import type { ReactNode } from "react";
import { Brain, FlaskConical, Info, Lightbulb, MessagesSquare, Server, Flame, TriangleAlert, ArrowRight, Scale, ListOrdered } from "lucide-react";
import { cn, DEPTH_META } from "@/lib/utils";
import { getWidget } from "@/lib/registry";
import type { Depth } from "@/lib/content/types";

// Each callout is a neutral panel with a 2px left border and an uppercase label in its tone colour.
const CALLOUTS = {
  note: { icon: Info, label: "Note", tone: "var(--info)" },
  tip: { icon: Lightbulb, label: "Tip", tone: "var(--ok)" },
  insight: { icon: Brain, label: "Key insight", tone: "var(--accent)" },
  warning: { icon: TriangleAlert, label: "Watch out", tone: "var(--warn)" },
  danger: { icon: Flame, label: "Common mistake", tone: "var(--bad)" },
  interview: { icon: MessagesSquare, label: "Interview angle", tone: "var(--d-core)" },
  production: { icon: Server, label: "In production", tone: "var(--d-senior)" },
} as const;

export function Callout({ type = "note", title, children }: { type?: string; title?: string; children?: ReactNode }) {
  const c = CALLOUTS[type as keyof typeof CALLOUTS] ?? CALLOUTS.note;
  const Icon = c.icon;
  return (
    <aside className="not-prose-margins my-5 rounded-lg border border-border bg-surface px-4 py-3.5" style={{ borderLeftWidth: 2, borderLeftColor: c.tone }} role="note">
      <p className="m-0! flex items-center gap-1.5 text-2xs font-semibold tracking-[0.1em] uppercase" style={{ color: c.tone }}>
        <Icon className="size-3.5" />
        <span>{title ?? c.label}</span>
      </p>
      <div className="mt-1.5 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{children}</div>
    </aside>
  );
}

export function DepthBlock({ level = "advanced", title, children }: { level?: string; title?: string; children?: ReactNode }) {
  const d = (level in DEPTH_META ? level : "advanced") as Depth;
  const meta = DEPTH_META[d];
  return (
    <section data-depth={d} className="my-6 rounded-lg border border-border bg-surface px-4 py-3.5" style={{ borderLeftWidth: 2, borderLeftColor: `var(--d-${d})` }}>
      <div className={cn("mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs font-semibold tracking-[0.12em] uppercase", meta.text)}>
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
        <span>{meta.label}</span>
        {title && <span className="font-medium tracking-normal text-fg normal-case">— {title}</span>}
        <span className="font-normal tracking-normal text-subtle normal-case">
          {d === "advanced" ? "· optional for entry-level interviews" : d === "senior" ? "· conceptual awareness, not a requirement" : ""}
        </span>
      </div>
      <div className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{children}</div>
    </section>
  );
}

export function Details({ title = "Details", children }: { title?: string; children?: ReactNode }) {
  return (
    <details className="group my-5 rounded-lg border border-border bg-surface px-4 py-2 open:pb-3">
      <summary className="cursor-pointer list-none py-1 text-sm font-medium text-fg marker:hidden">
        <span className="mr-2 inline-block text-subtle transition-transform group-open:rotate-90">▸</span>
        {title}
      </summary>
      <div className="mt-2 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{children}</div>
    </details>
  );
}

export function Compare({ title = "Comparison", children }: { title?: string; children?: ReactNode }) {
  return (
    <figure className="my-6 overflow-hidden rounded-lg border border-border bg-surface">
      <figcaption className="flex items-center gap-2 border-b border-border px-3 py-1.5 font-mono text-2xs tracking-wider text-subtle uppercase">
        <Scale className="size-3.5" />
        {title}
      </figcaption>
      <div className="px-1 [&_table]:my-0 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_.table-wrap]:border-0 [&_.table-wrap]:rounded-none">{children}</div>
    </figure>
  );
}

export function Steps({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <div className="steps my-6 rounded-lg border border-border bg-surface px-4 py-3">
      {title && (
        <div className="mb-2 flex items-center gap-1.5 text-2xs font-semibold tracking-[0.1em] text-subtle uppercase">
          <ListOrdered className="size-3.5" />
          {title}
        </div>
      )}
      <div className="[&_ol]:my-0 [&_ol>li]:my-1.5 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{children}</div>
    </div>
  );
}

export function Table({ children, ...rest }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="table-wrap my-6 overflow-x-auto rounded-lg border border-border thin-scroll">
      <table {...rest}>{children}</table>
    </div>
  );
}

export function SmartLink({ href = "#", children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (href.startsWith("/")) return <Link href={href} {...rest}>{children}</Link>;
  if (href.startsWith("#")) return <a href={href} {...rest}>{children}</a>;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" {...rest}>
      {children}
    </a>
  );
}

export function LabCard({ id }: { id: string }) {
  const w = getWidget(id);
  if (!w) return null;
  const href = w.kinds.includes("lab") ? `/labs/${id}` : `/visualizations/${id}`;
  return (
    <Link href={href} className="not-prose group my-6 flex items-center gap-4 rounded-lg border border-border bg-surface p-4 no-underline transition-colors hover:border-border-strong">
      <span className="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-surface-2 text-fg">
        <FlaskConical className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="eyebrow block">Lab</span>
        <span className="block text-sm font-medium text-fg">{w.title}</span>
        <span className="block text-sm text-muted">{w.description}</span>
      </span>
      <ArrowRight className="size-4 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
    </Link>
  );
}
