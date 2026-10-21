// Routing algorithms for the Routing Algorithms lab: Dijkstra step by step,
// synchronous distance-vector (Bellman-Ford) rounds, and count-to-infinity on
// a line of three routers with and without split horizon / poison reverse.
// Pure functions, checkable with tsx.

export interface Edge {
  a: string;
  b: string;
  cost: number;
}

export interface Graph {
  nodes: string[];
  edges: Edge[];
}

export const INF = Number.POSITIVE_INFINITY;

const neighbours = (g: Graph, n: string) =>
  g.edges.filter((e) => e.a === n || e.b === n).map((e) => ({ node: e.a === n ? e.b : e.a, cost: e.cost }));

export interface DijkstraStep {
  settled: string | null; // node settled in this step (null for the initial state)
  dist: Record<string, number>;
  prev: Record<string, string | null>;
  done: string[]; // all settled nodes so far
  relaxed: string[]; // neighbours whose distance improved in this step
}

export function dijkstraSteps(g: Graph, src: string): DijkstraStep[] {
  const dist: Record<string, number> = Object.fromEntries(g.nodes.map((n) => [n, n === src ? 0 : INF]));
  const prev: Record<string, string | null> = Object.fromEntries(g.nodes.map((n) => [n, null]));
  const done: string[] = [];
  const steps: DijkstraStep[] = [{ settled: null, dist: { ...dist }, prev: { ...prev }, done: [], relaxed: [] }];
  while (done.length < g.nodes.length) {
    const u = g.nodes.filter((n) => !done.includes(n)).sort((x, y) => dist[x] - dist[y] || x.localeCompare(y))[0];
    if (dist[u] === INF) break;
    done.push(u);
    const relaxed: string[] = [];
    for (const { node, cost } of neighbours(g, u)) {
      if (done.includes(node)) continue;
      if (dist[u] + cost < dist[node]) {
        dist[node] = dist[u] + cost;
        prev[node] = u;
        relaxed.push(node);
      }
    }
    steps.push({ settled: u, dist: { ...dist }, prev: { ...prev }, done: [...done], relaxed });
  }
  return steps;
}

/** The first hop from src on the shortest path to dst (src's forwarding-table entry). */
export function firstHop(prev: Record<string, string | null>, src: string, dst: string): string | null {
  if (dst === src) return null;
  let cur = dst;
  for (let guard = 0; guard < 100; guard++) {
    const p = prev[cur];
    if (p === null) return null;
    if (p === src) return cur;
    cur = p;
  }
  return null;
}

export type Vector = Record<string, { dist: number; via: string | null }>;

/** Synchronous distance-vector rounds until nothing changes; round 0 = each router knows only its links. */
export function dvRounds(g: Graph, maxRounds = 20): Record<string, Vector>[] {
  const init: Record<string, Vector> = {};
  for (const n of g.nodes) {
    init[n] = Object.fromEntries(g.nodes.map((d) => [d, { dist: d === n ? 0 : INF, via: d === n ? n : null }]));
    for (const { node, cost } of neighbours(g, n)) init[n][node] = { dist: cost, via: node };
  }
  const rounds = [init];
  for (let r = 0; r < maxRounds; r++) {
    const last = rounds[rounds.length - 1];
    const next: Record<string, Vector> = {};
    let changed = false;
    for (const n of g.nodes) {
      next[n] = {};
      for (const d of g.nodes) {
        if (d === n) {
          next[n][d] = { dist: 0, via: n };
          continue;
        }
        let best = { dist: INF, via: null as string | null };
        for (const { node, cost } of neighbours(g, n)) {
          const through = cost + last[node][d].dist;
          if (through < best.dist) best = { dist: through, via: node };
        }
        next[n][d] = best;
        if (best.dist !== last[n][d].dist || best.via !== last[n][d].via) changed = true;
      }
    }
    if (!changed) break;
    rounds.push(next);
  }
  return rounds;
}

export type DvFix = "none" | "split-horizon" | "poison-reverse";

export interface CountRow {
  step: number;
  who: "both" | "A" | "B"; // which router just updated
  note: string;
  a: number; // A's distance to C
  aVia: string | null;
  b: number; // B's distance to C
  bVia: string | null;
}

/**
 * A — B — C with cost 1 per link, converged; then the B–C link fails. B and A
 * take turns recomputing their distance to C from the other's latest
 * advertisement, as in the lesson's table. 16 counts as infinity (as in RIP).
 */
export function countToInfinity(fix: DvFix, infinity = 16): CountRow[] {
  let a = { dist: 2, via: "B" as string | null };
  let b = { dist: 1, via: "C" as string | null };
  const rows: CountRow[] = [{ step: 0, who: "both", note: "converged before the failure", a: a.dist, aVia: a.via, b: b.dist, bVia: b.via }];
  // what a router tells neighbour `to` about its route to C
  const advertised = (from: { dist: number; via: string | null }, to: string): number | null => {
    if (from.via === to && fix === "split-horizon") return null; // says nothing about C
    if (from.via === to && fix === "poison-reverse") return infinity;
    return from.dist;
  };
  const via = (adv: number | null, through: string) =>
    adv === null || 1 + adv >= infinity ? { dist: infinity, via: null } : { dist: 1 + adv, via: through };
  for (let step = 1; step < 40; step++) {
    if (step % 2 === 1) {
      const adv = advertised(a, "B");
      b = via(adv, "A");
      const told = adv === null ? "A says nothing about C (split horizon)" : `A advertises C at ${adv >= infinity ? "∞" : adv}`;
      rows.push({ step, who: "B", note: step === 1 ? `B's link to C fails; ${told}` : told, a: a.dist, aVia: a.via, b: b.dist, bVia: b.via });
    } else {
      const adv = advertised(b, "A");
      a = via(adv, "B");
      const told = adv === null ? "B says nothing about C (split horizon)" : `B advertises C at ${adv >= infinity ? "∞" : adv}`;
      rows.push({ step, who: "A", note: told, a: a.dist, aVia: a.via, b: b.dist, bVia: b.via });
    }
    if (a.dist >= infinity && b.dist >= infinity) break;
  }
  return rows;
}

/** The lesson's network: A–B 2, A–C 3, B–C 2, B–D 3, C–D 1, C–E 6, D–E 2. */
export const LESSON_GRAPH: Graph = {
  nodes: ["A", "B", "C", "D", "E"],
  edges: [
    { a: "A", b: "B", cost: 2 },
    { a: "A", b: "C", cost: 3 },
    { a: "B", b: "C", cost: 2 },
    { a: "B", b: "D", cost: 3 },
    { a: "C", b: "D", cost: 1 },
    { a: "C", b: "E", cost: 6 },
    { a: "D", b: "E", cost: 2 },
  ],
};
