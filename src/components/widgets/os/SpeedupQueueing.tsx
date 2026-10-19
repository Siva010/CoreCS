"use client";
import { useState } from "react";
import { amdahl, gustafson, mmc, usl, uslPeak } from "@/lib/sim/perfMath";
import { Btn, Explain, Field, NumberInput, Panel, Segmented, Stat } from "../ui";

type Tab = "speedup" | "little" | "queue";

const W = 600;
const H = 240;
const PAD = { l: 44, r: 12, t: 12, b: 30 };

/** A small line chart: x from 1..xMax (log scale optional), several series. */
function Chart({
  series,
  xMax,
  yMax,
  xLabel,
  yLabel,
  log,
  marker,
}: {
  series: { name: string; color: string; f: (x: number) => number; dash?: string }[];
  xMax: number;
  yMax: number;
  xLabel: string;
  yLabel: string;
  log?: boolean;
  marker?: { x: number; y: number };
}) {
  const xMin = log ? 1 : 0;
  const sx = (x: number) => PAD.l + ((log ? Math.log2(x) - Math.log2(xMin) : x - xMin) / (log ? Math.log2(xMax) : xMax - xMin)) * (W - PAD.l - PAD.r);
  const sy = (y: number) => H - PAD.b - (Math.min(y, yMax) / yMax) * (H - PAD.t - PAD.b);
  const xs = Array.from({ length: 121 }, (_, i) => (log ? 2 ** ((i / 120) * Math.log2(xMax)) : xMin + (i / 120) * (xMax - xMin)));
  const xTicks = log ? Array.from({ length: Math.floor(Math.log2(xMax)) + 1 }, (_, i) => 2 ** i).filter((v, i, a) => a.length < 9 || i % 2 === 0) : [0, 0.25, 0.5, 0.75, 1].map((f) => f * xMax);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  const fmt = (v: number) => (v >= 10 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(2).replace(/0$/, ""));
  return (
    <div className="overflow-x-auto thin-scroll">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[460px]" role="img" aria-label={`${yLabel} against ${xLabel}`}>
        {yTicks.map((y) => (
          <g key={y}>
            <line x1={PAD.l} x2={W - PAD.r} y1={sy(y)} y2={sy(y)} stroke="var(--border)" />
            <text x={PAD.l - 6} y={sy(y) + 4} fontSize="10" textAnchor="end" fill="var(--subtle)">
              {fmt(y)}
            </text>
          </g>
        ))}
        {xTicks.map((x) => (
          <text key={x} x={sx(Math.max(x, xMin))} y={H - PAD.b + 14} fontSize="10" textAnchor="middle" fill="var(--subtle)">
            {fmt(x)}
          </text>
        ))}
        <text x={(W + PAD.l) / 2} y={H - 4} fontSize="10.5" textAnchor="middle" fill="var(--muted)">
          {xLabel}
        </text>
        <text x={12} y={(H - PAD.b) / 2} fontSize="10.5" textAnchor="middle" fill="var(--muted)" transform={`rotate(-90 12 ${(H - PAD.b) / 2})`}>
          {yLabel}
        </text>
        {series.map((s) => (
          <polyline
            key={s.name}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeDasharray={s.dash}
            points={xs
              .map((x) => [x, s.f(x)] as const)
              .filter(([, y]) => Number.isFinite(y))
              .map(([x, y]) => `${sx(x)},${sy(y)}`)
              .join(" ")}
          />
        ))}
        {marker && Number.isFinite(marker.y) && <circle cx={sx(marker.x)} cy={sy(marker.y)} r={5} fill="var(--warn)" stroke="var(--surface)" strokeWidth={1.5} />}
      </svg>
      <div className="mt-1 flex flex-wrap gap-3 text-[12px] text-muted">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-5" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function SpeedupTab() {
  const [pPct, setPPct] = useState(95);
  const [n, setN] = useState(16);
  const [alphaPct, setAlphaPct] = useState(3);
  const [betaPm, setBetaPm] = useState(1); // per mille
  const p = pPct / 100;
  const alpha = alphaPct / 100;
  const beta = betaPm / 1000;
  const peak = uslPeak(alpha, beta);
  const maxN = 256;
  const yMax = Math.max(8, Math.ceil(Math.min(gustafson(p, maxN), 1 / (1 - p || 1e-9), maxN) / 8) * 8);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Parallel fraction p (%)">
          <NumberInput value={pPct} min={0} max={100} step={1} onChange={(v) => setPPct(Math.max(0, Math.min(100, v)))} />
        </Field>
        <Field label="Cores N">
          <NumberInput value={n} min={1} max={maxN} onChange={(v) => setN(Math.max(1, Math.min(maxN, Math.round(v))))} />
        </Field>
        <Field label="USL contention α (%)">
          <NumberInput value={alphaPct} min={0} max={50} step={0.5} onChange={(v) => setAlphaPct(Math.max(0, Math.min(50, v)))} />
        </Field>
        <Field label="USL coherence β (‰)">
          <NumberInput value={betaPm} min={0} max={50} step={0.1} onChange={(v) => setBetaPm(Math.max(0, Math.min(50, v)))} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Amdahl speedup" value={`${amdahl(p, n).toFixed(2)}×`} sub={`1 / ((1 − ${p}) + ${p} / ${n})`} />
        <Stat label="Amdahl ceiling" value={p < 1 ? `${(1 / (1 - p)).toFixed(1)}×` : "∞"} sub="1 / (1 − p), any number of cores" />
        <Stat label="Gustafson speedup" value={`${gustafson(p, n).toFixed(2)}×`} sub="when the work grows with N" />
        <Stat label="USL throughput" value={`${usl(alpha, beta, n).toFixed(2)}×`} sub={Number.isFinite(peak) ? `peaks near N = ${Math.round(peak)}` : "no peak with β = 0"} />
      </div>
      <Panel title="Speedup as cores are added">
        <Chart
          log
          xMax={maxN}
          yMax={yMax}
          xLabel="cores N (log scale)"
          yLabel="speedup ×"
          marker={{ x: n, y: amdahl(p, n) }}
          series={[
            { name: "Amdahl (fixed problem)", color: "var(--accent)", f: (x) => amdahl(p, x) },
            { name: "Gustafson (problem grows with N)", color: "var(--ok)", f: (x) => gustafson(p, x), dash: "5 4" },
            { name: "USL (contention + coherence)", color: "var(--bad)", f: (x) => usl(alpha, beta, x) },
            { name: "ideal", color: "var(--border-strong)", f: (x) => x, dash: "2 4" },
          ]}
        />
      </Panel>
      <Explain>
        Amdahl: even with {pPct}% of the work parallel, the serial {100 - pPct}% caps speedup at {p < 1 ? `${(1 / (1 - p)).toFixed(1)}×` : "infinity"}. The Universal Scalability Law adds
        what Amdahl leaves out: waiting for shared resources (α) and keeping shared data coherent across cores (β). Because β grows with N², past the peak adding workers makes throughput{" "}
        <b>fall</b>, as an over-sized thread pool does.
      </Explain>
    </div>
  );
}

function LittleTab() {
  const [solve, setSolve] = useState<"L" | "lambda" | "W">("L");
  const [L, setL] = useState(22.5);
  const [lambda, setLambda] = useState(1500);
  const [wMs, setWMs] = useState(15);
  const result = solve === "L" ? (lambda * wMs) / 1000 : solve === "lambda" ? (L * 1000) / wMs : (L * 1000) / lambda;
  return (
    <div className="space-y-4">
      <Explain>
        <b>L = λ × W.</b> In any stable system, the average number of requests inside equals the arrival rate times the average time each one spends inside. It holds for a connection pool, a
        thread pool, a queue, a whole service. It needs no assumptions about arrival patterns.
      </Explain>
      <Field label="Solve for">
        <Segmented
          size="sm"
          value={solve}
          onChange={setSolve}
          options={[
            { value: "L", label: "L: requests in the system" },
            { value: "lambda", label: "λ: throughput" },
            { value: "W", label: "W: time in the system" },
          ]}
        />
      </Field>
      <div className="flex flex-wrap items-end gap-3">
        {solve !== "L" && (
          <Field label="L (requests in flight)">
            <NumberInput value={L} min={0} step={0.5} className="w-24" onChange={(v) => setL(Math.max(0, v))} />
          </Field>
        )}
        {solve !== "lambda" && (
          <Field label="λ (requests per second)">
            <NumberInput value={lambda} min={0} step={50} className="w-24" onChange={(v) => setLambda(Math.max(0, v))} />
          </Field>
        )}
        {solve !== "W" && (
          <Field label="W (milliseconds)">
            <NumberInput value={wMs} min={0} step={1} className="w-24" onChange={(v) => setWMs(Math.max(0, v))} />
          </Field>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Stat
          label={solve === "L" ? "Requests in the system, L" : solve === "lambda" ? "Throughput, λ" : "Time in the system, W"}
          value={Number.isFinite(result) ? (solve === "L" ? result.toFixed(1) : solve === "lambda" ? `${Math.round(result).toLocaleString()} /s` : `${result.toFixed(1)} ms`) : "—"}
          sub={solve === "L" ? `${lambda.toLocaleString()} /s × ${wMs} ms` : solve === "lambda" ? `${L} ÷ ${wMs} ms` : `${L} ÷ ${lambda.toLocaleString()} /s`}
        />
      </div>
      <p className="text-[12.5px] text-muted">
        The lesson&apos;s example: 1,500 requests per second, each holding a database connection for 15 ms, keep 22.5 connections busy on average. A pool of 20 can&apos;t keep up, whatever the CPU
        says. And since requests arrive in bursts, a pool sized at exactly the average still makes requests wait, as the queueing tab shows.
      </p>
    </div>
  );
}

function QueueTab() {
  const [c, setC] = useState(30);
  const [sMs, setSMs] = useState(15);
  const [lambda, setLambda] = useState(1500);
  const s = sMs / 1000;
  const q = mmc(lambda, s, c);
  const presets = [
    { label: "One server, 80% busy", c: 1, s: 10, l: 80 },
    { label: "Pool of 20 at 1,500/s", c: 20, s: 15, l: 1500 },
    { label: "Pool of 30 at 1,500/s", c: 30, s: 15, l: 1500 },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => (
          <Btn
            key={p.label}
            onClick={() => {
              setC(p.c);
              setSMs(p.s);
              setLambda(p.l);
            }}
          >
            {p.label}
          </Btn>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Servers c (threads, connections)">
          <NumberInput value={c} min={1} max={500} onChange={(v) => setC(Math.max(1, Math.min(500, Math.round(v))))} />
        </Field>
        <Field label="Service time S (ms)">
          <NumberInput value={sMs} min={0.1} step={1} onChange={(v) => setSMs(Math.max(0.1, v))} />
        </Field>
        <Field label="Arrivals λ (per second)">
          <NumberInput value={lambda} min={0} step={50} className="w-24" onChange={(v) => setLambda(Math.max(0, v))} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Utilization" value={`${(100 * q.rho).toFixed(1)}%`} sub={`ρ = λS / c = ${q.offered.toFixed(2)} / ${c}`} />
        <Stat label="Must wait" value={q.stable ? `${(100 * q.waitProb).toFixed(1)}%` : "—"} sub="of requests find all servers busy" />
        <Stat label="Mean wait in queue" value={q.stable ? `${(q.wq * 1000).toFixed(2)} ms` : "∞"} />
        <Stat label="Mean response time" value={q.stable ? `${(q.w * 1000).toFixed(2)} ms` : "∞"} sub={q.stable ? `${(q.w / s).toFixed(2)} × the service time` : undefined} />
      </div>
      {!q.stable && (
        <Explain tone="bad">
          Requests arrive faster than {c} server{c === 1 ? "" : "s"} can finish them ({q.offered.toFixed(1)} needed on average). The queue grows without limit, so latency keeps climbing until
          something times out or is rejected.
        </Explain>
      )}
      <Panel title="Response time as utilization rises (same c and S)">
        <Chart
          xMax={0.99}
          yMax={Math.max(5, Math.ceil(q.stable ? Math.min(20, (q.w / s) * 1.5) : 10))}
          xLabel="utilization ρ"
          yLabel="response time ÷ service time"
          marker={q.stable ? { x: q.rho, y: q.w / s } : undefined}
          series={[
            { name: `M/M/${c} (${c} server${c === 1 ? "" : "s"})`, color: "var(--accent)", f: (r) => (r <= 0 ? 1 : mmc((r * c) / s, s, c).w / s) },
            ...(c > 1 ? [{ name: "M/M/1 for comparison", color: "var(--subtle)", f: (r: number) => 1 / (1 - r), dash: "4 4" }] : []),
          ]}
        />
      </Panel>
      <p className="text-[12.5px] text-muted">
        The model is the textbook M/M/c queue: random (Poisson) arrivals, exponentially distributed service times, one shared queue. With one server, W = S / (1 − ρ). Many servers share bursts
        better, so a large pool stays fast closer to 100% busy, then turns sharply. Real services differ in detail, but the hockey stick is the same, which is why latency-sensitive resources are
        planned for 60–75% utilization.
      </p>
    </div>
  );
}

export default function SpeedupQueueing() {
  const [tab, setTab] = useState<Tab>("speedup");
  return (
    <div className="space-y-4">
      <Segmented
        ariaLabel="View"
        value={tab}
        onChange={setTab}
        options={[
          { value: "speedup", label: "Amdahl, Gustafson & USL" },
          { value: "little", label: "Little's law" },
          { value: "queue", label: "Queueing delay" },
        ]}
      />
      {tab === "speedup" ? <SpeedupTab /> : tab === "little" ? <LittleTab /> : <QueueTab />}
    </div>
  );
}
