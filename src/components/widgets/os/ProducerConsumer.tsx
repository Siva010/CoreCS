"use client";
import { useState } from "react";
import { RotateCcw, Shuffle } from "lucide-react";
import { Btn, Explain, Panel, Segmented, Stat } from "../ui";
import { cn } from "@/lib/utils";

type Bug = "none" | "order" | "nomutex";
type Sem = "empty" | "full" | "mutex";

type Instr =
  | { op: "produce" }
  | { op: "consume" }
  | { op: "wait"; sem: Sem }
  | { op: "signal"; sem: Sem }
  | { op: "write-slot" }
  | { op: "bump-in" }
  | { op: "read-slot" }
  | { op: "bump-out" };

const N = 4;

function programs(bug: Bug): { producer: Instr[]; consumer: Instr[] } {
  const pInsert: Instr[] = [{ op: "write-slot" }, { op: "bump-in" }];
  const cRemove: Instr[] = [{ op: "read-slot" }, { op: "bump-out" }];
  const lockP = bug === "nomutex" ? [] : [{ op: "wait", sem: "mutex" } as Instr];
  const unlockP = bug === "nomutex" ? [] : [{ op: "signal", sem: "mutex" } as Instr];
  const producer: Instr[] =
    bug === "order"
      ? [{ op: "produce" }, { op: "wait", sem: "mutex" }, { op: "wait", sem: "empty" }, ...pInsert, { op: "signal", sem: "mutex" }, { op: "signal", sem: "full" }]
      : [{ op: "produce" }, { op: "wait", sem: "empty" }, ...lockP, ...pInsert, ...unlockP, { op: "signal", sem: "full" }];
  const consumer: Instr[] = [{ op: "wait", sem: "full" }, ...lockP, ...cRemove, ...unlockP, { op: "signal", sem: "empty" }, { op: "consume" }];
  return { producer, consumer };
}

function label(i: Instr) {
  switch (i.op) {
    case "produce":
      return "item = produce()";
    case "consume":
      return "consume(item)";
    case "wait":
      return `wait(${i.sem})`;
    case "signal":
      return `signal(${i.sem})`;
    case "write-slot":
      return "buf[in] = item";
    case "bump-in":
      return "in = (in + 1) % N";
    case "read-slot":
      return "item = buf[out]";
    case "bump-out":
      return "out = (out + 1) % N";
  }
}

interface T {
  name: string;
  role: "producer" | "consumer";
  pc: number;
  item: string | null;
  blockedOn: Sem | null;
  made: number;
}

interface World {
  threads: T[];
  sems: Record<Sem, number>;
  queues: Record<Sem, number[]>;
  buf: (string | null)[];
  inIdx: number;
  outIdx: number;
  consumed: string[];
  lost: string[];
  log: string[];
}

function initial(): World {
  return {
    threads: [
      { name: "P1", role: "producer", pc: 0, item: null, blockedOn: null, made: 0 },
      { name: "P2", role: "producer", pc: 0, item: null, blockedOn: null, made: 0 },
      { name: "C1", role: "consumer", pc: 0, item: null, blockedOn: null, made: 0 },
      { name: "C2", role: "consumer", pc: 0, item: null, blockedOn: null, made: 0 },
    ],
    sems: { empty: N, full: 0, mutex: 1 },
    queues: { empty: [], full: [], mutex: [] },
    buf: Array(N).fill(null),
    inIdx: 0,
    outIdx: 0,
    consumed: [],
    lost: [],
    log: [],
  };
}

function stepWorld(w0: World, ti: number, bug: Bug): World {
  const w: World = structuredClone(w0);
  const th = w.threads[ti];
  if (th.blockedOn) return w;
  const prog = programs(bug)[th.role];
  const ins = prog[th.pc];
  const say = (s: string) => w.log.unshift(`${th.name}: ${s}`);
  const advance = () => (th.pc = (th.pc + 1) % prog.length);
  switch (ins.op) {
    case "produce":
      th.made += 1;
      th.item = `${th.name}.${th.made}`;
      say(`produced ${th.item}`);
      advance();
      break;
    case "consume":
      say(`consumed ${th.item}`);
      th.item = null;
      advance();
      break;
    case "wait":
      if (w.sems[ins.sem] > 0) {
        w.sems[ins.sem] -= 1;
        say(`wait(${ins.sem}) passes (${ins.sem} → ${w.sems[ins.sem]})`);
        advance();
      } else {
        th.blockedOn = ins.sem;
        w.queues[ins.sem].push(ti);
        say(`wait(${ins.sem}) BLOCKS (${ins.sem} = 0)`);
      }
      break;
    case "signal": {
      const q = w.queues[ins.sem];
      if (q.length) {
        const wake = q.shift()!;
        const wt = w.threads[wake];
        wt.blockedOn = null;
        wt.pc = (wt.pc + 1) % programs(bug)[wt.role].length; // it completes its wait()
        say(`signal(${ins.sem}) wakes ${wt.name}`);
      } else {
        w.sems[ins.sem] += 1;
        say(`signal(${ins.sem}) (${ins.sem} → ${w.sems[ins.sem]})`);
      }
      advance();
      break;
    }
    case "write-slot":
      if (w.buf[w.inIdx] !== null) {
        w.lost.push(w.buf[w.inIdx]!);
        say(`OVERWROTE ${w.buf[w.inIdx]} in slot ${w.inIdx} with ${th.item} — item lost!`);
      } else say(`buf[${w.inIdx}] = ${th.item}`);
      w.buf[w.inIdx] = th.item;
      advance();
      break;
    case "bump-in":
      w.inIdx = (w.inIdx + 1) % N;
      say(`in = ${w.inIdx}`);
      advance();
      break;
    case "read-slot":
      th.item = w.buf[w.outIdx];
      say(`item = buf[${w.outIdx}] → ${th.item ?? "EMPTY (garbage read!)"}`);
      w.buf[w.outIdx] = null;
      if (th.item) w.consumed.push(th.item);
      advance();
      break;
    case "bump-out":
      w.outIdx = (w.outIdx + 1) % N;
      say(`out = ${w.outIdx}`);
      advance();
      break;
  }
  w.log = w.log.slice(0, 60);
  return w;
}

export default function ProducerConsumer() {
  const [bug, setBug] = useState<Bug>("none");
  const [w, setW] = useState<World>(initial);
  const progs = programs(bug);
  const allBlocked = w.threads.every((t) => t.blockedOn);

  const step = (i: number) => setW((cur) => stepWorld(cur, i, bug));
  const randomSteps = (k: number) =>
    setW((cur) => {
      let x = cur;
      for (let s = 0; s < k; s++) {
        const runnable = x.threads.map((t, i) => (t.blockedOn ? -1 : i)).filter((i) => i >= 0);
        if (!runnable.length) break;
        x = stepWorld(x, runnable[Math.floor(Math.random() * runnable.length)], bug);
      }
      return x;
    });
  const reset = () => setW(initial());

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          ariaLabel="Protocol"
          value={bug}
          onChange={(v) => {
            setBug(v);
            setW(initial());
          }}
          options={[
            { value: "none", label: "Correct protocol" },
            { value: "order", label: "Bug: producer waits on mutex first" },
            { value: "nomutex", label: "Bug: no mutex" },
          ]}
        />
        <Btn onClick={() => randomSteps(1)}>
          <Shuffle className="h-3.5 w-3.5" /> 1 random step
        </Btn>
        <Btn onClick={() => randomSteps(25)}>25 random steps</Btn>
        <Btn variant="ghost" onClick={reset}>
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </Btn>
      </div>

      <Panel title={`Bounded buffer (N = ${N})`}>
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex gap-1.5">
            {w.buf.map((b, i) => (
              <div key={i} className="text-center">
                <div className={cn("grid h-12 w-16 place-items-center rounded-lg border font-mono text-[12px]", b ? "border-accent/50 bg-accent/10 text-fg" : "border-dashed border-border-strong text-subtle")}>
                  {b ?? "empty"}
                </div>
                <div className="mt-1 font-mono text-[10.5px] text-subtle">
                  {i}
                  {i === w.inIdx && <span className="ml-1 text-ok">in</span>}
                  {i === w.outIdx && <span className="ml-1 text-warn">out</span>}
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(["empty", "full", "mutex"] as Sem[]).map((s) => (
              <Stat key={s} label={s} value={w.sems[s]} sub={w.queues[s].length ? `waiting: ${w.queues[s].map((i) => w.threads[i].name).join(", ")}` : "no waiters"} />
            ))}
          </div>
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {w.threads.map((t, i) => {
          const prog = progs[t.role];
          return (
            <Panel key={t.name} title={`${t.name} (${t.role})`} className={cn(t.blockedOn && "border-warn/50")}>
              <ol className="space-y-0.5 font-mono text-[11.5px]">
                {prog.map((ins, k) => (
                  <li key={k} className={cn("rounded px-1.5 py-0.5", k === t.pc && (t.blockedOn ? "bg-warn/15 text-warn" : "bg-accent/15 font-semibold text-fg"), k !== t.pc && "text-muted")}>
                    {label(ins)}
                  </li>
                ))}
              </ol>
              <div className="mt-2 text-[11.5px] text-subtle">holding: {t.item ?? "—"}</div>
              <Btn variant={t.blockedOn ? "default" : "primary"} className="mt-2 w-full" disabled={!!t.blockedOn} onClick={() => step(i)}>
                {t.blockedOn ? `blocked on ${t.blockedOn}` : "Step"}
              </Btn>
            </Panel>
          );
        })}
      </div>

      {allBlocked ? (
        <Explain tone="bad">
          DEADLOCK: every thread is blocked.{" "}
          {bug === "order" ? "A producer took the mutex and then slept on empty (buffer full) — consumers can never enter to free a slot." : "No thread can signal the others."}
        </Explain>
      ) : w.lost.length ? (
        <Explain tone="bad">
          Items lost: {w.lost.join(", ")}. Without mutual exclusion two producers wrote the same slot before either advanced <code>in</code>.
        </Explain>
      ) : (
        <Explain>
          Consumed so far: {w.consumed.length ? w.consumed.join(", ") : "nothing"}.{" "}
          {bug === "order" ? "Fill the buffer, then let a producer take the mutex…" : bug === "nomutex" ? "Step P1 to buf[in] = item, then step P2 to the same instruction." : "Invariant: empty + full + (items in flight) = N."}
        </Explain>
      )}

      <Panel title="Event log">
        <ol className="max-h-40 space-y-0.5 overflow-y-auto font-mono text-[11.5px] text-muted thin-scroll">
          {w.log.map((l, i) => (
            <li key={w.log.length - i} className={cn(i === 0 && "text-fg", (l.includes("BLOCKS") || l.includes("lost") || l.includes("garbage")) && "text-warn")}>
              {l}
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
