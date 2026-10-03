"use client";
import { useMemo, useState } from "react";
import { Explain, Panel, Segmented, StepControls, useStepper } from "../ui";
import { cn } from "@/lib/utils";

type Level = "ru" | "rc" | "rr" | "ser";
type TxId = 1 | 2;

interface Version {
  value: number;
  xmin: number; // 0 = initial data
  xmax: number | null;
}

type StepDef =
  | { tx: TxId; kind: "begin" }
  | { tx: TxId; kind: "commit" }
  | { tx: TxId; kind: "abort" }
  | { tx: TxId; kind: "read"; item: string; into: string; label: string }
  | { tx: TxId; kind: "count"; prefix: string; into: string; label: string }
  | { tx: TxId; kind: "write"; item: string; label: string; compute: (vars: Record<string, number>) => number }
  | { tx: TxId; kind: "insert"; item: string; value: number; label: string };

interface Scenario {
  id: string;
  title: string;
  intro: string;
  items: Record<string, number>;
  steps: StepDef[];
  verdict: (s: SimState) => { anomaly: boolean; text: string };
}

interface TxState {
  status: "idle" | "active" | "committed" | "aborted";
  snapshot: Set<number> | null;
  vars: Record<string, number>;
  reads: Set<string>;
  writes: Set<string>;
  commitOrder?: number;
}

interface SimState {
  store: Record<string, Version[]>;
  tx: Record<TxId, TxState>;
  committed: Set<number>;
  aborted: Set<number>;
  log: { tx: TxId; text: string; tone?: "bad" | "good" | "warn" }[];
  commits: number;
}

const LEVELS: { value: Level; label: string }[] = [
  { value: "ru", label: "Read Uncommitted*" },
  { value: "rc", label: "Read Committed" },
  { value: "rr", label: "Repeatable Read" },
  { value: "ser", label: "Serializable" },
];

export const SCENARIOS: Scenario[] = [
  {
    id: "lost-update",
    title: "Lost update",
    intro: "Balance 100. T1 deposits 50, T2 withdraws 30 — each reads the balance, computes the new value in application code, and writes it back. Any serial order ends at 120.",
    items: { balance: 100 },
    steps: [
      { tx: 1, kind: "begin" },
      { tx: 2, kind: "begin" },
      { tx: 1, kind: "read", item: "balance", into: "b", label: "SELECT balance" },
      { tx: 2, kind: "read", item: "balance", into: "b", label: "SELECT balance" },
      { tx: 1, kind: "write", item: "balance", label: "UPDATE balance = b + 50", compute: (v) => v.b + 50 },
      { tx: 1, kind: "commit" },
      { tx: 2, kind: "write", item: "balance", label: "UPDATE balance = b − 30", compute: (v) => v.b - 30 },
      { tx: 2, kind: "commit" },
    ],
    verdict: (s) => {
      const final = latestCommitted(s, "balance");
      if (s.tx[2].status === "aborted") return { anomaly: false, text: `T2 was aborted with a serialization error instead of overwriting T1's committed change. Retrying T2 gives the correct 120.` };
      return final === 120 ? { anomaly: false, text: "Final balance 120 — correct." } : { anomaly: true, text: `Final balance ${final}: T1's deposit was silently overwritten — a lost update.` };
    },
  },
  {
    id: "dirty-read",
    title: "Dirty read",
    intro: "Balance 100. T1 withdraws everything but then rolls back. Does T2 ever see the balance that never officially existed?",
    items: { balance: 100 },
    steps: [
      { tx: 1, kind: "begin" },
      { tx: 2, kind: "begin" },
      { tx: 1, kind: "write", item: "balance", label: "UPDATE balance = 0", compute: () => 0 },
      { tx: 2, kind: "read", item: "balance", into: "b1", label: "SELECT balance" },
      { tx: 1, kind: "abort" },
      { tx: 2, kind: "read", item: "balance", into: "b2", label: "SELECT balance" },
      { tx: 2, kind: "commit" },
    ],
    verdict: (s) =>
      s.tx[2].vars.b1 === 0
        ? { anomaly: true, text: "T2 read 0 — a value from a transaction that rolled back. A dirty read (only possible at textbook Read Uncommitted; PostgreSQL never allows it)." }
        : { anomaly: false, text: "T2 only ever saw committed data (100)." },
  },
  {
    id: "non-repeatable",
    title: "Non-repeatable read",
    intro: "T1 reads a price twice within one transaction; T2 changes it in between and commits.",
    items: { price: 100 },
    steps: [
      { tx: 1, kind: "begin" },
      { tx: 2, kind: "begin" },
      { tx: 1, kind: "read", item: "price", into: "p1", label: "SELECT price" },
      { tx: 2, kind: "write", item: "price", label: "UPDATE price = 120", compute: () => 120 },
      { tx: 2, kind: "commit" },
      { tx: 1, kind: "read", item: "price", into: "p2", label: "SELECT price" },
      { tx: 1, kind: "commit" },
    ],
    verdict: (s) =>
      s.tx[1].vars.p1 !== s.tx[1].vars.p2
        ? { anomaly: true, text: `T1 read ${s.tx[1].vars.p1}, then ${s.tx[1].vars.p2} — the same query gave different answers inside one transaction.` }
        : { anomaly: false, text: `T1 read ${s.tx[1].vars.p1} both times: its snapshot is fixed for the whole transaction.` },
  },
  {
    id: "phantom",
    title: "Phantom",
    intro: "T1 counts bookings for room 5 twice; T2 inserts a new booking for room 5 in between and commits.",
    items: { "room5:ana": 1 },
    steps: [
      { tx: 1, kind: "begin" },
      { tx: 2, kind: "begin" },
      { tx: 1, kind: "count", prefix: "room5:", into: "c1", label: "SELECT count(*) … WHERE room = 5" },
      { tx: 2, kind: "insert", item: "room5:raj", value: 1, label: "INSERT booking (room 5, Raj)" },
      { tx: 2, kind: "commit" },
      { tx: 1, kind: "count", prefix: "room5:", into: "c2", label: "SELECT count(*) … WHERE room = 5" },
      { tx: 1, kind: "commit" },
    ],
    verdict: (s) =>
      s.tx[1].vars.c1 !== s.tx[1].vars.c2
        ? { anomaly: true, text: `Count went ${s.tx[1].vars.c1} → ${s.tx[1].vars.c2}: a phantom row appeared in T1's predicate.` }
        : { anomaly: false, text: `Both counts were ${s.tx[1].vars.c1}: T1's snapshot doesn't include T2's insert.` },
  },
  {
    id: "read-skew",
    title: "Read skew",
    intro: "Accounts A and B hold 500 each (invariant: A + B = 1000). T2 transfers 100 from A to B while T1 reads A, then B.",
    items: { A: 500, B: 500 },
    steps: [
      { tx: 1, kind: "begin" },
      { tx: 2, kind: "begin" },
      { tx: 1, kind: "read", item: "A", into: "a", label: "SELECT A" },
      { tx: 2, kind: "write", item: "A", label: "UPDATE A = 400", compute: () => 400 },
      { tx: 2, kind: "write", item: "B", label: "UPDATE B = 600", compute: () => 600 },
      { tx: 2, kind: "commit" },
      { tx: 1, kind: "read", item: "B", into: "b", label: "SELECT B" },
      { tx: 1, kind: "commit" },
    ],
    verdict: (s) => {
      const sum = s.tx[1].vars.a + s.tx[1].vars.b;
      return sum !== 1000
        ? { anomaly: true, text: `T1 saw A = ${s.tx[1].vars.a} and B = ${s.tx[1].vars.b}: total ${sum}. Each value was committed, but they come from different moments.` }
        : { anomaly: false, text: `T1 saw a consistent total of ${sum}.` };
    },
  },
  {
    id: "write-skew",
    title: "Write skew",
    intro: "Rule: at least one doctor must stay on call. Alice (T1) and Bob (T2) are both on call, each checks the count and goes off call.",
    items: { "oncall:alice": 1, "oncall:bob": 1 },
    steps: [
      { tx: 1, kind: "begin" },
      { tx: 2, kind: "begin" },
      { tx: 1, kind: "count", prefix: "oncall:", into: "n", label: "SELECT count(*) WHERE on_call" },
      { tx: 2, kind: "count", prefix: "oncall:", into: "n", label: "SELECT count(*) WHERE on_call" },
      { tx: 1, kind: "write", item: "oncall:alice", label: "UPDATE alice SET on_call = false (n ≥ 2)", compute: () => 0 },
      { tx: 2, kind: "write", item: "oncall:bob", label: "UPDATE bob SET on_call = false (n ≥ 2)", compute: () => 0 },
      { tx: 1, kind: "commit" },
      { tx: 2, kind: "commit" },
    ],
    verdict: (s) => {
      if (s.tx[2].status === "aborted") return { anomaly: false, text: "T2 was aborted at commit (SSI detected the read–write dependency cycle). Bob stays on call; a retry would see only one doctor and refuse." };
      const on = countCommitted(s, "oncall:");
      return on === 0 ? { anomaly: true, text: "Nobody is on call: both transactions saw 2, wrote different rows, and both committed. Write skew — snapshot isolation doesn't catch it." } : { anomaly: false, text: `${on} doctor(s) on call.` };
    },
  },
];

function latestCommitted(s: SimState, item: string) {
  const vs = s.store[item] ?? [];
  for (let i = vs.length - 1; i >= 0; i--) if (vs[i].xmin === 0 || s.committed.has(vs[i].xmin)) return vs[i].value;
  return undefined;
}

function countCommitted(s: SimState, prefix: string) {
  return Object.keys(s.store)
    .filter((k) => k.startsWith(prefix))
    .reduce((n, k) => n + (latestCommitted(s, k) ?? 0), 0);
}

function visible(v: Version, me: TxId, snap: Set<number>, level: Level, s: SimState) {
  if (level === "ru") {
    // Textbook read uncommitted: the newest version that wasn't rolled back.
    return !s.aborted.has(v.xmin) && (v.xmax === null || s.aborted.has(v.xmax));
  }
  const createdOk = v.xmin === 0 || v.xmin === me || snap.has(v.xmin);
  if (!createdOk || s.aborted.has(v.xmin)) return false;
  if (v.xmax === null) return true;
  if (v.xmax === me) return false;
  return !snap.has(v.xmax);
}

function readItem(s: SimState, item: string, me: TxId, snap: Set<number>, level: Level) {
  const vs = s.store[item] ?? [];
  for (let i = vs.length - 1; i >= 0; i--) if (visible(vs[i], me, snap, level, s)) return vs[i];
  return undefined;
}

function snapshotFor(s: SimState, tx: TxId, level: Level) {
  const t = s.tx[tx];
  if (level === "rr" || level === "ser") {
    if (!t.snapshot) t.snapshot = new Set(s.committed);
    return t.snapshot;
  }
  return new Set(s.committed); // RC / RU: a fresh snapshot per statement
}

export function simulate(sc: Scenario, level: Level, upto: number): SimState {
  const s: SimState = {
    store: Object.fromEntries(Object.entries(sc.items).map(([k, v]) => [k, [{ value: v, xmin: 0, xmax: null }]])),
    tx: {
      1: { status: "idle", snapshot: null, vars: {}, reads: new Set(), writes: new Set() },
      2: { status: "idle", snapshot: null, vars: {}, reads: new Set(), writes: new Set() },
    },
    committed: new Set([0]),
    aborted: new Set(),
    log: [],
    commits: 0,
  };
  for (const step of sc.steps.slice(0, upto)) {
    const t = s.tx[step.tx];
    const name = `T${step.tx}`;
    if (t.status === "aborted") {
      s.log.push({ tx: step.tx, text: `(skipped — ${name} was aborted)`, tone: "warn" });
      continue;
    }
    switch (step.kind) {
      case "begin":
        t.status = "active";
        s.log.push({ tx: step.tx, text: "BEGIN" });
        break;
      case "read": {
        const snap = snapshotFor(s, step.tx, level);
        const v = readItem(s, step.item, step.tx, snap, level);
        t.vars[step.into] = v?.value ?? NaN;
        t.reads.add(step.item);
        const who = v ? (v.xmin === 0 ? "initial data" : `T${v.xmin}${s.committed.has(v.xmin) ? "" : ", uncommitted!"}`) : "";
        s.log.push({ tx: step.tx, text: `${step.label} → ${v?.value} (version by ${who})`, tone: v && v.xmin !== 0 && !s.committed.has(v.xmin) && v.xmin !== step.tx ? "bad" : undefined });
        break;
      }
      case "count": {
        const snap = snapshotFor(s, step.tx, level);
        const keys = Object.keys(s.store).filter((k) => k.startsWith(step.prefix));
        let n = 0;
        for (const k of keys) {
          t.reads.add(k);
          n += readItem(s, k, step.tx, snap, level)?.value ?? 0;
        }
        t.reads.add(`${step.prefix}*`);
        t.vars[step.into] = n;
        s.log.push({ tx: step.tx, text: `${step.label} → ${n}` });
        break;
      }
      case "write":
      case "insert": {
        const snap = snapshotFor(s, step.tx, level);
        const vs = (s.store[step.item] ??= []);
        const latest = [...vs].reverse().find((v) => v.xmax === null && !s.aborted.has(v.xmin));
        if ((level === "rr" || level === "ser") && latest && latest.xmin !== 0 && latest.xmin !== step.tx && !snap.has(latest.xmin)) {
          t.status = "aborted";
          s.aborted.add(step.tx);
          s.log.push({ tx: step.tx, text: `${step.label} → ERROR: could not serialize access due to concurrent update (the row was changed by a transaction that committed after ${name}'s snapshot). ${name} rolled back.`, tone: "bad" });
          break;
        }
        const value = step.kind === "insert" ? step.value : step.compute(t.vars);
        if (latest) latest.xmax = step.tx;
        vs.push({ value, xmin: step.tx, xmax: null });
        t.writes.add(step.item);
        if (step.kind === "insert") t.writes.add(`${step.item.split(":")[0]}:*`);
        s.log.push({ tx: step.tx, text: `${step.label} → new version ${value} (xmin = T${step.tx}, not visible to others until COMMIT)` });
        break;
      }
      case "commit": {
        if (level === "ser") {
          const other = s.tx[step.tx === 1 ? 2 : 1];
          const otherId = step.tx === 1 ? 2 : 1;
          const concurrentCommitted = other.status === "committed" && !(t.snapshot?.has(otherId) ?? false);
          const readsTheirWrites = [...t.reads].some((r) => other.writes.has(r));
          const theyReadMine = [...other.reads].some((r) => t.writes.has(r));
          if (concurrentCommitted && readsTheirWrites && theyReadMine) {
            t.status = "aborted";
            s.aborted.add(step.tx);
            s.log.push({ tx: step.tx, text: `COMMIT → ERROR: could not serialize access due to read/write dependencies among transactions. ${name} rolled back — retry it.`, tone: "bad" });
            break;
          }
        }
        t.status = "committed";
        s.committed.add(step.tx);
        t.commitOrder = ++s.commits;
        s.log.push({ tx: step.tx, text: "COMMIT", tone: "good" });
        break;
      }
      case "abort":
        t.status = "aborted";
        s.aborted.add(step.tx);
        s.log.push({ tx: step.tx, text: "ROLLBACK — its versions become invisible forever", tone: "warn" });
        break;
    }
  }
  return s;
}

const txName = (x: number | null) => (x === null ? "—" : x === 0 ? "T0" : `T${x}`);

export default function Isolation() {
  const [scId, setScId] = useState(SCENARIOS[0].id);
  const [level, setLevel] = useState<Level>("rc");
  const sc = SCENARIOS.find((x) => x.id === scId)!;
  const st = useStepper(sc.steps.length + 1, { interval: 1300 });
  const state = useMemo(() => simulate(sc, level, st.step), [sc, level, st.step]);
  const done = st.step >= sc.steps.length;
  const verdict = done ? sc.verdict(state) : null;

  const statusChip = (tx: TxId) => {
    const s = state.tx[tx].status;
    return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", s === "active" && "bg-accent/15 text-accent", s === "committed" && "bg-ok/15 text-ok", s === "aborted" && "bg-bad/15 text-bad", s === "idle" && "bg-surface-2 text-subtle")}>{s}</span>;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Segmented
          value={scId}
          onChange={(v) => {
            setScId(v);
            st.reset();
          }}
          options={SCENARIOS.map((x) => ({ value: x.id, label: x.title }))}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={level} onChange={setLevel} options={LEVELS} size="sm" />
        <span className="text-[11.5px] text-subtle">*textbook behavior; PostgreSQL runs Read Uncommitted as Read Committed</span>
      </div>
      <Explain>{sc.intro}</Explain>
      <StepControls s={st} total={sc.steps.length + 1} />

      <div className="grid gap-4 md:grid-cols-2">
        {([1, 2] as TxId[]).map((tx) => (
          <Panel key={tx} title={`Transaction T${tx}`} right={statusChip(tx)}>
            <ol className="space-y-1 text-[12.5px]">
              {sc.steps.map((stp, i) => {
                if (stp.tx !== tx) return null;
                const executed = i < st.step;
                const entry = executed ? state.log[i] : null; // every executed step logs exactly one entry
                const label = stp.kind === "begin" ? "BEGIN" : stp.kind === "commit" ? "COMMIT" : stp.kind === "abort" ? "ROLLBACK" : stp.label;
                return (
                  <li key={i} className={cn("rounded-md border px-2 py-1", i === st.step - 1 ? "border-accent bg-accent/5" : "border-transparent", !executed && "opacity-45")}>
                    <span className="mr-1.5 font-mono text-[10.5px] text-subtle">t{i + 1}</span>
                    <span className="font-mono">{label}</span>
                    {entry && entry.text !== label && (
                      <div className={cn("mt-0.5 text-[12px]", entry.tone === "bad" && "text-bad", entry.tone === "good" && "text-ok", entry.tone === "warn" && "text-warn", !entry.tone && "text-muted")}>{entry.text}</div>
                    )}
                  </li>
                );
              })}
            </ol>
          </Panel>
        ))}
      </div>

      <Panel title="Row versions (MVCC)">
        <div className="overflow-x-auto thin-scroll">
          <table className="w-full min-w-[520px] font-mono text-[12.5px]">
            <thead className="text-left text-[11px] text-subtle">
              <tr>
                <th className="pb-1">row</th>
                <th>value</th>
                <th>xmin (created by)</th>
                <th>xmax (ended by)</th>
                <th>state</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(state.store).map(([item, vs]) =>
                vs.map((v, i) => {
                  const creatorDone = v.xmin === 0 || state.committed.has(v.xmin);
                  const rolledBack = state.aborted.has(v.xmin);
                  const live = v.xmax === null || state.aborted.has(v.xmax);
                  return (
                    <tr key={`${item}-${i}`} className={cn("border-t border-border", rolledBack && "text-subtle line-through")}>
                      <td className="py-1">{i === 0 ? item : ""}</td>
                      <td className="font-semibold">{v.value}</td>
                      <td>{txName(v.xmin)}</td>
                      <td>{txName(v.xmax)}</td>
                      <td className="font-sans text-[12px]">
                        {rolledBack ? "rolled back — invisible" : !creatorDone ? "uncommitted" : live ? "current committed version" : "old version (kept for older snapshots)"}
                      </td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {verdict ? (
        <Explain tone={verdict.anomaly ? "bad" : "good"}>
          <strong>{verdict.anomaly ? "Anomaly! " : "No anomaly. "}</strong>
          {verdict.text} Try the same schedule under another isolation level.
        </Explain>
      ) : (
        <p className="text-[12.5px] text-subtle">Step through the schedule; the verdict appears at the end.</p>
      )}
    </div>
  );
}
