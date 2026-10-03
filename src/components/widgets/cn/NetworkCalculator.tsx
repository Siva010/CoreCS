"use client";
import { useMemo, useState } from "react";
import { Explain, Field, NumberInput, Panel, Select, Stat } from "../ui";

function fmtBits(bps: number) {
  if (!Number.isFinite(bps)) return "∞";
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(2)} Gb/s`;
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(2)} Mb/s`;
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(1)} kb/s`;
  return `${bps.toFixed(0)} b/s`;
}
function fmtBytes(b: number) {
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(2)} MB`;
  if (b >= 1e3) return `${(b / 1e3).toFixed(1)} KB`;
  return `${b.toFixed(0)} B`;
}
function fmtTime(s: number) {
  if (!Number.isFinite(s)) return "∞";
  if (s >= 3600) return `${(s / 3600).toFixed(2)} h`;
  if (s >= 60) return `${(s / 60).toFixed(1)} min`;
  if (s >= 1) return `${s.toFixed(2)} s`;
  return `${(s * 1000).toFixed(1)} ms`;
}

const SIZE_UNITS = { KB: 1e3, MB: 1e6, GB: 1e9 } as const;

export default function NetworkCalculator() {
  const [bwMbps, setBw] = useState(1000);
  const [rttMs, setRtt] = useState(80);
  const [size, setSize] = useState(1);
  const [unit, setUnit] = useState<keyof typeof SIZE_UNITS>("GB");
  const [lossPct, setLoss] = useState(0.01);
  const [windowKB, setWindow] = useState(64);
  const [setupRtts, setSetup] = useState("2");
  const mss = 1460;

  const r = useMemo(() => {
    const bw = bwMbps * 1e6;
    const rtt = rttMs / 1000;
    const bytes = size * SIZE_UNITS[unit];
    const bdp = (bw * rtt) / 8;
    const windowLimited = (windowKB * 1000 * 8) / rtt;
    const p = lossPct / 100;
    const mathis = p > 0 ? ((mss * 8) / rtt) * (1.22 / Math.sqrt(p)) : Infinity;
    const effective = Math.min(bw, windowLimited, mathis);
    // slow start rounds from IW=10 MSS until reaching min(BDP, window, file) (ignoring loss)
    const target = Math.min(bdp, windowKB * 1000, bytes);
    let cw = 10 * mss;
    let sent = 0;
    let rounds = 0;
    while (sent < bytes && cw < target && rounds < 60) {
      sent += cw;
      cw *= 2;
      rounds++;
    }
    const remaining = Math.max(0, bytes - sent);
    const transfer = rounds * rtt + remaining / (effective / 8);
    const total = Number(setupRtts) * rtt + transfer;
    const limiter = effective === bw ? "link bandwidth" : effective === windowLimited ? "TCP window (window / RTT)" : "packet loss (Mathis bound)";
    return { bdp, windowLimited, mathis, effective, rounds, total, limiter, serialization: (bytes * 8) / bw };
  }, [bwMbps, rttMs, size, unit, lossPct, windowKB, setupRtts]);

  return (
    <div className="space-y-4">
      <Panel title="Path and transfer">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Bandwidth (Mb/s)">
            <NumberInput value={bwMbps} min={0.1} step={10} onChange={(v) => setBw(Math.max(0.1, v))} className="w-full" />
          </Field>
          <Field label="RTT (ms)">
            <NumberInput value={rttMs} min={0.05} step={5} onChange={(v) => setRtt(Math.max(0.05, v))} className="w-full" />
          </Field>
          <Field label="Packet loss (%)" hint="0 disables the loss bound">
            <NumberInput value={lossPct} min={0} step={0.01} onChange={(v) => setLoss(Math.max(0, Math.min(50, v)))} className="w-full" />
          </Field>
          <Field label="Max window (KB)" hint="min(rwnd, buffer limit)">
            <NumberInput value={windowKB} min={1} step={64} onChange={(v) => setWindow(Math.max(1, v))} className="w-full" />
          </Field>
          <Field label="Transfer size">
            <div className="flex gap-1">
              <NumberInput value={size} min={0.001} step={1} onChange={(v) => setSize(Math.max(0.001, v))} className="w-full" />
              <Select value={unit} onChange={setUnit} options={(["KB", "MB", "GB"] as const).map((u) => ({ value: u, label: u }))} />
            </div>
          </Field>
          <Field label="Setup round trips" hint="TCP + TLS before data">
            <Select
              value={setupRtts}
              onChange={setSetup}
              options={[
                { value: "0", label: "0 (warm connection)" },
                { value: "1", label: "1 (TCP only / QUIC)" },
                { value: "2", label: "2 (TCP + TLS 1.3)" },
                { value: "3", label: "3 (TCP + TLS 1.2)" },
              ]}
            />
          </Field>
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Bandwidth-delay product" value={fmtBytes(r.bdp)} sub="bytes in flight to fill the pipe" />
        <Stat label="Window-limited throughput" value={fmtBits(r.windowLimited)} sub="window / RTT" />
        <Stat label="Loss-limited (Mathis)" value={fmtBits(r.mathis)} sub="(MSS/RTT) × 1.22/√p" />
        <Stat label="Effective throughput" value={fmtBits(r.effective)} sub={`limited by ${r.limiter}`} />
        <Stat label="Pure serialization time" value={fmtTime(r.serialization)} sub="size / bandwidth" />
        <Stat label="Estimated total time" value={fmtTime(r.total)} sub={`setup + ${r.rounds} slow-start RTTs + steady state`} />
      </div>

      <Explain tone={r.effective < bwMbps * 1e6 * 0.5 ? "warn" : "neutral"}>
        {r.effective < bwMbps * 1e6 * 0.5
          ? `This transfer can use at most ${((r.effective / (bwMbps * 1e6)) * 100).toFixed(1)}% of the link: it is limited by ${r.limiter}. ${
              r.limiter.startsWith("TCP")
                ? `A window of at least ${fmtBytes(r.bdp)} (the BDP) is needed — check window scaling and socket buffer limits, or use parallel streams.`
                : r.limiter.startsWith("packet")
                  ? "Reduce loss or RTT (move data closer), or use parallel streams / BBR."
                  : ""
            }`
          : "The link itself is the bottleneck. For small transfers, notice how setup and slow-start round trips dominate the total — latency, not bandwidth."}
      </Explain>
      <p className="text-[12px] text-subtle">Model: ideal slow start from an initial window of 10 × 1,460 B, no loss during ramp-up, then the effective rate. Real transfers vary; use it for orders of magnitude.</p>
    </div>
  );
}
