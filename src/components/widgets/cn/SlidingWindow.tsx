"use client";
import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Btn, Explain, Field, NumberInput, Panel, Stat } from "../ui";
import { cn } from "@/lib/utils";

const N = 24;

interface W {
  base: number; // oldest unacked
  next: number; // next new segment to send
  rwnd: number; // last advertised receive window
  inflight: number[]; // sent but unacked (by id)
  lostSent: number[]; // sent but lost in the network
  received: boolean[]; // receiver has segment
  rcvNext: number;
  appRead: number;
  dupAcks: number;
  retransmitNext: boolean;
  round: number;
  log: { round: number; lines: string[] }[];
}

const init = (buf: number): W => ({
  base: 0,
  next: 0,
  rwnd: buf,
  inflight: [],
  lostSent: [],
  received: Array(N).fill(false),
  rcvNext: 0,
  appRead: 0,
  dupAcks: 0,
  retransmitNext: false,
  round: 0,
  log: [{ round: 0, lines: [`Receiver buffer: ${buf} segments. The sender may have at most min(cwnd, rwnd) unacknowledged segments.`] }],
});

export default function SlidingWindow() {
  const [buf, setBuf] = useState(8);
  const [cwnd, setCwnd] = useState(6);
  const [readRate, setReadRate] = useState(3);
  const [lossTarget, setLossTarget] = useState<number | null>(null);
  const [w, setW] = useState<W>(() => init(8));

  function round() {
    setW((cur) => {
      const s: W = structuredClone(cur);
      s.round += 1;
      const log: string[] = [];
      const win = Math.min(cwnd, s.rwnd);
      const sent: number[] = [];
      // 1) retransmit if fast retransmit / RTO triggered
      let retx: number | null = null;
      if (s.retransmitNext && s.base < N && !s.received[s.base]) {
        retx = s.base;
        sent.push(s.base);
      }
      s.retransmitNext = false;
      // 2) send new segments within the window
      const fresh: number[] = [];
      while (s.next < N && s.next < s.base + win) {
        sent.push(s.next);
        fresh.push(s.next);
        s.inflight.push(s.next);
        s.next += 1;
      }
      const parts: string[] = [];
      if (retx !== null) parts.push(`retransmit ${retx}`);
      if (fresh.length) parts.push(`send ${fresh.join(", ")}`);
      if (parts.length) log.push(`${parts.join("; ")} — window = min(cwnd ${cwnd}, rwnd ${s.rwnd}) = ${win}.`);
      else log.push(win === 0 ? "Window is 0 → the sender stops; its persist timer will send a small window probe." : "Nothing new may be sent: the window is full of unacknowledged data.");

      // 3) network + receiver
      const acks: number[] = [];
      for (const seg of sent) {
        if (lossTarget === seg && !s.lostSent.includes(seg) && !s.received[seg]) {
          s.lostSent.push(seg);
          log.push(`✗ Segment ${seg} lost in the network.`);
          continue;
        }
        const held = s.received.filter((r, i) => r && i >= s.appRead).length;
        if (held >= buf && seg !== s.rcvNext) {
          log.push(`Receiver buffer full — segment ${seg} dropped.`);
          continue;
        }
        s.received[seg] = true;
        while (s.rcvNext < N && s.received[s.rcvNext]) s.rcvNext += 1;
        acks.push(s.rcvNext);
      }
      // 4) application reads (only in-order data is readable)
      const r = Math.min(readRate, s.rcvNext - s.appRead);
      s.appRead += r;
      const occupancy = s.received.filter((x, i) => x && i >= s.appRead).length;
      s.rwnd = Math.max(0, buf - occupancy);
      if (r) log.push(`Application read ${r} segment(s); buffer holds ${occupancy} → advertises rwnd = ${s.rwnd}.`);
      else if (readRate === 0) log.push(`Application isn't reading; buffer holds ${occupancy} → rwnd = ${s.rwnd}.`);
      else if (occupancy) log.push(`Nothing readable: a hole at ${s.rcvNext} blocks ${occupancy} buffered out-of-order segment(s) → rwnd = ${s.rwnd}.`);

      // 5) sender processes ACKs one by one
      for (const a of acks) {
        if (a > s.base) {
          s.base = a;
          s.dupAcks = 0;
        } else if (s.base < N) {
          s.dupAcks += 1;
          if (s.dupAcks === 3) {
            log.push(`3rd duplicate ACK for ${s.base} → fast retransmit of segment ${s.base} (no timeout wait).`);
            s.retransmitNext = true;
          }
        }
      }
      if (acks.length) log.push(`ACKs: ${acks.join(", ")} → oldest unacked = ${s.base >= N ? "none (all acked)" : s.base}.`);
      s.inflight = s.inflight.filter((x) => x >= s.base);
      if (!acks.length && s.base < s.next && !s.retransmitNext) {
        log.push(`No ACKs this round → retransmission timeout fires for segment ${s.base}.`);
        s.retransmitNext = true;
      }
      s.lostSent = s.lostSent.filter((x) => !s.received[x]);
      s.log = [{ round: s.round, lines: log }, ...s.log].slice(0, 40);
      return s;
    });
  }

  const reset = () => {
    setW(init(buf));
    setLossTarget(null);
  };
  const winRight = Math.min(N, w.base + Math.min(cwnd, w.rwnd));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Receiver buffer (segments)">
          <NumberInput value={buf} min={1} max={16} onChange={(v) => { const b = Math.max(1, Math.min(16, v)); setBuf(b); setW(init(b)); }} />
        </Field>
        <Field label="cwnd (segments)">
          <NumberInput value={cwnd} min={1} max={16} onChange={(v) => setCwnd(Math.max(1, Math.min(16, v)))} />
        </Field>
        <Field label="App reads / round" hint="0 = application stalled">
          <NumberInput value={readRate} min={0} max={16} onChange={(v) => setReadRate(Math.max(0, Math.min(16, v)))} />
        </Field>
        <Field label="Lose segment #">
          <NumberInput value={lossTarget ?? -1} min={-1} max={N - 1} onChange={(v) => setLossTarget(v < 0 ? null : Math.min(N - 1, v))} />
        </Field>
        <Btn variant="primary" onClick={round} disabled={w.base >= N}>
          Next round trip
        </Btn>
        <Btn variant="ghost" onClick={reset}>
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </Btn>
      </div>

      <Panel title="Sender's view of the byte stream">
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: N }, (_, i) => {
            const acked = i < w.base;
            const inflight = !acked && i < w.next;
            const lost = w.lostSent.includes(i) && !w.received[i];
            const sendable = !acked && !inflight && i < winRight;
            return (
              <div
                key={i}
                title={`segment ${i}`}
                className={cn(
                  "grid h-9 w-9 place-items-center rounded-md border font-mono text-[11px]",
                  acked && "border-ok/50 bg-ok/15 text-ok",
                  inflight && !lost && "border-d-core/60 bg-d-core/15 text-d-core",
                  lost && "border-bad/60 bg-bad/15 text-bad",
                  sendable && "border-dashed border-accent text-accent",
                  !acked && !inflight && !sendable && "border-border text-subtle",
                )}
              >
                {lost ? "✕" : i}
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-[12px] text-muted">
          <span className="text-ok">■ acked</span>
          <span className="text-d-core">■ in flight</span>
          <span className="text-accent">□ sendable (inside window)</span>
          <span className="text-subtle">□ not yet allowed</span>
          <span className="text-bad">✕ lost</span>
        </div>
      </Panel>

      <Panel title="Receiver buffer">
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: N }, (_, i) => {
            const read = i < w.appRead;
            const inOrder = !read && i < w.rcvNext;
            const ooo = !read && i >= w.rcvNext && w.received[i];
            return (
              <div
                key={i}
                className={cn(
                  "grid h-9 w-9 place-items-center rounded-md border font-mono text-[11px]",
                  read && "border-border bg-surface-2 text-subtle",
                  inOrder && "border-d-core/60 bg-d-core/15 text-d-core",
                  ooo && "border-d-advanced/60 bg-d-advanced/15 text-d-advanced",
                  !read && !inOrder && !ooo && "border-dashed border-border text-transparent",
                )}
              >
                {i}
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-[12px] text-muted">
          <span>■ read by app</span>
          <span className="text-d-core">■ buffered in order (waiting for read())</span>
          <span className="text-d-advanced">■ buffered out of order (hole before it — HOL blocking)</span>
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Round" value={w.round} />
        <Stat label="Advertised rwnd" value={w.rwnd} />
        <Stat label="Effective window" value={Math.min(cwnd, w.rwnd)} sub="min(cwnd, rwnd)" />
        <Stat label="Delivered to app" value={`${w.appRead}/${N}`} />
      </div>

      <Panel title="Event log (newest round first)">
        <ol className="max-h-56 space-y-2 overflow-y-auto text-[12.5px] thin-scroll">
          {w.log.map((g, i) => (
            <li key={g.round} className={cn("rounded-md border border-border px-2 py-1.5", i === 0 ? "bg-surface-2" : "opacity-75")}>
              {g.round > 0 && <div className="mb-0.5 font-mono text-[11px] text-subtle">round {g.round}</div>}
              <ul className="space-y-0.5">
                {g.lines.map((l, k) => (
                  <li key={k} className={cn(l.startsWith("✗") && "text-bad", l.startsWith("3rd") && "text-warn")}>
                    {l}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </Panel>
      <Explain>
        Try: set “App reads / round” to 0 and watch rwnd fall to zero — the sender stops even though the network is fine (flow control). Then lose segment 3: later
        segments arrive out of order, duplicate ACKs accumulate, and a fast retransmit repairs the hole.
      </Explain>
    </div>
  );
}
