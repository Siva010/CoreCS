"use client";
import { useState } from "react";
import { CircleCheck, CircleX, Eye } from "lucide-react";
import type { PracticeData } from "@/lib/content/types";
import { useProgress } from "@/lib/progress/store";
import { cn } from "@/lib/utils";
import { Html } from "./QuestionCard";

function Mcq({ p }: { p: PracticeData }) {
  const [choice, setChoice] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const record = useProgress((s) => s.recordPractice);
  const correct = choice !== null && p.options![choice].correct;
  return (
    <div>
      <div className="space-y-2" role="radiogroup">
        {p.options!.map((o, i) => {
          const isCorrect = o.correct;
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={choice === i}
              disabled={checked}
              onClick={() => setChoice(i)}
              className={cn(
                "flex w-full items-start gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                !checked && choice === i && "border-accent bg-accent/10",
                !checked && choice !== i && "border-border hover:border-border-strong",
                checked && isCorrect && "border-ok/60 bg-ok/10",
                checked && !isCorrect && choice === i && "border-bad/60 bg-bad/10",
                checked && !isCorrect && choice !== i && "border-border opacity-60",
              )}
            >
              <span className={cn("mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full border", choice === i ? "border-accent" : "border-border-strong")}>
                {choice === i && <span className="h-2 w-2 rounded-full bg-accent" />}
              </span>
              <Html html={o.html} className="[&_p]:my-0 text-[14.5px]" />
            </button>
          );
        })}
      </div>
      {!checked ? (
        <button
          type="button"
          disabled={choice === null}
          onClick={() => {
            setChecked(true);
            record(p.id, p.lessonId, correct);
          }}
          className="mt-3 h-8 rounded-lg bg-accent px-3 text-[13px] font-medium text-accent-fg disabled:opacity-40"
        >
          Check answer
        </button>
      ) : (
        <Feedback ok={correct} html={p.explanationHtml} onRetry={() => { setChecked(false); setChoice(null); }} />
      )}
    </div>
  );
}

function Feedback({ ok, html, onRetry }: { ok: boolean; html: string; onRetry?: () => void }) {
  return (
    <div className={cn("mt-3 rounded-lg border px-3 py-2", ok ? "border-ok/40 bg-ok/5" : "border-bad/40 bg-bad/5")}>
      <div className={cn("mb-1 flex items-center gap-1.5 text-[13px] font-semibold", ok ? "text-ok" : "text-bad")}>
        {ok ? <CircleCheck className="h-4 w-4" /> : <CircleX className="h-4 w-4" />}
        {ok ? "Correct" : "Not quite"}
        {onRetry && (
          <button type="button" onClick={onRetry} className="ml-auto text-[12px] font-medium text-muted hover:text-fg">
            Try again
          </button>
        )}
      </div>
      {html && <Html html={html} className="text-[14.5px]" />}
    </div>
  );
}

function Numeric({ p }: { p: PracticeData }) {
  const [val, setVal] = useState("");
  const [result, setResult] = useState<boolean | null>(null);
  const record = useProgress((s) => s.recordPractice);
  const check = () => {
    const n = Number(val.replace(/,/g, ""));
    const ok = Number.isFinite(n) && Math.abs(n - (p.answer ?? NaN)) <= (p.tolerance ?? 0.01);
    setResult(ok);
    record(p.id, p.lessonId, ok);
  };
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && check()}
          inputMode="decimal"
          placeholder="Your answer"
          aria-label="Numeric answer"
          className="h-9 w-40 rounded-lg border border-border bg-surface px-3 font-mono text-sm outline-none focus:border-accent"
        />
        {p.unit && <span className="text-sm text-muted">{p.unit}</span>}
        <button type="button" onClick={check} disabled={!val.trim()} className="h-9 rounded-lg bg-accent px-3 text-[13px] font-medium text-accent-fg disabled:opacity-40">
          Check
        </button>
      </div>
      {result !== null && (
        <Feedback
          ok={result}
          html={(result ? "" : `<p>Expected <strong>${p.answer}${p.unit ? " " + p.unit : ""}</strong>.</p>`) + p.explanationHtml}
          onRetry={result ? undefined : () => setResult(null)}
        />
      )}
    </div>
  );
}

function Exercise({ p }: { p: PracticeData }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<boolean | null>(null);
  const record = useProgress((s) => s.recordPractice);
  return (
    <div>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-2 text-[13px] font-medium text-accent hover:underline">
          <Eye className="h-4 w-4" /> Work it out, then show the solution
        </button>
      ) : (
        <div className="rounded-lg border border-border bg-surface-2/50 px-3 py-2">
          <div className="mb-1 text-[11px] font-semibold tracking-wider text-subtle uppercase">Solution</div>
          <Html html={p.explanationHtml} />
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-2 text-[13px]">
            <span className="text-muted">Did you get it?</span>
            {[true, false].map((ok) => (
              <button
                key={String(ok)}
                type="button"
                onClick={() => {
                  setDone(ok);
                  record(p.id, p.lessonId, ok);
                }}
                className={cn(
                  "rounded-lg border px-2.5 py-1 font-medium",
                  done === ok ? (ok ? "border-ok/60 bg-ok/10 text-ok" : "border-bad/60 bg-bad/10 text-bad") : "border-border hover:bg-surface-2",
                )}
              >
                {ok ? "Yes" : "Not yet"}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function PracticeList({ items }: { items: PracticeData[] }) {
  if (!items.length) return null;
  return (
    <div className="space-y-4">
      {items.map((p, i) => (
        <article key={p.id} id={p.id} className="rounded-xl border border-border bg-surface px-4 py-3">
          <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold tracking-wider text-subtle uppercase">
            <span>Practice {i + 1}</span>
            <span>·</span>
            <span>{p.kind === "mcq" ? "Multiple choice" : p.kind === "numeric" ? "Numerical" : "Exercise"}</span>
          </div>
          <h4 className="mb-2 text-[15px] font-semibold text-fg">{p.prompt}</h4>
          {p.promptHtml && <Html html={p.promptHtml} className="mb-3" />}
          {p.kind === "mcq" && <Mcq p={p} />}
          {p.kind === "numeric" && <Numeric p={p} />}
          {p.kind === "exercise" && <Exercise p={p} />}
        </article>
      ))}
    </div>
  );
}
