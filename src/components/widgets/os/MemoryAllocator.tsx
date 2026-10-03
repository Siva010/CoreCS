"use client";
import { useMemo, useState } from "react";
import { Explain, Field, inputCls, Panel, Segmented, Stat, Btn, colorFor } from "../ui";
import { cn } from "@/lib/utils";

type Policy = "first" | "next" | "best" | "worst";
const TOTAL = 1000; // KB

interface Block {
  start: number;
  size: number;
  owner: string | null; // null = free
}

type Op = { kind: "alloc"; name: string; size: number } | { kind: "free"; name: string };

function parseOps(text: string): Op[] {
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const f = /^free\s+(\w+)$/i.exec(s);
      if (f) return { kind: "free" as const, name: f[1] };
      const a = /^(\w+)\s*[=:]?\s*(\d+)$/i.exec(s);
      if (a) return { kind: "alloc" as const, name: a[1], size: Math.min(TOTAL, Number(a[2])) };
      return null;
    })
    .filter((x): x is Op => x !== null);
}

function run(ops: Op[], policy: Policy, upto: number) {
  let blocks: Block[] = [{ start: 0, size: TOTAL, owner: null }];
  let nextPtr = 0;
  const log: { text: string; ok: boolean }[] = [];
  let failures = 0;
  ops.slice(0, upto).forEach((op) => {
    if (op.kind === "free") {
      const i = blocks.findIndex((b) => b.owner === op.name);
      if (i === -1) {
        log.push({ text: `free ${op.name}: not allocated`, ok: false });
        return;
      }
      blocks[i] = { ...blocks[i], owner: null };
      // coalesce
      const merged: Block[] = [];
      for (const b of blocks) {
        const last = merged[merged.length - 1];
        if (last && last.owner === null && b.owner === null) last.size += b.size;
        else merged.push({ ...b });
      }
      blocks = merged;
      log.push({ text: `free ${op.name}: block released and coalesced with free neighbors`, ok: true });
      return;
    }
    const holes = blocks.map((b, i) => ({ b, i })).filter(({ b }) => b.owner === null && b.size >= op.size);
    let pick: { b: Block; i: number } | undefined;
    if (policy === "first") pick = holes[0];
    if (policy === "best") pick = holes.sort((x, y) => x.b.size - y.b.size || x.b.start - y.b.start)[0];
    if (policy === "worst") pick = holes.sort((x, y) => y.b.size - x.b.size || x.b.start - y.b.start)[0];
    if (policy === "next") pick = holes.find(({ b }) => b.start >= nextPtr) ?? holes[0];
    if (!pick) {
      failures++;
      const free = blocks.filter((b) => b.owner === null).reduce((s, b) => s + b.size, 0);
      log.push({
        text: `${op.name}=${op.size} KB: FAILED — ${free} KB free in total, but no single hole ≥ ${op.size} KB${free >= op.size ? " (external fragmentation!)" : ""}`,
        ok: false,
      });
      return;
    }
    const { b, i } = pick;
    const used: Block = { start: b.start, size: op.size, owner: op.name };
    const rest: Block | null = b.size > op.size ? { start: b.start + op.size, size: b.size - op.size, owner: null } : null;
    blocks.splice(i, 1, ...(rest ? [used, rest] : [used]));
    nextPtr = used.start + used.size;
    log.push({ text: `${op.name}=${op.size} KB → hole at ${b.start} KB (${b.size} KB), ${b.size - op.size} KB left over`, ok: true });
  });
  const free = blocks.filter((b) => b.owner === null);
  const totalFree = free.reduce((s, b) => s + b.size, 0);
  const largest = Math.max(0, ...free.map((b) => b.size));
  return { blocks, log, failures, totalFree, largest, holes: free.length };
}

const PRESETS: { label: string; text: string }[] = [
  { label: "Fragmentation demo", text: "A 200\nB 100\nC 200\nD 100\nE 400\nfree B\nfree D\nF 150" },
  { label: "Textbook holes", text: "X1 100\nH1 500\nX2 200\nH2 300\nX3 300\nH3 600\nfree H1\nfree H2\nfree H3\nfree X1\nP1 212\nP2 417\nP3 112\nP4 426" },
  { label: "Churn", text: "A 120\nB 60\nC 200\nD 40\nfree A\nE 90\nfree C\nF 150\nG 70\nfree B\nH 100\nI 180" },
];

export default function MemoryAllocator() {
  const [policy, setPolicy] = useState<Policy>("first");
  const [text, setText] = useState(PRESETS[0].text);
  const ops = useMemo(() => parseOps(text), [text]);
  const [upto, setUpto] = useState(Infinity);
  const n = Math.min(upto, ops.length);
  const r = useMemo(() => run(ops, policy, n), [ops, policy, n]);
  const compare = useMemo(() => (["first", "next", "best", "worst"] as Policy[]).map((p) => ({ p, res: run(ops, p, ops.length) })), [ops]);
  const extFrag = r.totalFree ? 1 - r.largest / r.totalFree : 0;
  const names = [...new Set(ops.filter((o) => o.kind === "alloc").map((o) => o.name))];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          ariaLabel="Placement policy"
          value={policy}
          onChange={setPolicy}
          options={[
            { value: "first", label: "First fit" },
            { value: "next", label: "Next fit" },
            { value: "best", label: "Best fit" },
            { value: "worst", label: "Worst fit" },
          ]}
        />
        {PRESETS.map((p) => (
          <Btn key={p.label} onClick={() => { setText(p.text); setUpto(Infinity); }}>
            {p.label}
          </Btn>
        ))}
      </div>

      <Panel title={`Memory (${TOTAL} KB)`}>
        <div className="flex h-12 overflow-hidden rounded-lg border border-border">
          {r.blocks.map((b, i) => (
            <div
              key={i}
              title={`${b.owner ?? "free"} @ ${b.start} KB, ${b.size} KB`}
              className={cn("flex items-center justify-center border-r border-bg text-[11px] font-semibold last:border-r-0", b.owner === null && "bg-surface-2 text-subtle")}
              style={{
                width: `${(b.size / TOTAL) * 100}%`,
                background: b.owner ? colorFor(names.indexOf(b.owner)) : undefined,
                color: b.owner ? "white" : undefined,
                backgroundImage: b.owner ? undefined : "repeating-linear-gradient(45deg, transparent 0 6px, color-mix(in oklab, var(--border) 60%, transparent) 6px 7px)",
              }}
            >
              <span className="truncate px-1">{b.owner ?? (b.size >= 40 ? `${b.size}` : "")}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Free total" value={`${r.totalFree} KB`} />
          <Stat label="Largest hole" value={`${r.largest} KB`} />
          <Stat label="Holes" value={r.holes} />
          <Stat label="Ext. fragmentation" value={`${Math.round(extFrag * 100)}%`} sub="1 − largest/total free" />
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Request trace" right={<span className="font-mono text-[12px] text-subtle">{n}/{ops.length}</span>}>
          <textarea
            className={cn(inputCls, "h-28 w-full py-1.5")}
            value={text}
            onChange={(e) => { setText(e.target.value); setUpto(Infinity); }}
            aria-label="Allocation trace"
          />
          <p className="mt-1 text-[11.5px] text-subtle">One per line: <code>NAME SIZE</code> to allocate (KB), <code>free NAME</code> to release.</p>
          <div className="mt-2 flex gap-2">
            <Btn onClick={() => setUpto(0)}>Step from start</Btn>
            <Btn onClick={() => setUpto((u) => Math.min((Number.isFinite(u) ? u : ops.length) + 1, ops.length))} disabled={n >= ops.length}>Next op</Btn>
            <Btn variant="ghost" onClick={() => setUpto(Infinity)}>Run all</Btn>
          </div>
          <ol className="mt-3 max-h-44 space-y-1 overflow-y-auto text-[12.5px] thin-scroll">
            {r.log.map((l, i) => (
              <li key={i} className={l.ok ? "text-muted" : "text-bad"}>
                {i + 1}. {l.text}
              </li>
            ))}
          </ol>
        </Panel>
        <Panel title="Policies on the full trace">
          <table className="w-full text-[13px]">
            <thead className="text-left text-[11px] text-subtle uppercase">
              <tr>
                <th className="pb-1">Policy</th>
                <th className="pb-1 text-right">Failed requests</th>
                <th className="pb-1 text-right">Largest hole</th>
                <th className="pb-1 text-right">Holes</th>
              </tr>
            </thead>
            <tbody>
              {compare.map(({ p, res }) => (
                <tr key={p} className={cn("border-t border-border", p === policy && "bg-accent/5")}>
                  <td className="py-1.5 capitalize">{p} fit</td>
                  <td className={cn("text-right font-mono", res.failures ? "text-bad" : "text-ok")}>{res.failures}</td>
                  <td className="text-right font-mono">{res.largest} KB</td>
                  <td className="text-right font-mono">{res.holes}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3">
            <Explain>
              External fragmentation: free memory exists but is split into holes too small for the request. Paging avoids this for physical memory; compacting
              garbage collectors avoid it for heaps.
            </Explain>
          </div>
        </Panel>
      </div>
    </div>
  );
}
