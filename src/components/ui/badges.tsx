import type { Depth, Relevance, SubjectId } from "@/lib/content/types";
import { cn, DEPTH_META, DIFFICULTY_LABELS, RELEVANCE_META, SUBJECT_SHORT, SUBJECT_STYLE } from "@/lib/utils";

export function DepthBadge({ depth, className, compact }: { depth: Depth; className?: string; compact?: boolean }) {
  const m = DEPTH_META[depth];
  return (
    <span
      title={m.blurb}
      className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap", m.border, m.bg, m.text, className)}
    >
      <span aria-hidden className="text-[9px]">{m.emoji}</span>
      {compact ? m.short : m.label}
    </span>
  );
}

export function SubjectBadge({ subject, className }: { subject: SubjectId; className?: string }) {
  const s = SUBJECT_STYLE[subject];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px] font-medium", s.border, s.bg, s.text, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
      {SUBJECT_SHORT[subject]}
    </span>
  );
}

export function Pill({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[11.5px] text-muted", className)}>
      {children}
    </span>
  );
}

export function RelevanceMeter({ relevance }: { relevance: Relevance }) {
  const r = RELEVANCE_META[relevance];
  return (
    <span className="inline-flex items-center gap-1.5" title={`Interview relevance: ${r.label}`}>
      <span className="flex gap-0.5" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={cn("h-2.5 w-1.5 rounded-sm", i <= r.dots ? "bg-accent" : "bg-border")} />
        ))}
      </span>
      <span>{r.label}</span>
    </span>
  );
}

export function DifficultyMeter({ difficulty }: { difficulty: number }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={`Difficulty ${difficulty}/5`}>
      <span className="flex items-end gap-0.5" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} style={{ height: 4 + i * 2 }} className={cn("w-1 rounded-sm", i <= difficulty ? "bg-fg/70" : "bg-border")} />
        ))}
      </span>
      <span>{DIFFICULTY_LABELS[difficulty]}</span>
    </span>
  );
}

export function PageHeader({ eyebrow, title, description, children }: { eyebrow?: React.ReactNode; title: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="mb-8 border-b border-border pb-8">
      {eyebrow && <div className="mb-3 text-[12px] font-semibold tracking-wider text-subtle uppercase">{eyebrow}</div>}
      <h1 className="text-3xl font-semibold tracking-tight text-balance text-fg sm:text-4xl">{title}</h1>
      {description && <p className="mt-3 max-w-3xl text-[16px] leading-relaxed text-pretty text-muted">{description}</p>}
      {children}
    </header>
  );
}
