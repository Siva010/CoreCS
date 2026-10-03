"use client";
import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Btn, Explain, Panel } from "../ui";
import { cn } from "@/lib/utils";

type Side = "C" | "S";
type State =
  | "CLOSED"
  | "LISTEN"
  | "SYN_SENT"
  | "SYN_RECV"
  | "ESTABLISHED"
  | "FIN_WAIT_1"
  | "FIN_WAIT_2"
  | "CLOSE_WAIT"
  | "LAST_ACK"
  | "TIME_WAIT"
  | "CLOSING";

interface Seg {
  id: number;
  from: Side;
  flags: string[]; // SYN, ACK, FIN, DATA
  seq: number;
  ack?: number;
  len: number;
  lost: boolean;
  retx?: boolean;
  note?: string;
}

interface End {
  state: State;
  isn: number;
  sndNxt: number; // next seq to send
  sndUna: number; // oldest unacked
  rcvNxt: number; // next expected from peer
}

interface World {
  C: End;
  S: End;
  segs: Seg[];
  unacked: { C: Seg | null; S: Seg | null }; // last reliable segment awaiting ACK, per side
  nextId: number;
  log: string[];
  chain: number; // segments sent in the current action (for loss injection)
  dropAt: number; // 0 = none, 1 = first segment of the action, 2 = the reply
}

const init = (): World => ({
  C: { state: "CLOSED", isn: 1000, sndNxt: 1000, sndUna: 1000, rcvNxt: 0 },
  S: { state: "LISTEN", isn: 5000, sndNxt: 5000, sndUna: 5000, rcvNxt: 0 },
  segs: [],
  unacked: { C: null, S: null },
  nextId: 1,
  log: ["Server is LISTENing on port 443. Client socket is CLOSED."],
  chain: 0,
  dropAt: 0,
});

const other = (s: Side): Side => (s === "C" ? "S" : "C");
const name = (s: Side) => (s === "C" ? "Client" : "Server");

function label(g: Seg) {
  const f = g.flags.filter((x) => x !== "DATA").join("+") || "DATA";
  return `${f}${g.flags.includes("DATA") && g.flags.length > 1 ? "+DATA" : ""} seq=${g.seq}${g.ack !== undefined ? ` ack=${g.ack}` : ""}${g.len ? ` len=${g.len}` : ""}`;
}

/** Process delivery of a segment at the receiver; returns follow-up segments to send (auto responses). */
function deliver(w: World, g: Seg): Omit<Seg, "id" | "lost">[] {
  const r = other(g.from);
  const me = w[r];
  const out: Omit<Seg, "id" | "lost">[] = [];
  const say = (s: string) => w.log.push(s);

  // ACK processing
  if (g.ack !== undefined && g.flags.includes("ACK")) {
    if (g.ack > me.sndUna) {
      me.sndUna = g.ack;
      w.unacked[r] = null;
    }
  }

  const flags = g.flags;
  if (flags.includes("SYN") && !flags.includes("ACK")) {
    if (me.state === "LISTEN" || me.state === "SYN_RECV") {
      me.rcvNxt = g.seq + 1;
      me.state = "SYN_RECV";
      say(`Server: SYN received → SYN_RECV (half-open, in the SYN queue). Replies SYN-ACK with its own ISN ${me.isn}, ack=${g.seq + 1}.`);
      me.sndNxt = me.isn + 1;
      out.push({ from: r, flags: ["SYN", "ACK"], seq: me.isn, ack: me.rcvNxt, len: 0 });
    }
    return out;
  }
  if (flags.includes("SYN") && flags.includes("ACK")) {
    if (me.state === "SYN_SENT" || me.state === "ESTABLISHED") {
      me.rcvNxt = g.seq + 1;
      me.state = "ESTABLISHED";
      say(`Client: SYN-ACK received → ESTABLISHED. Sends ACK=${me.rcvNxt} (third message; could carry data).`);
      out.push({ from: r, flags: ["ACK"], seq: me.sndNxt, ack: me.rcvNxt, len: 0 });
    }
    return out;
  }
  if (flags.includes("DATA")) {
    if (g.seq === me.rcvNxt) {
      me.rcvNxt += g.len;
      say(`${name(r)}: received ${g.len} bytes (seq ${g.seq}–${g.seq + g.len - 1}) → ACK=${me.rcvNxt} ("next byte I expect").`);
    } else {
      say(`${name(r)}: duplicate/out-of-order data (seq ${g.seq}, expected ${me.rcvNxt}) → re-ACK ${me.rcvNxt}.`);
    }
    out.push({ from: r, flags: ["ACK"], seq: me.sndNxt, ack: me.rcvNxt, len: 0 });
    return out;
  }
  if (flags.includes("FIN")) {
    me.rcvNxt = g.seq + 1;
    if (me.state === "ESTABLISHED") {
      me.state = "CLOSE_WAIT";
      say(`${name(r)}: FIN received → CLOSE_WAIT. ACKs it. Its application must now call close() — until then it can still send (half-close).`);
    } else if (me.state === "FIN_WAIT_2" || me.state === "FIN_WAIT_1") {
      me.state = me.state === "FIN_WAIT_1" ? "CLOSING" : "TIME_WAIT";
      say(`${name(r)}: peer's FIN received → ${me.state}. ACKs it.${me.state === "TIME_WAIT" ? " Waits 2×MSL (60 s on Linux) in case this ACK is lost." : ""}`);
    }
    out.push({ from: r, flags: ["ACK"], seq: me.sndNxt, ack: me.rcvNxt, len: 0 });
    return out;
  }
  // pure ACK: state transitions
  if (flags.includes("ACK")) {
    if (me.state === "SYN_RECV" && g.ack === me.isn + 1) {
      me.state = "ESTABLISHED";
      say("Server: final ACK received → ESTABLISHED (moved to the accept queue; accept() will return it).");
    } else if (me.state === "FIN_WAIT_1" && g.ack === me.sndNxt) {
      me.state = "FIN_WAIT_2";
      say(`${name(r)}: its FIN was ACKed → FIN_WAIT_2 (waiting for the peer to close its side).`);
    } else if (me.state === "CLOSING" && g.ack === me.sndNxt) {
      me.state = "TIME_WAIT";
      say(`${name(r)}: → TIME_WAIT.`);
    } else if (me.state === "LAST_ACK" && g.ack === me.sndNxt) {
      me.state = "CLOSED";
      say(`${name(r)}: last ACK received → CLOSED. Its socket is fully released (no TIME_WAIT for the passive closer).`);
    }
  }
  return out;
}

export default function TcpHandshake() {
  const [w, setW] = useState<World>(init);
  const [dropMode, setDropMode] = useState<"0" | "1" | "2">("0");

  function send(world: World, seg: Omit<Seg, "id" | "lost">, reliable: boolean, _drop?: boolean) {
    world.chain += 1;
    const drop = world.dropAt > 0 && world.chain === world.dropAt;
    const g: Seg = { ...seg, id: world.nextId++, lost: drop };
    world.segs.push(g);
    if (reliable) world.unacked[seg.from] = g;
    if (drop) {
      world.log.push(`✗ ${name(seg.from)}'s ${label(g)} was LOST in the network. ${reliable ? `${name(seg.from)} will retransmit when its RTO fires.` : "Pure ACKs aren't retransmitted; the peer will retransmit its segment instead."}`);
      return;
    }
    // chain automatic responses (no further loss injection)
    const follow = deliver(world, g);
    for (const f of follow) send(world, f, f.flags.includes("SYN") || f.flags.includes("FIN") || f.flags.includes("DATA"), false);
  }

  function act(fn: (world: World, drop: boolean) => void, injectLoss = true) {
    setW((cur) => {
      const world: World = structuredClone(cur);
      world.chain = 0;
      world.dropAt = injectLoss ? Number(dropMode) : 0;
      fn(world, false);
      return world;
    });
    if (injectLoss) setDropMode("0");
  }

  const c = w.C;
  const s = w.S;
  const connect = () =>
    act((world, drop) => {
      world.C.state = "SYN_SENT";
      world.C.sndNxt = world.C.isn + 1;
      world.log.push(`Client: connect() → sends SYN with random ISN ${world.C.isn} → SYN_SENT.`);
      send(world, { from: "C", flags: ["SYN"], seq: world.C.isn, len: 0 }, true, drop);
    });
  const sendData = (from: Side, len: number) =>
    act((world, drop) => {
      const e = world[from];
      const seq = e.sndNxt;
      e.sndNxt += len;
      world.log.push(`${name(from)}: write() ${len} bytes → segment seq=${seq}.`);
      send(world, { from, flags: ["DATA", "ACK"], seq, ack: e.rcvNxt, len }, true, drop);
    });
  const close = (from: Side) =>
    act((world, drop) => {
      const e = world[from];
      const seq = e.sndNxt;
      e.sndNxt += 1;
      e.state = e.state === "CLOSE_WAIT" ? "LAST_ACK" : "FIN_WAIT_1";
      world.log.push(`${name(from)}: close() → sends FIN → ${e.state}.`);
      send(world, { from, flags: ["FIN", "ACK"], seq, ack: e.rcvNxt, len: 0 }, true, drop);
    });
  const retransmit = (from: Side) =>
    act((world) => {
      const g = world.unacked[from];
      if (!g) return;
      world.log.push(`${name(from)}: RTO expired (Linux initial RTO: 1 s for SYN, then doubling) → retransmits ${label(g)}.`);
      send(world, { from: g.from, flags: g.flags, seq: g.seq, ack: g.ack, len: g.len, retx: true }, true, false);
    }, false);
  const expireTimeWait = () =>
    act((world) => {
      for (const side of ["C", "S"] as Side[]) {
        if (world[side].state === "TIME_WAIT") {
          world[side].state = "CLOSED";
          world.log.push(`${name(side)}: 2×MSL elapsed → CLOSED. The 4-tuple can be reused.`);
        }
      }
    });

  const bothOpen = c.state === "ESTABLISHED" && s.state === "ESTABLISHED";
  const canSendC = ["ESTABLISHED", "CLOSE_WAIT"].includes(c.state);
  const canSendS = ["ESTABLISHED", "CLOSE_WAIT"].includes(s.state);

  const H = Math.max(120, w.segs.length * 44 + 30);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Btn variant="primary" onClick={connect} disabled={c.state !== "CLOSED" || s.state !== "LISTEN"}>
          Client connect()
        </Btn>
        <Btn onClick={() => sendData("C", 100)} disabled={!canSendC}>
          Client sends 100 B
        </Btn>
        <Btn onClick={() => sendData("S", 300)} disabled={!canSendS}>
          Server sends 300 B
        </Btn>
        <Btn onClick={() => close("C")} disabled={!["ESTABLISHED", "CLOSE_WAIT"].includes(c.state)}>
          Client close()
        </Btn>
        <Btn onClick={() => close("S")} disabled={!["ESTABLISHED", "CLOSE_WAIT"].includes(s.state)}>
          Server close()
        </Btn>
        <Btn onClick={expireTimeWait} disabled={c.state !== "TIME_WAIT" && s.state !== "TIME_WAIT"}>
          Wait 2×MSL
        </Btn>
        <label className={cn("ml-1 flex items-center gap-2 rounded-lg border px-2.5 py-1 text-[13px]", dropMode !== "0" ? "border-bad/50 bg-bad/10 text-bad" : "border-border text-muted")}>
          Next action: lose
          <select value={dropMode} onChange={(e) => setDropMode(e.target.value as "0" | "1" | "2")} className="rounded border border-border bg-surface px-1 text-[12.5px]">
            <option value="0">nothing</option>
            <option value="1">its first segment</option>
            <option value="2">the reply (e.g. SYN-ACK / ACK)</option>
          </select>
        </label>
        <Btn variant="ghost" onClick={() => setW(init())}>
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </Btn>
      </div>
      {(w.unacked.C || w.unacked.S) && (
        <div className="flex flex-wrap gap-2">
          {(["C", "S"] as Side[]).map((sd) =>
            w.unacked[sd] ? (
              <Btn key={sd} variant="danger" onClick={() => retransmit(sd)}>
                {name(sd)} RTO fires → retransmit
              </Btn>
            ) : null,
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="overflow-x-auto rounded-xl border border-border bg-surface p-2 thin-scroll">
          <svg viewBox={`0 0 560 ${H}`} className="w-full min-w-[460px]" role="img" aria-label="TCP segment sequence diagram">
            <defs>
              <marker id="tcpa" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
              </marker>
              <marker id="tcpl" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="var(--bad)" />
              </marker>
            </defs>
            <text x={80} y={16} textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--fg)">Client :51514</text>
            <text x={480} y={16} textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--fg)">Server :443</text>
            <line x1={80} x2={80} y1={24} y2={H} stroke="var(--border-strong)" />
            <line x1={480} x2={480} y1={24} y2={H} stroke="var(--border-strong)" />
            {w.segs.map((g, i) => {
              const y1 = 36 + i * 44;
              const y2 = y1 + 30;
              const fromX = g.from === "C" ? 80 : 480;
              const toX = g.from === "C" ? 480 : 80;
              const endX = g.lost ? fromX + (toX - fromX) * 0.55 : toX;
              const endY = g.lost ? y1 + 16 : y2;
              return (
                <g key={g.id}>
                  <line x1={fromX} y1={y1} x2={endX} y2={endY} stroke={g.lost ? "var(--bad)" : "var(--accent)"} strokeWidth={1.8} strokeDasharray={g.lost ? "5 4" : undefined} markerEnd={g.lost ? undefined : "url(#tcpa)"} />
                  {g.lost && (
                    <text x={endX} y={endY + 5} textAnchor="middle" fontSize="16" fontWeight="700" fill="var(--bad)">
                      ✕
                    </text>
                  )}
                  <text x={280} y={(y1 + y2) / 2 - 6} textAnchor="middle" fontSize="11.5" fontFamily="var(--font-mono)" fill={g.lost ? "var(--bad)" : "var(--fg)"} paintOrder="stroke" stroke="var(--surface)" strokeWidth={4}>
                    {g.retx ? "↻ " : ""}
                    {label(g)}
                  </text>
                </g>
              );
            })}
            {!w.segs.length && (
              <text x={280} y={70} textAnchor="middle" fontSize="12" fill="var(--subtle)">
                Press “Client connect()” to start the three-way handshake
              </text>
            )}
          </svg>
        </div>
        <div className="space-y-3">
          {(["C", "S"] as Side[]).map((sd) => {
            const e = w[sd];
            return (
              <Panel key={sd} title={name(sd)}>
                <div className="font-mono text-[15px] font-semibold text-accent">{e.state}</div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[12px]">
                  <dt className="text-subtle">ISN</dt>
                  <dd>{e.isn}</dd>
                  <dt className="text-subtle">SND.NXT</dt>
                  <dd>{e.sndNxt}</dd>
                  <dt className="text-subtle">SND.UNA</dt>
                  <dd>{e.sndUna}</dd>
                  <dt className="text-subtle">RCV.NXT</dt>
                  <dd>{e.rcvNxt || "—"}</dd>
                </dl>
              </Panel>
            );
          })}
          {bothOpen && <Explain tone="good">Both ends ESTABLISHED: the handshake cost one round trip before the first data byte.</Explain>}
        </div>
      </div>

      <Panel title="What just happened">
        <ol className="max-h-56 space-y-1 overflow-y-auto text-[13px] thin-scroll">
          {[...w.log].reverse().map((l, i) => (
            <li key={w.log.length - i} className={cn(i === 0 ? "text-fg" : "text-muted", l.startsWith("✗") && "text-bad")}>
              {l}
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
