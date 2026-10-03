"use client";
import { useState } from "react";
import { RotateCcw, Shield, Skull, Upload } from "lucide-react";
import { Btn, Explain, Field, Panel, Segmented, Stat } from "../ui";
import { cn } from "@/lib/utils";

type NodeId = "P" | "A" | "B";
type Mode = "async" | "semisync" | "sync";

interface Entry {
  id: number;
  text: string;
  origin: NodeId;
}

interface Node {
  alive: boolean;
  fenced: boolean;
  role: "primary" | "replica";
  log: Entry[];
}

interface State {
  nodes: Record<NodeId, Node>;
  primary: NodeId;
  lastPrimary: NodeId | null;
  mode: Mode;
  seq: number;
  lost: Entry[];
  discarded: Entry[];
  events: { text: string; tone?: "good" | "bad" | "warn" }[];
}

const NAMES: Record<NodeId, string> = { P: "Node P (zone 1)", A: "Node A (zone 2)", B: "Node B (zone 3)" };

const initial = (mode: Mode = "async"): State => ({
  nodes: {
    P: { alive: true, fenced: false, role: "primary", log: [] },
    A: { alive: true, fenced: false, role: "replica", log: [] },
    B: { alive: true, fenced: false, role: "replica", log: [] },
  },
  primary: "P",
  lastPrimary: null,
  mode,
  seq: 0,
  lost: [],
  discarded: [],
  events: [{ text: "One primary, two replicas. Writes go to the primary and are streamed to replicas." }],
});

const copy = (s: State): State => structuredClone(s);
const replicas = (s: State) => (["P", "A", "B"] as NodeId[]).filter((n) => n !== s.primary);

function deliver(s: State, to: NodeId, quiet = false) {
  const p = s.nodes[s.primary];
  const r = s.nodes[to];
  if (!r.alive || r.log.length >= p.log.length) return false;
  r.log.push(p.log[r.log.length]);
  if (!quiet) s.events.push({ text: `${to} replayed write #${r.log[r.log.length - 1].id}.` });
  return true;
}

function write(prev: State): State {
  const s = copy(prev);
  const p = s.nodes[s.primary];
  if (!p.alive || p.fenced) {
    s.events.push({ text: `${s.primary} can't accept writes (${!p.alive ? "it is down" : "it is fenced"}).`, tone: "bad" });
    return s;
  }
  const needed = s.mode === "async" ? 0 : s.mode === "semisync" ? 1 : replicas(s).length;
  const available = replicas(s).filter((n) => s.nodes[n].alive).length;
  if (available < needed) {
    s.events.push({ text: `COMMIT blocked: ${s.mode} replication needs ${needed} replica ack(s) but only ${available} replica(s) are reachable. The primary waits — availability traded for durability.`, tone: "bad" });
    return s;
  }
  const entry: Entry = { id: ++s.seq, text: `write #${s.seq}`, origin: s.primary };
  p.log.push(entry);
  let acked = 0;
  for (const n of replicas(s)) {
    if (acked >= needed) break;
    if (s.nodes[n].alive) {
      while (deliver(s, n, true));
      acked++;
    }
  }
  s.events.push({
    text:
      s.mode === "async"
        ? `Write #${entry.id} committed on ${s.primary} and acknowledged to the client immediately; replicas will catch up later.`
        : `Write #${entry.id} committed after ${acked} replica(s) confirmed it was flushed (${s.mode}).`,
    tone: "good",
  });
  return s;
}

function promote(prev: State, to: NodeId): State {
  const s = copy(prev);
  if (to === s.primary || !s.nodes[to].alive) return s;
  const old = s.primary;
  const oldNode = s.nodes[old];
  const newNode = s.nodes[to];
  const lost = oldNode.log.slice(newNode.log.length);
  s.lost = lost;
  s.nodes[to].role = "primary";
  s.nodes[old].role = "replica";
  s.primary = to;
  s.lastPrimary = old;
  s.events.push({
    text: `${to} promoted to primary with ${newNode.log.length} write(s) replayed.` + (lost.length ? ` ${lost.length} acknowledged write(s) (#${lost.map((e) => e.id).join(", #")}) exist only on ${old} — data loss (RPO > 0).` : " No acknowledged write was lost (RPO = 0)."),
    tone: lost.length ? "bad" : "good",
  });
  if (oldNode.alive && !oldNode.fenced) {
    s.events.push({ text: `⚠ ${old} is still running and unfenced: if clients can still reach it, you now have two primaries — split brain.`, tone: "bad" });
  }
  return s;
}

function writeToOld(prev: State): State {
  const s = copy(prev);
  const old = s.lastPrimary;
  if (!old || old === s.primary || !s.nodes[old].alive || s.nodes[old].fenced) {
    s.events.push({ text: "No reachable, unfenced old primary — clients can only reach the current primary.", tone: "good" });
    return s;
  }
  const entry: Entry = { id: ++s.seq, text: `write #${s.seq}`, origin: old };
  s.nodes[old].log.push(entry);
  s.events.push({ text: `A client that still points at ${old} wrote #${entry.id} there. Two different histories now exist for the same database.`, tone: "bad" });
  return s;
}

function rejoin(prev: State, node: NodeId): State {
  const s = copy(prev);
  const n = s.nodes[node];
  const p = s.nodes[s.primary];
  if (node === s.primary) return s;
  let fork = 0;
  while (fork < n.log.length && fork < p.log.length && n.log[fork].id === p.log[fork].id) fork++;
  const discarded = n.log.slice(fork);
  s.discarded = [...s.discarded, ...discarded];
  n.log = p.log.slice(0, fork);
  n.alive = true;
  n.fenced = false;
  n.role = "replica";
  s.events.push({
    text: discarded.length
      ? `${node} rejoined as a replica. pg_rewind discarded ${discarded.length} divergent write(s) (#${discarded.map((e) => e.id).join(", #")}) — they are gone unless you extracted them first.`
      : `${node} rejoined as a replica and is catching up.`,
    tone: discarded.length ? "bad" : "good",
  });
  return s;
}

const PRESETS: { label: string; note: string; build: () => State }[] = [
  {
    label: "Stale read from a replica",
    note: "Three writes committed on the primary; replica A has replayed only one. A read routed to A misses the user's own write — a read-your-writes violation.",
    build: () => {
      let s = initial("async");
      s = write(write(write(s)));
      deliver(s, "A");
      return s;
    },
  },
  {
    label: "Async failover loses writes",
    note: "Five writes acknowledged; A has three. The primary dies and A is promoted: the last two acknowledged writes exist only on the dead node.",
    build: () => {
      let s = initial("async");
      for (let i = 0; i < 5; i++) s = write(s);
      deliver(s, "A");
      deliver(s, "A");
      deliver(s, "A");
      s.nodes.P.alive = false;
      s.events.push({ text: "Node P failed (host lost).", tone: "bad" });
      return promote(s, "A");
    },
  },
  {
    label: "Synchronous replication: RPO 0",
    note: "With semi-synchronous replication each commit waits for one replica to flush it. When the primary dies, the promoted replica has every acknowledged write.",
    build: () => {
      let s = initial("semisync");
      for (let i = 0; i < 5; i++) s = write(s);
      s.nodes.P.alive = false;
      s.events.push({ text: "Node P failed (host lost).", tone: "bad" });
      return promote(s, "A");
    },
  },
  {
    label: "Split brain (no fencing)",
    note: "P is unreachable from the monitor but still alive and serving clients. A is promoted, both accept writes, and the histories diverge. Rejoining P discards its divergent writes.",
    build: () => {
      let s = initial("async");
      for (let i = 0; i < 3; i++) s = write(s);
      deliver(s, "A");
      deliver(s, "A");
      deliver(s, "A");
      s = promote(s, "A");
      s = writeToOld(s);
      s = write(s);
      return s;
    },
  },
];

export default function Replication() {
  const [s, setS] = useState<State>(() => initial());
  const [note, setNote] = useState<string | null>(null);
  const primaryLog = s.nodes[s.primary].log;

  const lagOf = (n: NodeId) => primaryLog.length - s.nodes[n].log.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <Btn key={p.label} onClick={() => { setS(p.build()); setNote(p.note); }}>
            {p.label}
          </Btn>
        ))}
        <Btn variant="ghost" onClick={() => { setS(initial(s.mode)); setNote(null); }}>
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </Btn>
      </div>
      {note && <Explain>{note}</Explain>}

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Replication mode">
          <Segmented
            value={s.mode}
            onChange={(m) => setS((x) => ({ ...copy(x), mode: m }))}
            options={[
              { value: "async", label: "async" },
              { value: "semisync", label: "wait for 1" },
              { value: "sync", label: "wait for all" },
            ]}
          />
        </Field>
        <Btn variant="primary" onClick={() => setS(write)}>
          Client write
        </Btn>
        <Btn onClick={() => setS((x) => { const n = copy(x); for (const r of replicas(n)) deliver(n, r); return n; })}>
          <Upload className="h-3.5 w-3.5" /> Ship one WAL record to each replica
        </Btn>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {(["P", "A", "B"] as NodeId[]).map((id) => {
          const n = s.nodes[id];
          const isPrimary = s.primary === id;
          return (
            <Panel
              key={id}
              title={NAMES[id]}
              right={
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", !n.alive ? "bg-bad/15 text-bad" : isPrimary ? "bg-accent/15 text-accent" : "bg-surface-2 text-muted")}>
                  {!n.alive ? "down" : isPrimary ? "PRIMARY" : "replica"}
                  {n.fenced ? " · fenced" : ""}
                </span>
              }
            >
              <div className="mb-2 flex flex-wrap gap-1">
                {n.log.length ? (
                  n.log.map((e) => (
                    <span key={e.id} className={cn("rounded px-1.5 py-0.5 font-mono text-[11.5px]", e.origin !== "P" && e.origin !== s.primary ? "bg-bad/15 text-bad" : "bg-surface-2 text-muted")} title={`write #${e.id} originated on ${e.origin}`}>
                      #{e.id}
                    </span>
                  ))
                ) : (
                  <span className="text-[12px] text-subtle">empty</span>
                )}
              </div>
              <div className="mb-2 text-[12px] text-muted">
                {isPrimary ? `${n.log.length} write(s) committed here` : `lag: ${Math.max(0, lagOf(id))} write(s) behind`}
                {!isPrimary && n.alive && <> · a read here returns {n.log.length ? `#${n.log[n.log.length - 1].id}` : "nothing"}</>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {!isPrimary && n.alive && (
                  <>
                    <Btn onClick={() => setS((x) => { const c = copy(x); deliver(c, id); return c; })} disabled={lagOf(id) <= 0}>
                      Replay 1
                    </Btn>
                    <Btn onClick={() => setS((x) => promote(x, id))}>Promote</Btn>
                  </>
                )}
                {n.alive ? (
                  <Btn variant="ghost" onClick={() => setS((x) => { const c = copy(x); c.nodes[id].alive = false; c.events.push({ text: `${id} went down.`, tone: "bad" }); return c; })}>
                    <Skull className="h-3.5 w-3.5" /> Kill
                  </Btn>
                ) : (
                  <Btn variant="ghost" onClick={() => setS((x) => rejoin(x, id))}>
                    Restart &amp; rejoin
                  </Btn>
                )}
                {!isPrimary && n.alive && !n.fenced && n.log.length > 0 && (
                  <Btn variant="ghost" onClick={() => setS((x) => { const c = copy(x); c.nodes[id].fenced = true; c.events.push({ text: `${id} fenced: it can no longer accept writes, even if clients still reach it.`, tone: "good" }); return c; })}>
                    <Shield className="h-3.5 w-3.5" /> Fence
                  </Btn>
                )}
              </div>
            </Panel>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <Btn variant="danger" onClick={() => setS(writeToOld)}>
          Client writes to the old primary (no fencing)
        </Btn>
        {s.lost.length > 0 && <Stat label="Acknowledged writes lost on failover" value={s.lost.length} sub={`#${s.lost.map((e) => e.id).join(", #")}`} />}
        {s.discarded.length > 0 && <Stat label="Divergent writes discarded on rejoin" value={s.discarded.length} sub={`#${s.discarded.map((e) => e.id).join(", #")}`} />}
      </div>

      <Panel title="Events">
        <ol className="max-h-56 space-y-0.5 overflow-y-auto text-[12.5px] thin-scroll">
          {[...s.events].reverse().map((e, i) => (
            <li key={s.events.length - i} className={cn(e.tone === "bad" && "text-bad", e.tone === "good" && "text-ok", e.tone === "warn" && "text-warn", !e.tone && "text-muted")}>
              {e.text}
            </li>
          ))}
        </ol>
      </Panel>
      <Explain>
        Async replication acknowledges writes before replicas have them: fast, but a failover loses whatever hadn&apos;t shipped. Waiting for one replica gives RPO 0 at the cost of a round
        trip per commit — and blocks writes when no replica is reachable. Fencing is what stops the old primary from accepting writes after someone else is promoted.
      </Explain>
    </div>
  );
}
