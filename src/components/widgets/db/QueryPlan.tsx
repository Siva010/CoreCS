"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Play, Plus, RefreshCw, Trash2, Wand2 } from "lucide-react";
import { PLAN_SEED } from "@/lib/sql/seed";
import { describeSqlError } from "@/lib/sql/pglite";
import { Btn, Explain, Panel, inputCls } from "../ui";
import { DbStatusBanner, SqlEditor, useSqlDatabase } from "./sqlUi";
import { cn } from "@/lib/utils";

interface Scenario {
  id: string;
  title: string;
  sql: string;
  note: string;
  suggestions?: { label: string; sql: string }[];
}

const SCENARIOS: Scenario[] = [
  {
    id: "lookup",
    title: "Point lookup",
    sql: "SELECT * FROM orders WHERE customer_id = 4242",
    note: "Find one customer's orders among 200,000. Run it, then add the index and run again — compare rows read and time.",
    suggestions: [{ label: "Index on customer_id", sql: "CREATE INDEX orders_customer_idx ON orders (customer_id)" }],
  },
  {
    id: "low-selectivity",
    title: "Low selectivity",
    sql: "SELECT count(*) FROM orders WHERE status = 'paid'",
    note: "About 70% of orders are paid. Add an index on status: the planner still prefers a sequential scan. Then change 'paid' to 'pending' (~10%) and run again.",
    suggestions: [{ label: "Index on status", sql: "CREATE INDEX orders_status_idx ON orders (status)" }],
  },
  {
    id: "top-n",
    title: "ORDER BY … LIMIT",
    sql: "SELECT id, order_date, total FROM orders WHERE customer_id = 4242 ORDER BY order_date DESC LIMIT 5",
    note: "With only a customer_id index, PostgreSQL fetches all of the customer's orders and sorts them. A composite index returns them already in order and stops after 5.",
    suggestions: [
      { label: "Index on customer_id", sql: "CREATE INDEX orders_customer_idx ON orders (customer_id)" },
      { label: "Composite (customer_id, order_date DESC)", sql: "CREATE INDEX orders_customer_date_idx ON orders (customer_id, order_date DESC)" },
    ],
  },
  {
    id: "sargable",
    title: "Function on a column",
    sql: "SELECT count(*) FROM orders WHERE date_trunc('month', order_date) = DATE '2023-03-01'",
    note: "Even with an index on order_date, wrapping the column in a function hides it from the index. Rewrite the predicate as a range on the bare column.",
    suggestions: [
      { label: "Index on order_date", sql: "CREATE INDEX orders_date_idx ON orders (order_date)" },
      { label: "Use the range rewrite", sql: "--rewrite:SELECT count(*) FROM orders WHERE order_date >= DATE '2023-03-01' AND order_date < DATE '2023-04-01'" },
    ],
  },
  {
    id: "join-rare",
    title: "Join, rare city",
    sql: "SELECT c.name, o.total FROM customers c JOIN orders o ON o.customer_id = c.id WHERE c.city = 'Kochi'",
    note: "Kochi has ~1% of customers. Add the index: with default costs (random_page_cost = 4, which assumes spinning disks) the planner still prefers a hash join, because ~200 probes with random page reads look expensive. Apply SSD-like costs and it switches to a nested loop. Then compare with the Pune version.",
    suggestions: [
      { label: "Index on customer_id", sql: "CREATE INDEX orders_customer_idx ON orders (customer_id)" },
      { label: "SSD cost settings", sql: "SET random_page_cost = 1.1" },
    ],
  },
  {
    id: "join-common",
    title: "Join, most customers",
    sql: "SELECT c.name, o.total FROM customers c JOIN orders o ON o.customer_id = c.id WHERE c.segment = 'retail'",
    note: "Retail is ~95% of customers, so a nested loop would probe the index ~19,000 times. One pass that hashes the customers and scans orders once is cheaper — even with the index and SSD cost settings. (Try city = 'Pune', ~11%: with SSD costs the crossover moves and a nested loop wins again.)",
    suggestions: [
      { label: "Index on customer_id", sql: "CREATE INDEX orders_customer_idx ON orders (customer_id)" },
      { label: "SSD cost settings", sql: "SET random_page_cost = 1.1" },
    ],
  },
  {
    id: "covering",
    title: "Index-only scan",
    sql: "SELECT order_date, total FROM orders WHERE customer_id = 4242",
    note: "A covering index contains every column the query needs. After VACUUM sets the visibility map, the table isn't touched at all (Heap Fetches: 0).",
    suggestions: [
      { label: "Covering index", sql: "CREATE INDEX orders_customer_cover_idx ON orders (customer_id) INCLUDE (order_date, total)" },
      { label: "VACUUM orders", sql: "VACUUM orders" },
    ],
  },
  {
    id: "aggregate",
    title: "GROUP BY",
    sql: "SELECT status, count(*), round(avg(total), 2) AS avg_total FROM orders GROUP BY status",
    note: "Aggregating the whole table: a sequential scan feeding a HashAggregate with a handful of groups. No index can avoid reading every row here.",
  },
];

type PlanNode = Record<string, unknown> & { Plans?: PlanNode[] };

interface ExplainOutput {
  plan: PlanNode;
  planningMs: number;
  executionMs: number;
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));
const fmtRows = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(Math.round(n)));
const fmtMs = (n: number) => (n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toFixed(3));

function nodeTotalMs(n: PlanNode) {
  return num(n["Actual Total Time"]) * Math.max(1, num(n["Actual Loops"]));
}

function exclusiveMs(n: PlanNode) {
  const kids = (n.Plans ?? []).reduce((s, c) => s + nodeTotalMs(c), 0);
  return Math.max(0, nodeTotalMs(n) - kids);
}

function walk(n: PlanNode, f: (n: PlanNode, parent: PlanNode | null) => void, parent: PlanNode | null = null) {
  f(n, parent);
  for (const c of n.Plans ?? []) walk(c, f, n);
}

function insightsFor(out: ExplainOutput): { tone: "bad" | "warn" | "good"; text: string }[] {
  const tips: { tone: "bad" | "warn" | "good"; text: string }[] = [];
  walk(out.plan, (n, parent) => {
    const type = String(n["Node Type"]);
    const rel = n["Relation Name"] ? ` on ${n["Relation Name"]}` : "";
    const actual = num(n["Actual Rows"]) * Math.max(1, num(n["Actual Loops"]));
    const removed = num(n["Rows Removed by Filter"]) * Math.max(1, num(n["Actual Loops"]));
    const est = num(n["Plan Rows"]);
    if (type === "Seq Scan" && removed > 1000 && removed > actual * 10) {
      tips.push({ tone: "bad", text: `Seq Scan${rel} read ~${fmtRows(actual + removed)} rows to return ${fmtRows(actual)} (filter: ${n.Filter}). An index matching this predicate would let PostgreSQL jump straight to the matching rows.` });
    }
    if (type === "Sort" && parent && String(parent["Node Type"]) === "Limit") {
      tips.push({ tone: "warn", text: `A Sort runs before LIMIT (sort key: ${(n["Sort Key"] as string[] | undefined)?.join(", ")}). An index that returns rows already in this order would avoid sorting and stop early.` });
    }
    if (String(n["Sort Method"] ?? "").includes("external")) tips.push({ tone: "bad", text: "The sort spilled to disk (external merge). More work_mem or an order-providing index would help." });
    if (num(n["Hash Batches"]) > 1) tips.push({ tone: "bad", text: `The hash spilled into ${n["Hash Batches"]} batches (build side larger than work_mem).` });
    if (type === "Index Only Scan") {
      if (num(n["Heap Fetches"]) > 0) tips.push({ tone: "warn", text: `Index Only Scan still visited the table ${n["Heap Fetches"]} times: pages aren't marked all-visible yet. Run VACUUM.` });
      else tips.push({ tone: "good", text: "Index Only Scan with zero heap fetches: the query was answered from the index alone." });
    }
    if (type === "Nested Loop") {
      const inner = n.Plans?.[1];
      if (inner && num(inner["Actual Loops"]) > 1000) tips.push({ tone: "warn", text: `The Nested Loop's inner side ran ${fmtRows(num(inner["Actual Loops"]))} times. Fine for small outer inputs; for large ones a hash join is usually cheaper.` });
    }
    if (est > 0 && actual > 0 && (actual / est > 10 || est / actual > 10) && Math.max(actual, est) > 100) {
      tips.push({ tone: "warn", text: `${type}${rel}: estimated ${fmtRows(est)} rows but got ${fmtRows(actual)} — misestimates like this are how bad plans get chosen.` });
    }
    if (type === "Bitmap Heap Scan") tips.push({ tone: "good", text: `Bitmap scan${rel}: matching row locations were collected from the index first, then each table page was read once in physical order.` });
  });
  return tips;
}

function PlanTree({ node, total, depth = 0 }: { node: PlanNode; total: number; depth?: number }) {
  const type = String(node["Node Type"]);
  const loops = Math.max(1, num(node["Actual Loops"]));
  const actual = num(node["Actual Rows"]);
  const est = num(node["Plan Rows"]);
  const excl = exclusiveMs(node);
  const share = total > 0 ? excl / total : 0;
  const ratio = est > 0 && actual > 0 ? Math.max(actual / est, est / actual) : 1;
  const details: [string, unknown][] = [
    ["Index Cond", node["Index Cond"]],
    ["Filter", node.Filter],
    ["Rows Removed by Filter", node["Rows Removed by Filter"]],
    ["Recheck Cond", node["Recheck Cond"]],
    ["Hash Cond", node["Hash Cond"]],
    ["Merge Cond", node["Merge Cond"]],
    ["Join Filter", node["Join Filter"]],
    ["Sort Key", (node["Sort Key"] as string[] | undefined)?.join(", ")],
    ["Sort Method", node["Sort Method"] ? `${node["Sort Method"]} (${node["Sort Space Used"]} kB ${node["Sort Space Type"] ?? ""})` : undefined],
    ["Group Key", (node["Group Key"] as string[] | undefined)?.join(", ")],
    ["Hash Batches", num(node["Hash Batches"]) > 0 ? node["Hash Batches"] : undefined],
    ["Heap Fetches", node["Heap Fetches"]],
    ["Buffers", node["Shared Hit Blocks"] !== undefined ? `hit ${node["Shared Hit Blocks"]}, read ${node["Shared Read Blocks"] ?? 0}` : undefined],
  ];
  return (
    <div className={cn(depth > 0 && "mt-2 ml-4 border-l border-border pl-3")}>
      <div className="rounded-lg border border-border bg-surface-2/50 p-2.5" style={{ boxShadow: `inset 4px 0 0 rgba(239, 68, 68, ${Math.min(0.9, 0.12 + share)})` }}>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-semibold text-fg">{type}</span>
          {node["Join Type"] ? <span className="text-[12px] text-muted">{String(node["Join Type"]).toLowerCase()} join</span> : null}
          {node["Index Name"] ? <span className="text-[12px] text-muted">using {String(node["Index Name"])}</span> : null}
          {node["Relation Name"] ? <span className="text-[12px] text-muted">on {String(node["Relation Name"])}</span> : null}
          <span className="ml-auto font-mono text-[11.5px] text-subtle">
            {fmtMs(excl)} ms self · {Math.round(share * 100)}%
          </span>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[11.5px] text-muted">
          <span>
            rows est {fmtRows(est)} → actual {fmtRows(actual)}
            {loops > 1 ? ` × ${fmtRows(loops)} loops` : ""}
          </span>
          {ratio > 10 && Math.max(est, actual) > 100 && <span className="rounded bg-warn/15 px-1.5 text-warn">estimate off ×{ratio >= 100 ? Math.round(ratio) : ratio.toFixed(1)}</span>}
          <span>cost {num(node["Total Cost"]).toFixed(0)}</span>
        </div>
        <dl className="mt-1 space-y-0.5 text-[12px]">
          {details
            .filter(([, v]) => v !== undefined && v !== null && v !== "")
            .map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="shrink-0 text-subtle">{k}:</dt>
                <dd className="font-mono break-all text-muted">{String(v)}</dd>
              </div>
            ))}
        </dl>
      </div>
      {(node.Plans ?? []).map((c, i) => (
        <PlanTree key={i} node={c} total={total} depth={depth + 1} />
      ))}
    </div>
  );
}

interface IndexRow {
  tablename: string;
  indexname: string;
  indexdef: string;
}

export default function QueryPlan() {
  const { db, status, error, notice, clearNotice, restart } = useSqlDatabase(PLAN_SEED);
  const [scenario, setScenario] = useState<Scenario>(SCENARIOS[0]);
  const [sql, setSql] = useState(SCENARIOS[0].sql);
  const [out, setOut] = useState<ExplainOutput | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [indexes, setIndexes] = useState<IndexRow[]>([]);
  const [ddl, setDdl] = useState("CREATE INDEX ON orders (order_date)");
  const [log, setLog] = useState<string[]>([]);

  const refreshIndexes = useCallback(async () => {
    if (!db) return;
    const r = await db.query<IndexRow>("SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname");
    setIndexes(r.rows);
  }, [db]);

  useEffect(() => {
    refreshIndexes().catch(() => undefined);
  }, [refreshIndexes]);

  const explain = useCallback(
    async (text: string = sql) => {
      if (!db) return;
      setBusy(true);
      setErr(null);
      const body = text.trim().replace(/;+\s*$/, "");
      try {
        const r = await db.exec(`BEGIN; EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${body}; ROLLBACK;`, 20000);
        const raw = r[1]?.rows[0]?.[0];
        const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as { Plan: PlanNode; "Planning Time": number; "Execution Time": number }[];
        setOut({ plan: parsed[0].Plan, planningMs: parsed[0]["Planning Time"], executionMs: parsed[0]["Execution Time"] });
      } catch (e) {
        setErr(describeSqlError(e));
        setOut(null);
        await db.exec("ROLLBACK").catch(() => undefined);
      }
      setBusy(false);
    },
    [db, sql],
  );

  const runDdl = useCallback(
    async (text: string) => {
      if (!db) return;
      if (text.startsWith("--rewrite:")) {
        const q = text.slice("--rewrite:".length);
        setSql(q);
        await explain(q);
        return;
      }
      setBusy(true);
      try {
        const t = performance.now();
        await db.exec(text, 60000);
        const extra = /^create index/i.test(text) ? "; ANALYZE" : "";
        if (extra) await db.exec("ANALYZE", 60000);
        setLog((l) => [`✓ ${text}${extra} (${Math.round(performance.now() - t)} ms)`, ...l].slice(0, 8));
      } catch (e) {
        setLog((l) => [`✗ ${text}: ${describeSqlError(e)}`, ...l].slice(0, 8));
      }
      setBusy(false);
      await refreshIndexes();
      await explain();
    },
    [db, explain, refreshIndexes],
  );

  const pick = (s: Scenario) => {
    setScenario(s);
    setSql(s.sql);
    setOut(null);
    setErr(null);
  };

  const totalMs = out ? nodeTotalMs(out.plan) : 0;
  const tips = useMemo(() => (out ? insightsFor(out) : []), [out]);

  return (
    <div className="space-y-4">
      <DbStatusBanner status={status} error={error} notice={notice} onDismiss={clearNotice} loadingLabel="Starting PostgreSQL and generating 20,000 customers and 200,000 orders…" />

      <div className="flex flex-wrap gap-1.5">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => pick(s)}
            className={cn("rounded-full border px-3 py-1 text-[12.5px] font-medium", scenario.id === s.id ? "border-accent bg-accent/10 text-accent" : "border-border text-muted hover:text-fg")}
          >
            {s.title}
          </button>
        ))}
      </div>

      <Explain>{scenario.note}</Explain>

      <SqlEditor value={sql} onChange={setSql} onRun={() => explain()} rows={3} disabled={status !== "ready"} />
      <div className="flex flex-wrap items-center gap-2">
        <Btn variant="primary" onClick={() => explain()} disabled={!db || busy}>
          <Play className="h-3.5 w-3.5" /> EXPLAIN ANALYZE
        </Btn>
        {scenario.suggestions?.map((s) => (
          <Btn key={s.label} onClick={() => runDdl(s.sql)} disabled={!db || busy} title={s.sql.replace("--rewrite:", "")}>
            <Wand2 className="h-3.5 w-3.5" /> {s.label}
          </Btn>
        ))}
        <Btn variant="ghost" onClick={() => runDdl("ANALYZE")} disabled={!db || busy}>
          <RefreshCw className="h-3.5 w-3.5" /> ANALYZE
        </Btn>
        <Btn variant="ghost" onClick={() => { restart(); setOut(null); setLog([]); }}>
          Reset data
        </Btn>
      </div>

      {err && <pre className="whitespace-pre-wrap rounded-lg border border-bad/40 bg-bad/10 p-3 font-mono text-[12.5px] text-bad">{err}</pre>}

      {out && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <Panel
            title="Plan (read bottom-up; red bar = share of time spent in the node itself)"
            right={
              <span className="font-mono text-[12px] text-muted">
                execution {fmtMs(out.executionMs)} ms · planning {fmtMs(out.planningMs)} ms
              </span>
            }
          >
            <div className="overflow-x-auto thin-scroll">
              <PlanTree node={out.plan} total={totalMs} />
            </div>
          </Panel>
          <Panel title="What the plan is telling you">
            {tips.length ? (
              <ul className="space-y-2 text-[13px]">
                {tips.map((t, i) => (
                  <li key={i} className={cn("rounded-md border px-2.5 py-1.5", t.tone === "bad" && "border-bad/40 bg-bad/5", t.tone === "warn" && "border-warn/40 bg-warn/5", t.tone === "good" && "border-ok/40 bg-ok/5")}>
                    {t.text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-subtle">Nothing suspicious: estimates are close and no node reads far more rows than it returns.</p>
            )}
          </Panel>
        </div>
      )}

      <Panel title="Indexes">
        <ul className="space-y-1 font-mono text-[12px]">
          {indexes.map((ix) => (
            <li key={ix.indexname} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate" title={ix.indexdef}>
                {ix.indexdef.replace(/ USING btree/, "").replace(/public\./g, "")}
              </span>
              {!ix.indexname.endsWith("_pkey") && (
                <button type="button" onClick={() => runDdl(`DROP INDEX ${ix.indexname}`)} className="text-subtle hover:text-bad" title={`Drop ${ix.indexname}`} aria-label={`Drop ${ix.indexname}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <input value={ddl} onChange={(e) => setDdl(e.target.value)} className={cn(inputCls, "min-w-0 flex-1")} aria-label="DDL statement" />
          <Btn onClick={() => runDdl(ddl)} disabled={!db || busy}>
            <Plus className="h-3.5 w-3.5" /> Run DDL
          </Btn>
        </div>
        {log.length > 0 && (
          <ul className="mt-2 space-y-0.5 font-mono text-[11.5px] text-muted">
            {log.map((l, i) => (
              <li key={i} className={l.startsWith("✗") ? "text-bad" : undefined}>
                {l}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
