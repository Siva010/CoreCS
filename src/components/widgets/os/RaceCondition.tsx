"use client";
import { useMemo, useState } from "react";
import { RotateCcw, Shuffle, Lock } from "lucide-react";
import { Btn, Explain, Panel, Segmented, Stat } from "../ui";
import { cn } from "@/lib/utils";

type Op = "LOCK" | "LOAD" | "ADD" | "STORE" | "UNLOCK";

interface Thread {
  pc: number;
  reg: number | null;
}

function program(withLock: boolean, increments: number): Op[] {
  const one: Op[] = withLock ? ["LOCK", "LOAD", "ADD", "STORE", "UNLOCK"] : ["LOAD", "ADD", "STORE"];
  return Array.from({ length: increments }, () => one).flat();
}

const OP_TEXT: Record<Op, string> = {
  LOCK: "lock(m)",
  LOAD: "reg ← counter",
  ADD: "reg ← reg + 1",
  STORE: "counter ← reg",
  UNLOCK: "unlock(m)",
};

export default function RaceCondition() {
  const [withLock, setWithLock] = useState(false);
  const [increments, setIncrements] = useState<"1" | "2">("1");
  const prog = useMemo(() => program(withLock, Number(increments)), [withLock, increments]);
  const [t, setT] = useState<Thread[]>([
    { pc: 0, reg: null },
    { pc: 0, reg: null },
  ]);
  const [counter, setCounter] = useState(0);
  const [owner, setOwner] = useState<number | null>(null);
  const [trace, setTrace] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ tone: "neutral" | "bad" | "good" | "warn"; text: string } | null>(null);

  const reset = (lock = withLock, inc = increments) => {
    setT([
      { pc: 0, reg: null },
      { pc: 0, reg: null },
    ]);
    setCounter(0);
    setOwner(null);
    setTrace([]);
    setMsg(null);
    void lock;
    void inc;
  };

  const done = (i: number) => t[i].pc >= prog.length;
  const allDone = done(0) && done(1);
  const expected = 2 * Number(increments);

  function canStep(i: number, threads = t, own = owner) {
    if (threads[i].pc >= prog.length) return false;
    const op = prog[threads[i].pc];
    if (op === "LOCK" && own !== null && own !== i) return false;
    return true;
  }

  function step(i: number) {
    if (!canStep(i)) {
      if (!done(i)) setMsg({ tone: "warn", text: `T${i + 1} is blocked: the mutex is held by T${(owner ?? 0) + 1}. It sleeps until unlock.` });
      return;
    }
    const th = { ...t[i] };
    const op = prog[th.pc];
    let c = counter;
    let own = owner;
    let line = `T${i + 1}: ${OP_TEXT[op]}`;
    if (op === "LOCK") own = i;
    if (op === "UNLOCK") own = null;
    if (op === "LOAD") {
      th.reg = c;
      line += `  (reg=${c})`;
    }
    if (op === "ADD") {
      th.reg = (th.reg ?? 0) + 1;
      line += `  (reg=${th.reg})`;
    }
    if (op === "STORE") {
      if (th.reg !== c + 1 && th.reg !== null && th.reg <= c) line += "  ⚠ overwrites a newer value";
      c = th.reg ?? c;
      line += `  (counter=${c})`;
    }
    th.pc += 1;
    const next = t.map((x, k) => (k === i ? th : x));
    setT(next);
    setCounter(c);
    setOwner(own);
    setTrace((tr) => [...tr, line]);
    if (next[0].pc >= prog.length && next[1].pc >= prog.length) {
      setMsg(
        c === expected
          ? { tone: "good", text: `Final counter = ${c}. Correct — this interleaving happened to be safe${withLock ? " (and with the mutex, every interleaving is)" : ""}.` }
          : { tone: "bad", text: `Final counter = ${c}, expected ${expected}: ${expected - c} update(s) lost. Both threads loaded the same value before either stored.` },
      );
    } else setMsg(null);
  }

  function runRandom() {
    reset();
    let threads = [
      { pc: 0, reg: null as number | null },
      { pc: 0, reg: null as number | null },
    ];
    let c = 0;
    let own: number | null = null;
    const lines: string[] = [];
    while (threads.some((x) => x.pc < prog.length)) {
      const choices = [0, 1].filter((i) => canStep(i, threads, own));
      const i = choices[Math.floor(Math.random() * choices.length)];
      const th = { ...threads[i] };
      const op = prog[th.pc];
      if (op === "LOCK") own = i;
      if (op === "UNLOCK") own = null;
      if (op === "LOAD") th.reg = c;
      if (op === "ADD") th.reg = (th.reg ?? 0) + 1;
      if (op === "STORE") c = th.reg ?? c;
      lines.push(`T${i + 1}: ${OP_TEXT[op]}${op === "STORE" ? `  (counter=${c})` : op === "LOAD" || op === "ADD" ? `  (reg=${th.reg})` : ""}`);
      th.pc += 1;
      threads = threads.map((x, k) => (k === i ? th : x));
    }
    setT(threads);
    setCounter(c);
    setOwner(null);
    setTrace(lines);
    setMsg(c === expected ? { tone: "good", text: `Random run: counter = ${c} (correct).` } : { tone: "bad", text: `Random run: counter = ${c}, expected ${expected} — lost update.` });
  }

  function showLosing() {
    reset();
    if (withLock) {
      setMsg({ tone: "good", text: "With the mutex enabled, no losing interleaving exists: the LOAD–ADD–STORE sequence of one thread can't overlap the other's." });
      return;
    }
    // T1 LOAD, T2 LOAD, T1 ADD, T1 STORE, T2 ADD, T2 STORE (then remaining increments sequentially)
    const lines = [
      "T1: reg ← counter  (reg=0)",
      "T2: reg ← counter  (reg=0)",
      "T1: reg ← reg + 1  (reg=1)",
      "T1: counter ← reg  (counter=1)",
      "T2: reg ← reg + 1  (reg=1)",
      "T2: counter ← reg  (counter=1)  ⚠ overwrites a newer value",
    ];
    let c = 1;
    const rest = Number(increments) - 1;
    for (let k = 0; k < rest; k++) {
      for (const who of [1, 2]) {
        lines.push(`T${who}: reg ← counter  (reg=${c})`, `T${who}: reg ← reg + 1  (reg=${c + 1})`, `T${who}: counter ← reg  (counter=${c + 1})`);
        c += 1;
      }
    }
    setT([
      { pc: prog.length, reg: c },
      { pc: prog.length, reg: c },
    ]);
    setCounter(c);
    setTrace(lines);
    setMsg({ tone: "bad", text: `Counter = ${c}, expected ${expected}. T2 loaded 0 before T1 stored 1, so T2's store overwrote T1's increment.` });
  }

  // number of interleavings of two sequences of length L: C(2L, L)
  const L = prog.length;
  const interleavings = useMemo(() => {
    let r = 1;
    for (let k = 1; k <= L; k++) r = (r * (L + k)) / k;
    return Math.round(r);
  }, [L]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          ariaLabel="Mutex"
          value={withLock ? "lock" : "nolock"}
          onChange={(v) => {
            setWithLock(v === "lock");
            reset();
          }}
          options={[
            { value: "nolock", label: "No lock" },
            { value: "lock", label: <span className="flex items-center gap-1"><Lock className="h-3 w-3" /> With mutex</span> },
          ]}
        />
        <Segmented
          ariaLabel="Increments per thread"
          value={increments}
          onChange={(v) => {
            setIncrements(v);
            reset();
          }}
          options={[
            { value: "1", label: "1 increment each" },
            { value: "2", label: "2 each" },
          ]}
        />
        <Btn onClick={runRandom}>
          <Shuffle className="h-3.5 w-3.5" /> Random schedule
        </Btn>
        <Btn onClick={showLosing}>Show a losing interleaving</Btn>
        <Btn variant="ghost" onClick={() => reset()}>
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </Btn>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_200px_1fr]">
        {[0, 1].map((i) => (
          <Panel key={i} title={`Thread ${i + 1}`} right={<span className="font-mono text-[12px] text-subtle">reg = {t[i].reg ?? "—"}</span>}>
            <ol className="space-y-1 font-mono text-[12.5px]">
              {prog.map((op, k) => (
                <li
                  key={k}
                  className={cn(
                    "rounded px-2 py-0.5",
                    k < t[i].pc && "text-subtle line-through decoration-border-strong",
                    k === t[i].pc && "bg-accent/15 font-semibold text-fg",
                    (op === "LOCK" || op === "UNLOCK") && "text-d-advanced",
                  )}
                >
                  {OP_TEXT[op]}
                </li>
              ))}
            </ol>
            <Btn variant="primary" className="mt-3 w-full" onClick={() => step(i)} disabled={done(i)}>
              {done(i) ? "Finished" : canStep(i) ? `Step T${i + 1}` : `T${i + 1} blocked on mutex`}
            </Btn>
          </Panel>
        ))}
        <div className="order-first space-y-2 md:order-none">
          <Stat label="Shared counter" value={counter} sub={`expected ${expected}`} />
          {withLock && <Stat label="Mutex owner" value={owner === null ? "free" : `T${owner + 1}`} />}
          <Stat label="Possible interleavings" value={interleavings} sub={`C(${2 * L}, ${L})`} />
        </div>
      </div>

      {msg && <Explain tone={msg.tone}>{msg.text}</Explain>}
      {allDone && !msg && <Explain>Done.</Explain>}
      <Panel title="Execution trace">
        {trace.length ? (
          <ol className="max-h-48 space-y-0.5 overflow-y-auto font-mono text-[12px] text-muted thin-scroll">
            {trace.map((l, i) => (
              <li key={i} className={cn(l.includes("⚠") && "text-bad")}>
                {i + 1}. {l}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[13px] text-subtle">Step the threads in any order you like — you are the scheduler.</p>
        )}
      </Panel>
    </div>
  );
}
