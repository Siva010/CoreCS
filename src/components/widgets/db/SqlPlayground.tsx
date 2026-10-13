"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CircleCheck, Eye, Lightbulb, Play, RotateCcw, Table2 } from "lucide-react";
import { PLAYGROUND_SEED, PLAYGROUND_TABLES } from "@/lib/sql/seed";
import { SQL_EXERCISES, SQL_SECTIONS, compareResults, type SqlExercise } from "@/lib/sql/exercises";
import { describeSqlError, formatValue, type SqlDatabase, type SqlResult } from "@/lib/sql/pglite";
import { useManifest } from "@/components/providers/Providers";
import { useProgress } from "@/lib/progress/store";
import { Btn, Explain, Panel, inputCls } from "../ui";
import { DbStatusBanner, ResultTable, RunOutput, SqlEditor, runUserSql, useSqlDatabase, type RunOutcome } from "./sqlUi";
import { cn } from "@/lib/utils";

const SOLVED_KEY = "ccia-sql-solved-v1";
const FREE_PLAY = "__free__";
const FREE_PLAY_SQL = `-- Free play: the whole schema is yours. Try:
SELECT d.name AS department, count(e.id) AS headcount, round(avg(e.salary)) AS avg_salary
FROM departments d
LEFT JOIN employees e ON e.department_id = d.id
GROUP BY d.id, d.name
ORDER BY headcount DESC;`;

// Exercises in the order the sidebar lists them: by section, then as written.
const ORDERED = SQL_SECTIONS.flatMap((s) => SQL_EXERCISES.filter((e) => e.section === s.id));

// Data-modification exercises run inside a transaction the playground rolls back,
// so the learner's SQL must not open or end transactions itself.
const TX_CONTROL = /(^|;)\s*(begin|commit|rollback|end|abort|start\s+transaction|savepoint|release)\b/i;
function controlsTransaction(sql: string) {
  const code = sql.replace(/--[^\n]*/g, "").replace(/'(?:[^']|'')*'/g, "''");
  return TX_CONTROL.test(code);
}

interface RolledBack {
  outcome: RunOutcome;
  after: SqlResult | null;
  afterError?: string;
}

/** Runs statements in a transaction, reads `check` inside it, then rolls everything back. */
async function runRolledBack(db: SqlDatabase, sql: string, check: string): Promise<RolledBack> {
  await db.exec("BEGIN");
  try {
    const outcome = await runUserSql(db, sql);
    if (outcome.error) return { outcome, after: null };
    try {
      return { outcome, after: await db.queryArrays(check) };
    } catch (e) {
      return { outcome, after: null, afterError: describeSqlError(e) };
    }
  } finally {
    await db.exec("ROLLBACK").catch(() => undefined);
  }
}

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
  const [after, setAfter] = useState<SqlResult | null>(null);
  const [verdict, setVerdict] = useState<{ ok: boolean; message: string } | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [showSolution, setShowSolution] = useState(false);
  const [showSchema, setShowSchema] = useState(false);
  const [schema, setSchema] = useState<ColumnInfo[]>([]);
  const [solved, setSolved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => setSolved(loadSolved()), []);

  const exercise: SqlExercise | undefined = SQL_EXERCISES.find((e) => e.id === selected);
  const sql = drafts[selected] ?? `-- ${exercise?.title}\n-- ${exercise?.check ? "Write the statement(s) that make the change." : `Return: ${exercise?.columns.join(", ")}`}\n`;
  const lessonHref = (id: string) => manifest.lessons.find((l) => l.id === id)?.href;
  const position = ORDERED.findIndex((e) => e.id === selected);
  const nextExercise = position >= 0 ? ORDERED[position + 1] : ORDERED[0];

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

  const select = useCallback((id: string, updateUrl = true) => {
    setSelected(id);
    setOutcome(null);
    setAfter(null);
    setVerdict(null);
    setShowHint(false);
    setShowSolution(false);
    if (updateUrl) {
      try {
        history.replaceState(null, "", id === FREE_PLAY ? location.pathname + location.search : `#${id}`);
      } catch {
        /* sandboxed frames may forbid history access */
      }
    }
  }, []);

  // Lessons link to lab:sql-playground#<exercise-id>; open that exercise.
  useEffect(() => {
    const fromHash = () => {
      const id = decodeURIComponent(location.hash.slice(1));
      if (SQL_EXERCISES.some((e) => e.id === id)) select(id, false);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [select]);

  const run = useCallback(async () => {
    if (!db || busy) return;
    setVerdict(null);
    setAfter(null);
    if (exercise?.check) {
      if (controlsTransaction(sql)) {
        setVerdict({ ok: false, message: "Leave out BEGIN / COMMIT / ROLLBACK: the playground wraps your statements in a transaction and rolls it back after every run." });
        return;
      }
      setBusy(true);
      const r = await runRolledBack(db, sql, exercise.check);
      setOutcome(r.outcome);
      setAfter(r.after);
      if (r.afterError) setVerdict({ ok: false, message: `Your statements ran, but the check couldn't read the result: ${r.afterError}` });
      setBusy(false);
      return;
    }
    setBusy(true);
    setOutcome(await runUserSql(db, sql));
    setBusy(false);
  }, [db, busy, sql, exercise]);

  const markSolved = useCallback(
    (ex: SqlExercise) => {
      if (solved.has(ex.id)) return;
      const next = new Set(solved).add(ex.id);
      setSolved(next);
      saveSolved(next);
      logHistory({ kind: "lab", title: `SQL exercise: ${ex.title}`, href: "/labs/sql-playground" });
    },
    [solved, logHistory],
  );

  const check = useCallback(async () => {
    if (!db || !exercise || busy) return;
    const fmt = (r: SqlResult) => r.rows.map((row) => row.map(formatValue));
    setVerdict(null);
    setAfter(null);

    if (exercise.check) {
      if (controlsTransaction(sql)) {
        setVerdict({ ok: false, message: "Leave out BEGIN / COMMIT / ROLLBACK: the playground wraps your statements in a transaction and rolls it back after every run." });
        return;
      }
      setBusy(true);
      const mine = await runRolledBack(db, sql, exercise.check);
      setOutcome(mine.outcome);
      setAfter(mine.after);
      if (mine.outcome.error) {
        setVerdict({ ok: false, message: "Fix the error first. Nothing was changed: the transaction was rolled back." });
      } else if (!mine.after) {
        setVerdict({ ok: false, message: `Your statements ran, but the check couldn't read the result: ${mine.afterError ?? "unknown error"}` });
      } else {
        const expected = await runRolledBack(db, exercise.solution, exercise.check);
        if (!expected.after) {
          setVerdict({ ok: false, message: `Couldn't run the reference solution: ${expected.outcome.error ?? expected.afterError}` });
        } else {
          const result = compareResults(fmt(mine.after), fmt(expected.after), exercise.ordered);
          setVerdict(result.ok ? { ok: true, message: "Correct — your change leaves the data exactly as expected. (It was rolled back, so you can run it again.)" } : { ok: false, message: `The data after your change differs from the expected state. ${result.message}` });
          if (result.ok) markSolved(exercise);
        }
      }
      setBusy(false);
      return;
    }

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
      const result = compareResults(fmt(last), fmt(expected), exercise.ordered);
      setVerdict(result);
      if (result.ok) markSolved(exercise);
    } catch (e) {
      setVerdict({ ok: false, message: `Couldn't run the reference solution: ${describeSqlError(e)}` });
    }
    setBusy(false);
  }, [db, exercise, busy, sql, markSolved]);

  const grouped = useMemo(() => SQL_SECTIONS.map((s) => ({ ...s, items: SQL_EXERCISES.filter((e) => e.section === s.id) })).filter((g) => g.items.length), []);

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
          {grouped.map((g) => (
            <optgroup key={g.id} label={g.title}>
              {g.items.map((e) => (
                <option key={e.id} value={e.id}>
                  {solved.has(e.id) ? "✓ " : ""}
                  {e.title} (L{e.level})
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Panel title={`Exercises · ${solved.size}/${SQL_EXERCISES.length} solved`} className="hidden self-start lg:block">
          <nav className="max-h-[640px] space-y-3 overflow-y-auto text-[13px] thin-scroll">
            <button
              type="button"
              onClick={() => select(FREE_PLAY)}
              className={cn("w-full rounded-md px-2 py-1.5 text-left font-medium", selected === FREE_PLAY ? "bg-accent/10 text-accent" : "text-muted hover:bg-surface-2 hover:text-fg")}
            >
              Free play
            </button>
            {grouped.map((g) => (
              <div key={g.id}>
                <div className="mb-1 flex items-baseline justify-between px-2">
                  <span className="eyebrow">{g.title}</span>
                  <span className="font-mono text-2xs text-subtle tabular-nums">
                    {g.items.filter((e) => solved.has(e.id)).length}/{g.items.length}
                  </span>
                </div>
                <ul className="space-y-0.5">
                  {g.items.map((e) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => select(e.id)}
                        className={cn("flex w-full items-start gap-2 rounded-md px-2 py-1 text-left", selected === e.id ? "bg-accent/10 text-accent" : "text-muted hover:bg-surface-2 hover:text-fg")}
                      >
                        <CircleCheck className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", solved.has(e.id) ? "text-ok" : "text-border-strong")} />
                        <span className="flex-1">{e.title}</span>
                        <span className="mt-0.5 font-mono text-2xs text-subtle">L{e.level}</span>
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
            <div className="rounded-lg border border-border bg-surface p-4">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-[11.5px] font-semibold tracking-wide text-subtle uppercase">
                <span>L{exercise.level}</span>
                <span>·</span>
                <span>{exercise.topic}</span>
                {exercise.check && <span className="rounded-full bg-warn/15 px-2 py-0.5 text-warn normal-case">changes data · rolled back</span>}
                {solved.has(exercise.id) && <span className="rounded-full bg-ok/15 px-2 py-0.5 text-ok normal-case">solved</span>}
              </div>
              <h3 className="text-[16px] font-semibold text-fg">{exercise.title}</h3>
              <p className="mt-1 text-[14px] text-muted">{exercise.prompt}</p>
              {exercise.check ? (
                <p className="mt-2 text-[12.5px] text-subtle">
                  Your statements run in a transaction that is rolled back afterwards, so the database never changes. Graded by reading the data afterwards with:{" "}
                  <code className="font-mono text-muted">{exercise.check.replace(/\s+/g, " ")}</code>
                </p>
              ) : (
                <p className="mt-2 text-[12.5px] text-subtle">
                  Expected columns: <span className="font-mono text-muted">{exercise.columns.join(", ")}</span>
                  {exercise.ordered ? " · row order matters" : " · any row order"}
                </p>
              )}
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
              guest orders with a NULL customer, customers who never ordered, salary ties and duplicate logins. {SQL_EXERCISES.length} graded exercises, from a first SELECT to
              relational division and safe data changes.
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
            <Btn variant="ghost" onClick={() => { restart(); setOutcome(null); setAfter(null); setVerdict(null); setSchema([]); }} title="Rebuild the database from scratch">
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

          {verdict && (
            <Explain tone={verdict.ok ? "good" : "bad"}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{verdict.message}</span>
                {verdict.ok && nextExercise && (
                  <Btn onClick={() => select(nextExercise.id)}>
                    Next: {nextExercise.title} <ArrowRight className="h-3.5 w-3.5" />
                  </Btn>
                )}
              </div>
            </Explain>
          )}
          <Panel title="Result">
            <RunOutput outcome={outcome} />
          </Panel>
          {after && (
            <Panel title="Data after your change (rolled back)">
              <ResultTable result={after} className="max-h-96" />
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
