"use client";
// Shared primitives for labs and visualizations: consistent controls, panels
// and step playback so every widget feels like part of one instrument set.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Pause, Play, RotateCcw, StepBack, StepForward } from "lucide-react";
import { cn } from "@/lib/utils";

export function Panel({ title, right, children, className }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border bg-surface", className)}>
      {(title || right) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="text-[12px] font-semibold tracking-wide text-muted uppercase">{title}</div>
          {right}
        </div>
      )}
      <div className="p-3">{children}</div>
    </div>
  );
}

export function Btn({
  children,
  onClick,
  variant = "default",
  disabled,
  className,
  title,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "ghost" | "danger";
  disabled?: boolean;
  className?: string;
  title?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        variant === "primary" && "bg-accent text-accent-fg hover:opacity-90",
        variant === "default" && "border border-border bg-surface text-fg hover:border-border-strong hover:bg-surface-2",
        variant === "ghost" && "text-muted hover:bg-surface-2 hover:text-fg",
        variant === "danger" && "border border-bad/40 bg-bad/10 text-bad hover:bg-bad/15",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
  size?: "sm" | "md";
  ariaLabel?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex flex-wrap rounded-lg border border-border bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md font-medium transition-colors",
            size === "sm" ? "px-2 py-0.5 text-[12px]" : "px-2.5 py-1 text-[13px]",
            value === o.value ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-[12px] text-muted">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-subtle">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "h-8 rounded-lg border border-border bg-surface px-2 text-[13px] text-fg outline-none focus:border-accent font-mono";

export function NumberInput({ value, onChange, min, max, step = 1, className }: { value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; className?: string }) {
  return (
    <input
      type="number"
      className={cn(inputCls, "w-20", className)}
      value={Number.isFinite(value) ? value : ""}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (!Number.isNaN(n)) onChange(n);
      }}
    />
  );
}

export function Select<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string }) {
  return (
    <select className={cn(inputCls, "font-sans", className)} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Step-playback state for step-based visualizations. */
export function useStepper(total: number, { interval = 1100 }: { interval?: number } = {}) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (step >= total - 1) setPlaying(false);
  }, [step, total]);

  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => setStep((s) => Math.min(s + 1, total - 1)), interval);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, total, interval]);

  const reset = useCallback(() => {
    setPlaying(false);
    setStep(0);
  }, []);

  return {
    step,
    setStep: (n: number) => setStep(Math.max(0, Math.min(total - 1, n))),
    next: () => setStep((s) => Math.min(s + 1, total - 1)),
    prev: () => setStep((s) => Math.max(s - 1, 0)),
    playing,
    toggle: () => {
      if (step >= total - 1) setStep(0);
      setPlaying((p) => !p);
    },
    reset,
    atEnd: step >= total - 1,
    atStart: step === 0,
  };
}

export function StepControls({ s, total, label }: { s: ReturnType<typeof useStepper>; total: number; label?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Btn onClick={s.reset} variant="ghost" title="Reset">
        <RotateCcw className="h-3.5 w-3.5" />
      </Btn>
      <Btn onClick={s.prev} disabled={s.atStart} title="Previous step">
        <StepBack className="h-3.5 w-3.5" />
      </Btn>
      <Btn onClick={s.toggle} variant="primary" title={s.playing ? "Pause" : "Play"}>
        {s.playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        {s.playing ? "Pause" : s.atEnd ? "Replay" : "Play"}
      </Btn>
      <Btn onClick={s.next} disabled={s.atEnd} title="Next step">
        <StepForward className="h-3.5 w-3.5" />
      </Btn>
      <span className="font-mono text-[12px] text-subtle">
        {s.step + 1}/{total}
      </span>
      {label && <span className="text-[13px] text-muted">{label}</span>}
    </div>
  );
}

export function Explain({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "bad" | "warn" }) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-[13.5px] leading-relaxed",
        tone === "neutral" && "border-border bg-surface-2 text-fg",
        tone === "good" && "border-ok/40 bg-ok/10 text-fg",
        tone === "bad" && "border-bad/40 bg-bad/10 text-fg",
        tone === "warn" && "border-warn/40 bg-warn/10 text-fg",
      )}
    >
      {children}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2">
      <div className="text-[11px] font-medium tracking-wide text-subtle uppercase">{label}</div>
      <div className="font-mono text-lg font-semibold text-fg">{value}</div>
      {sub && <div className="text-[11px] text-subtle">{sub}</div>}
    </div>
  );
}

/** Deterministic color palette for process / transaction / stream identities. */
export const PALETTE = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#a855f7", "#14b8a6", "#f97316", "#84cc16", "#ec4899"];
export function colorFor(i: number) {
  return PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];
}
