"use client";
import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Wraps a :::depth block. When the reader's depth setting hides the block,
 * CSS swaps it for a one-line placeholder (see "Depth filtering" in
 * globals.css), so a section whose whole body is a deep dive never shows up as
 * a bare heading. Clicking the placeholder reveals just this block.
 */
export function DepthGate({ depth, label, title, topics = [], textClass, children }: { depth: string; label: string; title?: string; topics?: string[]; textClass: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-depth={depth} data-open={open || undefined}>
      {children}
      <button
        type="button"
        data-depth-placeholder
        onClick={() => setOpen(true)}
        className="no-print my-4 w-full items-center gap-2 rounded-lg border border-dashed border-border px-4 py-2.5 text-left text-xs text-muted transition-colors hover:border-border-strong hover:text-fg"
      >
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full bg-current", textClass)} />
        <span className={cn("font-semibold tracking-[0.1em] uppercase", textClass)}>{label}</span>
        <span className="min-w-0 flex-1 truncate" title={topics.join(" · ") || undefined}>
          {title ?? (topics.length ? topics.join(" · ") : "Deep dive hidden at your current depth")}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 font-medium text-fg">
          Show <ChevronDown className="size-3.5" />
        </span>
      </button>
    </div>
  );
}
