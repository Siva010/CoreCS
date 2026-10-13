"use client";
import { useMemo, useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { analyze, opLabel, parseSchedule, timestampOrdering, type Edge, type Op, type TsStep } from "@/lib/sim/schedule";
import { Btn, Explain, Panel, Segmented, StepControls, colorFor, inputCls, useStepper } from "../ui";
import { cn } from "@/lib/utils";

const PRESETS: { label: string; text: string; note: string }[] = [
  { label: "Lost update", text: "R1(A) R2(A) W1(A) W2(A) C1 C2", note: "Both read A, both write it. T1 → T2 (R1 before W2) and T2 → T1 (R2 before W1): a cycle, so no serial order produces this outcome — one update is lost." },
  { label: "Serializable interleaving", text: "R1(A) W1(A) R2(A) W2(A) R1(B) W1(B) R2(B) W2(B) C1 C2", note: "Every conflict goes T1 → T2, so the interleaving is equivalent to running T1 then T2 — yet it reads uncommitted data, so it isn't cascadeless." },
  { label: "Three-way cycle", text: "R1(A) R2(B) R3(C) W1(B) W2(C) W3(A) C1 C2 C3", note: "No two transactions conflict in both directions, but the edges T2 → T1, T3 → T2 and T1 → T3 still close a cycle." },
  { label: "Blind writes", text: "R1(A) W2(A) W1(A) W3(A) C1 C2 C3", note: "Not conflict-serializable (T1 ⇄ T2), but view-serializable as T1, T2, T3: T3's blind write overwrites both, so the order of the earlier writes is never observed." },
  { label: "Unrecoverable", text: "W1(A) R2(A) W2(B) C2 A1", note: "T2 reads T1's uncommitted A and commits. Then T1 aborts: T2 acted on a value that never existed, and its commit can't be taken back." },
  { label: "Cascading abort", text: "W1(A) R2(A) W2(B) R3(B) A1", note: "T1 aborts, so T2 (which read its A) must abort, so T3 (which read T2's B) must too. Recoverable — nobody committed — but not cascadeless." },
  { label: "Strict", text: "W1(A) W1(B) C1 R2(A) W2(A) C2", note: "Nobody touches an item another transaction wrote until that transaction finishes. This is what strict 2PL produces." },
  { label: "Thomas's write rule", text: "R1(A) W2(A) W1(A) C1 C2", note: "Under timestamp ordering T1 (older) writes A after T2 (younger) already did. Basic TO aborts T1; Thomas's rule just skips the obsolete write. Switch to the Timestamp ordering tab." },
];

const tone = (tx: number) => colorFor(tx - 1);

export default function Schedules() {
  const [text, setText] = useState(PRESETS[0].text);
  const [note, setNote] = useState<string | null>(PRESETS[0].note);
  const [mode, setMode] = useState<"analyze" | "to">("analyze");
  const parsed = useMemo(() => parseSchedule(text), [text]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <Btn key={p.label} variant={text === p.text ? "primary" : "default"} onClick={() => { setText(p.text); setNote(p.note); }}>
            {p.label}
          </Btn>
        ))}
      </div>
      <label className="flex flex-col gap-1 text-[12px] font-medium text-muted">
        Schedule — R1(A) read, W2(B) write, C1 commit, A2 abort
        <input value={text} onChange={(e) => { setText(e.target.value); setNote(null); }} spellCheck={false} className={cn(inputCls, "h-9 w-full")} aria-label="Schedule" />
      </label>
      {parsed.error ? <Explain tone="bad">{parsed.error}</Explain> : note && <Explain>{note}</Explain>}

      <Segmented
        ariaLabel="Mode"
        value={mode}
        onChange={setMode}
        options={[
          { value: "analyze", label: "Serializability & recoverability" },
          { value: "to", label: "Timestamp ordering" },
        ]}
      />

      {!parsed.error && parsed.ops.length > 0 && (mode === "analyze" ? <Analyze ops={parsed.ops} txs={parsed.txs} /> : <TimestampOrdering key={text} ops={parsed.ops} txs={parsed.txs} />)}
    </div>
  );
}

function ScheduleGrid({ ops, txs, highlight, status }: { ops: Op[]; txs: number[]; highlight?: Set<number>; status?: Map<number, TsStep["outcome"]> }) {
  return (
    <div className="overflow-x-auto thin-scroll">
      <table className="w-full min-w-max border-collapse font-mono text-[12.5px]">
        <thead>
          <tr className="text-[11px] text-subtle">
            <th className="w-10 border-b border-border px-2 py-1 text-left font-medium">t</th>
            {txs.map((t) => (
              <th key={t} className="border-b border-border px-3 py-1 text-left font-semibold" style={{ color: tone(t) }}>
                T{t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ops.map((o) => {
            const st = status?.get(o.i);
            return (
              <tr key={o.i} className={cn(highlight?.has(o.i) && "bg-warn/10")}>
                <td className="border-b border-border/60 px-2 py-1 text-subtle">{o.i + 1}</td>
                {txs.map((t) => (
                  <td key={t} className="border-b border-border/60 px-3 py-1">
                    {o.tx === t && (
                      <span className={cn(st === "abort" && "text-bad line-through", st === "skipped" && "text-subtle line-through", st === "ignored" && "text-warn line-through")} style={st ? undefined : { color: tone(t) }}>
                        {o.kind === "C" ? "commit" : o.kind === "A" ? "abort" : `${o.kind}(${o.item})`}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Graph({ txs, edges, cycle, active, onHover }: { txs: number[]; edges: Edge[]; cycle: number[] | null; active: string | null; onHover: (k: string | null) => void }) {
  const W = 300;
  const H = 230;
  const R = 20;
  const pos = new Map(
    txs.map((t, i) => {
      const a = txs.length === 1 ? 0 : -Math.PI / 2 + (2 * Math.PI * i) / txs.length;
      return [t, { x: W / 2 + (txs.length === 1 ? 0 : 82 * Math.cos(a)), y: H / 2 + (txs.length === 1 ? 0 : 82 * Math.sin(a)) }];
    }),
  );
  const onCycle = (e: Edge) => !!cycle && cycle.some((t, i) => t === e.from && cycle[(i + 1) % cycle.length] === e.to);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto w-full max-w-[340px]" role="img" aria-label="Precedence graph">
      <defs>
        {["n", "c", "h"].map((id) => (
          <marker key={id} id={`sched-${id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={id === "c" ? "var(--bad)" : id === "h" ? "var(--warn)" : "var(--muted)"} />
          </marker>
        ))}
      </defs>
      {edges.map((e) => {
        const a = pos.get(e.from)!;
        const b = pos.get(e.to)!;
        const k = `${e.from}>${e.to}`;
        const twoWay = edges.some((x) => x.from === e.to && x.to === e.from);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const bend = twoWay ? 18 : 0;
        const cx = (a.x + b.x) / 2 + nx * bend;
        const cy = (a.y + b.y) / 2 + ny * bend;
        const s = { x: a.x + ((cx - a.x) / Math.hypot(cx - a.x, cy - a.y)) * R, y: a.y + ((cy - a.y) / Math.hypot(cx - a.x, cy - a.y)) * R };
        const t = { x: b.x + ((cx - b.x) / Math.hypot(cx - b.x, cy - b.y)) * (R + 2), y: b.y + ((cy - b.y) / Math.hypot(cx - b.x, cy - b.y)) * (R + 2) };
        const kind = active === k ? "h" : onCycle(e) ? "c" : "n";
        return (
          <g key={k} onMouseEnter={() => onHover(k)} onMouseLeave={() => onHover(null)} className="cursor-pointer">
            <path d={`M${s.x},${s.y} Q${cx},${cy} ${t.x},${t.y}`} fill="none" stroke="transparent" strokeWidth={12} />
            <path d={`M${s.x},${s.y} Q${cx},${cy} ${t.x},${t.y}`} fill="none" stroke={kind === "h" ? "var(--warn)" : kind === "c" ? "var(--bad)" : "var(--muted)"} strokeWidth={kind === "n" ? 1.5 : 2.2} markerEnd={`url(#sched-${kind})`} />
          </g>
        );
      })}
      {txs.map((t) => {
        const p = pos.get(t)!;
        return (
          <g key={t}>
            <circle cx={p.x} cy={p.y} r={R} fill="var(--surface-2)" stroke={cycle?.includes(t) ? "var(--bad)" : tone(t)} strokeWidth={2} />
            <text x={p.x} y={p.y + 4.5} textAnchor="middle" className="font-mono" fontSize={13} fontWeight={600} fill="var(--fg)">
              T{t}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Verdict({ label, ok, children }: { label: string; ok: boolean; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3" style={{ borderLeftWidth: 2, borderLeftColor: ok ? "var(--ok)" : "var(--bad)" }}>
      <div className="flex items-center gap-1.5 text-[13px] font-semibold text-fg">
        {ok ? <Check className="size-4 text-ok" /> : <X className="size-4 text-bad" />} {label}
      </div>
      <div className="mt-1 space-y-1 text-[12.5px] leading-relaxed text-muted">{children}</div>
    </div>
  );
}

function Analyze({ ops, txs }: { ops: Op[]; txs: number[] }) {
  const a = useMemo(() => analyze(ops), [ops]);
  const [hover, setHover] = useState<string | null>(null);
  const ptxs = [...new Set(a.projection.map((o) => o.tx))].sort((x, y) => x - y);
  const hovered = a.edges.find((e) => `${e.from}>${e.to}` === hover);
  const highlight = new Set(hovered ? hovered.because.flatMap((c) => [c.a.i, c.b.i]) : []);
  const order = (o: number[]) => o.map((t) => `T${t}`).join(" → ");

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Schedule">
          <ScheduleGrid ops={ops} txs={txs} highlight={highlight} />
        </Panel>
        <Panel title="Precedence graph" right={<span className="text-[11px] text-subtle">hover an edge to see its conflicts</span>}>
          {ptxs.length ? <Graph txs={ptxs} edges={a.edges} cycle={a.cycle} active={hover} onHover={setHover} /> : <p className="text-[13px] text-subtle">Every transaction aborted — nothing to order.</p>}
          <ul className="mt-2 space-y-0.5 font-mono text-[12px]">
            {a.edges.map((e) => (
              <li key={`${e.from}>${e.to}`} onMouseEnter={() => setHover(`${e.from}>${e.to}`)} onMouseLeave={() => setHover(null)} className={cn("rounded px-1.5 py-0.5", hover === `${e.from}>${e.to}` && "bg-warn/10")}>
                T{e.from} → T{e.to}: <span className="text-muted">{e.because.map((c) => `${opLabel(c.a)} before ${opLabel(c.b)}`).join("; ")}</span>
              </li>
            ))}
            {!a.edges.length && ptxs.length > 0 && <li className="text-subtle">No conflicting operations: any serial order is equivalent.</li>}
          </ul>
        </Panel>
      </div>

      {a.dropped.length > 0 && (
        <p className="text-[12.5px] text-subtle">
          Serializability is judged on the committed projection: {a.dropped.map((t) => `T${t}`).join(", ")} aborted, so {a.dropped.length === 1 ? "its" : "their"} operations are left out of the graph.
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Verdict label="Conflict-serializable" ok={!a.cycle}>
          {a.cycle ? (
            <p>
              Cycle {[...a.cycle, a.cycle[0]].map((t) => `T${t}`).join(" → ")}: each transaction would have to come both before and after another. No serial order has the same conflicts.
            </p>
          ) : (
            <p>
              No cycle. Equivalent serial order{a.orders.length > 1 ? "s" : ""}: {a.orders.map(order).join(" · ")}
              {a.orders.length >= 6 ? " …" : ""} (topological sort of the graph).
            </p>
          )}
        </Verdict>
        <Verdict label="View-serializable" ok={!!a.view}>
          {a.view ? (
            <p>
              View-equivalent to {order(a.view)}: every read sees the same write and the same transaction writes each item last.
              {a.cycle && " It is view- but not conflict-serializable — only possible with blind writes (writes without a prior read)."}
            </p>
          ) : (
            <p>No serial order gives every read the same source and every item the same final writer.</p>
          )}
        </Verdict>
        <Verdict label="Recoverable" ok={a.recoverable.ok}>
          {a.recoverable.why.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </Verdict>
        <Verdict label="Cascadeless (avoids cascading aborts)" ok={a.cascadeless.ok}>
          {a.cascadeless.why.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </Verdict>
        <Verdict label="Strict" ok={a.strict.ok}>
          {a.strict.why.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </Verdict>
        <div className="rounded-lg border border-dashed border-border p-3 text-[12.5px] leading-relaxed text-muted">
          <span className="font-medium text-fg">How they nest:</span> strict ⊂ cascadeless ⊂ recoverable, and conflict-serializable ⊂ view-serializable. The two families are independent: a schedule can be
          serializable and unrecoverable.
          {a.incomplete.length > 0 && <> T{a.incomplete.join(", T")} never commit{a.incomplete.length === 1 ? "s" : ""} or abort{a.incomplete.length === 1 ? "s" : ""} here.</>}
        </div>
      </div>
    </div>
  );
}

function TimestampOrdering({ ops, txs }: { ops: Op[]; txs: number[] }) {
  const [thomas, setThomas] = useState<"basic" | "thomas">("basic");
  const [tsMode, setTsMode] = useState<"number" | "first">("number");
  const ts = useMemo(() => {
    const order = tsMode === "number" ? txs : [...new Set(ops.map((o) => o.tx))];
    return new Map(order.map((t, i) => [t, i + 1]));
  }, [ops, txs, tsMode]);
  const steps = useMemo(() => timestampOrdering(ops, ts, thomas === "thomas"), [ops, ts, thomas]);
  const s = useStepper(steps.length + 1, { interval: 1300 });
  const shown = steps.slice(0, s.step);
  const current = shown[shown.length - 1];
  const items = [...new Set(ops.filter((o) => o.item).map((o) => o.item!))].sort();
  const status = new Map(shown.map((x) => [x.op.i, x.outcome]));
  const final = steps.filter((x) => x.outcome === "abort").map((x) => x.op.tx);
  const skipped = steps.filter((x) => x.outcome === "ignored").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented ariaLabel="Write rule" size="sm" value={thomas} onChange={setThomas} options={[{ value: "basic", label: "Basic TO" }, { value: "thomas", label: "Thomas's write rule" }]} />
        <Segmented
          ariaLabel="Timestamps"
          size="sm"
          value={tsMode}
          onChange={setTsMode}
          options={[
            { value: "number", label: "TS(Ti) = i", title: "T1 is the oldest" },
            { value: "first", label: "TS by first operation", title: "A transaction's timestamp is when it first appears" },
          ]}
        />
        <span className="font-mono text-[12px] text-subtle">{txs.map((t) => `TS(T${t})=${ts.get(t)}`).join("  ")}</span>
      </div>
      <StepControls s={s} total={steps.length + 1} label={s.step === 0 ? "Start: every R-TS and W-TS is 0." : undefined} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <Panel title="Schedule">
          <ScheduleGrid ops={ops} txs={txs} highlight={current ? new Set([current.op.i]) : undefined} status={status} />
        </Panel>
        <div className="space-y-3">
          <Panel title="Item timestamps">
            <table className="w-full font-mono text-[12.5px]">
              <thead className="text-left text-[11px] text-subtle">
                <tr>
                  <th className="pb-1 font-medium">item</th>
                  <th className="pb-1 font-medium">R-TS</th>
                  <th className="pb-1 font-medium">W-TS</th>
                </tr>
              </thead>
              <tbody>
                {items.map((x) => (
                  <tr key={x} className={cn(current?.op.item === x && "bg-warn/10")}>
                    <td className="py-0.5">{x}</td>
                    <td>{current?.rts[x] ?? 0}</td>
                    <td>{current?.wts[x] ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          {s.atEnd && (
            <Explain tone={final.length ? "warn" : "good"}>
              {final.length ? `Rolled back: ${[...new Set(final)].map((t) => `T${t}`).join(", ")}. ` : "No rollbacks. "}
              {skipped ? `${skipped} obsolete write${skipped === 1 ? "" : "s"} skipped. ` : ""}
              What ran is equivalent to the serial order by timestamp{skipped ? " (view-equivalent: a skipped write would have been overwritten anyway)" : ""}.
            </Explain>
          )}
        </div>
      </div>
      {current && (
        <Explain tone={current.outcome === "abort" ? "bad" : current.outcome === "ignored" ? "warn" : current.outcome === "ok" || current.outcome === "commit" ? "good" : "neutral"}>
          <span className="font-mono font-semibold">{opLabel(current.op)}</span> — {current.why}
        </Explain>
      )}
      <p className="text-[12.5px] text-subtle">
        The rule in one line: an operation may run only if no younger transaction has already done something it should have come before — a read must not follow a younger write; a write must not follow a
        younger read or (in basic TO) a younger write. In a real system a rolled-back transaction restarts with a new, larger timestamp; here its remaining operations are skipped.
      </p>
    </div>
  );
}
