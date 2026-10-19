"use client";
import { useState } from "react";
import { Undo2 } from "lucide-react";
import { alternate, simulate, type Access, type State, type Var } from "@/lib/sim/mesi";
import { Btn, Explain, Panel, Segmented, Stat, StepControls, useStepper } from "../ui";
import { cn } from "@/lib/utils";

const PRESETS: { label: string; accesses: Access[]; note: string }[] = [
  {
    label: "False sharing",
    accesses: alternate(4),
    note: "Two threads each increment their own counter: core 0 writes a, core 1 writes b. They never touch each other's variable.",
  },
  {
    label: "True sharing",
    accesses: Array.from({ length: 4 }, () => [
      { core: 0, op: "write" as const, v: "a" as Var },
      { core: 1, op: "write" as const, v: "a" as Var },
    ]).flat(),
    note: "Both threads increment the same counter a. Here the traffic is real: the cores really do share the data. Padding can't help; sharding the counter (LongAdder) can.",
  },
  {
    label: "Read-mostly",
    accesses: [
      { core: 0, op: "read", v: "a" },
      { core: 1, op: "read", v: "a" },
      { core: 0, op: "read", v: "a" },
      { core: 1, op: "read", v: "a" },
      { core: 0, op: "write", v: "a" },
      { core: 1, op: "read", v: "a" },
      { core: 0, op: "read", v: "a" },
      { core: 1, op: "read", v: "a" },
    ],
    note: "Both cores read a shared value; one of them updates it once. Reads of a Shared line are free, and only the write costs coherence traffic.",
  },
];

const STATE_STYLE: Record<State, string> = {
  M: "border-bad/50 bg-bad/15 text-bad",
  E: "border-ok/50 bg-ok/15 text-ok",
  S: "border-accent/50 bg-accent/10 text-accent",
  I: "border-border bg-surface-2 text-subtle",
};
const STATE_NAME: Record<State, string> = { M: "Modified", E: "Exclusive", S: "Shared", I: "Invalid" };

export default function CacheCoherence() {
  const [accesses, setAccesses] = useState<Access[]>(PRESETS[0].accesses);
  const [note, setNote] = useState<string | null>(PRESETS[0].note);
  const [padded, setPadded] = useState(false);
  const run = simulate(accesses, 2, padded);
  const other = simulate(accesses, 2, !padded);
  const total = Math.max(1, run.steps.length);
  const s = useStepper(total + 1, { interval: 900 });
  const shown = s.step; // steps applied so far
  const lines = padded ? 2 : 1;
  const current = shown > 0 ? (run.steps[shown - 1] ?? null) : null;
  const states: State[][] = current ? current.states : Array.from({ length: lines }, () => ["I", "I"] as State[]);
  const partial = simulate(accesses.slice(0, shown), 2, padded).totals;

  const add = (a: Access) => {
    setAccesses((xs) => [...xs, a].slice(-16));
    setNote(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <Btn
            key={p.label}
            onClick={() => {
              setAccesses(p.accesses);
              setNote(p.note);
              s.reset();
            }}
          >
            {p.label}
          </Btn>
        ))}
        <Segmented
          size="sm"
          ariaLabel="Layout"
          value={padded ? "padded" : "shared"}
          onChange={(v) => {
            setPadded(v === "padded");
            s.reset();
          }}
          options={[
            { value: "shared", label: "a and b on one 64-byte line" },
            { value: "padded", label: "padded: separate lines" },
          ]}
        />
      </div>
      {note && <Explain>{note}</Explain>}

      <Panel title="Program" right={<span className="text-[11px] text-subtle">add accesses with the buttons</span>}>
        <div className="flex flex-wrap gap-1">
          {accesses.map((a, i) => (
            <span
              key={i}
              className={cn(
                "rounded border px-1.5 py-0.5 font-mono text-[12px]",
                i < shown ? "border-border-strong bg-surface-2 text-fg" : "border-border text-muted",
                i === shown - 1 && "ring-2 ring-warn",
              )}
            >
              C{a.core} {a.op === "write" ? "W" : "R"} {a.v}
            </span>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {[0, 1].map((core) =>
            (["a", "b"] as Var[]).map((v) =>
              (["read", "write"] as const).map((op) => (
                <Btn key={`${core}${v}${op}`} variant="ghost" className="border border-border" onClick={() => add({ core, op, v })}>
                  core {core} {op} {v}
                </Btn>
              )),
            ),
          )}
          <Btn variant="ghost" disabled={!accesses.length} onClick={() => setAccesses((xs) => xs.slice(0, -1))}>
            <Undo2 className="h-3.5 w-3.5" /> Remove last
          </Btn>
        </div>
      </Panel>

      <StepControls s={s} total={total + 1} label={current ? current.text : "Both caches start empty."} />

      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1].map((core) => (
          <Panel key={core} title={`Core ${core}'s cache`}>
            <div className="space-y-1.5">
              {Array.from({ length: lines }, (_, line) => {
                const st = states[line][core];
                const vars = padded ? (line === 0 ? "a" : "b") : "a, b";
                const hit = current && current.line === line && current.access.core === core;
                return (
                  <div key={line} className={cn("flex items-center justify-between rounded-md border px-2 py-1.5", hit ? "border-warn" : "border-border")}>
                    <span className="font-mono text-[12.5px] text-muted">
                      {lines > 1 ? `line ${line}` : "line"} ({vars})
                    </span>
                    <span className={cn("rounded border px-2 py-0.5 font-mono text-[12px] font-semibold", STATE_STYLE[st])} title={STATE_NAME[st]}>
                      {st} · {STATE_NAME[st]}
                    </span>
                  </div>
                );
              })}
            </div>
          </Panel>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Hits so far" value={partial.hits} />
        <Stat label="Misses so far" value={partial.misses} />
        <Stat label="Invalidations" value={partial.invalidations} />
        <Stat label="Cache-to-cache transfers" value={partial.transfers} />
      </div>

      <Panel title="Whole program: one shared line vs padded">
        <div className="overflow-x-auto thin-scroll">
          <table className="w-full min-w-[420px] text-[13px]">
            <thead>
              <tr className="text-left text-[11px] tracking-wide text-subtle uppercase">
                <th className="py-1 pr-3 font-medium">Layout</th>
                <th className="py-1 pr-3 font-medium">Hits</th>
                <th className="py-1 pr-3 font-medium">Misses</th>
                <th className="py-1 pr-3 font-medium">Invalidations</th>
                <th className="py-1 font-medium">Transfers</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {[
                { label: "one line", t: padded ? other.totals : run.totals },
                { label: "padded", t: padded ? run.totals : other.totals },
              ].map(({ label, t }) => (
                <tr key={label} className="border-t border-border">
                  <td className="py-1 pr-3 font-sans">{label}</td>
                  <td className="py-1 pr-3">{t.hits}</td>
                  <td className="py-1 pr-3">{t.misses}</td>
                  <td className="py-1 pr-3">{t.invalidations}</td>
                  <td className="py-1">{t.transfers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[12.5px] text-muted">
          A hit costs about 4 cycles. A miss served by another core, or an invalidation round-trip, costs tens to hundreds of cycles, and more across sockets. Coherence works on whole 64-byte
          lines, so two variables on one line behave like one shared variable.
        </p>
      </Panel>
      <p className="text-[12.5px] text-subtle">
        The simulator follows the MESI table in the lesson, for two cores snooping one bus. Real CPUs add states (MOESI, MESIF) and directories, but the costly events are the same. In Java, keep
        per-thread hot fields apart with <code>@Contended</code> or use <code>LongAdder</code>, and confirm with <code>perf c2c</code>.
      </p>
    </div>
  );
}
