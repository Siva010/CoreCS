"use client";
import { useMemo, useState } from "react";
import { BASE_CONFIG, simulateOverload, type OverloadConfig } from "@/lib/sim/overload";
import { Explain, Field, NumberInput, Panel, Segmented, Select, Stat } from "../ui";
import { cn } from "@/lib/utils";

type PresetId = "none" | "no-retries" | "shed" | "budget" | "drop" | "all";

const PRESETS: { id: PresetId; label: string; patch: Partial<OverloadConfig>; note: string }[] = [
  {
    id: "none",
    label: "No protection",
    patch: {},
    note: "Unbounded queue, 3 attempts per request, no retry budget, and the server works on requests whose clients already left.",
  },
  { id: "no-retries", label: "No retries", patch: { maxAttempts: 1 }, note: "The same server, but clients never retry." },
  { id: "shed", label: "Bounded queue", patch: { queueLimit: 250 }, note: "At most 250 requests may wait (half a second of work); the rest get an immediate 503." },
  { id: "budget", label: "Retry budget only", patch: { retryBudget: 0.1 }, note: "Retries may add at most 10% to the load, but the queue is still unbounded." },
  { id: "drop", label: "Drop expired", patch: { dropExpired: true }, note: "The server skips queued requests whose client has already timed out (deadline propagation)." },
  { id: "all", label: "All defenses", patch: { queueLimit: 250, retryBudget: 0.1, dropExpired: true }, note: "Bounded queue, 10% retry budget and dropping expired requests, together." },
];

/** A round axis maximum whose quarter is also round (800 → ticks 0, 200, 400, 600, 800). */
function niceMax(v: number) {
  const q = Math.max(v, 1) / 4;
  const p = 10 ** Math.floor(Math.log10(q));
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * p).find((x) => x >= q) ?? 10 * p;
  return step * 4;
}

const COLORS = { offered: "var(--warn)", ok: "var(--ok)", wasted: "var(--bad)", rejected: "var(--subtle)", wait: "var(--accent)" };

interface Series {
  label: string;
  color: string;
  values: number[];
  dashed?: boolean;
}

function LineChart({
  series,
  duration,
  yMax,
  yUnit,
  refLine,
  shade,
  ariaLabel,
  format = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : `${Math.round(v)}`),
}: {
  series: Series[];
  duration: number;
  yMax: number;
  yUnit: string;
  format?: (v: number) => string;
  refLine?: { y: number; label: string };
  shade: { from: number; to: number };
  ariaLabel: string;
}) {
  const W = 560;
  const H = 210;
  const L = 52;
  const R = 12;
  const T = 12;
  const B = 28;
  const x = (t: number) => L + (t / duration) * (W - L - R);
  const y = (v: number) => T + (1 - Math.min(v, yMax) / yMax) * (H - T - B);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  const xTicks = Array.from({ length: Math.floor(duration / 10) + 1 }, (_, i) => i * 10);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full min-w-[420px]" role="img" aria-label={ariaLabel}>
      <rect x={x(shade.from)} y={T} width={x(shade.to) - x(shade.from)} height={H - T - B} fill="var(--warn)" opacity={0.08} />
      <text x={(x(shade.from) + x(shade.to)) / 2} y={T + 11} textAnchor="middle" fontSize={10} fill="var(--subtle)">
        spike
      </text>
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
          <text x={L - 6} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill="var(--subtle)" fontFamily="var(--font-mono)">
            {format(v)}
          </text>
        </g>
      ))}
      {xTicks.map((t) => (
        <text key={t} x={x(t)} y={H - 10} textAnchor="middle" fontSize={10} fill="var(--subtle)" fontFamily="var(--font-mono)">
          {t}s
        </text>
      ))}
      <text x={12} y={T + (H - T - B) / 2} fontSize={10} fill="var(--subtle)" transform={`rotate(-90 12 ${T + (H - T - B) / 2})`} textAnchor="middle">
        {yUnit}
      </text>
      {refLine && (
        <g>
          <line x1={L} x2={W - R} y1={y(refLine.y)} y2={y(refLine.y)} stroke="var(--fg)" strokeOpacity={0.55} strokeDasharray="5 4" strokeWidth={1.2} />
          <text x={W - R - 4} y={y(refLine.y) - 4} textAnchor="end" fontSize={10} fill="var(--muted)">
            {refLine.label}
          </text>
        </g>
      )}
      {series.map((s) => (
        <polyline
          key={s.label}
          fill="none"
          stroke={s.color}
          strokeWidth={2}
          strokeDasharray={s.dashed ? "4 3" : undefined}
          strokeLinejoin="round"
          points={s.values.map((v, i) => `${x(i + 0.5)},${y(v)}`).join(" ")}
        />
      ))}
    </svg>
  );
}

function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <svg width="18" height="6" aria-hidden>
            <line x1="0" x2="18" y1="3" y2="3" stroke={i.color} strokeWidth="2.5" strokeDasharray={i.dashed ? "4 3" : undefined} />
          </svg>
          {i.label}
        </span>
      ))}
    </div>
  );
}

export default function OverloadRetries() {
  const [preset, setPreset] = useState<PresetId>("none");
  const [cfg, setCfg] = useState<OverloadConfig>(BASE_CONFIG);
  const set = (patch: Partial<OverloadConfig>) => setCfg((c) => ({ ...c, ...patch }));
  const choose = (id: PresetId) => {
    setPreset(id);
    setCfg({ ...BASE_CONFIG, ...PRESETS.find((p) => p.id === id)!.patch });
  };

  const safe: OverloadConfig = {
    ...cfg,
    workers: Math.max(1, Math.min(200, Math.round(cfg.workers))),
    serviceMs: Math.max(1, Math.min(1000, cfg.serviceMs)),
    baseRate: Math.max(0, Math.min(20000, cfg.baseRate)),
    spikeRate: Math.max(0, Math.min(40000, cfg.spikeRate)),
    timeoutMs: Math.max(50, Math.min(30000, cfg.timeoutMs)),
    maxAttempts: Math.max(1, Math.min(5, Math.round(cfg.maxAttempts))),
    backoffMs: Math.max(0, Math.min(10000, cfg.backoffMs)),
    queueLimit: cfg.queueLimit === null ? null : Math.max(0, Math.round(cfg.queueLimit)),
  };
  const res = useMemo(() => simulateOverload(safe), [JSON.stringify(safe)]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = res.seconds;
  const offered = s.map((x) => x.fresh + x.retries);
  const peak = Math.max(res.capacity, ...offered);
  const yMax = niceMax(peak * 1.05);
  const waits = s.map((x) => x.waitMs);
  const longestWait = Math.max(...waits);
  const waitMax = niceMax(Math.min(Math.max(safe.timeoutMs * 1.5, longestWait * 1.05), safe.timeoutMs * 4));
  const clipped = longestWait > waitMax;
  const completions = res.totals.ok + res.totals.wasted;
  const wastedShare = completions ? res.totals.wasted / completions : 0;
  const after = s.slice(Math.ceil(safe.spikeEnd));
  const lastGoodput = s.slice(-10).reduce((a, x) => a + x.ok, 0) / 10;
  const metastable = res.recoveredAt === null && lastGoodput < 0.5 * safe.baseRate && safe.baseRate < res.capacity;
  const util = safe.baseRate / res.capacity;
  const spikeLen = safe.spikeEnd - safe.spikeStart;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => choose(p.id)}
            className={cn(
              "rounded-lg border px-2.5 py-1 text-[13px] font-medium",
              preset === p.id ? "border-accent bg-accent/10 text-fg" : "border-border bg-surface text-muted hover:text-fg",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <Explain>{PRESETS.find((p) => p.id === preset)?.note ?? "Custom settings."}</Explain>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Workers">
          <NumberInput value={safe.workers} min={1} max={200} onChange={(v) => set({ workers: v })} className="w-full" />
        </Field>
        <Field label="Service time (ms)">
          <NumberInput value={safe.serviceMs} min={1} max={1000} onChange={(v) => set({ serviceMs: v })} className="w-full" />
        </Field>
        <Field label="Normal load (req/s)">
          <NumberInput value={safe.baseRate} min={0} step={50} onChange={(v) => set({ baseRate: v })} className="w-full" />
        </Field>
        <Field label="Spike load (req/s)">
          <NumberInput value={safe.spikeRate} min={0} step={50} onChange={(v) => set({ spikeRate: v })} className="w-full" />
        </Field>
        <Field label="Spike length (s)">
          <NumberInput value={spikeLen} min={0} max={60} onChange={(v) => set({ spikeEnd: safe.spikeStart + Math.max(0, Math.min(60, v)) })} className="w-full" />
        </Field>
        <Field label="Client timeout (ms)">
          <NumberInput value={safe.timeoutMs} min={50} step={100} onChange={(v) => set({ timeoutMs: v })} className="w-full" />
        </Field>
        <Field label="Attempts per request">
          <NumberInput value={safe.maxAttempts} min={1} max={5} onChange={(v) => set({ maxAttempts: v })} className="w-full" />
        </Field>
        <Field label="Retry backoff (ms)">
          <NumberInput value={safe.backoffMs} min={0} step={100} onChange={(v) => set({ backoffMs: v })} className="w-full" />
        </Field>
        <Field label="Retry budget">
          <Select
            value={safe.retryBudget === null ? "none" : String(safe.retryBudget)}
            onChange={(v) => set({ retryBudget: v === "none" ? null : Number(v) })}
            options={[
              { value: "none", label: "unlimited" },
              { value: "0.1", label: "10% of requests" },
              { value: "0.5", label: "50% of requests" },
            ]}
          />
        </Field>
        <Field label="Queue limit">
          <Select
            value={safe.queueLimit === null ? "none" : String(safe.queueLimit)}
            onChange={(v) => set({ queueLimit: v === "none" ? null : Number(v) })}
            options={[
              { value: "none", label: "unbounded" },
              { value: "100", label: "100 requests" },
              { value: "250", label: "250 requests" },
              { value: "1000", label: "1,000 requests" },
            ]}
          />
        </Field>
        <Field label="Expired requests">
          <Segmented
            size="sm"
            value={safe.dropExpired ? "drop" : "serve"}
            onChange={(v) => set({ dropExpired: v === "drop" })}
            options={[
              { value: "serve", label: "serve" },
              { value: "drop", label: "drop" },
            ]}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Capacity" value={`${Math.round(res.capacity)}/s`} sub={`normal load is ${Math.round(util * 100)}% of it`} />
        <Stat label="Requests that succeeded" value={`${(res.successRate * 100).toFixed(1)}%`} sub={`${Math.round(res.totals.ok).toLocaleString()} of ${Math.round(res.totals.fresh).toLocaleString()}`} />
        <Stat label="Work wasted" value={`${Math.round(wastedShare * 100)}%`} sub="served after the client left" />
        <Stat
          label="Recovery"
          value={res.recoveredAt === null ? "never" : res.recoveredAt <= Math.ceil(safe.spikeEnd) ? "immediate" : `t = ${res.recoveredAt}s`}
          sub={res.recoveredAt === null ? "within this run" : `spike ended at t = ${safe.spikeEnd}s`}
        />
      </div>

      <Panel title="Requests per second">
        <div className="overflow-x-auto thin-scroll">
          <LineChart
            ariaLabel="Offered load, goodput, wasted work and rejections over time"
            duration={safe.duration}
            yMax={yMax}
            yUnit="requests / s"
            refLine={{ y: res.capacity, label: `capacity ${Math.round(res.capacity)}/s` }}
            shade={{ from: safe.spikeStart, to: safe.spikeEnd }}
            series={[
              { label: "offered", color: COLORS.offered, values: offered },
              { label: "rejected", color: COLORS.rejected, values: s.map((x) => x.rejected), dashed: true },
              { label: "wasted", color: COLORS.wasted, values: s.map((x) => x.wasted) },
              { label: "goodput", color: COLORS.ok, values: s.map((x) => x.ok) },
            ]}
          />
        </div>
        <Legend
          items={[
            { label: "offered (new + retries)", color: COLORS.offered },
            { label: "goodput (answered in time)", color: COLORS.ok },
            { label: "wasted (answered after the client left)", color: COLORS.wasted },
            { label: "rejected at once (503)", color: COLORS.rejected, dashed: true },
          ]}
        />
      </Panel>

      <Panel title="How long served requests had waited">
        <div className="overflow-x-auto thin-scroll">
          <LineChart
            ariaLabel="Queueing delay of served requests over time"
            duration={safe.duration}
            yMax={waitMax}
            yUnit="ms"
            format={(v) => Math.round(v).toLocaleString()}
            refLine={{ y: safe.timeoutMs, label: `client timeout ${safe.timeoutMs} ms` }}
            shade={{ from: safe.spikeStart, to: safe.spikeEnd }}
            series={[{ label: "wait", color: COLORS.wait, values: waits }]}
          />
        </div>
        <p className="mt-2 text-[12px] text-muted">
          Above the dashed line, everything the server finishes is wasted: the client has already given up.
          {clipped && ` The line is cut off at the top: waits reach ${(longestWait / 1000).toFixed(1)} s.`}
        </p>
      </Panel>

      <Explain tone={metastable ? "bad" : res.recoveredAt !== null && res.recoveredAt <= Math.ceil(safe.spikeEnd) + 2 ? "good" : "warn"}>
        {util >= 1
          ? "Normal load alone is at or above capacity, so the queue grows even without a spike. Add workers or cut the service time first."
          : metastable
            ? `Metastable failure. The spike ended at t = ${safe.spikeEnd}s, yet goodput is still about ${Math.round(lastGoodput)}/s: every request now waits longer than the timeout, every timeout becomes retries, and the offered load stays around ${Math.round(after.length ? after[after.length - 1].fresh + after[after.length - 1].retries : 0)}/s, above capacity. Removing the trigger isn't enough; something has to shed load.`
            : res.recoveredAt === null
              ? "Goodput hasn't fully returned to the normal load by the end of the run. Look at what the server spends its capacity on after the spike."
              : res.recoveredAt <= Math.ceil(safe.spikeEnd) + 2
                ? `Recovered as soon as the spike ended. During the spike the server stayed at capacity and spent it on requests that could still succeed.`
                : `Recovered at t = ${res.recoveredAt}s, ${res.recoveredAt - safe.spikeEnd} s after the spike ended. Until then the server was draining a backlog of requests whose clients had already left.`}
      </Explain>
    </div>
  );
}
