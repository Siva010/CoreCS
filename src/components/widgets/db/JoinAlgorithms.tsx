"use client";
import { useMemo, useState } from "react";
import { Explain, Field, NumberInput, Panel, Segmented, Stat, StepControls, useStepper } from "../ui";
import { cn } from "@/lib/utils";

type Algo = "nl" | "inl" | "hash" | "merge";

interface Step {
  text: string;
  r?: number; // highlighted outer (orders) index, in display order
  s?: number; // highlighted inner (customers) index, in display order
  s2?: number[]; // extra highlighted inner rows (bucket contents)
  comparisons: number;
  output: number;
  hash?: Record<number, number[]>; // bucket → inner row indexes
  phase?: string;
}

const BUCKETS = 4;

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
}

function buildData(nOuter: number, nInner: number, seed: number) {
  const r = rng(seed);
  const inner = Array.from({ length: nInner }, (_, i) => i + 1); // customers: unique ids 1..m
  const outer = Array.from({ length: nOuter }, () => 1 + Math.floor(r() * (nInner + 2))); // orders: customer_id, some without a match
  return { outer, inner };
}

function steps(algo: Algo, outer: number[], inner: number[]): { steps: Step[]; outerView: number[]; innerView: number[] } {
  const out: Step[] = [];
  let cmp = 0;
  let res = 0;
  if (algo === "nl") {
    outer.forEach((rk, i) => {
      inner.forEach((sk, j) => {
        cmp++;
        const hit = rk === sk;
        if (hit) res++;
        out.push({ r: i, s: j, comparisons: cmp, output: res, text: `order.customer_id ${rk} vs customer ${sk}: ${hit ? "match → emit row" : "no"}` });
      });
    });
    return { steps: out, outerView: outer, innerView: inner };
  }
  if (algo === "inl") {
    const probeCost = Math.ceil(Math.log2(inner.length + 1)) + 1;
    outer.forEach((rk, i) => {
      cmp += probeCost;
      const j = inner.indexOf(rk);
      if (j >= 0) res++;
      out.push({ r: i, s: j >= 0 ? j : undefined, comparisons: cmp, output: res, text: `index lookup for customer ${rk}: descend the B+ tree (~${probeCost} key comparisons) → ${j >= 0 ? "found, emit row" : "not found"}` });
    });
    return { steps: out, outerView: outer, innerView: inner };
  }
  if (algo === "hash") {
    const table: Record<number, number[]> = {};
    inner.forEach((sk, j) => {
      const b = sk % BUCKETS;
      table[b] = [...(table[b] ?? []), j];
      out.push({ phase: "build", s: j, comparisons: cmp, output: res, hash: structuredClone(table), text: `build: hash(customer ${sk}) → bucket ${b}` });
    });
    outer.forEach((rk, i) => {
      const b = rk % BUCKETS;
      const bucket = table[b] ?? [];
      let hit = -1;
      for (const j of bucket) {
        cmp++;
        if (inner[j] === rk) hit = j;
      }
      if (hit >= 0) res++;
      out.push({ phase: "probe", r: i, s: hit >= 0 ? hit : undefined, s2: bucket, comparisons: cmp, output: res, hash: table, text: `probe: hash(${rk}) → bucket ${b} (${bucket.length} entr${bucket.length === 1 ? "y" : "ies"} compared) → ${hit >= 0 ? "match, emit row" : "no match"}` });
    });
    return { steps: out, outerView: outer, innerView: inner };
  }
  // merge join: inputs sorted first (assume an index supplies order, or pay for sorting)
  const R = [...outer].sort((a, b) => a - b);
  const S = [...inner].sort((a, b) => a - b);
  let i = 0;
  let j = 0;
  while (i < R.length && j < S.length) {
    cmp++;
    if (R[i] === S[j]) {
      res++;
      out.push({ r: i, s: j, comparisons: cmp, output: res, text: `${R[i]} = ${S[j]} → emit; advance orders (next order may match the same customer)` });
      i++;
    } else if (R[i] < S[j]) {
      out.push({ r: i, s: j, comparisons: cmp, output: res, text: `${R[i]} < ${S[j]} → advance orders` });
      i++;
    } else {
      out.push({ r: i, s: j, comparisons: cmp, output: res, text: `${R[i]} > ${S[j]} → advance customers` });
      j++;
    }
  }
  out.push({ comparisons: cmp, output: res, text: "One input is exhausted → done. Both inputs were read once, in order." });
  return { steps: out, outerView: R, innerView: S };
}

const INFO: Record<Algo, { title: string; cost: string; memory: string; when: string }> = {
  nl: { title: "Nested loop (no index)", cost: "O(|R| × |S|) comparisons", memory: "O(1)", when: "Only tiny inputs — this is the disaster case when estimates are wrong." },
  inl: { title: "Index nested loop", cost: "O(|R| × log |S|)", memory: "O(1)", when: "Small outer input + index on the inner join key. Starts returning rows immediately (good with LIMIT)." },
  hash: { title: "Hash join", cost: "O(|R| + |S|)", memory: "O(|S|) — the build side must fit in work_mem or it spills in batches", when: "Large, unsorted inputs joined on equality." },
  merge: { title: "Merge join", cost: "O(|R| + |S|) once sorted (+ O(n log n) per sort if not pre-sorted)", memory: "O(1) streaming", when: "Inputs already ordered by the key (indexes) or output needed in key order." },
};

export default function JoinAlgorithms() {
  const [algo, setAlgo] = useState<Algo>("hash");
  const [nOuter, setNOuter] = useState(8);
  const [nInner, setNInner] = useState(6);
  const data = useMemo(() => buildData(nOuter, nInner, 11), [nOuter, nInner]);
  const { steps: st, outerView, innerView } = useMemo(() => steps(algo, data.outer, data.inner), [algo, data]);
  const s = useStepper(st.length, { interval: 700 });
  const cur = st[Math.min(s.step, st.length - 1)];
  const totals = useMemo(() => (["nl", "inl", "hash", "merge"] as Algo[]).map((a) => ({ a, c: steps(a, data.outer, data.inner).steps.at(-1)?.comparisons ?? 0 })), [data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Segmented
          value={algo}
          onChange={(a) => {
            setAlgo(a);
            s.reset();
          }}
          options={[
            { value: "nl", label: "Nested loop" },
            { value: "inl", label: "Index NL" },
            { value: "hash", label: "Hash" },
            { value: "merge", label: "Merge" },
          ]}
        />
        <Field label="orders (outer) rows">
          <NumberInput value={nOuter} min={2} max={14} onChange={(v) => { setNOuter(Math.max(2, Math.min(14, v))); s.reset(); }} />
        </Field>
        <Field label="customers (inner) rows">
          <NumberInput value={nInner} min={2} max={12} onChange={(v) => { setNInner(Math.max(2, Math.min(12, v))); s.reset(); }} />
        </Field>
      </div>
      <StepControls s={s} total={st.length} label={cur?.phase ? `${cur.phase} phase` : undefined} />

      <div className="grid gap-4 md:grid-cols-[1fr_1fr_1.2fr]">
        <Panel title={algo === "merge" ? "orders (sorted by customer_id)" : "orders (outer / probe side)"}>
          <ul className="space-y-1 font-mono text-[12.5px]">
            {outerView.map((k, i) => (
              <li key={i} className={cn("rounded px-2 py-0.5", cur?.r === i ? "bg-accent/20 font-semibold text-accent" : "text-muted")}>
                order {i + 1} → customer_id {k}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title={algo === "hash" ? "customers (build side)" : algo === "merge" ? "customers (sorted by id)" : algo === "inl" ? "customers (via B+ tree index on id)" : "customers (inner, scanned each time)"}>
          <ul className="space-y-1 font-mono text-[12.5px]">
            {innerView.map((k, j) => (
              <li key={j} className={cn("rounded px-2 py-0.5", cur?.s === j ? "bg-ok/20 font-semibold text-ok" : cur?.s2?.includes(j) ? "bg-warn/15 text-fg" : "text-muted")}>
                customer {k}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title={algo === "hash" ? `Hash table (${BUCKETS} buckets)` : "What's happening"}>
          {algo === "hash" && (
            <div className="mb-3 space-y-1 font-mono text-[12px]">
              {Array.from({ length: BUCKETS }, (_, b) => (
                <div key={b} className="flex gap-2">
                  <span className="w-16 shrink-0 text-subtle">bucket {b}</span>
                  <span>{(cur?.hash?.[b] ?? []).map((j) => innerView[j]).join(", ") || "—"}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-[13px]">{cur?.text}</p>
        </Panel>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Comparisons so far" value={cur?.comparisons ?? 0} />
        <Stat label="Rows emitted" value={cur?.output ?? 0} />
        <Stat label="Cost" value={<span className="text-[13px]">{INFO[algo].cost}</span>} />
        <Stat label="Extra memory" value={<span className="text-[13px]">{INFO[algo].memory}</span>} />
      </div>

      <Panel title="Total comparisons for this data">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {totals.map((t) => (
            <div key={t.a} className={cn("rounded-lg border px-3 py-2", t.a === algo ? "border-accent" : "border-border")}>
              <div className="text-[11.5px] text-subtle">{INFO[t.a].title}</div>
              <div className="font-mono text-lg font-semibold">{t.c}</div>
            </div>
          ))}
        </div>
      </Panel>
      <Explain>
        <strong>{INFO[algo].title}.</strong> {INFO[algo].when} Grow the orders table and watch the nested loop&apos;s comparisons multiply while hash and merge grow linearly.
      </Explain>
    </div>
  );
}
