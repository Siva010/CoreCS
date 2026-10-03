"use client";
import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Btn, Explain, Field, NumberInput, Panel, Select } from "../ui";
import { cn } from "@/lib/utils";

interface Edge {
  kind: "request" | "assign";
  p: number;
  r: number;
}

const P_POS = [
  { x: 110, y: 60 },
  { x: 110, y: 170 },
  { x: 110, y: 280 },
];
const R_POS = [
  { x: 390, y: 60 },
  { x: 390, y: 170 },
  { x: 390, y: 280 },
];

const PRESETS: { label: string; instances: number[]; edges: Edge[]; note: string }[] = [
  {
    label: "Two-lock deadlock",
    instances: [1, 1, 1],
    edges: [
      { kind: "assign", p: 0, r: 0 },
      { kind: "request", p: 0, r: 1 },
      { kind: "assign", p: 1, r: 1 },
      { kind: "request", p: 1, r: 0 },
    ],
    note: "P0 holds R0 and wants R1; P1 holds R1 and wants R0.",
  },
  {
    label: "Cycle, but no deadlock",
    instances: [2, 1, 1],
    edges: [
      { kind: "assign", p: 0, r: 0 },
      { kind: "assign", p: 2, r: 0 },
      { kind: "request", p: 0, r: 1 },
      { kind: "assign", p: 1, r: 1 },
      { kind: "request", p: 1, r: 0 },
    ],
    note: "R0 has two instances. P2 (outside the cycle) holds one and will release it, so P1 can proceed.",
  },
  {
    label: "Three-way chain",
    instances: [1, 1, 1],
    edges: [
      { kind: "assign", p: 0, r: 0 },
      { kind: "request", p: 0, r: 1 },
      { kind: "assign", p: 1, r: 1 },
      { kind: "request", p: 1, r: 2 },
      { kind: "assign", p: 2, r: 2 },
      { kind: "request", p: 2, r: 0 },
    ],
    note: "The dining-philosophers shape with three parties.",
  },
  { label: "Empty", instances: [1, 1, 1], edges: [], note: "Build your own graph." },
];

/** Graph reduction: repeatedly let a process whose requests can all be satisfied finish and release. */
function analyze(instances: number[], edges: Edge[]) {
  const held = [0, 1, 2].map((p) => [0, 1, 2].map((r) => edges.filter((e) => e.kind === "assign" && e.p === p && e.r === r).length));
  const wants = [0, 1, 2].map((p) => [0, 1, 2].map((r) => edges.filter((e) => e.kind === "request" && e.p === p && e.r === r).length));
  const allocated = [0, 1, 2].map((r) => held.reduce((s, h) => s + h[r], 0));
  let avail = instances.map((n, r) => n - allocated[r]);
  const active = [0, 1, 2].map((p) => held[p].some((x) => x > 0) || wants[p].some((x) => x > 0));
  const done = active.map((a) => !a);
  const order: number[] = [];
  let progress = true;
  while (progress) {
    progress = false;
    for (let p = 0; p < 3; p++) {
      if (done[p]) continue;
      if (wants[p].every((w, r) => w <= avail[r])) {
        avail = avail.map((a, r) => a + held[p][r]);
        done[p] = true;
        order.push(p);
        progress = true;
      }
    }
  }
  const deadlocked = [0, 1, 2].filter((p) => !done[p]);
  // cycle detection on the RAG (directed: P->R request, R->P assign)
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const [a, b] = e.kind === "request" ? [`P${e.p}`, `R${e.r}`] : [`R${e.r}`, `P${e.p}`];
    adj.set(a, [...(adj.get(a) ?? []), b]);
  }
  let cycle: string[] | null = null;
  const color = new Map<string, number>();
  const stack: string[] = [];
  const dfs = (u: string): boolean => {
    color.set(u, 1);
    stack.push(u);
    for (const v of adj.get(u) ?? []) {
      if (color.get(v) === 1) {
        cycle = [...stack.slice(stack.indexOf(v)), v];
        return true;
      }
      if (!color.get(v) && dfs(v)) return true;
    }
    stack.pop();
    color.set(u, 2);
    return false;
  };
  for (const u of adj.keys()) if (!color.get(u) && dfs(u)) break;
  const overAllocated = allocated.some((a, r) => a > instances[r]);
  return { deadlocked, order, cycle: cycle as string[] | null, overAllocated };
}

export default function DeadlockGraph() {
  const [instances, setInstances] = useState(PRESETS[0].instances);
  const [edges, setEdges] = useState<Edge[]>(PRESETS[0].edges);
  const [note, setNote] = useState(PRESETS[0].note);
  const [kind, setKind] = useState<"request" | "assign">("request");
  const [p, setP] = useState("0");
  const [r, setR] = useState("0");
  const a = useMemo(() => analyze(instances, edges), [instances, edges]);
  const onCycle = (x: string) => a.cycle?.includes(x) ?? false;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((pr) => (
          <Btn key={pr.label} onClick={() => { setInstances(pr.instances); setEdges(pr.edges); setNote(pr.note); }}>
            {pr.label}
          </Btn>
        ))}
      </div>
      <p className="text-[12.5px] text-subtle">{note}</p>
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="overflow-x-auto rounded-xl border border-border bg-surface p-2 thin-scroll">
          <svg viewBox="0 0 500 340" className="w-full min-w-[420px]" role="img" aria-label="Resource allocation graph">
            <defs>
              {["req", "asg", "cyc"].map((id) => (
                <marker key={id} id={`m-${id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill={id === "cyc" ? "var(--bad)" : id === "req" ? "var(--warn)" : "var(--muted)"} />
                </marker>
              ))}
            </defs>
            {edges.map((e, i) => {
              const P = P_POS[e.p];
              const R = R_POS[e.r];
              const cyc = a.cycle && (e.kind === "request" ? a.cycle.join(">").includes(`P${e.p}>R${e.r}`) : a.cycle.join(">").includes(`R${e.r}>P${e.p}`));
              const [x1, y1, x2, y2] = e.kind === "request" ? [P.x + 28, P.y, R.x - 30, R.y] : [R.x - 30, R.y, P.x + 28, P.y];
              const off = e.kind === "request" ? -8 : 8;
              return (
                <line
                  key={i}
                  x1={x1}
                  y1={y1 + off}
                  x2={x2}
                  y2={y2 + off}
                  stroke={cyc ? "var(--bad)" : e.kind === "request" ? "var(--warn)" : "var(--muted)"}
                  strokeWidth={cyc ? 2.5 : 1.6}
                  strokeDasharray={e.kind === "request" ? "6 4" : undefined}
                  markerEnd={`url(#m-${cyc ? "cyc" : e.kind === "request" ? "req" : "asg"})`}
                />
              );
            })}
            {P_POS.map((pos, i) => (
              <g key={`p${i}`}>
                <circle cx={pos.x} cy={pos.y} r={28} fill={a.deadlocked.includes(i) ? "color-mix(in oklab, var(--bad) 15%, var(--surface))" : "var(--surface-2)"} stroke={onCycle(`P${i}`) ? "var(--bad)" : "var(--border-strong)"} strokeWidth={2} />
                <text x={pos.x} y={pos.y + 5} textAnchor="middle" fontSize="14" fontWeight="600" fill="var(--fg)">P{i}</text>
              </g>
            ))}
            {R_POS.map((pos, i) => (
              <g key={`r${i}`}>
                <rect x={pos.x - 30} y={pos.y - 26} width={60} height={52} rx={6} fill="var(--surface-2)" stroke={onCycle(`R${i}`) ? "var(--bad)" : "var(--border-strong)"} strokeWidth={2} />
                <text x={pos.x} y={pos.y - 7} textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--fg)">R{i}</text>
                {Array.from({ length: instances[i] }, (_, k) => (
                  <circle key={k} cx={pos.x - (instances[i] - 1) * 7 + k * 14} cy={pos.y + 11} r={4.5} fill="var(--accent)" />
                ))}
              </g>
            ))}
            <text x={250} y={330} textAnchor="middle" fontSize="11" fill="var(--subtle)">dashed = request (P → R) · solid = assignment (R → P) · dots = instances</text>
          </svg>
        </div>
        <div className="space-y-3">
          <Panel title="Edit graph">
            <div className="grid grid-cols-3 gap-2">
              <Field label="Edge">
                <Select value={kind} onChange={setKind} options={[{ value: "request", label: "P requests R" }, { value: "assign", label: "R held by P" }]} />
              </Field>
              <Field label="Process">
                <Select value={p} onChange={setP} options={[0, 1, 2].map((i) => ({ value: String(i), label: `P${i}` }))} />
              </Field>
              <Field label="Resource">
                <Select value={r} onChange={setR} options={[0, 1, 2].map((i) => ({ value: String(i), label: `R${i}` }))} />
              </Field>
            </div>
            <Btn variant="primary" className="mt-2 w-full" onClick={() => setEdges((es) => [...es, { kind, p: Number(p), r: Number(r) }])}>
              Add edge
            </Btn>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-muted">
              Instances:
              {[0, 1, 2].map((i) => (
                <label key={i} className="flex items-center gap-1 font-mono">
                  R{i}
                  <NumberInput value={instances[i]} min={1} max={4} onChange={(v) => setInstances(instances.map((x, k) => (k === i ? Math.max(1, Math.min(4, v)) : x)))} className="w-14" />
                </label>
              ))}
            </div>
            <ul className="mt-3 max-h-32 space-y-1 overflow-y-auto text-[12px] thin-scroll">
              {edges.map((e, i) => (
                <li key={i} className="flex items-center justify-between font-mono">
                  {e.kind === "request" ? `P${e.p} → R${e.r} (request)` : `R${e.r} → P${e.p} (held)`}
                  <button type="button" aria-label="Remove edge" onClick={() => setEdges((es) => es.filter((_, k) => k !== i))} className="text-subtle hover:text-bad">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
      {a.overAllocated ? (
        <Explain tone="bad">More assignment edges than instances for some resource — that state can&apos;t exist.</Explain>
      ) : a.deadlocked.length ? (
        <Explain tone="bad">
          Deadlock: {a.deadlocked.map((x) => `P${x}`).join(", ")} can never proceed. Cycle: {a.cycle?.join(" → ")}. Every resource on the cycle has its instances held by
          processes that are themselves waiting.
        </Explain>
      ) : a.cycle ? (
        <Explain tone="warn">
          There is a cycle ({a.cycle.join(" → ")}) but no deadlock: reduction order {a.order.map((x) => `P${x}`).join(" → ")} lets every process finish. With multi-instance
          resources, a cycle is necessary but not sufficient.
        </Explain>
      ) : (
        <Explain tone="good">No cycle → no deadlock. {a.order.length ? `Processes can finish in the order ${a.order.map((x) => `P${x}`).join(" → ")}.` : ""}</Explain>
      )}
    </div>
  );
}
