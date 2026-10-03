"use client";
import { useMemo, useState } from "react";
import { Plus, RotateCcw, X } from "lucide-react";
import { Btn, Explain, Panel, Segmented, inputCls } from "../ui";
import { cn } from "@/lib/utils";

type JoinType = "inner" | "left" | "right" | "full" | "cross" | "semi" | "anti";

interface Row {
  key: number | null;
  label: string;
}

const DEFAULT_A: Row[] = [
  { key: 1, label: "Asha" },
  { key: 2, label: "Ravi" },
  { key: 3, label: "Meera" },
];
const DEFAULT_B: Row[] = [
  { key: 1, label: "#10" },
  { key: 1, label: "#11" },
  { key: 2, label: "#12" },
  { key: null, label: "#13 (guest)" },
];

const SQL: Record<JoinType, string> = {
  inner: "SELECT * FROM customers c\nJOIN orders o ON o.customer_id = c.id;",
  left: "SELECT * FROM customers c\nLEFT JOIN orders o ON o.customer_id = c.id;",
  right: "SELECT * FROM customers c\nRIGHT JOIN orders o ON o.customer_id = c.id;",
  full: "SELECT * FROM customers c\nFULL JOIN orders o ON o.customer_id = c.id;",
  cross: "SELECT * FROM customers c\nCROSS JOIN orders o;",
  semi: "SELECT c.* FROM customers c\nWHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id);",
  anti: "SELECT c.* FROM customers c\nWHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id);",
};

const EXPLAIN: Record<JoinType, string> = {
  inner: "Only pairs where the keys are equal. A customer with two orders appears twice; customers without orders and the guest order (NULL key) disappear.",
  left: "Every customer, paired with each matching order — or once with NULLs if there is none. The guest order still disappears (it has no customer).",
  right: "The mirror image: every order, with its customer or NULLs. The guest order survives with NULL customer columns.",
  full: "Everything: matched pairs, plus unmatched customers (NULL order) and unmatched orders (NULL customer).",
  cross: "Every combination, no condition: |A| × |B| rows. This is what a join means before filtering by the ON condition.",
  semi: "Customers that have at least one order — each at most once, however many orders match. No order columns are returned.",
  anti: "Customers with no order at all. NULL keys never match anything, so NOT EXISTS is safe; NOT IN against a column containing NULL would return nothing.",
};

interface Out {
  a: number | null;
  b: number | null;
}

function join(type: JoinType, A: Row[], B: Row[]): Out[] {
  const eq = (i: number, j: number) => A[i].key !== null && B[j].key !== null && A[i].key === B[j].key;
  const pairs: Out[] = [];
  if (type === "cross") {
    A.forEach((_, i) => B.forEach((__, j) => pairs.push({ a: i, b: j })));
    return pairs;
  }
  if (type === "semi" || type === "anti") {
    A.forEach((_, i) => {
      const has = B.some((__, j) => eq(i, j));
      if (has === (type === "semi")) pairs.push({ a: i, b: null });
    });
    return pairs;
  }
  const aMatched = new Set<number>();
  const bMatched = new Set<number>();
  A.forEach((_, i) =>
    B.forEach((__, j) => {
      if (eq(i, j)) {
        pairs.push({ a: i, b: j });
        aMatched.add(i);
        bMatched.add(j);
      }
    }),
  );
  if (type === "left" || type === "full") A.forEach((_, i) => !aMatched.has(i) && pairs.push({ a: i, b: null }));
  if (type === "right" || type === "full") B.forEach((_, j) => !bMatched.has(j) && pairs.push({ a: null, b: j }));
  return pairs;
}

function parseKey(s: string): number | null {
  const t = s.trim().toUpperCase();
  if (t === "" || t === "NULL") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function SourceTable({ title, cols, rows, onRemove, onAdd, hot, tone }: { title: string; cols: [string, string]; rows: Row[]; onRemove: (i: number) => void; onAdd: (r: Row) => void; hot: number | null; tone: "a" | "b" }) {
  const [k, setK] = useState("");
  const [l, setL] = useState("");
  return (
    <Panel title={title}>
      <table className="w-full font-mono text-[12.5px]">
        <thead className="text-left text-[11px] text-subtle">
          <tr>
            <th className="pb-1">{cols[0]}</th>
            <th>{cols[1]}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={cn("border-t border-border transition-colors", hot === i && (tone === "a" ? "bg-accent/15" : "bg-d-core/15"))}>
              <td className={cn("py-1", r.key === null && "text-subtle italic")}>{r.key === null ? "NULL" : r.key}</td>
              <td>{r.label}</td>
              <td className="text-right">
                <button type="button" onClick={() => onRemove(i)} className="text-subtle hover:text-bad" aria-label={`Remove row ${i + 1}`}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex gap-1.5">
        <input className={cn(inputCls, "w-20")} placeholder="key/NULL" value={k} onChange={(e) => setK(e.target.value)} aria-label={`${cols[0]} of new row`} />
        <input className={cn(inputCls, "min-w-0 flex-1 font-sans")} placeholder={cols[1]} value={l} onChange={(e) => setL(e.target.value)} aria-label={`${cols[1]} of new row`} />
        <Btn
          onClick={() => {
            onAdd({ key: parseKey(k), label: l || "new" });
            setK("");
            setL("");
          }}
          title="Add row"
        >
          <Plus className="h-3.5 w-3.5" />
        </Btn>
      </div>
    </Panel>
  );
}

export default function JoinTypes() {
  const [type, setType] = useState<JoinType>("inner");
  const [A, setA] = useState<Row[]>(DEFAULT_A);
  const [B, setB] = useState<Row[]>(DEFAULT_B);
  const [hover, setHover] = useState<number | null>(null);
  const out = useMemo(() => join(type, A, B), [type, A, B]);
  const hot = hover !== null ? out[hover] : null;
  const onlyA = type === "semi" || type === "anti";

  return (
    <div className="space-y-4">
      <Segmented
        value={type}
        onChange={(t) => {
          setType(t);
          setHover(null);
        }}
        options={(["inner", "left", "right", "full", "cross", "semi", "anti"] as JoinType[]).map((t) => ({ value: t, label: t === "semi" ? "semi (EXISTS)" : t === "anti" ? "anti (NOT EXISTS)" : t.toUpperCase() }))}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <SourceTable title="customers (A)" cols={["id", "name"]} rows={A} hot={hot?.a ?? null} tone="a" onRemove={(i) => setA((r) => r.filter((_, k) => k !== i))} onAdd={(r) => setA((x) => [...x, r])} />
        <SourceTable title="orders (B)" cols={["customer_id", "order"]} rows={B} hot={hot?.b ?? null} tone="b" onRemove={(i) => setB((r) => r.filter((_, k) => k !== i))} onAdd={(r) => setB((x) => [...x, r])} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Panel title={`Result · ${out.length} row${out.length === 1 ? "" : "s"} (hover a row to see where it came from)`}>
          <table className="w-full font-mono text-[12.5px]">
            <thead className="text-left text-[11px] text-subtle">
              <tr>
                <th className="pb-1">c.id</th>
                <th>c.name</th>
                {!onlyA && (
                  <>
                    <th>o.customer_id</th>
                    <th>o.order</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody onMouseLeave={() => setHover(null)}>
              {out.map((r, i) => {
                const a = r.a !== null ? A[r.a] : null;
                const b = r.b !== null ? B[r.b] : null;
                const cell = (v: string | number | null | undefined, isNull: boolean) => <td className={cn("py-1", isNull && "text-subtle italic")}>{isNull ? "NULL" : v}</td>;
                return (
                  <tr key={i} onMouseEnter={() => setHover(i)} className={cn("cursor-default border-t border-border", hover === i && "bg-surface-2")}>
                    {cell(a?.key ?? null, !a || a.key === null)}
                    {cell(a?.label, !a)}
                    {!onlyA && (
                      <>
                        {cell(b?.key ?? null, !b || b.key === null)}
                        {cell(b?.label, !b)}
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!out.length && <p className="text-[13px] text-subtle">No rows.</p>}
        </Panel>
        <div className="space-y-3">
          <pre className="overflow-x-auto rounded-lg border border-border bg-surface-2 p-3 font-mono text-[12px]">{SQL[type]}</pre>
          <Explain>{EXPLAIN[type]}</Explain>
          <Btn
            variant="ghost"
            onClick={() => {
              setA(DEFAULT_A);
              setB(DEFAULT_B);
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset tables
          </Btn>
        </div>
      </div>
    </div>
  );
}
