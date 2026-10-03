"use client";
import { useMemo, useState } from "react";
import { Shuffle } from "lucide-react";
import { Btn, Explain, Field, NumberInput, Panel } from "../ui";
import { cn } from "@/lib/utils";

const T = 60; // seconds of simulated time
const HDR = 700; // bytes of HTTP request + response headers (HTTP/1.1 with cookies)
const PAYLOAD = 120; // bytes per event

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function genEvents(perMin: number, seed: number) {
  const r = rng(seed);
  const out: number[] = [];
  const mean = 60 / perMin;
  let t = 0;
  for (;;) {
    t += -Math.log(1 - r()) * mean;
    if (t >= T) break;
    out.push(t);
  }
  return out;
}

interface Req {
  start: number;
  end: number;
  empty: boolean;
}
interface Result {
  key: string;
  name: string;
  requests: Req[];
  deliveries: { e: number; at: number }[];
  bytes: number;
  pending: number;
  note: string;
}

function polling(events: number[], P: number, rtt: number): Result {
  const h = rtt / 2;
  const requests: Req[] = [];
  const deliveries: Result["deliveries"] = [];
  let i = 0;
  for (let t = 0; t < T; t += P) {
    const atServer = t + h;
    let got = 0;
    while (i < events.length && events[i] <= atServer) {
      deliveries.push({ e: events[i], at: t + rtt });
      i++;
      got++;
    }
    requests.push({ start: t, end: t + rtt, empty: got === 0 });
  }
  return {
    key: "poll",
    name: `Short polling (every ${P}s)`,
    requests,
    deliveries,
    bytes: requests.length * HDR + deliveries.length * PAYLOAD,
    pending: events.length - i,
    note: "Simple and cache/proxy friendly; latency ≈ interval/2 on average, and most requests come back empty.",
  };
}

function longPolling(events: number[], timeout: number, rtt: number): Result {
  const h = rtt / 2;
  const requests: Req[] = [];
  const deliveries: Result["deliveries"] = [];
  let i = 0;
  let t = 0;
  while (t < T) {
    const arrive = t + h;
    let respondAt: number;
    let empty = false;
    if (i < events.length && events[i] <= arrive) respondAt = arrive; // events queued while no request was parked
    else if (i < events.length && events[i] < arrive + timeout) respondAt = events[i];
    else {
      respondAt = arrive + timeout;
      empty = true;
    }
    const at = respondAt + h;
    while (i < events.length && events[i] <= respondAt) deliveries.push({ e: events[i++], at });
    requests.push({ start: t, end: at, empty });
    t = at; // client re-requests immediately
  }
  return {
    key: "long",
    name: `Long polling (timeout ${timeout}s)`,
    requests,
    deliveries,
    bytes: requests.length * HDR + deliveries.length * PAYLOAD,
    pending: events.length - i,
    note: "Near-real-time over plain HTTP; one full request per event batch, and events that fire between a response and the next request wait an extra round trip.",
  };
}

function streaming(events: number[], rtt: number, kind: "sse" | "ws"): Result {
  const h = rtt / 2;
  const frame = kind === "sse" ? 10 : 6;
  return {
    key: kind,
    name: kind === "sse" ? "Server-Sent Events" : "WebSocket",
    requests: [{ start: 0, end: T, empty: false }],
    deliveries: events.map((e) => ({ e, at: Math.max(e, h) + h })),
    bytes: HDR + events.length * (PAYLOAD + frame),
    pending: 0,
    note:
      kind === "sse"
        ? "One long-lived HTTP response; server → client only, auto-reconnect with Last-Event-ID, works through most HTTP infrastructure."
        : "One upgraded connection; full-duplex frames with ~2–14 bytes of overhead. Needs sticky, long-lived connections through every proxy and load balancer.",
  };
}

const W = 720;
const LANE = 46;
const PAD_L = 8;
const PAD_R = 8;

export default function RealtimeTransports() {
  const [perMin, setPerMin] = useState(12);
  const [interval, setIntervalS] = useState(5);
  const [timeout, setTimeoutS] = useState(25);
  const [rtt, setRtt] = useState(150);
  const [seed, setSeed] = useState(7);

  const events = useMemo(() => genEvents(Math.max(1, perMin), seed), [perMin, seed]);
  const results = useMemo(() => {
    const r = rtt / 1000;
    return [polling(events, Math.max(0.5, interval), r), longPolling(events, Math.max(1, timeout), r), streaming(events, r, "sse"), streaming(events, r, "ws")];
  }, [events, interval, timeout, rtt]);

  const x = (t: number) => PAD_L + (Math.min(t, T) / T) * (W - PAD_L - PAD_R);
  const H = 28 + results.length * LANE + 18;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Server events / minute">
          <NumberInput value={perMin} min={1} max={120} onChange={(v) => setPerMin(Math.max(1, Math.min(120, v)))} />
        </Field>
        <Field label="Poll interval (s)">
          <NumberInput value={interval} min={0.5} max={30} step={0.5} onChange={(v) => setIntervalS(Math.max(0.5, Math.min(30, v)))} />
        </Field>
        <Field label="Long-poll timeout (s)">
          <NumberInput value={timeout} min={1} max={60} onChange={(v) => setTimeoutS(Math.max(1, Math.min(60, v)))} />
        </Field>
        <Field label="RTT (ms)">
          <NumberInput value={rtt} min={10} max={1000} step={10} onChange={(v) => setRtt(Math.max(10, Math.min(1000, v)))} />
        </Field>
        <Btn onClick={() => setSeed((s) => s + 1)}>
          <Shuffle className="h-3.5 w-3.5" /> New event pattern
        </Btn>
      </div>

      <Panel title={`60 seconds, ${events.length} server-side events`}>
        <div className="overflow-x-auto thin-scroll">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[560px]" role="img" aria-label="Timeline of requests and event deliveries per transport">
            <text x={PAD_L} y={11} fontSize="10" fill="var(--subtle)">
              server events
            </text>
            {events.map((e, i) => (
              <line key={i} x1={x(e)} x2={x(e)} y1={14} y2={24} stroke="var(--warn)" strokeWidth={2} />
            ))}
            {results.map((r, li) => {
              const y0 = 28 + li * LANE;
              return (
                <g key={r.key}>
                  <text x={PAD_L} y={y0 + 11} fontSize="10.5" fontWeight={600} fill="var(--fg)">
                    {r.name}
                  </text>
                  {r.requests.map((q, k) => (
                    <rect
                      key={k}
                      x={x(q.start)}
                      y={y0 + 16}
                      width={Math.max(1.5, x(q.end) - x(q.start) - 1)}
                      height={8}
                      rx={2}
                      fill={q.empty ? "var(--border-strong)" : "var(--accent)"}
                      opacity={r.requests.length === 1 ? 0.35 : 0.85}
                    />
                  ))}
                  {r.deliveries.map((d, k) => (
                    <g key={k}>
                      <line x1={x(d.e)} x2={x(d.at)} y1={y0 + 32} y2={y0 + 32} stroke="var(--warn)" strokeWidth={1.5} />
                      <circle cx={x(d.at)} cy={y0 + 32} r={2.6} fill="var(--ok)" />
                    </g>
                  ))}
                </g>
              );
            })}
            {[0, 10, 20, 30, 40, 50, 60].map((t) => (
              <text key={t} x={x(t)} y={H - 4} fontSize="9.5" fill="var(--subtle)" textAnchor={t === 0 ? "start" : t === 60 ? "end" : "middle"}>
                {t}s
              </text>
            ))}
          </svg>
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-[12px] text-muted">
          <span className="text-accent">▬ request carrying data</span>
          <span>▬ empty response (pure overhead)</span>
          <span className="text-warn">— wait from event to delivery</span>
          <span className="text-ok">● delivered to the client</span>
        </div>
      </Panel>

      <Panel title="Cost and latency">
        <div className="overflow-x-auto thin-scroll">
          <table className="w-full min-w-[560px] text-[12.5px]">
            <thead className="text-left text-[11px] text-subtle uppercase">
              <tr>
                <th className="pb-1">Transport</th>
                <th className="text-right">HTTP requests</th>
                <th className="text-right">Empty</th>
                <th className="text-right">Avg latency</th>
                <th className="text-right">Max latency</th>
                <th className="text-right">Bytes on wire</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => {
                const lat = r.deliveries.map((d) => d.at - d.e);
                const avg = lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : 0;
                const max = lat.length ? Math.max(...lat) : 0;
                const empty = r.requests.filter((q) => q.empty).length;
                return (
                  <tr key={r.key} className="border-t border-border">
                    <td className="py-1.5 font-medium">{r.name}</td>
                    <td className="text-right font-mono">{r.requests.length}</td>
                    <td className={cn("text-right font-mono", empty > r.requests.length / 2 && "text-warn")}>{empty}</td>
                    <td className="text-right font-mono">{avg < 1 ? `${Math.round(avg * 1000)} ms` : `${avg.toFixed(2)} s`}</td>
                    <td className="text-right font-mono">{max < 1 ? `${Math.round(max * 1000)} ms` : `${max.toFixed(2)} s`}</td>
                    <td className="text-right font-mono">{(r.bytes / 1000).toFixed(1)} KB</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ul className="mt-3 space-y-1 text-[12.5px] text-muted">
          {results.map((r) => (
            <li key={r.key}>
              <span className="font-medium text-fg">{r.name.split(" (")[0]}:</span> {r.note}
            </li>
          ))}
        </ul>
      </Panel>
      <Explain>
        Per-client numbers. Multiply by a million connected clients: polling costs requests per second whether or not anything happens; SSE and WebSockets cost
        memory and file descriptors per idle connection instead — a different scaling bottleneck, not a free one.
      </Explain>
    </div>
  );
}
