"use client";
import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Btn, Explain, Panel } from "../ui";
import { cn } from "@/lib/utils";

type Mode = "S" | "X";
type Tx = 1 | 2 | 3;
const TXS: Tx[] = [1, 2, 3];
const RESOURCES = ["row A", "row B", "row C"] as const;
type Res = (typeof RESOURCES)[number];

interface Req {
  tx: Tx;
  mode: Mode;
}

interface LockState {
  held: Record<Res, Req[]>;
  queue: Record<Res, Req[]>;
  status: Record<Tx, "active" | "waiting" | "committed" | "aborted">;
  log: { text: string; tone?: "bad" | "good" | "warn" }[];
  deadlocks: number;
}

const compatible = (a: Mode, b: Mode) => a === "S" && b === "S";

function fresh(): LockState {
  return {
    held: { "row A": [], "row B": [], "row C": [] },
    queue: { "row A": [], "row B": [], "row C": [] },
    status: { 1: "active", 2: "active", 3: "active" },
    log: [{ text: "Three transactions, three rows. Click S (shared) or X (exclusive) to request a lock." }],
    deadlocks: 0,
  };
}

function clone(s: LockState): LockState {
  return {
    held: Object.fromEntries(RESOURCES.map((r) => [r, [...s.held[r]]])) as Record<Res, Req[]>,
    queue: Object.fromEntries(RESOURCES.map((r) => [r, [...s.queue[r]]])) as Record<Res, Req[]>,
    status: { ...s.status },
    log: [...s.log],
    deadlocks: s.deadlocks,
  };
}

/** Edges waiter → holder (and → earlier incompatible waiters, which also block it). */
function waitsFor(s: LockState): [Tx, Tx][] {
  const edges: [Tx, Tx][] = [];
  for (const r of RESOURCES) {
    s.queue[r].forEach((w, qi) => {
      for (const h of s.held[r]) if (h.tx !== w.tx && !compatible(h.mode, w.mode)) edges.push([w.tx, h.tx]);
      for (const ahead of s.queue[r].slice(0, qi)) if (ahead.tx !== w.tx && !compatible(ahead.mode, w.mode)) edges.push([w.tx, ahead.tx]);
    });
  }
  return edges.filter(([a, b], i, all) => all.findIndex(([x, y]) => x === a && y === b) === i);
}

function findCycle(edges: [Tx, Tx][], start: Tx): Tx[] | null {
  const path: Tx[] = [];
  const seen = new Set<Tx>();
  const dfs = (n: Tx): Tx[] | null => {
    if (path.includes(n)) return path.slice(path.indexOf(n));
    if (seen.has(n)) return null;
    seen.add(n);
    path.push(n);
    for (const [a, b] of edges) if (a === n) {
      const c = dfs(b);
      if (c) return c;
    }
    path.pop();
    return null;
  };
  return dfs(start);
}

function canGrant(s: LockState, r: Res, req: Req, ignoreQueue: boolean) {
  const others = s.held[r].filter((h) => h.tx !== req.tx);
  if (others.some((h) => !compatible(h.mode, req.mode))) return false;
  if (!ignoreQueue && s.queue[r].some((w) => w.tx !== req.tx && !compatible(w.mode, req.mode))) return false;
  return true;
}

function grant(s: LockState, r: Res, req: Req) {
  const mine = s.held[r].find((h) => h.tx === req.tx);
  if (mine) mine.mode = mine.mode === "X" || req.mode === "X" ? "X" : "S";
  else s.held[r].push({ ...req });
}

function releaseAll(s: LockState, tx: Tx) {
  for (const r of RESOURCES) {
    s.held[r] = s.held[r].filter((h) => h.tx !== tx);
    s.queue[r] = s.queue[r].filter((w) => w.tx !== tx);
  }
  // Wake waiters in FIFO order while they're compatible.
  for (const r of RESOURCES) {
    while (s.queue[r].length) {
      const next = s.queue[r][0];
      if (!canGrant(s, r, next, true)) break;
      s.queue[r].shift();
      grant(s, r, next);
      s.status[next.tx] = RESOURCES.some((x) => s.queue[x].some((w) => w.tx === next.tx)) ? "waiting" : "active";
      s.log.push({ text: `T${next.tx} woke up: ${next.mode} lock on ${r} granted.`, tone: "good" });
    }
  }
}

function request(prev: LockState, tx: Tx, r: Res, mode: Mode): LockState {
  const s = clone(prev);
  if (s.status[tx] !== "active") {
    s.log.push({ text: `T${tx} is ${s.status[tx]} and can't issue new requests.`, tone: "warn" });
    return s;
  }
  const mine = s.held[r].find((h) => h.tx === tx);
  if (mine && (mine.mode === "X" || mode === "S")) {
    s.log.push({ text: `T${tx} already holds a ${mine.mode} lock on ${r}.` });
    return s;
  }
  const req = { tx, mode };
  if (canGrant(s, r, req, false)) {
    grant(s, r, req);
    s.log.push({ text: `T${tx}: ${mode} lock on ${r} ${mine ? "upgraded" : "granted"}.`, tone: "good" });
    return s;
  }
  s.queue[r].push(req);
  s.status[tx] = "waiting";
  const blockers = [...s.held[r].filter((h) => h.tx !== tx && !compatible(h.mode, mode)).map((h) => `T${h.tx} (holds ${h.mode})`), ...s.queue[r].slice(0, -1).filter((w) => w.tx !== tx && !compatible(w.mode, mode)).map((w) => `T${w.tx} (queued for ${w.mode})`)];
  s.log.push({ text: `T${tx} waits for ${mode} on ${r} — blocked by ${blockers.join(", ")}.`, tone: "warn" });
  const cycle = findCycle(waitsFor(s), tx);
  if (cycle) {
    s.deadlocks++;
    s.log.push({ text: `Deadlock detected: ${[...cycle, cycle[0]].map((t) => `T${t}`).join(" → ")}. The detector aborts T${tx} (its request closed the cycle); its locks are released.`, tone: "bad" });
    s.status[tx] = "aborted";
    releaseAll(s, tx);
  }
  return s;
}

function finish(prev: LockState, tx: Tx, how: "committed" | "aborted"): LockState {
  const s = clone(prev);
  if (s.status[tx] === "committed" || s.status[tx] === "aborted") return s;
  s.status[tx] = how;
  s.log.push({ text: `T${tx} ${how === "committed" ? "COMMIT" : "ROLLBACK"} → all its locks released.`, tone: how === "committed" ? "good" : "warn" });
  releaseAll(s, tx);
  return s;
}

type Op = [Tx, Res, Mode] | [Tx, "commit" | "abort"];

const PRESETS: { label: string; ops: Op[]; note: string }[] = [
  { label: "Readers share, writer waits", ops: [[1, "row A", "S"], [2, "row A", "S"], [3, "row A", "X"]], note: "Two shared locks coexist; the exclusive request queues until both readers finish. Commit T1 and T2 to let T3 in." },
  { label: "Deadlock", ops: [[1, "row A", "X"], [2, "row B", "X"], [1, "row B", "X"], [2, "row A", "X"]], note: "T1 holds A and wants B; T2 holds B and wants A. The waits-for graph has a cycle, so one transaction must die." },
  { label: "Consistent lock order", ops: [[1, "row A", "X"], [2, "row A", "X"], [1, "row B", "X"], [1, "commit"], [2, "row B", "X"]], note: "Both lock A before B. T2 simply waits for T1 — a queue, never a cycle." },
  { label: "Queue behind a writer", ops: [[1, "row C", "S"], [2, "row C", "X"], [3, "row C", "S"]], note: "Like ALTER TABLE behind a long SELECT: T3's shared request is compatible with T1 but must queue behind T2's waiting exclusive request (FIFO fairness). One waiting writer blocks everyone after it." },
];

function applyOps(ops: Op[]) {
  let s = fresh();
  for (const op of ops) s = op.length === 3 ? request(s, op[0], op[1], op[2]) : finish(s, op[0], op[1] === "commit" ? "committed" : "aborted");
  return s;
}

const POS: Record<Tx, [number, number]> = { 1: [60, 40], 2: [220, 40], 3: [140, 140] };

export default function DbLocks() {
  const [state, setState] = useState<LockState>(fresh);
  const [note, setNote] = useState<string | null>(null);
  const edges = useMemo(() => waitsFor(state), [state]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <Btn key={p.label} onClick={() => { setState(applyOps(p.ops)); setNote(p.note); }}>
            {p.label}
          </Btn>
        ))}
        <Btn variant="ghost" onClick={() => { setState(fresh()); setNote(null); }}>
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </Btn>
      </div>
      {note && <Explain>{note}</Explain>}

      <div className="grid gap-4 md:grid-cols-3">
        {TXS.map((tx) => {
          const st = state.status[tx];
          const held = RESOURCES.flatMap((r) => state.held[r].filter((h) => h.tx === tx).map((h) => `${h.mode}(${r.replace("row ", "")})`));
          const waiting = RESOURCES.flatMap((r) => state.queue[r].filter((w) => w.tx === tx).map((w) => `${w.mode}(${r.replace("row ", "")})`));
          return (
            <Panel
              key={tx}
              title={`T${tx}`}
              right={<span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", st === "active" && "bg-accent/15 text-accent", st === "waiting" && "bg-warn/15 text-warn", st === "committed" && "bg-ok/15 text-ok", st === "aborted" && "bg-bad/15 text-bad")}>{st}</span>}
            >
              <div className="mb-2 text-[12px] text-muted">
                holds: <span className="font-mono text-fg">{held.join(" ") || "—"}</span>
                {waiting.length > 0 && (
                  <>
                    {" "}
                    · waiting: <span className="font-mono text-warn">{waiting.join(" ")}</span>
                  </>
                )}
              </div>
              <div className="grid grid-cols-3 gap-1">
                {RESOURCES.map((r) =>
                  (["S", "X"] as Mode[]).map((m) => (
                    <button key={r + m} type="button" disabled={st !== "active"} onClick={() => setState((s) => request(s, tx, r, m))} className="rounded-md border border-border px-1.5 py-1 font-mono text-[11.5px] text-muted hover:border-accent hover:text-fg disabled:opacity-40">
                      {m}·{r.replace("row ", "")}
                    </button>
                  )),
                )}
              </div>
              <div className="mt-2 flex gap-1.5">
                <Btn onClick={() => setState((s) => finish(s, tx, "committed"))} disabled={st === "committed" || st === "aborted"}>
                  Commit
                </Btn>
                <Btn variant="ghost" onClick={() => setState((s) => finish(s, tx, "aborted"))} disabled={st === "committed" || st === "aborted"}>
                  Abort
                </Btn>
              </div>
            </Panel>
          );
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_300px]">
        <Panel title="Lock table">
          <table className="w-full font-mono text-[12.5px]">
            <thead className="text-left text-[11px] text-subtle">
              <tr>
                <th className="pb-1">resource</th>
                <th>granted</th>
                <th>wait queue (FIFO)</th>
              </tr>
            </thead>
            <tbody>
              {RESOURCES.map((r) => (
                <tr key={r} className="border-t border-border">
                  <td className="py-1.5">{r}</td>
                  <td className="text-ok">{state.held[r].map((h) => `T${h.tx}:${h.mode}`).join(", ") || "—"}</td>
                  <td className="text-warn">{state.queue[r].map((w) => `T${w.tx}:${w.mode}`).join(" → ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11.5px] text-subtle">S is compatible only with S. X conflicts with everything. Locks are held until commit/abort (strict 2PL).</p>
        </Panel>
        <Panel title="Waits-for graph">
          <svg viewBox="0 0 280 180" className="w-full" role="img" aria-label="Waits-for graph">
            <defs>
              <marker id="wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="var(--warn)" />
              </marker>
            </defs>
            {edges.map(([a, b], i) => {
              const [x1, y1] = POS[a];
              const [x2, y2] = POS[b];
              const dx = x2 - x1;
              const dy = y2 - y1;
              const len = Math.hypot(dx, dy);
              const ox = (dx / len) * 22;
              const oy = (dy / len) * 22;
              const bend = edges.some(([c, d]) => c === b && d === a) ? 14 : 0;
              const mx = (x1 + x2) / 2 - (dy / len) * bend;
              const my = (y1 + y2) / 2 + (dx / len) * bend;
              return <path key={i} d={`M${x1 + ox},${y1 + oy} Q${mx},${my} ${x2 - ox},${y2 - oy}`} stroke="var(--warn)" strokeWidth={2} fill="none" markerEnd="url(#wf-arrow)" />;
            })}
            {TXS.map((tx) => (
              <g key={tx}>
                <circle cx={POS[tx][0]} cy={POS[tx][1]} r={20} fill="var(--surface-2)" stroke={state.status[tx] === "aborted" ? "var(--bad)" : state.status[tx] === "waiting" ? "var(--warn)" : "var(--border-strong)"} strokeWidth={2} />
                <text x={POS[tx][0]} y={POS[tx][1] + 4} textAnchor="middle" fontSize="12" fontWeight={600} fill="var(--fg)">
                  T{tx}
                </text>
              </g>
            ))}
          </svg>
          <p className="text-[11.5px] text-subtle">An arrow Tᵢ → Tⱼ means Tᵢ waits for Tⱼ. A cycle is a deadlock. Deadlocks so far: {state.deadlocks}.</p>
        </Panel>
      </div>

      <Panel title="Event log">
        <ol className="max-h-48 space-y-0.5 overflow-y-auto text-[12.5px] thin-scroll">
          {[...state.log].reverse().map((l, i) => (
            <li key={state.log.length - i} className={cn(l.tone === "bad" && "text-bad", l.tone === "good" && "text-ok", l.tone === "warn" && "text-warn", !l.tone && "text-muted")}>
              {l.text}
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
