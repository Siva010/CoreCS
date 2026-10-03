"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CircleCheck, Eye, Lightbulb, Play, RotateCcw, Table2 } from "lucide-react";
import { PLAYGROUND_SEED, PLAYGROUND_TABLES } from "@/lib/sql/seed";
import { SQL_EXERCISES, compareResults, type SqlExercise } from "@/lib/sql/exercises";
import { describeSqlError, formatValue, type SqlResult } from "@/lib/sql/pglite";
import { useManifest } from "@/components/providers/Providers";
import { useProgress } from "@/lib/progress/store";
import { Btn, Explain, Panel, inputCls } from "../ui";
import { DbStatusBanner, RunOutput, SqlEditor, runUserSql, useSqlDatabase, type RunOutcome } from "./sqlUi";
import { cn } from "@/lib/utils";

const SOLVED_KEY = "ccia-sql-solved-v1";
const FREE_PLAY = "__free__";
const FREE_PLAY_SQL = `-- Free play: the whole schema is yours. Try:
SELECT d.name AS department, count(e.id) AS headcount, round(avg(e.salary)) AS avg_salary
FROM departments d
LEFT JOIN employees e ON e.department_id = d.id
GROUP BY d.id, d.name
ORDER BY headcount DESC;`;

const LEVEL_LABEL: Record<number, string> = { 1: "Basics", 2: "Joins & aggregation", 3: "Window functions", 4: "Interview patterns" };

function loadSolved(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SOLVED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function saveSolved(s: Set<string>) {
  try {
    localStorage.setItem(SOLVED_KEY, JSON.stringify([...s]));
  } catch {
    /* storage unavailable: progress simply isn't remembered */
  }
}

interface ColumnInfo {
  table_name: string;
  column_name: string;
  data_type: string;
}

export default function SqlPlayground() {
  const { db, status, error, notice, clearNotice, restart } = useSqlDatabase(PLAYGROUND_SEED);
  const manifest = useManifest();
  const logHistory = useProgress((s) => s.logHistory);
  const [selected, setSelected] = useState<string>(FREE_PLAY);
  const [drafts, setDrafts] = useState<Record<string, string>>({ [FREE_PLAY]: FREE_PLAY_SQL });
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [verdict, setVerdict] = useState<{ ok: boolean; message: string } | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [showSolution, setShowSolution] = useState(false);
  const [showSchema, setShowSchema] = useState(false);
  const [schema, setSchema] = useState<ColumnInfo[]>([]);
  const [solved, setSolved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => setSolved(loadSolved()), []);

  const exercise: SqlExercise | undefined = SQL_EXERCISES.find((e) => e.id === selected);
  const sql = drafts[selected] ?? `-- ${exercise?.title}\n-- Return: ${exercise?.columns.join(", ")}\n`;
  const lessonHref = (id: string) => manifest.lessons.find((l) => l.id === id)?.href;

  useEffect(() => {
    if (!db || !showSchema || schema.length) return;
    db.query<ColumnInfo>(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name IN (${PLAYGROUND_TABLES.map((t) => `'${t}'`).join(", ")})
       ORDER BY table_name, ordinal_position`,
    )
      .then((r) => setSchema(r.rows))
      .catch(() => setSchema([]));
  }, [db, showSchema, schema.length]);

  const select = (id: string) => {
    setSelected(id);
    setOutcome(null);
    setVerdict(null);
    setShowHint(false);
    setShowSolution(false);
  };

  const run = useCallback(async () => {
    if (!db || busy) return;
    setBusy(true);
    setVerdict(null);
    setOutcome(await runUserSql(db, sql));
    setBusy(false);
  }, [db, busy, sql]);

  const check = useCallback(async () => {
    if (!db || !exercise || busy) return;
    setBusy(true);
    const mine = await runUserSql(db, sql);
    setOutcome(mine);
    if (mine.error) {
      setVerdict({ ok: false, message: "Fix the error first." });
      setBusy(false);
      return;
    }
    const last = [...mine.results].reverse().find((r) => r.fields.length > 0);
    if (!last) {
      setVerdict({ ok: false, message: "Your SQL didn't return any rows to compare — the answer needs a SELECT." });
      setBusy(false);
      return;
    }
    try {
      const expected: SqlResult = await db.queryArrays(exercise.solution);
      const fmt = (r: SqlResult) => r.rows.map((row) => row.map(formatValue));
      const result = compareResults(fmt(last), fmt(expected), exercise.ordered);
      setVerdict(result);
      if (result.ok && !solved.has(exercise.id)) {
        const next = new Set(solved).add(exercise.id);
        setSolved(next);
        saveSolved(next);
        logHistory({ kind: "lab", title: `SQL exercise: ${exercise.title}`, href: "/labs/sql-playground" });
      }
    } catch (e) {
      setVerdict({ ok: false, message: `Couldn't run the reference solution: ${describeSqlError(e)}` });
    }
    setBusy(false);
  }, [db, exercise, busy, sql, solved, logHistory]);

  const grouped = useMemo(() => {
    const g = new Map<number, SqlExercise[]>();
    for (const e of SQL_EXERCISES) g.set(e.level, [...(g.get(e.level) ?? []), e]);
    return [...g.entries()];
  }, []);

  const tables = useMemo(() => {
    const m = new Map<string, ColumnInfo[]>();
    for (const c of schema) m.set(c.table_name, [...(m.get(c.table_name) ?? []), c]);
    return [...m.entries()];
  }, [schema]);

  return (
    <div className="space-y-4">
      <DbStatusBanner status={status} error={error} notice={notice} onDismiss={clearNotice} />

      <label className="flex flex-col gap-1 text-[12px] font-medium text-muted lg:hidden">
        Exercise ({solved.size}/{SQL_EXERCISES.length} solved)
        <select value={selected} onChange={(e) => select(e.target.value)} className={cn(inputCls, "font-sans")}>
          <option value={FREE_PLAY}>Free play</option>
          {grouped.map(([level, items]) => (
            <optgroup key={level} label={`L${level} · ${LEVEL_LABEL[level]}`}>
              {items.map((e) => (
                <option key={e.id} value={e.id}>
                  {solved.has(e.id) ? "✓ " : ""}
                  {e.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <div className="grid gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
        <Panel title={`Exercises · ${solved.size}/${SQL_EXERCISES.length} solved`} className="hidden self-start lg:block">
          <nav className="max-h-[520px] space-y-3 overflow-y-auto text-[13px] thin-scroll">
            <button
              type="button"
              onClick={() => select(FREE_PLAY)}
              className={cn("w-full rounded-md px-2 py-1.5 text-left font-medium", selected === FREE_PLAY ? "bg-accent/10 text-accent" : "text-muted hover:bg-surface-2 hover:text-fg")}
            >
              Free play
            </button>
            {grouped.map(([level, items]) => (
              <div key={level}>
                <div className="mb-1 px-2 text-[11px] font-semibold tracking-wider text-subtle uppercase">
                  L{level} · {LEVEL_LABEL[level]}
                </div>
                <ul className="space-y-0.5">
                  {items.map((e) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => select(e.id)}
                        className={cn("flex w-full items-start gap-2 rounded-md px-2 py-1 text-left", selected === e.id ? "bg-accent/10 text-accent" : "text-muted hover:bg-surface-2 hover:text-fg")}
                      >
                        <CircleCheck className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", solved.has(e.id) ? "text-ok" : "text-border-strong")} />
                        <span>{e.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </Panel>

        <div className="min-w-0 space-y-3">
          {exercise ? (
            <div className="rounded-xl border border-border bg-surface p-4">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-[11.5px] font-semibold tracking-wide text-subtle uppercase">
                <span>L{exercise.level}</span>
                <span>·</span>
                <span>{exercise.topic}</span>
                {solved.has(exercise.id) && <span className="rounded-full bg-ok/15 px-2 py-0.5 text-ok normal-case">solved</span>}
              </div>
              <h3 className="text-[16px] font-semibold text-fg">{exercise.title}</h3>
              <p className="mt-1 text-[14px] text-muted">{exercise.prompt}</p>
              <p className="mt-2 text-[12.5px] text-subtle">
                Expected columns: <span className="font-mono text-muted">{exercise.columns.join(", ")}</span>
                {exercise.ordered ? " · row order matters" : " · any row order"}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Btn variant="ghost" onClick={() => setShowHint((v) => !v)}>
                  <Lightbulb className="h-3.5 w-3.5" /> {showHint ? "Hide hint" : "Hint"}
                </Btn>
                <Btn variant="ghost" onClick={() => setShowSolution((v) => !v)}>
                  <Eye className="h-3.5 w-3.5" /> {showSolution ? "Hide solution" : "Solution"}
                </Btn>
                {lessonHref(exercise.lesson) && (
                  <Link href={lessonHref(exercise.lesson)!} className="inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-medium text-muted hover:bg-surface-2 hover:text-fg">
                    Lesson →
                  </Link>
                )}
              </div>
              {showHint && <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-[13px]">{exercise.hint}</p>}
              {showSolution && <pre className="mt-2 overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-[12.5px]">{exercise.solution}</pre>}
            </div>
          ) : (
            <p className="text-[13.5px] text-muted">
              Seven tables — departments, employees, customers, products, orders, order_items, logins — with deliberate traps: employees without a department, a department without employees,
              guest orders with a NULL customer, customers who never ordered, salary ties and duplicate logins.
            </p>
          )}

          <SqlEditor value={sql} onChange={(v) => setDrafts((d) => ({ ...d, [selected]: v }))} onRun={exercise ? check : run} rows={9} disabled={status !== "ready"} />

          <div className="flex flex-wrap items-center gap-2">
            <Btn variant="primary" onClick={run} disabled={!db || busy}>
              <Play className="h-3.5 w-3.5" /> Run
            </Btn>
            {exercise && (
              <Btn onClick={check} disabled={!db || busy}>
                <CircleCheck className="h-3.5 w-3.5" /> Check answer
              </Btn>
            )}
            <Btn variant="ghost" onClick={() => setShowSchema((v) => !v)}>
              <Table2 className="h-3.5 w-3.5" /> {showSchema ? "Hide schema" : "Schema"}
            </Btn>
            <Btn variant="ghost" onClick={() => { restart(); setOutcome(null); setVerdict(null); setSchema([]); }} title="Rebuild the database from scratch">
              <RotateCcw className="h-3.5 w-3.5" /> Reset database
            </Btn>
            <span className="text-[12px] text-subtle">{exercise ? "Ctrl/⌘ + Enter checks your answer" : "Ctrl/⌘ + Enter runs"}</span>
          </div>

          {showSchema && (
            <Panel title="Schema">
              {tables.length ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {tables.map(([t, cols]) => (
                    <div key={t} className="rounded-lg border border-border p-2">
                      <div className="mb-1 font-mono text-[13px] font-semibold text-fg">{t}</div>
                      <ul className="space-y-0.5 font-mono text-[12px]">
                        {cols.map((c) => (
                          <li key={c.column_name} className="flex justify-between gap-2">
                            <span>{c.column_name}</span>
                            <span className="text-subtle">{c.data_type}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-subtle">Loading schema…</p>
              )}
            </Panel>
          )}

          {verdict && <Explain tone={verdict.ok ? "good" : "bad"}>{verdict.message}</Explain>}
          <Panel title="Result">
            <RunOutput outcome={outcome} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
