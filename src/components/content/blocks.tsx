// Server-renderable content blocks used by the Markdown renderer.
import Link from "next/link";
import type { ReactNode } from "react";
import { Brain, FlaskConical, Info, Lightbulb, MessagesSquare, Server, Flame, TriangleAlert, ArrowRight, Scale, ListOrdered } from "lucide-react";
import { cn, DEPTH_META } from "@/lib/utils";
import { getWidget } from "@/lib/registry";
import type { Depth } from "@/lib/content/types";

const CALLOUTS = {
  note: { icon: Info, label: "Note", cls: "border-accent/40 bg-accent/[0.06]", ic: "text-accent" },
  tip: { icon: Lightbulb, label: "Tip", cls: "border-ok/40 bg-ok/[0.06]", ic: "text-ok" },
  insight: { icon: Brain, label: "Key insight", cls: "border-x/40 bg-x/[0.06]", ic: "text-x" },
  warning: { icon: TriangleAlert, label: "Watch out", cls: "border-warn/40 bg-warn/[0.07]", ic: "text-warn" },
  danger: { icon: Flame, label: "Danger", cls: "border-bad/40 bg-bad/[0.06]", ic: "text-bad" },
  interview: { icon: MessagesSquare, label: "Interview angle", cls: "border-d-core/40 bg-d-core/[0.06]", ic: "text-d-core" },
  production: { icon: Server, label: "In production", cls: "border-db/40 bg-db/[0.06]", ic: "text-db" },
} as const;

export function Callout({ type = "note", title, children }: { type?: string; title?: string; children?: ReactNode }) {
  const c = CALLOUTS[type as keyof typeof CALLOUTS] ?? CALLOUTS.note;
  const Icon = c.icon;
  return (
    <div className={cn("not-prose-margins my-6 rounded-xl border px-4 py-3", c.cls)} role="note">
      <div className={cn("mb-1 flex items-center gap-2 text-[13px] font-semibold", c.ic)}>
        <Icon className="h-4 w-4" />
        <span>{title ?? c.label}</span>
      </div>
      <div className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{children}</div>
    </div>
  );
}

export function DepthBlock({ level = "advanced", title, children }: { level?: string; title?: string; children?: ReactNode }) {
  const d = (level in DEPTH_META ? level : "advanced") as Depth;
  const meta = DEPTH_META[d];
  return (
    <section data-depth={d} className={cn("my-6 rounded-xl border border-l-4 bg-surface px-4 py-3", meta.border)}>
      <div className={cn("mb-1 flex flex-wrap items-center gap-2 text-[12px] font-semibold tracking-wide uppercase", meta.text)}>
        <span aria-hidden>{meta.emoji}</span>
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
    <details className="group my-5 rounded-xl border border-border bg-surface px-4 py-2 open:pb-3">
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
    <figure className="my-6 overflow-hidden rounded-xl border border-border bg-surface">
      <figcaption className="flex items-center gap-2 border-b border-border bg-surface-2 px-4 py-2 text-[13px] font-semibold">
        <Scale className="h-4 w-4 text-accent" />
        {title}
      </figcaption>
      <div className="px-1 [&_table]:my-0 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_.table-wrap]:border-0 [&_.table-wrap]:rounded-none">{children}</div>
    </figure>
  );
}

export function Steps({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <div className="steps my-6 rounded-xl border border-border bg-surface px-4 py-3">
      {title && (
        <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
          <ListOrdered className="h-4 w-4 text-accent" />
          {title}
        </div>
      )}
      <div className="[&_ol]:my-0 [&_ol>li]:my-1.5 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{children}</div>
    </div>
  );
}

export function Table({ children, ...rest }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="table-wrap my-6 overflow-x-auto rounded-xl border border-border thin-scroll">
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
    <Link href={href} className="not-prose group my-6 flex items-center gap-4 rounded-xl border border-border bg-surface p-4 no-underline hover:border-accent/50">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent">
        <FlaskConical className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold tracking-wider text-subtle uppercase">Lab</span>
        <span className="block font-medium text-fg">{w.title}</span>
        <span className="block text-sm text-muted">{w.description}</span>
      </span>
      <ArrowRight className="h-4 w-4 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
    </Link>
  );
}
