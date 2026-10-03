"use client";
import { useMemo, useState } from "react";
import { Explain, Field, NumberInput, Panel, Select } from "../ui";
import { colorFor } from "../ui";

type Mode = "h1-serial" | "h1-multi" | "h2" | "h3";
const STREAMS = ["A", "B", "C"] as const;
const PER = 4;

const MODES: { id: Mode; name: string; transport: string; note: string }[] = [
  { id: "h1-serial", name: "HTTP/1.1, one connection", transport: "1 TCP connection, responses in sequence", note: "Responses can't interleave: B waits for all of A even with no loss (application-level HOL)." },
  { id: "h1-multi", name: "HTTP/1.1, 3 connections", transport: "3 TCP connections", note: "Loss only stalls its own connection — at the cost of 3 handshakes, 3 congestion controllers and more server sockets." },
  { id: "h2", name: "HTTP/2", transport: "1 TCP connection, multiplexed streams", note: "One lost packet stalls every stream: TCP must deliver bytes in order, and it has no idea the bytes belong to different streams." },
  { id: "h3", name: "HTTP/3 (QUIC)", transport: "1 QUIC connection over UDP", note: "Streams are ordered independently; a loss delays only the stream whose data was in that packet." },
];

interface Pkt {
  id: string;
  stream: number;
  send: number;
  arrive: number;
  deliver: number;
  lost: boolean;
  firstArrive: number;
}

function run(mode: Mode, lostId: string, d: number): Pkt[] {
  const order: { stream: number; seq: number }[] = [];
  if (mode === "h1-serial") STREAMS.forEach((_, s) => { for (let k = 1; k <= PER; k++) order.push({ stream: s, seq: k }); });
  else for (let k = 1; k <= PER; k++) STREAMS.forEach((_, s) => order.push({ stream: s, seq: k }));
  const retx = 2 * d + 2; // ≈ one RTT to detect via duplicate ACKs, plus the retransmission
  const domainMax: Record<string, number> = {};
  return order.map((o, i) => {
    const id = `${STREAMS[o.stream]}${o.seq}`;
    const lost = id === lostId;
    const firstArrive = i + d;
    const arrive = lost ? firstArrive + retx : firstArrive;
    const domain = mode === "h1-multi" || mode === "h3" ? `s${o.stream}` : "conn";
    const deliver = Math.max(arrive, domainMax[domain] ?? 0);
    domainMax[domain] = deliver;
    return { id, stream: o.stream, send: i, arrive, deliver, lost, firstArrive };
  });
}

const W = 700;
const LANE = 22;

export default function HolBlocking() {
  const [lost, setLost] = useState("A2");
  const [d, setD] = useState(4);
  const all = useMemo(() => MODES.map((m) => ({ ...m, pkts: run(m.id, lost, d) })), [lost, d]);
  const maxT = Math.max(...all.flatMap((m) => m.pkts.map((p) => p.deliver))) + 2;
  const x = (t: number) => 70 + (t / maxT) * (W - 80);
  const opts = [{ value: "none", label: "no loss" }, ...STREAMS.flatMap((s) => Array.from({ length: PER }, (_, k) => ({ value: `${s}${k + 1}`, label: `lose ${s}${k + 1}` })))];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Lost packet">
          <Select value={lost} onChange={setLost} options={opts} />
        </Field>
        <Field label="One-way delay (ticks)">
          <NumberInput value={d} min={1} max={10} onChange={(v) => setD(Math.max(1, Math.min(10, v)))} />
        </Field>
        <p className="max-w-md pb-1 text-[12px] text-subtle">Three responses (A, B, C) of four packets each share one bottleneck: one packet leaves per tick. A lost packet is repaired about one RTT later.</p>
      </div>

      {all.map((m) => {
        const H = STREAMS.length * LANE + 26;
        const done = STREAMS.map((_, s) => Math.max(...m.pkts.filter((p) => p.stream === s).map((p) => p.deliver)));
        const held = m.pkts.filter((p) => !p.lost && p.deliver > p.arrive).length;
        return (
          <Panel key={m.id} title={m.name} right={<span className="text-[11.5px] text-subtle">{m.transport}</span>}>
            <div className="overflow-x-auto thin-scroll">
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[520px]" role="img" aria-label={`${m.name} delivery timeline`}>
                {STREAMS.map((s, si) => {
                  const y = 8 + si * LANE;
                  return (
                    <g key={s}>
                      <text x={4} y={y + 10} fontSize="10.5" fontWeight={600} fill={colorFor(si)}>
                        stream {s}
                      </text>
                      <line x1={x(0)} x2={W - 8} y1={y + 6} y2={y + 6} stroke="var(--border)" />
                      {m.pkts
                        .filter((p) => p.stream === si)
                        .map((p) => (
                          <g key={p.id}>
                            {p.lost && (
                              <text x={x(p.firstArrive)} y={y + 10} fontSize="11" textAnchor="middle" fill="var(--bad)">
                                ✕
                              </text>
                            )}
                            {p.deliver > p.arrive && <rect x={x(p.arrive)} y={y + 3} width={x(p.deliver) - x(p.arrive)} height={6} fill="var(--warn)" opacity={0.45} rx={2} />}
                            <rect x={x(p.arrive) - 3.5} y={y + 2.5} width={7} height={7} fill="none" stroke={colorFor(si)} strokeWidth={1.3} rx={1} />
                            <rect x={x(p.deliver) - 3} y={y + 3} width={6} height={6} fill={colorFor(si)} rx={1} />
                          </g>
                        ))}
                      <line x1={x(done[si])} x2={x(done[si])} y1={y} y2={y + 12} stroke="var(--fg)" strokeWidth={1.5} />
                      <text x={x(done[si]) + 4} y={y + 10} fontSize="9.5" fill="var(--muted)">
                        done t={done[si]}
                      </text>
                    </g>
                  );
                })}
                {Array.from({ length: Math.floor(maxT / 5) + 1 }, (_, k) => k * 5).map((t) => (
                  <text key={t} x={x(t)} y={H - 3} fontSize="9" fill="var(--subtle)" textAnchor="middle">
                    {t}
                  </text>
                ))}
              </svg>
            </div>
            <p className="mt-1 text-[12.5px] text-muted">
              {held ? <span className="font-medium text-warn">{held} packet(s) arrived but were held behind the gap. </span> : <span className="font-medium text-ok">No packet waited behind another stream&apos;s loss. </span>}
              {m.note}
            </p>
          </Panel>
        );
      })}

      <div className="flex flex-wrap gap-4 text-[12px] text-muted">
        <span>□ packet arrived</span>
        <span>■ delivered to the application</span>
        <span className="text-warn">▬ held in the receive buffer (head-of-line blocked)</span>
        <span className="text-bad">✕ original transmission lost</span>
      </div>
      <Explain>
        With no loss, notice that HTTP/2 finishes A later than serialized HTTP/1.1 — interleaving trades first-response latency for fairness. With a loss early in the
        stream, HTTP/2 is the only one where B and C pay for A&apos;s packet.
      </Explain>
    </div>
  );
}
