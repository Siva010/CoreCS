"use client";
import { useState, type ReactNode } from "react";
import { Eye } from "lucide-react";

/** Inline :::answer / :::solution blocks inside lesson prose. */
export function AnswerReveal({ title, children }: { title?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-5 rounded-xl border border-dashed border-border-strong bg-surface px-4 py-3">
      {open ? (
        <div className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{children}</div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-2 text-sm font-medium text-accent hover:underline">
          <Eye className="h-4 w-4" />
          {title ?? "Think first — then reveal the answer"}
        </button>
      )}
    </div>
  );
}
