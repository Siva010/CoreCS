"use client";
import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ALGO_LABELS, simulate, type Algo, type Proc } from "@/lib/sim/scheduler";
import { Btn, colorFor, Explain, Field, inputCls, NumberInput, Panel, Select, Stat } from "../ui";
import { cn } from "@/lib/utils";

const PRESETS: Record<string, { label: string; procs: Proc[]; note: string }> = {
  lesson: {
    label: "Lesson workload",
    note: "The worked example from the Scheduling Algorithms lesson.",
    procs: [
      { name: "P1", arrival: 0, burst: 8, priority: 3 },
      { name: "P2", arrival: 1, burst: 4, priority: 1 },
      { name: "P3", arrival: 2, burst: 9, priority: 4 },
      { name: "P4", arrival: 3, burst: 5, priority: 2 },
    ],
  },
  convoy: {
    label: "Convoy effect",
    note: "One long job first. Compare FCFS against SJF.",
    procs: [
      { name: "P1", arrival: 0, burst: 24, priority: 2 },
      { name: "P2", arrival: 1, burst: 3, priority: 2 },
      { name: "P3", arrival: 2, burst: 3, priority: 2 },
    ],
  },
  starvation: {
    label: "Starvation",
    note: "A low-priority job and a stream of high-priority arrivals. Try preemptive priority, then enable aging.",
    procs: [
      { name: "LOW", arrival: 0, burst: 6, priority: 9 },
      { name: "H1", arrival: 1, burst: 4, priority: 1 },
      { name: "H2", arrival: 4, burst: 4, priority: 1 },
      { name: "H3", arrival: 8, burst: 4, priority: 1 },
      { name: "H4", arrival: 12, burst: 4, priority: 1 },
      { name: "H5", arrival: 16, burst: 4, priority: 1 },
    ],
  },
  interactive: {
    label: "Interactive + batch",
    note: "Short interactive bursts mixed with CPU-bound batch jobs. Try MLFQ.",
    procs: [
      { name: "batch1", arrival: 0, burst: 14, priority: 5 },
      { name: "batch2", arrival: 0, burst: 12, priority: 5 },
      { name: "ui1", arrival: 3, burst: 1, priority: 1 },
      { name: "ui2", arrival: 7, burst: 2, priority: 1 },
      { name: "ui3", arrival: 11, burst: 1, priority: 1 },
    ],
  },
};

function Gantt({ procs, segments, makespan }: { procs: Proc[]; segments: ReturnType<typeof simulate>["segments"]; makespan: number }) {
  const ticks = new Set<number>([0]);
  segments.forEach((s) => ticks.add(s.end));
  return (
    <div className="overflow-x-auto thin-scroll">
      <div className="min-w-[520px] px-3 pb-1">
        <div className="flex h-11 overflow-hidden rounded-lg border border-border">
          {segments.map((s, i) => (
            <div
              key={i}
              title={s.pid === null ? `idle ${s.start}–${s.end}` : `${procs[s.pid].name} ${s.start}–${s.end}${s.level !== undefined ? ` (Q${s.level})` : ""}`}
              className={cn("flex items-center justify-center border-r border-bg text-[11.5px] font-semibold last:border-r-0", s.pid === null && "bg-surface-2 text-subtle")}
              style={{
                width: `${((s.end - s.start) / Math.max(1, makespan)) * 100}%`,
                background: s.pid === null ? undefined : colorFor(s.pid),
                color: s.pid === null ? undefined : "white",
              }}
            >
              <span className="truncate px-0.5">
                {s.pid === null ? "idle" : procs[s.pid].name}
                {s.level !== undefined && <sup className="ml-0.5 opacity-80">Q{s.level}</sup>}
              </span>
            </div>
          ))}
        </div>
        <div className="relative mt-1 h-4">
          {[...ticks].map((t) => (
            <span key={t} className="absolute -translate-x-1/2 font-mono text-[10.5px] text-subtle" style={{ left: `${(t / Math.max(1, makespan)) * 100}%` }}>
              {t}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function CpuScheduler() {
  const [procs, setProcs] = useState<Proc[]>(PRESETS.lesson.procs);
  const [preset, setPreset] = useState("lesson");
  const [algo, setAlgo] = useState<Algo>("fcfs");
  const [quantum, setQuantum] = useState(4);
  const [aging, setAging] = useState(0);
  const [boost, setBoost] = useState(0);
  const [q0, setQ0] = useState(2);
  const [q1, setQ1] = useState(4);
  const [showLog, setShowLog] = useState(false);

  const opts = { quantum, aging, mlfqQuanta: [q0, q1] as [number, number], boost };
  const valid = procs.length > 0 && procs.every((p) => p.burst > 0 && p.arrival >= 0);
  const res = useMemo(() => (valid ? simulate(procs, algo, opts) : null), [procs, algo, quantum, aging, boost, q0, q1, valid]); // eslint-disable-line react-hooks/exhaustive-deps
  const compare = useMemo(
    () => (valid ? (Object.keys(ALGO_LABELS) as Algo[]).map((a) => ({ a, r: simulate(procs, a, opts) })) : []),
    [procs, quantum, aging, boost, q0, q1, valid], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const update = (i: number, patch: Partial<Proc>) => setProcs((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Algorithm">
          <Select value={algo} onChange={setAlgo} options={(Object.keys(ALGO_LABELS) as Algo[]).map((a) => ({ value: a, label: ALGO_LABELS[a] }))} />
        </Field>
        {algo === "rr" && (
          <Field label="Quantum">
            <NumberInput value={quantum} min={1} max={20} onChange={(v) => setQuantum(Math.max(1, v))} />
          </Field>
        )}
        {(algo === "prio" || algo === "prio-p") && (
          <Field label="Aging (−1 priority per N ticks waiting)" hint="0 = off">
            <NumberInput value={aging} min={0} max={50} onChange={(v) => setAging(Math.max(0, v))} />
          </Field>
        )}
        {algo === "mlfq" && (
          <>
            <Field label="Q0 allotment">
              <NumberInput value={q0} min={1} max={20} onChange={(v) => setQ0(Math.max(1, v))} />
            </Field>
            <Field label="Q1 allotment">
              <NumberInput value={q1} min={1} max={40} onChange={(v) => setQ1(Math.max(1, v))} />
            </Field>
            <Field label="Boost every" hint="0 = off">
              <NumberInput value={boost} min={0} max={100} onChange={(v) => setBoost(Math.max(0, v))} />
            </Field>
          </>
        )}
        <Field label="Preset">
          <Select
            value={preset}
            onChange={(v) => {
              setPreset(v);
              setProcs(PRESETS[v].procs);
            }}
            options={Object.entries(PRESETS).map(([k, v]) => ({ value: k, label: v.label }))}
          />
        </Field>
      </div>
      <p className="text-[12.5px] text-subtle">{PRESETS[preset]?.note} Ties go to the earlier arrival; in RR, new arrivals queue before a preempted process.</p>

      <Panel
        title="Processes"
        right={
          <Btn
            onClick={() =>
              setProcs((ps) => [...ps, { name: `P${ps.length + 1}`, arrival: ps.length ? Math.max(...ps.map((p) => p.arrival)) + 1 : 0, burst: 3, priority: 3 }])
            }
            disabled={procs.length >= 10}
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </Btn>
        }
      >
        <div className="overflow-x-auto thin-scroll">
          <table className="w-full min-w-[520px] text-[13px]">
            <thead className="text-left text-[11px] tracking-wide text-subtle uppercase">
              <tr>
                <th className="pb-2">Process</th>
                <th className="pb-2">Arrival</th>
                <th className="pb-2">Burst</th>
                <th className="pb-2">Priority</th>
                <th className="pb-2 text-right">CT</th>
                <th className="pb-2 text-right">TAT</th>
                <th className="pb-2 text-right">WT</th>
                <th className="pb-2 text-right">RT</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {procs.map((p, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-1.5 pr-2">
                    <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: colorFor(i) }} />
                    <input className={cn(inputCls, "w-20")} value={p.name} onChange={(e) => update(i, { name: e.target.value.slice(0, 8) })} />
                  </td>
                  <td className="pr-2">
                    <NumberInput value={p.arrival} min={0} onChange={(v) => update(i, { arrival: Math.max(0, Math.floor(v)) })} className="w-16" />
                  </td>
                  <td className="pr-2">
                    <NumberInput value={p.burst} min={1} onChange={(v) => update(i, { burst: Math.max(1, Math.floor(v)) })} className="w-16" />
                  </td>
                  <td className="pr-2">
                    <NumberInput value={p.priority} min={0} onChange={(v) => update(i, { priority: Math.floor(v) })} className="w-16" />
                  </td>
                  <td className="text-right font-mono">{res?.results[i].completion}</td>
                  <td className="text-right font-mono">{res?.results[i].turnaround}</td>
                  <td className="text-right font-mono">{res?.results[i].waiting}</td>
                  <td className="text-right font-mono">{res?.results[i].response}</td>
                  <td className="text-right">
                    <button type="button" aria-label="Remove" onClick={() => setProcs((ps) => ps.filter((_, j) => j !== i))} className="p-1 text-subtle hover:text-bad">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {res && (
        <>
          <Panel title={`Gantt chart — ${ALGO_LABELS[algo]}`}>
            <Gantt procs={procs} segments={res.segments} makespan={res.makespan} />
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Avg waiting" value={res.avg.waiting.toFixed(2)} />
              <Stat label="Avg turnaround" value={res.avg.turnaround.toFixed(2)} />
              <Stat label="Avg response" value={res.avg.response.toFixed(2)} />
              <Stat label="Context switches" value={res.contextSwitches} />
            </div>
            <button type="button" onClick={() => setShowLog((s) => !s)} className="mt-3 text-[12.5px] font-medium text-accent hover:underline">
              {showLog ? "Hide" : "Show"} scheduler event log
            </button>
            {showLog && (
              <ol className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-border bg-surface-2 p-2 font-mono text-[11.5px] text-muted thin-scroll">
                {res.events.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ol>
            )}
          </Panel>
          <Panel title="Compare all algorithms on this workload">
            <div className="overflow-x-auto thin-scroll">
              <table className="w-full min-w-[480px] text-[13px]">
                <thead className="text-left text-[11px] tracking-wide text-subtle uppercase">
                  <tr>
                    <th className="pb-2">Algorithm</th>
                    <th className="pb-2 text-right">Avg WT</th>
                    <th className="pb-2 text-right">Avg TAT</th>
                    <th className="pb-2 text-right">Avg RT</th>
                    <th className="pb-2 text-right">Switches</th>
                  </tr>
                </thead>
                <tbody>
                  {compare.map(({ a, r }) => {
                    const best = Math.min(...compare.map((c) => c.r.avg.waiting));
                    return (
                      <tr key={a} className={cn("border-t border-border", a === algo && "bg-accent/5")}>
                        <td className="py-1.5">
                          <button type="button" onClick={() => setAlgo(a)} className="text-left hover:text-accent">
                            {ALGO_LABELS[a]}
                          </button>
                        </td>
                        <td className={cn("text-right font-mono", r.avg.waiting === best && "font-semibold text-ok")}>{r.avg.waiting.toFixed(2)}</td>
                        <td className="text-right font-mono">{r.avg.turnaround.toFixed(2)}</td>
                        <td className="text-right font-mono">{r.avg.response.toFixed(2)}</td>
                        <td className="text-right font-mono">{r.contextSwitches}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-3">
              <Explain>
                SRTF usually wins on average waiting time; Round Robin and MLFQ trade some of that for better response time and fairness. Watch the switch count rise as
                preemption increases.
              </Explain>
            </div>
          </Panel>
        </>
      )}
      {!valid && <Explain tone="bad">Every process needs a burst ≥ 1 and arrival ≥ 0.</Explain>}
    </div>
  );
}
