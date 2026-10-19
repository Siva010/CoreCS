"use client";
import { useState } from "react";
import { amat, eat, pteBytes, randomMissRate, reachShares, tlbReach, type Level } from "@/lib/sim/memHier";
import { fmtBytes } from "@/lib/sim/fileAlloc";
import { Btn, Explain, Field, NumberInput, Panel, Segmented, Stat } from "../ui";
import { cn } from "@/lib/utils";

type Tab = "amat" | "eat" | "reach";

const MODERN: Level[] = [
  { name: "L1", time: 1, hitRate: 0.95 },
  { name: "L2", time: 4, hitRate: 0.6 },
  { name: "L3", time: 12, hitRate: 0.5 },
];

function AmatTab() {
  const [levels, setLevels] = useState<Level[]>(MODERN);
  const [count, setCount] = useState(3);
  const [memory, setMemory] = useState(100);
  const used = levels.slice(0, count);
  const t = amat(used, memory);
  const shares = reachShares(used);
  const update = (i: number, patch: Partial<Level>) => setLevels((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Btn
          onClick={() => {
            setCount(1);
            setLevels([{ name: "L1", time: 1, hitRate: 0.95 }, ...MODERN.slice(1)]);
            setMemory(100);
          }}
        >
          Lesson example: L1 + memory
        </Btn>
        <Btn
          onClick={() => {
            setCount(3);
            setLevels(MODERN);
            setMemory(100);
          }}
        >
          Three cache levels
        </Btn>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Cache levels">
          <Segmented size="sm" value={String(count)} onChange={(v) => setCount(Number(v))} options={["1", "2", "3"].map((v) => ({ value: v, label: v }))} />
        </Field>
        <Field label="Memory access (ns)">
          <NumberInput value={memory} min={1} onChange={(v) => setMemory(Math.max(1, v))} />
        </Field>
      </div>
      <Panel title="Levels">
        <div className="overflow-x-auto thin-scroll">
          <table className="w-full min-w-[440px] text-[13px]">
            <thead>
              <tr className="text-left text-[11px] tracking-wide text-subtle uppercase">
                <th className="py-1 pr-3 font-medium">Level</th>
                <th className="py-1 pr-3 font-medium">Hit time (ns)</th>
                <th className="py-1 pr-3 font-medium">Hit rate (%)</th>
                <th className="py-1 font-medium">Accesses served here</th>
              </tr>
            </thead>
            <tbody>
              {used.map((l, i) => (
                <tr key={l.name} className="border-t border-border">
                  <td className="py-1 pr-3 font-mono">{l.name}</td>
                  <td className="py-1 pr-3">
                    <NumberInput value={l.time} min={0.1} step={0.5} onChange={(v) => update(i, { time: Math.max(0.1, v) })} />
                  </td>
                  <td className="py-1 pr-3">
                    <NumberInput value={Math.round(l.hitRate * 1000) / 10} min={0} max={100} step={1} onChange={(v) => update(i, { hitRate: Math.max(0, Math.min(100, v)) / 100 })} />
                  </td>
                  <td className="py-1 font-mono">{(100 * shares[i]).toFixed(2)}%</td>
                </tr>
              ))}
              <tr className="border-t border-border">
                <td className="py-1 pr-3 font-mono">memory</td>
                <td className="py-1 pr-3 font-mono">{memory}</td>
                <td className="py-1 pr-3 text-subtle">always hits</td>
                <td className="py-1 font-mono">{(100 * shares[used.length]).toFixed(2)}%</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[12px] text-subtle">Hit rates are local: of the accesses that reach a level, the share that hit there.</p>
      </Panel>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Stat label="Average access time" value={`${t.toFixed(2)} ns`} sub={`${(memory / t).toFixed(1)}× faster than going to memory every time`} />
        <Stat label="Formula" value={<span className="text-[13px]">{formula(used, memory)}</span>} />
      </div>
      <Explain>
        Each level applies <b>hit time + miss rate × (cost of the next level)</b>. A small miss rate still matters: memory is so slow that the {(100 * shares[used.length]).toFixed(1)}% of accesses
        that reach it can dominate the average. That is why cache-friendly layouts (arrays, not linked lists) pay off.
      </Explain>
    </div>
  );
}

function formula(levels: Level[], memory: number): string {
  let s = String(memory);
  for (let i = levels.length - 1; i >= 0; i--) {
    const miss = +(1 - levels[i].hitRate).toFixed(4);
    s = `${levels[i].time} + ${miss} × ${i === levels.length - 1 ? s : `(${s})`}`;
  }
  return s;
}

function EatTab() {
  const [h, setH] = useState(80);
  const [t, setT] = useState(20);
  const [m, setM] = useState(100);
  const [k, setK] = useState(1);
  const value = eat(h / 100, t, m, k);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Btn
          onClick={() => {
            setH(80);
            setT(20);
            setM(100);
            setK(1);
          }}
        >
          TLB lesson example
        </Btn>
        <Btn
          onClick={() => {
            setH(99);
            setT(1);
            setM(100);
            setK(4);
          }}
        >
          x86-64: 4-level walk, 99% hits
        </Btn>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="TLB hit ratio h (%)">
          <NumberInput value={h} min={0} max={100} step={0.5} onChange={(v) => setH(Math.max(0, Math.min(100, v)))} />
        </Field>
        <Field label="TLB lookup t (ns)">
          <NumberInput value={t} min={0} step={1} onChange={(v) => setT(Math.max(0, v))} />
        </Field>
        <Field label="Memory access m (ns)">
          <NumberInput value={m} min={1} step={10} onChange={(v) => setM(Math.max(1, v))} />
        </Field>
        <Field label="Page-table levels k">
          <NumberInput value={k} min={1} max={5} onChange={(v) => setK(Math.max(1, Math.min(5, Math.round(v))))} />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Stat label="Effective access time" value={`${value.toFixed(1)} ns`} sub={`${((100 * (value - m)) / m).toFixed(0)}% slower than one memory access`} />
        <Stat
          label="Formula"
          value={
            <span className="text-[13px]">
              {h / 100} × ({t} + {m}) + {+(1 - h / 100).toFixed(4)} × ({t} + {k}×{m} + {m})
            </span>
          }
        />
      </div>
      <Explain>
        A TLB hit costs the lookup plus one memory access. A miss adds a page walk: {k} page-table read{k === 1 ? "" : "s"} before the real access. Real CPUs cache page-table entries too, so
        walks are often cheaper than {k} full memory accesses, but the shape holds: the hit ratio decides everything.
      </Explain>
    </div>
  );
}

const PAGES = [
  { value: String(4096), label: "4 KB", bytes: 4096 },
  { value: String(2 * 2 ** 20), label: "2 MB", bytes: 2 * 2 ** 20 },
  { value: String(2 ** 30), label: "1 GB", bytes: 2 ** 30 },
];

function ReachTab() {
  const [entries, setEntries] = useState(1536);
  const [gb, setGb] = useState(16);
  const ws = gb * 2 ** 30;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="TLB entries">
          <NumberInput value={entries} min={16} max={65536} step={64} className="w-24" onChange={(v) => setEntries(Math.max(16, Math.round(v)))} />
        </Field>
        <Field label="Working set (GB)">
          <NumberInput value={gb} min={0.01} step={1} className="w-24" onChange={(v) => setGb(Math.max(0.01, v))} />
        </Field>
      </div>
      <Panel title={`${fmtBytes(ws)} accessed at random`}>
        <div className="overflow-x-auto thin-scroll">
          <table className="w-full min-w-[480px] text-[13px]">
            <thead>
              <tr className="text-left text-[11px] tracking-wide text-subtle uppercase">
                <th className="py-1 pr-3 font-medium">Page size</th>
                <th className="py-1 pr-3 font-medium">TLB reach</th>
                <th className="py-1 pr-3 font-medium">Working set covered</th>
                <th className="py-1 pr-3 font-medium">TLB miss rate</th>
                <th className="py-1 font-medium">Page-table entries</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {PAGES.map((p) => {
                const reach = tlbReach(entries, p.bytes);
                const miss = randomMissRate(entries, p.bytes, ws);
                return (
                  <tr key={p.value} className="border-t border-border">
                    <td className="py-1 pr-3 font-sans">{p.label}</td>
                    <td className="py-1 pr-3">{fmtBytes(reach)}</td>
                    <td className="py-1 pr-3">{Math.min(100, (100 * reach) / ws).toFixed(reach >= ws ? 0 : 2)}%</td>
                    <td className={cn("py-1 pr-3", miss > 0.5 ? "text-bad" : miss > 0 ? "text-warn" : "text-ok")}>{(100 * miss).toFixed(miss > 0.999 && miss < 1 ? 2 : 1)}%</td>
                    <td className="py-1">{fmtBytes(pteBytes(ws, p.bytes))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[12px] text-subtle">
          TLB reach = entries × page size. Miss rate assumes uniformly random accesses and a TLB that always holds {entries.toLocaleString()} of the pages; page-table size counts last-level
          entries of 8 bytes, per process that maps the region. Real CPUs keep separate, smaller TLBs for 1 GB pages.
        </p>
      </Panel>
      <Explain>
        With 4 KB pages, {entries.toLocaleString()} entries cover only {fmtBytes(tlbReach(entries, 4096))}, so a database buffer pool or a large Java heap misses the TLB on almost every random
        access. 2 MB pages multiply the reach by 512, which is why databases and JVMs use huge pages (<code>-XX:+UseLargePages</code>).
      </Explain>
    </div>
  );
}

export default function MemoryHierarchy() {
  const [tab, setTab] = useState<Tab>("amat");
  return (
    <div className="space-y-4">
      <Segmented
        ariaLabel="View"
        value={tab}
        onChange={setTab}
        options={[
          { value: "amat", label: "Cache levels" },
          { value: "eat", label: "TLB and page walks" },
          { value: "reach", label: "TLB reach & huge pages" },
        ]}
      />
      {tab === "amat" ? <AmatTab /> : tab === "eat" ? <EatTab /> : <ReachTab />}
    </div>
  );
}
