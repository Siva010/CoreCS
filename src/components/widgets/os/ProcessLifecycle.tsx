"use client";
import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Btn, Explain, Panel } from "../ui";
import { cn } from "@/lib/utils";

type State = "new" | "ready" | "running" | "blocked" | "zombie" | "gone";
type Event = "admit" | "dispatch" | "preempt" | "block" | "wake" | "exit" | "reap" | "parent-exit";

const POS: Record<Exclude<State, "gone">, { x: number; y: number; label: string }> = {
  new: { x: 70, y: 70, label: "New" },
  ready: { x: 250, y: 70, label: "Ready" },
  running: { x: 450, y: 70, label: "Running" },
  blocked: { x: 350, y: 205, label: "Blocked" },
  zombie: { x: 610, y: 70, label: "Zombie" },
};

const TRANSITIONS: Record<Event, { from: State; to: State; label: string; explain: string }> = {
  admit: { from: "new", to: "ready", label: "Admit", explain: "The kernel finished building the PCB and address space; the process joins the run queue." },
  dispatch: { from: "ready", to: "running", label: "Dispatch (scheduler)", explain: "The scheduler picked this process; the dispatcher restored its saved registers and switched to its address space." },
  preempt: { from: "running", to: "ready", label: "Timer interrupt (preempt)", explain: "Its time slice expired. The kernel saved its registers into the PCB and put it back on the run queue — involuntary switch." },
  block: { from: "running", to: "blocked", label: "read() on empty socket", explain: "It made a blocking system call. The kernel parked it on the socket's wait queue and ran something else — voluntary switch. It uses no CPU while blocked." },
  wake: { from: "blocked", to: "ready", label: "Data arrives (interrupt)", explain: "The NIC interrupt handler queued the data and woke the waiters: the process moves to the run queue. It is eligible — not yet running." },
  exit: { from: "running", to: "zombie", label: "exit(0)", explain: "The kernel freed its memory and closed its files, sent SIGCHLD to the parent, and kept a tiny record with the exit status: a zombie." },
  reap: { from: "zombie", to: "gone", label: "Parent calls wait()", explain: "The parent collected the exit status; the PID and process-table entry are released." },
  "parent-exit": { from: "new", to: "new", label: "Parent exits", explain: "" },
};

const INVALID: Partial<Record<Event, Partial<Record<State, string>>>> = {
  block: {
    ready: "A Ready process isn't executing, so it can't make a blocking system call. Only Running → Blocked exists.",
    blocked: "It's already blocked.",
    new: "It hasn't started running yet.",
  },
  dispatch: {
    blocked: "Blocked → Running is impossible: when the event arrives, the process only becomes Ready. The scheduler decides when it runs.",
    running: "It's already running.",
    new: "It must be admitted to the ready queue first.",
    zombie: "A zombie has no code left to run — only an exit status.",
  },
  wake: { ready: "Nothing to wake: it isn't waiting for an event.", running: "It's running, not waiting.", new: "It isn't waiting for anything." },
  preempt: { ready: "Only the running process can be preempted.", blocked: "A blocked process isn't on a CPU to take away." },
  exit: { ready: "A process exits by executing exit() (or being killed while it runs its signal delivery path) — here, it must be running.", blocked: "It must be running to call exit(). (A kill signal would wake it first.)" },
  reap: { running: "wait() only reaps children that have already exited.", ready: "Not exited yet.", blocked: "Not exited yet.", new: "Not exited yet." },
  admit: { ready: "Already admitted." },
};

interface Log {
  ok: boolean;
  text: string;
}

const HALF_W = 52;
const HALF_H = 22;

/** Point where the ray from a node's center toward (tx, ty) leaves its rectangle. */
function clip(c: { x: number; y: number }, tx: number, ty: number) {
  const dx = tx - c.x;
  const dy = ty - c.y;
  const s = Math.min(HALF_W / Math.max(Math.abs(dx), 1e-9), HALF_H / Math.max(Math.abs(dy), 1e-9));
  return { x: c.x + dx * s, y: c.y + dy * s };
}

function edgePath(A: { x: number; y: number }, B: { x: number; y: number }, bend: number) {
  const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
  const px = -(B.y - A.y) / len;
  const py = (B.x - A.x) / len;
  const mx = (A.x + B.x) / 2 + px * bend;
  const my = (A.y + B.y) / 2 + py * bend;
  const s = clip(A, mx, my);
  const e = clip(B, mx, my);
  return { d: `M${s.x},${s.y} Q${mx},${my} ${e.x},${e.y}`, lx: mx, ly: my };
}

export default function ProcessLifecycle() {
  const [state, setState] = useState<State>("new");
  const [ppid, setPpid] = useState(3990);
  const [lastEdge, setLastEdge] = useState<[State, State] | null>(null);
  const [pc, setPc] = useState(0x401000);
  const [cpu, setCpu] = useState(0);
  const [log, setLog] = useState<Log[]>([{ ok: true, text: "fork() created PID 4121 (child of the shell, PID 3990). State: New." }]);

  const queue =
    state === "ready" ? "CPU 0 run queue" : state === "running" ? "on CPU 0" : state === "blocked" ? "socket wait queue" : state === "zombie" ? "— (awaiting reap)" : "—";

  function fire(ev: Event) {
    if (ev === "parent-exit") {
      if (ppid === 1) return;
      setPpid(1);
      if (state === "zombie") {
        setState("gone");
        setLog((l) => [{ ok: true, text: "Parent exited. The zombie was re-parented to PID 1 (init), which reaped it immediately." }, ...l]);
      } else {
        setLog((l) => [{ ok: true, text: "Parent exited while the child was alive → the child is now an orphan, re-parented to PID 1, which will reap it when it exits." }, ...l]);
      }
      return;
    }
    const t = TRANSITIONS[ev];
    if (state === "gone") return;
    if (t.from !== state) {
      const why = INVALID[ev]?.[state] ?? `Not possible from ${state}.`;
      setLog((l) => [{ ok: false, text: `✗ ${t.label}: ${why}` }, ...l]);
      return;
    }
    if (ev === "preempt" || ev === "block" || ev === "exit") {
      setPc((p) => p + 0x40 + Math.floor(Math.random() * 0x80));
      setCpu((c) => c + 1 + Math.floor(Math.random() * 3));
    }
    if (ev === "reap" && ppid === 1) {
      setLog((l) => [{ ok: true, text: "init (PID 1) reaped the orphan." }, ...l]);
    }
    setLastEdge([t.from, t.to]);
    setState(t.to);
    setLog((l) => [{ ok: true, text: `✓ ${t.label}: ${t.explain}` }, ...l]);
  }

  const reset = () => {
    setState("new");
    setPpid(3990);
    setLastEdge(null);
    setPc(0x401000);
    setCpu(0);
    setLog([{ ok: true, text: "fork() created PID 4121 (child of the shell, PID 3990). State: New." }]);
  };

  const edges: [State, State, string][] = [
    ["new", "ready", "admit"],
    ["ready", "running", "dispatch"],
    ["running", "ready", "preempt"],
    ["running", "blocked", "wait for I/O"],
    ["blocked", "ready", "I/O done"],
    ["running", "zombie", "exit"],
  ];

  const pt = (s: State) => POS[s as Exclude<State, "gone">];

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-xl border border-border bg-surface p-2 thin-scroll">
        <svg viewBox="0 0 700 270" className="w-full min-w-[560px]" role="img" aria-label="Process state diagram">
          <defs>
            <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" />
            </marker>
            <marker id="arrOn" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
            </marker>
          </defs>
          {edges.map(([a, b, label]) => {
            const A = pt(a);
            const B = pt(b);
            const on = lastEdge && lastEdge[0] === a && lastEdge[1] === b;
            // ready<->running are drawn as two curves bending to opposite sides
            const bend = (a === "ready" && b === "running") || (a === "running" && b === "ready") ? 26 : 0;
            const { d, lx, ly } = edgePath(A, B, bend);
            return (
              <g key={`${a}-${b}`}>
                <path d={d} fill="none" stroke={on ? "var(--accent)" : "var(--border-strong)"} strokeWidth={on ? 2.5 : 1.5} markerEnd={on ? "url(#arrOn)" : "url(#arr)"} />
                <text x={lx} y={ly - 5} textAnchor="middle" fontSize="11" fill={on ? "var(--accent)" : "var(--muted)"} paintOrder="stroke" stroke="var(--surface)" strokeWidth={4}>
                  {label}
                </text>
              </g>
            );
          })}
          {(Object.keys(POS) as Exclude<State, "gone">[]).map((s) => {
            const p = POS[s];
            const active = state === s;
            return (
              <g key={s}>
                <rect
                  x={p.x - 52}
                  y={p.y - 22}
                  width={104}
                  height={44}
                  rx={12}
                  fill={active ? "color-mix(in oklab, var(--accent) 18%, var(--surface))" : "var(--surface-2)"}
                  stroke={active ? "var(--accent)" : "var(--border-strong)"}
                  strokeWidth={active ? 2.5 : 1}
                />
                <text x={p.x} y={p.y + 5} textAnchor="middle" fontSize="14" fontWeight={active ? 700 : 500} fill="var(--fg)">
                  {p.label}
                </text>
              </g>
            );
          })}
          {state === "gone" && (
            <text x={610} y={140} textAnchor="middle" fontSize="12" fill="var(--ok)">
              reaped — PID freed
            </text>
          )}
        </svg>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <Panel title="Events" right={<Btn variant="ghost" onClick={reset}><RotateCcw className="h-3.5 w-3.5" /> Reset</Btn>}>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(TRANSITIONS) as Event[]).map((ev) => (
              <Btn key={ev} onClick={() => fire(ev)} variant={ev !== "parent-exit" && TRANSITIONS[ev].from === state ? "primary" : "default"}>
                {TRANSITIONS[ev].label}
              </Btn>
            ))}
          </div>
          <p className="mt-2 text-[12px] text-subtle">Highlighted buttons are legal from the current state — try the others to see why they aren&apos;t.</p>
          <ol className="mt-3 max-h-52 space-y-1.5 overflow-y-auto pr-1 thin-scroll">
            {log.map((l, i) => (
              <li key={log.length - i} className={cn("text-[13px]", i === 0 ? "text-fg" : "text-muted", !l.ok && "text-bad")}>
                {l.text}
              </li>
            ))}
          </ol>
        </Panel>
        <Panel title="PCB (task_struct excerpt)">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 font-mono text-[12.5px]">
            <dt className="text-subtle">PID</dt>
            <dd>4121</dd>
            <dt className="text-subtle">PPID</dt>
            <dd className={cn(ppid === 1 && "text-warn")}>{ppid}{ppid === 1 ? " (init)" : " (shell)"}</dd>
            <dt className="text-subtle">state</dt>
            <dd className="text-accent">{state === "gone" ? "(freed)" : state.toUpperCase()}</dd>
            <dt className="text-subtle">saved PC</dt>
            <dd>{state === "running" ? "(live in CPU)" : `0x${pc.toString(16)}`}</dd>
            <dt className="text-subtle">queue</dt>
            <dd>{queue}</dd>
            <dt className="text-subtle">CPU time</dt>
            <dd>{cpu} ms</dd>
            <dt className="text-subtle">memory</dt>
            <dd>{state === "zombie" || state === "gone" ? "released" : "mapped"}</dd>
          </dl>
          {state === "zombie" && <div className="mt-3"><Explain tone="warn">Zombie: holds only a PID and exit status until the parent calls wait().</Explain></div>}
        </Panel>
      </div>
    </div>
  );
}
