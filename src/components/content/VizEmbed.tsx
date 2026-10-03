"use client";
import Link from "next/link";
import { Activity, Maximize2 } from "lucide-react";
import { getWidget } from "@/lib/registry";
import { WidgetById } from "@/components/widgets";

/** A widget embedded inside lesson prose via ::viz{id=...}. */
export function VizEmbed({ id, title }: { id: string; title?: string }) {
  const w = getWidget(id);
  if (!w) return <p className="text-sm text-bad">Unknown visualization: {id}</p>;
  const href = w.kinds.includes("lab") ? `/labs/${id}` : `/visualizations/${id}`;
  return (
    <figure className="not-prose my-8 overflow-hidden rounded-2xl border border-border bg-bg">
      <figcaption className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2.5">
        <Activity className="h-4 w-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-fg">{title ?? w.title}</div>
        </div>
        <Link href={href} className="flex shrink-0 items-center gap-1 text-[12px] text-muted hover:text-accent">
          <Maximize2 className="h-3.5 w-3.5" /> Full page
        </Link>
      </figcaption>
      <div className="p-3 sm:p-4">
        <WidgetById id={id} />
      </div>
    </figure>
  );
}
