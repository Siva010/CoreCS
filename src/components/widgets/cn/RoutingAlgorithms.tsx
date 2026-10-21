"use client";
import { useMemo, useState } from "react";
import { INF, LESSON_GRAPH, countToInfinity, dijkstraSteps, dvRounds, firstHop, type DvFix, type Graph } from "@/lib/sim/routingAlgo";
import { Btn, Explain, NumberInput, Panel, Segmented, Select, Stat, StepControls, useStepper } from "../ui";
import { cn } from "@/lib/utils";

type Tab = "dijkstra" | "dv" | "count";
interface EdgeState {
  a: string;
  b: string;
  cost: number;
  up: boolean;
}

const POS: Record<string, { x: number; y: number }> = {
  A: { x: 40, y: 110 },
  B: { x: 150, y: 38 },
  C: { x: 150, y: 182 },
  D: { x: 262, y: 100 },
  E: { x: 352, y: 182 },
};

const INITIAL: EdgeState[] = LESSON_GRAPH.edges.map((e) => ({ ...e, up: true }));
const show = (d: number) => (d === INF ? "∞" : String(d));
const key = (a: string, b: string) => [a, b].sort().join("");

function GraphView({
  edges,
  tree,
  tentative,
  settled,
  current,
  labels,
  onEdge,
}: {
  edges: EdgeState[];
  tree?: Set<string>;
  tentative?: Set<string>;
  settled?: Set<string>;
  current?: string | null;
  labels?: Record<string, string>;
  onEdge?: (i: number) => void;
}) {
  return (
    <svg viewBox="0 0 392 226" className="mx-auto block w-full max-w-[520px]" role="img" aria-label="Network graph">
      {edges.map((e, i) => {
        const p = POS[e.a];
        const q = POS[e.b];
        const k = key(e.a, e.b);
        const inTree = tree?.has(k);
        const tent = tentative?.has(k);
        const mx = (p.x + q.x) / 2;
        const my = (p.y + q.y) / 2;
        return (
          <g key={i} onClick={() => onEdge?.(i)} className={onEdge ? "cursor-pointer" : undefined}>
            <title>{onEdge ? `${e.a}–${e.b}: click to ${e.up ? "fail" : "restore"} this link` : `${e.a}–${e.b}`}</title>
            <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="transparent" strokeWidth={14} />
            <line
              x1={p.x}
              y1={p.y}
              x2={q.x}
              y2={q.y}
              stroke={!e.up ? "var(--bad)" : inTree ? "var(--accent)" : tent ? "var(--warn)" : "var(--border-strong)"}
              strokeWidth={inTree ? 3.5 : tent ? 2.5 : 1.5}
              strokeDasharray={!e.up ? "4 4" : tent ? "6 3" : undefined}
              strokeOpacity={!e.up ? 0.6 : 1}
            />
            <rect x={mx - 11} y={my - 10} width={22} height={19} rx={4} fill="var(--surface)" stroke="var(--border)" />
            <text x={mx} y={my + 4.5} textAnchor="middle" fontSize={13} fontFamily="var(--font-mono)" fill={e.up ? "var(--fg)" : "var(--bad)"}>
              {e.up ? e.cost : "✕"}
            </text>
          </g>
        );
      })}
      {Object.entries(POS).map(([n, p]) => {
        const done = settled?.has(n);
        const cur = current === n;
        return (
          <g key={n}>
            <circle
              cx={p.x}
              cy={p.y}
              r={17}
              fill={cur ? "var(--accent)" : done ? "color-mix(in oklab, var(--accent) 22%, var(--surface))" : "var(--surface)"}
              stroke={cur || done ? "var(--accent)" : "var(--border-strong)"}
              strokeWidth={cur ? 2.5 : 1.5}
            />
            <text x={p.x} y={p.y + 5.5} textAnchor="middle" fontSize={15} fontWeight={600} fill={cur ? "var(--surface)" : "var(--fg)"}>
              {n}
            </text>
            {labels?.[n] !== undefined && (
              <text x={p.x} y={p.y + (p.y < 110 ? -24 : 35)} textAnchor="middle" fontSize={13.5} fontWeight={600} fontFamily="var(--font-mono)" fill="var(--accent)">
                {labels[n]}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function DijkstraTab({ edges, graph, onEdge }: { edges: EdgeState[]; graph: Graph; onEdge: (i: number) => void }) {
  const [src, setSrc] = useState("A");
  const steps = useMemo(() => dijkstraSteps(graph, src), [graph, src]);
  const s = useStepper(steps.length, { interval: 1300 });
  const idx = Math.min(s.step, steps.length - 1);
  const st = steps[idx];
  const before = idx > 0 ? steps[idx - 1].dist : null;
  const settled = new Set(st.done);
  const tree = new Set<string>();
  const tentative = new Set<string>();
  for (const n of graph.nodes) {
    const p = st.prev[n];
    if (!p) continue;
    (settled.has(n) ? tree : tentative).add(key(p, n));
  }
  const labels = Object.fromEntries(graph.nodes.map((n) => [n, show(st.dist[n])]));
  const finished = idx === steps.length - 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[12px] font-medium text-muted">
          Source
          <Select
            value={src}
            onChange={(v) => {
              setSrc(v);
              s.reset();
            }}
            options={graph.nodes.map((n) => ({ value: n, label: n }))}
          />
        </label>
        <StepControls s={s} total={steps.length} />
      </div>
      <div className="space-y-4">
        <Panel title="Graph (click a link to fail it)">
          <GraphView edges={edges} tree={tree} tentative={tentative} settled={settled} current={st.settled} labels={labels} onEdge={(i) => {
            onEdge(i);
            s.reset();
          }} />
          <p className="mt-1 text-[12px] text-muted">
            Numbers above or below the nodes are the current distances from {src}. Solid blue links are final; dashed amber links are the best path found so far.
          </p>
        </Panel>
        <Panel title={idx === 0 ? "Start" : `Step ${idx}: settle ${st.settled}`}>
          <table className="w-full font-mono text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] tracking-wide text-subtle uppercase">
                <th className="py-1 font-medium">Node</th>
                <th className="py-1 font-medium">Distance</th>
                <th className="py-1 font-medium">Previous</th>
                <th className="py-1 font-medium">State</th>
              </tr>
            </thead>
            <tbody>
              {graph.nodes.map((n) => {
                const changed = before && before[n] !== st.dist[n];
                return (
                  <tr key={n} className={cn("border-t border-border", n === st.settled && "bg-accent/10")}>
                    <td className="py-0.5 font-semibold text-fg">{n}</td>
                    <td className={cn("py-0.5", changed ? "text-warn" : "text-fg")}>
                      {changed ? `${show(before![n])} → ${show(st.dist[n])}` : show(st.dist[n])}
                    </td>
                    <td className="py-0.5 text-muted">{st.prev[n] ?? "–"}</td>
                    <td className="py-0.5 text-muted">{settled.has(n) ? "settled" : st.dist[n] === INF ? "unseen" : "tentative"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-3">
            <Explain tone={finished ? "good" : "neutral"}>
              {idx === 0
                ? `${src} is at distance 0; every other node starts at ∞. Each step settles the closest node not yet settled: no later path can beat it, because every link cost is positive.`
                : `${st.settled} is the closest unsettled node (${show(st.dist[st.settled!])}), so its distance is final. ${
                    st.relaxed.length
                      ? `Relaxing its links improves ${st.relaxed.map((r) => `${r} to ${show(st.dist[r])}`).join(", ")}.`
                      : "None of its links improves a neighbour's distance."
                  }${finished ? " Every reachable node is settled, so the algorithm stops." : ""}`}
            </Explain>
          </div>
        </Panel>
      </div>
      {finished && (
        <Panel title={`${src}'s forwarding table`}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {graph.nodes
              .filter((n) => n !== src)
              .map((n) => {
                const hop = firstHop(st.prev, src, n);
                return <Stat key={n} label={`to ${n}`} value={st.dist[n] === INF ? "unreachable" : `via ${hop}`} sub={st.dist[n] === INF ? undefined : `cost ${st.dist[n]}`} />;
              })}
          </div>
          <p className="mt-2 text-[12px] text-muted">The router keeps only the first hop of each path: the rest of the path is the next router&apos;s job.</p>
        </Panel>
      )}
    </div>
  );
}

function DvTab({ edges, graph, onEdge }: { edges: EdgeState[]; graph: Graph; onEdge: (i: number) => void }) {
  const rounds = useMemo(() => dvRounds(graph), [graph]);
  const s = useStepper(rounds.length, { interval: 1500 });
  const idx = Math.min(s.step, rounds.length - 1);
  const cur = rounds[idx];
  const prev = idx > 0 ? rounds[idx - 1] : null;
  const changes = prev ? graph.nodes.reduce((acc, n) => acc + graph.nodes.filter((d) => prev[n][d].dist !== cur[n][d].dist || prev[n][d].via !== cur[n][d].via).length, 0) : 0;
  const finished = idx === rounds.length - 1;
  return (
    <div className="space-y-4">
      <StepControls s={s} total={rounds.length} label={idx === 0 ? "round 0: direct links only" : `after exchange ${idx}`} />
      <div className="space-y-4">
        <Panel title="Graph (click a link to fail it)">
          <GraphView edges={edges} onEdge={(i) => {
            onEdge(i);
            s.reset();
          }} />
        </Panel>
        <Panel title="Each router's distance vector (distance via next hop)">
          <div className="overflow-x-auto thin-scroll">
            <table className="w-full min-w-[340px] font-mono text-[12px]">
              <thead>
                <tr className="text-left text-[11px] text-subtle">
                  <th className="py-1 pr-2 font-medium">router ↓ to →</th>
                  {graph.nodes.map((d) => (
                    <th key={d} className="py-1 pr-2 font-medium">
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {graph.nodes.map((n) => (
                  <tr key={n} className="border-t border-border">
                    <td className="py-0.5 pr-2 font-semibold text-fg">{n}</td>
                    {graph.nodes.map((d) => {
                      const c = cur[n][d];
                      const changed = prev && (prev[n][d].dist !== c.dist || prev[n][d].via !== c.via);
                      return (
                        <td key={d} className={cn("py-0.5 pr-2", n === d ? "text-subtle" : changed ? "rounded bg-warn/15 text-fg" : "text-muted")}>
                          {n === d ? "0" : c.dist === INF ? "∞" : `${c.dist} ${c.via}`}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[12px] text-muted">&ldquo;4 C&rdquo; means distance 4, next hop C. Highlighted cells changed in this exchange.</p>
        </Panel>
      </div>
      <Explain tone={finished ? "good" : "neutral"}>
        {idx === 0
          ? "Before any exchange, each router knows only the cost of its own links. In each exchange, every router sends its vector to its neighbours and recomputes: D(x, y) = min over neighbours v of [ cost(x, v) + D(v, y) ]."
          : finished
            ? `Exchange ${idx} was the last to change anything; one more exchange changes nothing, so the network has converged. Compare A's row with the Dijkstra tab: the same costs, found without any router seeing the whole map.`
            : `Exchange ${idx}: ${changes} entr${changes === 1 ? "y" : "ies"} changed. News crosses one link per exchange: a best route k links long first appears after k − 1 exchanges, because round 0 already holds the direct links.`}
      </Explain>
    </div>
  );
}

const FIX_NOTE: Record<DvFix, string> = {
  none: "No fix: B loses its link and believes A's advertised 2, although A's route goes through B itself. Each believes the other, and the distance climbs by 1 per exchange until it reaches infinity (16, as in RIP). Meanwhile packets for C loop between A and B.",
  "split-horizon": "Split horizon: A doesn't tell B about routes it learned through B. When B's link fails, B hears nothing about C from A, so B marks C unreachable at once.",
  "poison-reverse": "Poison reverse: A tells B explicitly that C is at ∞ through A. B rejects A as a path at once, and its update poisons A in turn.",
};

function CountTab() {
  const [fix, setFix] = useState<DvFix>("none");
  const rows = useMemo(() => countToInfinity(fix), [fix]);
  const cell = (d: number, via: string | null) => (d >= 16 ? "∞ (16)" : `${d} via ${via}`);
  return (
    <div className="space-y-4">
      <Segmented
        ariaLabel="Fix"
        value={fix}
        onChange={setFix}
        options={[
          { value: "none", label: "No fix" },
          { value: "split-horizon", label: "Split horizon" },
          { value: "poison-reverse", label: "Poison reverse" },
        ]}
      />
      <Panel title="A — B — C, every link cost 1; then the B–C link fails">
        <svg viewBox="0 0 300 54" className="block w-full max-w-[320px]" role="img" aria-label="Three routers in a line">
          <line x1={40} y1={27} x2={150} y2={27} stroke="var(--border-strong)" strokeWidth={1.5} />
          <line x1={150} y1={27} x2={260} y2={27} stroke="var(--bad)" strokeWidth={1.5} strokeDasharray="4 4" />
          <text x={205} y={20} textAnchor="middle" fontSize={13} fill="var(--bad)">
            ✕
          </text>
          {[
            ["A", 40],
            ["B", 150],
            ["C", 260],
          ].map(([n, x]) => (
            <g key={n}>
              <circle cx={x} cy={27} r={16} fill="var(--surface)" stroke="var(--border-strong)" strokeWidth={1.5} />
              <text x={x} y={32} textAnchor="middle" fontSize={14} fontWeight={600} fill="var(--fg)">
                {n}
              </text>
            </g>
          ))}
        </svg>
        <div className="mt-3 overflow-x-auto thin-scroll">
          <table className="w-full min-w-[420px] font-mono text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] tracking-wide text-subtle uppercase">
                <th className="py-1 pr-3 font-medium">Step</th>
                <th className="py-1 pr-3 font-medium">What happens</th>
                <th className="py-1 pr-3 font-medium">A → C</th>
                <th className="py-1 font-medium">B → C</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.step} className="border-t border-border">
                  <td className="py-0.5 pr-3 text-subtle">{r.step}</td>
                  <td className="py-0.5 pr-3 font-sans text-[12.5px] text-muted">{r.note}</td>
                  <td className={cn("py-0.5 pr-3", r.who === "A" ? "text-warn" : "text-fg", r.a >= 16 && "text-bad")}>{cell(r.a, r.aVia)}</td>
                  <td className={cn("py-0.5", r.who === "B" ? "text-warn" : "text-fg", r.b >= 16 && "text-bad")}>{cell(r.b, r.bVia)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Exchanges to agree" value={rows.length - 1} sub="until both say ∞" />
        <Stat label="Loop while counting" value={fix === "none" ? "yes" : "no"} sub={fix === "none" ? "A sends C's packets to B, B sends them back" : "no stale route survives"} />
      </div>
      <Explain tone={fix === "none" ? "bad" : "good"}>{FIX_NOTE[fix]}</Explain>
    </div>
  );
}

export default function RoutingAlgorithms() {
  const [tab, setTab] = useState<Tab>("dijkstra");
  const [edges, setEdges] = useState<EdgeState[]>(INITIAL);
  const graph = useMemo<Graph>(() => ({ nodes: LESSON_GRAPH.nodes, edges: edges.filter((e) => e.up) }), [edges]);
  const toggleEdge = (i: number) => setEdges((es) => es.map((e, j) => (j === i ? { ...e, up: !e.up } : e)));
  const changed = edges.some((e, i) => !e.up || e.cost !== INITIAL[i].cost);

  return (
    <div className="space-y-4">
      <Segmented
        ariaLabel="View"
        value={tab}
        onChange={setTab}
        options={[
          { value: "dijkstra", label: "Dijkstra (link state)" },
          { value: "dv", label: "Distance vector" },
          { value: "count", label: "Count to infinity" },
        ]}
      />
      {tab !== "count" && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] text-muted">
          <span className="font-medium">Link costs:</span>
          {edges.map((e, i) => (
            <label key={i} className={cn("flex items-center gap-1 font-mono", !e.up && "text-bad line-through")}>
              {e.a}–{e.b}
              <NumberInput
                className="w-14"
                value={e.cost}
                min={1}
                max={20}
                onChange={(v) => setEdges((es) => es.map((x, j) => (j === i ? { ...x, cost: Math.min(20, Math.max(1, Math.round(v) || 1)) } : x)))}
              />
            </label>
          ))}
          {changed && (
            <Btn variant="ghost" onClick={() => setEdges(INITIAL)}>
              Reset to the lesson&apos;s network
            </Btn>
          )}
        </div>
      )}
      {tab === "dijkstra" ? <DijkstraTab edges={edges} graph={graph} onEdge={toggleEdge} /> : tab === "dv" ? <DvTab edges={edges} graph={graph} onEdge={toggleEdge} /> : <CountTab />}
    </div>
  );
}
