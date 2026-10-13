// Transaction schedules as textbooks write them — "R1(A) W2(A) C1 C2" — and
// the classic analyses: conflict and view serializability, recoverability,
// cascadelessness and strictness, plus basic timestamp ordering with and
// without Thomas's write rule.

export type OpKind = "R" | "W" | "C" | "A";

export interface Op {
  /** Position in the schedule (0-based). */
  i: number;
  tx: number;
  kind: OpKind;
  item?: string;
}

export interface Parsed {
  ops: Op[];
  txs: number[];
  error?: string;
}

const TOKEN = /^([rwca])\s*(\d+)\s*(?:[([]\s*([a-z]\w*)\s*[)\]])?$/i;

/** Parses "R1(A) W2(A) C1" (also r1[x], w2(x); c = commit, a = abort; separators: spaces, commas, semicolons). */
export function parseSchedule(text: string): Parsed {
  const tokens = text
    .replace(/([)\]])/g, "$1 ")
    .split(/[\s,;]+/)
    .filter(Boolean);
  const ops: Op[] = [];
  for (const t of tokens) {
    const m = TOKEN.exec(t);
    if (!m) return { ops: [], txs: [], error: `Can't read "${t}". Write operations like R1(A), W2(B), C1 (commit) or A2 (abort).` };
    const kind = m[1].toUpperCase() as OpKind;
    const tx = Number(m[2]);
    const item = m[3]?.toUpperCase();
    if ((kind === "R" || kind === "W") && !item) return { ops: [], txs: [], error: `"${t}" needs a data item, e.g. ${kind}${tx}(A).` };
    if ((kind === "C" || kind === "A") && item) return { ops: [], txs: [], error: `"${t}": commit and abort take no data item.` };
    if (ops.some((o) => o.tx === tx && (o.kind === "C" || o.kind === "A"))) return { ops: [], txs: [], error: `T${tx} has an operation after it already committed or aborted.` };
    ops.push({ i: ops.length, tx, kind, item });
  }
  const txs = [...new Set(ops.map((o) => o.tx))].sort((a, b) => a - b);
  if (txs.length > 7) return { ops: [], txs: [], error: "Use at most 7 transactions." };
  return { ops, txs };
}

export const isAccess = (o: Op) => o.kind === "R" || o.kind === "W";

export interface Conflict {
  a: Op;
  b: Op;
}

/** Pairs of operations from different transactions on the same item where at least one writes. */
export function conflicts(ops: Op[]): Conflict[] {
  const acc = ops.filter(isAccess);
  const out: Conflict[] = [];
  for (let x = 0; x < acc.length; x++)
    for (let y = x + 1; y < acc.length; y++) {
      const a = acc[x];
      const b = acc[y];
      if (a.tx !== b.tx && a.item === b.item && (a.kind === "W" || b.kind === "W")) out.push({ a, b });
    }
  return out;
}

export interface Edge {
  from: number;
  to: number;
  because: Conflict[];
}

export function precedenceGraph(ops: Op[]): Edge[] {
  const edges = new Map<string, Edge>();
  for (const c of conflicts(ops)) {
    const k = `${c.a.tx}>${c.b.tx}`;
    const e = edges.get(k) ?? { from: c.a.tx, to: c.b.tx, because: [] };
    e.because.push(c);
    edges.set(k, e);
  }
  return [...edges.values()];
}

/** A cycle as a list of transactions (first repeated at the end is implied), or null. */
export function findCycle(txs: number[], edges: Edge[]): number[] | null {
  const state = new Map<number, 0 | 1 | 2>();
  const stack: number[] = [];
  const visit = (n: number): number[] | null => {
    state.set(n, 1);
    stack.push(n);
    for (const e of edges.filter((e) => e.from === n)) {
      const s = state.get(e.to) ?? 0;
      if (s === 1) return stack.slice(stack.indexOf(e.to));
      if (s === 0) {
        const c = visit(e.to);
        if (c) return c;
      }
    }
    stack.pop();
    state.set(n, 2);
    return null;
  };
  for (const t of txs) if (!state.get(t)) {
    const c = visit(t);
    if (c) return c;
  }
  return null;
}

/** Every serial order consistent with the graph (topological sorts), up to `limit`. */
export function serialOrders(txs: number[], edges: Edge[], limit = 6): number[][] {
  const out: number[][] = [];
  const indeg = new Map(txs.map((t) => [t, 0]));
  for (const e of edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const used = new Set<number>();
  const order: number[] = [];
  const rec = () => {
    if (out.length >= limit) return;
    if (order.length === txs.length) {
      out.push([...order]);
      return;
    }
    for (const t of txs) {
      if (used.has(t) || indeg.get(t) !== 0) continue;
      used.add(t);
      order.push(t);
      for (const e of edges) if (e.from === t) indeg.set(e.to, indeg.get(e.to)! - 1);
      rec();
      for (const e of edges) if (e.from === t) indeg.set(e.to, indeg.get(e.to)! + 1);
      order.pop();
      used.delete(t);
    }
  };
  rec();
  return out;
}

const aborted = (ops: Op[]) => new Set(ops.filter((o) => o.kind === "A").map((o) => o.tx));

/** The schedule without aborted transactions — what serializability is judged on. */
export function committedProjection(ops: Op[]): Op[] {
  const ab = aborted(ops);
  return ops.filter((o) => !ab.has(o.tx));
}

/** For each read, the write it reads from (null = the initial value). Writes of a transaction that aborted earlier were undone. */
export function readsFrom(ops: Op[]): Map<Op, Op | null> {
  const abortAt = new Map(ops.filter((o) => o.kind === "A").map((o) => [o.tx, o.i]));
  const out = new Map<Op, Op | null>();
  for (const r of ops) {
    if (r.kind !== "R") continue;
    let src: Op | null = null;
    for (const w of ops) {
      if (w.i >= r.i) break;
      if (w.kind !== "W" || w.item !== r.item) continue;
      const a = abortAt.get(w.tx);
      if (a !== undefined && a < r.i) continue;
      src = w;
    }
    out.set(r, src);
  }
  return out;
}

// An operation's identity independent of interleaving: transaction + its position within the transaction.
function opKey(ops: Op[], o: Op) {
  return `${o.tx}:${ops.filter((x) => x.tx === o.tx && x.i <= o.i).length}`;
}

function viewSignature(ops: Op[]) {
  const rf = [...readsFrom(ops).entries()].map(([r, w]) => `${opKey(ops, r)}<-${w ? opKey(ops, w) : "init"}`).sort();
  const finals = new Map<string, Op>();
  for (const o of ops) if (o.kind === "W") finals.set(o.item!, o);
  const fw = [...finals.entries()].map(([item, w]) => `${item}=${opKey(ops, w)}`).sort();
  return rf.join(",") + "|" + fw.join(",");
}

function permutations(xs: number[]): number[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

function serialSchedule(ops: Op[], order: number[]): Op[] {
  const out: Op[] = [];
  for (const t of order) for (const o of ops) if (o.tx === t) out.push({ ...o, i: out.length });
  return out;
}

/** A serial order that is view-equivalent to the schedule, or null. Brute force: fine for ≤ 7 transactions. */
export function viewEquivalentOrder(ops: Op[]): number[] | null {
  const txs = [...new Set(ops.map((o) => o.tx))].sort((a, b) => a - b);
  const sig = viewSignature(ops);
  for (const p of permutations(txs)) if (viewSignature(serialSchedule(ops, p)) === sig) return p;
  return null;
}

export interface Finding {
  ok: boolean;
  why: string[];
}

export interface Analysis {
  projection: Op[];
  dropped: number[];
  edges: Edge[];
  cycle: number[] | null;
  orders: number[][];
  view: number[] | null;
  recoverable: Finding;
  cascadeless: Finding;
  strict: Finding;
  incomplete: number[];
}

const T = (n: number) => `T${n}`;
export const opLabel = (o: Op) => `${o.kind}${o.tx}${o.item ? `(${o.item})` : ""}`;

export function analyze(ops: Op[]): Analysis {
  const ab = aborted(ops);
  const projection = committedProjection(ops);
  const ptxs = [...new Set(projection.map((o) => o.tx))].sort((a, b) => a - b);
  const edges = precedenceGraph(projection);
  const cycle = findCycle(ptxs, edges);
  const orders = cycle ? [] : serialOrders(ptxs, edges);
  const view = cycle ? viewEquivalentOrder(projection) : orders[0] ?? null;

  const end = new Map<number, Op>();
  for (const o of ops) if (o.kind === "C" || o.kind === "A") end.set(o.tx, o);
  const committedAt = (tx: number) => (end.get(tx)?.kind === "C" ? end.get(tx)!.i : null);

  const recoverable: Finding = { ok: true, why: [] };
  const cascadeless: Finding = { ok: true, why: [] };
  for (const [r, w] of readsFrom(ops)) {
    if (!w || w.tx === r.tx) continue;
    const cw = committedAt(w.tx);
    const cr = committedAt(r.tx);
    if (cw === null || cw > r.i) {
      cascadeless.ok = false;
      cascadeless.why.push(`${opLabel(r)} reads ${r.item} written by ${T(w.tx)}, which has not committed yet (a dirty read).`);
    }
    if (cr !== null && (cw === null || cw > cr)) {
      recoverable.ok = false;
      recoverable.why.push(
        `${T(r.tx)} read ${r.item} from ${T(w.tx)} and committed, but ${T(w.tx)} ${ab.has(w.tx) ? "later aborted" : cw === null ? "never commits" : "commits only afterwards"} — ${T(r.tx)}'s commit can't be undone.`,
      );
    }
  }
  const strict: Finding = { ok: true, why: [] };
  for (const w of ops) {
    if (w.kind !== "W") continue;
    const fin = end.get(w.tx)?.i ?? Infinity;
    const later = ops.find((o) => o.i > w.i && o.i < fin && o.tx !== w.tx && isAccess(o) && o.item === w.item);
    if (later) {
      strict.ok = false;
      strict.why.push(`${opLabel(later)} ${later.kind === "R" ? "reads" : "overwrites"} ${w.item} while ${T(w.tx)}'s write is still uncommitted.`);
    }
  }
  if (recoverable.ok) recoverable.why.push("Every transaction that read another's write commits only after that writer committed.");
  if (cascadeless.ok) cascadeless.why.push("No transaction reads a value written by a transaction that hasn't committed yet.");
  if (strict.ok) strict.why.push("No item written by an uncommitted transaction is read or overwritten by another transaction.");

  const txs = [...new Set(ops.map((o) => o.tx))];
  return {
    projection,
    dropped: [...ab].sort((a, b) => a - b),
    edges,
    cycle,
    orders,
    view,
    recoverable,
    cascadeless,
    strict,
    incomplete: txs.filter((t) => !end.has(t)).sort((a, b) => a - b),
  };
}

// ───────────────────────────── Timestamp ordering ─────────────────────────────

export interface TsStep {
  op: Op;
  outcome: "ok" | "abort" | "ignored" | "skipped" | "commit";
  why: string;
  rts: Record<string, number>;
  wts: Record<string, number>;
}

/**
 * Basic timestamp ordering. TS(Ti) is given by `ts`; R-TS/W-TS start at 0.
 * An aborted transaction's remaining operations are skipped (in a real system
 * it would restart with a new timestamp).
 */
export function timestampOrdering(ops: Op[], ts: Map<number, number>, thomas: boolean): TsStep[] {
  const rts: Record<string, number> = {};
  const wts: Record<string, number> = {};
  const dead = new Set<number>();
  const steps: TsStep[] = [];
  const snap = (op: Op, outcome: TsStep["outcome"], why: string) => steps.push({ op, outcome, why, rts: { ...rts }, wts: { ...wts } });
  for (const op of ops) {
    const t = ts.get(op.tx)!;
    if (dead.has(op.tx)) {
      snap(op, "skipped", `T${op.tx} was already rolled back.`);
      continue;
    }
    if (op.kind === "C") {
      snap(op, "commit", `T${op.tx} commits.`);
      continue;
    }
    if (op.kind === "A") {
      dead.add(op.tx);
      snap(op, "abort", `T${op.tx} aborts by itself.`);
      continue;
    }
    const x = op.item!;
    const r = rts[x] ?? 0;
    const w = wts[x] ?? 0;
    if (op.kind === "R") {
      if (t < w) {
        dead.add(op.tx);
        snap(op, "abort", `TS(T${op.tx}) = ${t} < W-TS(${x}) = ${w}: a younger transaction already wrote ${x}, so T${op.tx} would read a value "from its future". Roll back T${op.tx}.`);
      } else {
        rts[x] = Math.max(r, t);
        snap(op, "ok", `TS(T${op.tx}) = ${t} ≥ W-TS(${x}) = ${w}: read allowed. R-TS(${x}) = max(${r}, ${t}) = ${rts[x]}.`);
      }
      continue;
    }
    if (t < r) {
      dead.add(op.tx);
      snap(op, "abort", `TS(T${op.tx}) = ${t} < R-TS(${x}) = ${r}: a younger transaction already read the old ${x}; writing now would change what it should have seen. Roll back T${op.tx}.`);
    } else if (t < w) {
      if (thomas) snap(op, "ignored", `TS(T${op.tx}) = ${t} < W-TS(${x}) = ${w}, but nobody younger read ${x} (R-TS = ${r} ≤ ${t}): the write is obsolete. Thomas's write rule skips it instead of aborting.`);
      else {
        dead.add(op.tx);
        snap(op, "abort", `TS(T${op.tx}) = ${t} < W-TS(${x}) = ${w}: a younger transaction already wrote ${x}. Basic TO rolls back T${op.tx}.`);
      }
    } else {
      wts[x] = t;
      snap(op, "ok", `TS(T${op.tx}) = ${t} ≥ R-TS(${x}) = ${r} and ≥ W-TS(${x}) = ${w}: write allowed. W-TS(${x}) = ${t}.`);
    }
  }
  return steps;
}
