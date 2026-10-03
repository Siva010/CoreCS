"use client";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Database, Loader2, TriangleAlert } from "lucide-react";
import { createDatabase, describeSqlError, formatValue, type SqlDatabase, type SqlResult } from "@/lib/sql/pglite";
import { cn } from "@/lib/utils";

export type DbStatus = "loading" | "ready" | "error";

/** Owns one in-browser PostgreSQL instance; restart() rebuilds it from the seed. */
export function useSqlDatabase(seed: string) {
  const [status, setStatus] = useState<DbStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const dbRef = useRef<SqlDatabase | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);
    createDatabase(seed, (reason) => {
      if (cancelled || reason.name === "DatabaseStoppedError") return;
      // A runaway query forced a stop: rebuild automatically and tell the user why.
      setNotice(reason.message);
      setGeneration((g) => g + 1);
    })
      .then((db) => {
        if (cancelled) return db.stop();
        dbRef.current = db;
        setStatus("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        setStatus("error");
        setError(describeSqlError(e));
      });
    return () => {
      cancelled = true;
      dbRef.current?.stop();
      dbRef.current = null;
    };
  }, [seed, generation]);

  const restart = useCallback(() => {
    setNotice(null);
    setGeneration((g) => g + 1);
  }, []);

  return { db: status === "ready" ? dbRef.current : null, status, error, notice, clearNotice: () => setNotice(null), restart };
}

export function DbStatusBanner({ status, error, notice, onDismiss, loadingLabel = "Starting PostgreSQL in your browser…" }: { status: DbStatus; error: string | null; notice?: string | null; onDismiss?: () => void; loadingLabel?: string }) {
  if (status === "loading") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13px] text-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> {loadingLabel} <span className="text-subtle">(first load downloads ~10 MB, then it&apos;s cached)</span>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-[13px]">
        <div className="flex items-center gap-2 font-medium text-bad">
          <TriangleAlert className="h-4 w-4" /> PostgreSQL couldn&apos;t start in this browser.
        </div>
        <pre className="mt-1 whitespace-pre-wrap text-[12px] text-muted">{error}</pre>
      </div>
    );
  }
  if (notice) {
    return (
      <div className="flex items-start justify-between gap-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-[13px]">
        <span>{notice}</span>
        {onDismiss && (
          <button type="button" onClick={onDismiss} className="text-muted hover:text-fg">
            Dismiss
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-[12px] text-subtle">
      <Database className="h-3.5 w-3.5 text-ok" /> PostgreSQL is running locally in your browser (WebAssembly). Nothing is sent to a server.
    </div>
  );
}

/** Plain-textarea SQL editor: Ctrl/Cmd+Enter runs, Tab indents. */
export function SqlEditor({ value, onChange, onRun, rows = 8, disabled }: { value: string; onChange: (v: string) => void; onRun: () => void; rows?: number; disabled?: boolean }) {
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      onRun();
    } else if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: s, selectionEnd: t } = el;
      const next = value.slice(0, s) + "  " + value.slice(t);
      onChange(next);
      requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
    }
  };
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      rows={rows}
      spellCheck={false}
      disabled={disabled}
      aria-label="SQL editor"
      className="w-full resize-y rounded-lg border border-border bg-surface-2 p-3 font-mono text-[13px] leading-relaxed text-fg outline-none focus:border-accent disabled:opacity-60"
    />
  );
}

export interface RunOutcome {
  results: SqlResult[];
  ms: number;
  error?: string;
}

/** Runs user SQL (possibly several statements) and times it. */
export async function runUserSql(db: SqlDatabase, sql: string): Promise<RunOutcome> {
  const t = performance.now();
  try {
    const results = await db.exec(sql);
    return { results, ms: performance.now() - t };
  } catch (e) {
    return { results: [], ms: performance.now() - t, error: describeSqlError(e) };
  }
}

export function ResultTable({ result, maxRows = 200, className }: { result: SqlResult; maxRows?: number; className?: string }) {
  const rows = result.rows.slice(0, maxRows);
  return (
    <div className={cn("overflow-auto rounded-lg border border-border thin-scroll", className)}>
      <table className="w-full min-w-max text-left font-mono text-[12.5px]">
        <thead className="sticky top-0 bg-surface-2 text-[11.5px] text-muted">
          <tr>
            {result.fields.map((f, i) => (
              <th key={i} className="border-b border-border px-2.5 py-1.5 font-semibold">
                {f.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/60 last:border-0 hover:bg-surface-2/60">
              {r.map((v, j) => (
                <td key={j} className={cn("px-2.5 py-1 whitespace-nowrap", v === null && "text-subtle italic")}>
                  {formatValue(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {result.rows.length > maxRows && <div className="border-t border-border px-2.5 py-1 text-[12px] text-subtle">Showing {maxRows} of {result.rows.length} rows.</div>}
    </div>
  );
}

export function RunOutput({ outcome }: { outcome: RunOutcome | null }) {
  if (!outcome) return <p className="text-[13px] text-subtle">Run a query to see results. Tip: Ctrl/⌘ + Enter.</p>;
  if (outcome.error) {
    return <pre className="whitespace-pre-wrap rounded-lg border border-bad/40 bg-bad/10 p-3 font-mono text-[12.5px] text-bad">{outcome.error}</pre>;
  }
  const last = [...outcome.results].reverse().find((r) => r.fields.length > 0);
  const summary = outcome.results.map((r) => (r.fields.length ? `${r.rows.length} row${r.rows.length === 1 ? "" : "s"}` : `${r.command ?? "OK"}${r.affectedRows ? ` ${r.affectedRows}` : ""}`)).join(" · ");
  return (
    <div className="space-y-2">
      <div className="text-[12px] text-subtle">
        {summary || "OK"} · {outcome.ms.toFixed(1)} ms
      </div>
      {last ? <ResultTable result={last} className="max-h-96" /> : null}
    </div>
  );
}
