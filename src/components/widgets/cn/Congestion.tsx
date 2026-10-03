"use client";
import { useMemo, useState } from "react";
import { Btn, Explain, Field, NumberInput, Panel, Segmented } from "../ui";
import { cn } from "@/lib/utils";

type Algo = "reno" | "tahoe";
type Loss = "dup" | "timeout";

export function simulateCwnd(rounds: number, ssthresh0: number, iw: number, losses: Record<number, Loss>, algo: Algo) {
  const out: { r: number; cwnd: number; ssthresh: number; phase: string; event?: Loss }[] = [];
  let cwnd = iw;
  let ssthresh = ssthresh0;
  for (let r = 0; r < rounds; r++) {
    const ev = losses[r];
    const phase = cwnd < ssthresh ? "slow start" : "congestion avoidance";
    out.push({ r, cwnd, ssthresh, phase, event: ev });
    if (ev) {
      ssthresh = Math.max(2, Math.floor(cwnd / 2));
      cwnd = ev === "timeout" || algo === "tahoe" ? 1 : ssthresh;
      continue;
    }
    cwnd = cwnd < ssthresh ? Math.min(cwnd * 2, ssthresh) : cwnd + 1;
  }
  return out;
}

export default function Congestion() {
  const [algo, setAlgo] = useState<Algo>("reno");
  const [ssthresh, setSs] = useState(16);
  const [iw, setIw] = useState(1);
  const [losses, setLosses] = useState<Record<number, Loss>>({ 12: "dup", 22: "timeout" });
  const [mode, setMode] = useState<Loss>("dup");
  const rounds = 36;
  const data = useMemo(() => simulateCwnd(rounds, ssthresh, iw, losses, algo), [ssthresh, iw, losses, algo]);
  const maxY = Math.max(ssthresh, ...data.map((d) => d.cwnd)) + 4;
  const W = 680;
  const H = 280;
  const pad = { l: 36, r: 12, t: 12, b: 28 };
  const x = (r: number) => pad.l + (r / (rounds - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => H - pad.b - (v / maxY) * (H - pad.t - pad.b);
  const totalSegments = data.reduce((s, d) => s + d.cwnd, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Segmented value={algo} onChange={setAlgo} options={[{ value: "reno", label: "Reno" }, { value: "tahoe", label: "Tahoe" }]} />
        <Field label="Initial ssthresh (MSS)">
          <NumberInput value={ssthresh} min={2} max={64} onChange={(v) => setSs(Math.max(2, Math.min(64, v)))} />
        </Field>
        <Field label="Initial window (MSS)">
          <NumberInput value={iw} min={1} max={10} onChange={(v) => setIw(Math.max(1, Math.min(10, v)))} />
        </Field>
        <Field label="Clicking a round adds">
          <Segmented size="sm" value={mode} onChange={setMode} options={[{ value: "dup", label: "3 dup ACKs" }, { value: "timeout", label: "timeout" }]} />
        </Field>
        <Btn variant="ghost" onClick={() => setLosses({})}>
          Clear losses
        </Btn>
      </div>

      <Panel title="cwnd per round trip (MSS) — click a round to toggle a loss event">
        <div className="overflow-x-auto thin-scroll">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[520px]" role="img" aria-label="Congestion window chart">
            {[0, Math.round(maxY / 4), Math.round(maxY / 2), Math.round((3 * maxY) / 4)].map((v) => (
              <g key={v}>
                <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--border)" />
                <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="var(--subtle)">
                  {v}
                </text>
              </g>
            ))}
            <polyline points={data.map((d) => `${x(d.r)},${y(d.ssthresh)}`).join(" ")} fill="none" stroke="var(--warn)" strokeDasharray="5 4" strokeWidth={1.5} />
            <polyline points={data.map((d) => `${x(d.r)},${y(d.cwnd)}`).join(" ")} fill="none" stroke="var(--accent)" strokeWidth={2.2} />
            {data.map((d) => (
              <g key={d.r} onClick={() => setLosses((l) => { const n = { ...l }; if (n[d.r]) delete n[d.r]; else n[d.r] = mode; return n; })} style={{ cursor: "pointer" }}>
                <rect x={x(d.r) - 8} y={pad.t} width={16} height={H - pad.t - pad.b} fill="transparent" />
                <circle cx={x(d.r)} cy={y(d.cwnd)} r={d.event ? 5.5 : 3} fill={d.event === "timeout" ? "var(--bad)" : d.event === "dup" ? "var(--warn)" : d.phase === "slow start" ? "var(--d-core)" : "var(--accent)"} />
                {d.r % 4 === 0 && (
                  <text x={x(d.r)} y={H - 10} textAnchor="middle" fontSize="10" fill="var(--subtle)">
                    {d.r}
                  </text>
                )}
              </g>
            ))}
          </svg>
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-[12px] text-muted">
          <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-d-core" />slow start</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-accent" />congestion avoidance</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-warn" />3 dup ACKs</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-bad" />timeout</span>
          <span className="text-warn">- - ssthresh</span>
          <span className="ml-auto font-mono">≈ {totalSegments} segments sent in {rounds} RTTs</span>
        </div>
      </Panel>

      <Panel title="Round-by-round">
        <div className="max-h-48 overflow-y-auto thin-scroll">
          <table className="w-full font-mono text-[12px]">
            <thead className="text-left text-[11px] text-subtle">
              <tr>
                <th className="pb-1">RTT</th>
                <th>cwnd</th>
                <th>ssthresh</th>
                <th>phase</th>
                <th>event → effect</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.r} className={cn("border-t border-border", d.event && "bg-warn/5")}>
                  <td className="py-0.5">{d.r}</td>
                  <td>{d.cwnd}</td>
                  <td>{d.ssthresh}</td>
                  <td className="font-sans">{d.phase}</td>
                  <td className="font-sans">
                    {d.event === "dup" && (algo === "reno" ? `ssthresh = ${Math.max(2, Math.floor(d.cwnd / 2))}, cwnd = ssthresh (fast recovery)` : `ssthresh = ${Math.max(2, Math.floor(d.cwnd / 2))}, cwnd = 1 (Tahoe)`)}
                    {d.event === "timeout" && `ssthresh = ${Math.max(2, Math.floor(d.cwnd / 2))}, cwnd = 1, slow start`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Explain>
        Simplified model: slow start doubles cwnd each RTT (capped at ssthresh), congestion avoidance adds 1 MSS per RTT, and a loss event takes effect in the round it
        occurs. Compare the same duplicate-ACK loss under Reno and Tahoe — Reno keeps half its window; Tahoe restarts from 1.
      </Explain>
    </div>
  );
}
