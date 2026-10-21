"use client";
import { useState } from "react";
import { PAGE_PRESETS, simulatePageLoad, type PageLoadConfig, type Phase, type Transport } from "@/lib/sim/pageLoad";
import { Explain, Field, NumberInput, Panel, Segmented, Select, Stat } from "../ui";
import { cn } from "@/lib/utils";

const COLOR: Record<Phase["key"], string> = {
  dns: "var(--subtle)",
  tcp: "var(--warn)",
  tls: "var(--bad)",
  quic: "var(--bad)",
  request: "var(--accent)",
  html: "var(--ok)",
  assets: "var(--ok)",
  render: "var(--muted)",
};

const TRANSPORTS: { value: Transport; label: string }[] = [
  { value: "tls12", label: "TCP + TLS 1.2" },
  { value: "tls13", label: "TCP + TLS 1.3" },
  { value: "quic", label: "HTTP/3 (QUIC)" },
  { value: "quic0rtt", label: "HTTP/3, 0-RTT resumption" },
  { value: "reused", label: "Reused connection" },
];

function Waterfall({ phases, total, ttfb }: { phases: Phase[]; total: number; ttfb: number }) {
  const W = 560;
  const L = 128;
  const R = 16;
  const row = 26;
  const H = phases.length * row + 34;
  const x = (ms: number) => L + (ms / Math.max(total, 1)) * (W - L - R);
  const step = total > 2000 ? 500 : total > 800 ? 200 : total > 300 ? 100 : 50;
  const ticks = Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full min-w-[440px]" role="img" aria-label="Page load waterfall">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={6} y2={H - 24} stroke="var(--border)" strokeWidth={1} />
          <text x={x(t)} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--subtle)" fontFamily="var(--font-mono)">
            {t}
          </text>
        </g>
      ))}
      <line x1={x(ttfb)} x2={x(ttfb)} y1={4} y2={H - 24} stroke="var(--accent)" strokeDasharray="4 3" strokeWidth={1.2} />
      {phases.map((p, i) => {
        const y = 10 + i * row;
        const w = Math.max(2, x(p.end) - x(p.start));
        const ms = Math.round(p.end - p.start);
        const inside = w > 44;
        return (
          <g key={p.key}>
            <text x={8} y={y + 12} fontSize={11.5} fill="var(--fg)">
              {p.label}
            </text>
            <rect x={x(p.start)} y={y} width={w} height={17} rx={3} fill={COLOR[p.key]} fillOpacity={0.85} />
            <text
              x={inside ? x(p.start) + w / 2 : x(p.end) + 4}
              y={y + 12.5}
              textAnchor={inside ? "middle" : "start"}
              fontSize={10.5}
              fontFamily="var(--font-mono)"
              fill={inside ? "var(--surface)" : "var(--muted)"}
            >
              {ms} ms
            </text>
            <title>{`${p.label}: ${p.start.toFixed(0)}–${p.end.toFixed(0)} ms. ${p.note}`}</title>
          </g>
        );
      })}
    </svg>
  );
}

export default function PageLoad() {
  const [preset, setPreset] = useState<string>("cold");
  const [cfg, setCfg] = useState<PageLoadConfig>(PAGE_PRESETS[0].cfg);
  const set = (patch: Partial<PageLoadConfig>) => {
    setPreset("custom");
    setCfg((c) => ({ ...c, ...patch }));
  };
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
  const c: PageLoadConfig = {
    ...cfg,
    dnsMs: clamp(cfg.dnsMs, 0, 2000),
    rttMs: clamp(cfg.rttMs, 1, 1000),
    edgeRttMs: clamp(cfg.edgeRttMs, 1, 1000),
    edgeOriginRttMs: clamp(cfg.edgeOriginRttMs, 0, 1000),
    serverMs: clamp(cfg.serverMs, 0, 10000),
    htmlKB: clamp(cfg.htmlKB, 1, 5000),
    assets: Math.round(clamp(cfg.assets, 0, 20)),
    assetKB: clamp(cfg.assetKB, 1, 5000),
    bandwidthMbps: clamp(cfg.bandwidthMbps, 0.5, 10000),
    renderMs: clamp(cfg.renderMs, 0, 5000),
  };
  const r = simulatePageLoad(c);
  const handshakeMs = r.phases.filter((p) => p.key === "tcp" || p.key === "tls" || p.key === "quic").reduce((a, p) => a + (p.end - p.start), 0);
  const note = PAGE_PRESETS.find((p) => p.id === preset)?.note;
  const browserRtt = c.cdn ? c.edgeRttMs : c.rttMs;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {PAGE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setPreset(p.id);
              setCfg(p.cfg);
            }}
            className={cn(
              "rounded-lg border px-2.5 py-1 text-[13px] font-medium",
              preset === p.id ? "border-accent bg-accent/10 text-fg" : "border-border bg-surface text-muted hover:text-fg",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {note && <Explain>{note}</Explain>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Connection">
          <Select value={c.transport} onChange={(v) => set({ transport: v })} options={TRANSPORTS} />
        </Field>
        <Field label="DNS (ms, 0 = cached)">
          <NumberInput value={c.dnsMs} min={0} step={5} onChange={(v) => set({ dnsMs: v })} className="w-full" />
        </Field>
        <Field label="RTT to the origin (ms)">
          <NumberInput value={c.rttMs} min={1} step={10} onChange={(v) => set({ rttMs: v })} className="w-full" />
        </Field>
        <Field label="Server time (ms)">
          <NumberInput value={c.serverMs} min={0} step={5} onChange={(v) => set({ serverMs: v })} className="w-full" />
        </Field>
        <Field label="CDN edge">
          <Segmented
            size="sm"
            value={c.cdn ? "on" : "off"}
            onChange={(v) => set({ cdn: v === "on" })}
            options={[
              { value: "off", label: "none" },
              { value: "on", label: "in front" },
            ]}
          />
        </Field>
        {c.cdn && (
          <>
            <Field label="RTT to the edge (ms)">
              <NumberInput value={c.edgeRttMs} min={1} step={5} onChange={(v) => set({ edgeRttMs: v })} className="w-full" />
            </Field>
            <Field label="Edge to origin RTT (ms)">
              <NumberInput value={c.edgeOriginRttMs} min={0} step={10} onChange={(v) => set({ edgeOriginRttMs: v })} className="w-full" />
            </Field>
          </>
        )}
        <Field label="HTML size (KB)">
          <NumberInput value={c.htmlKB} min={1} step={5} onChange={(v) => set({ htmlKB: v })} className="w-full" />
        </Field>
        <Field label="CSS/JS files">
          <NumberInput value={c.assets} min={0} max={20} onChange={(v) => set({ assets: v })} className="w-full" />
        </Field>
        <Field label="Bandwidth (Mb/s)">
          <NumberInput value={c.bandwidthMbps} min={1} step={10} onChange={(v) => set({ bandwidthMbps: v })} className="w-full" />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Time to first byte" value={`${Math.round(r.ttfb)} ms`} sub="dashed line in the chart" />
        <Stat label="Round trips before it" value={r.rttsBeforeFirstByte} sub={`each ${browserRtt} ms${c.cdn ? " (to the edge)" : ""}`} />
        <Stat label="Handshakes" value={`${Math.round(handshakeMs)} ms`} sub={c.transport === "reused" ? "none: connection reused" : "TCP, TLS or QUIC"} />
        <Stat label="Page ready" value={`${Math.round(r.ready)} ms`} sub="after CSS/JS and rendering" />
      </div>

      <Panel title="Waterfall (ms from pressing Enter)">
        <div className="overflow-x-auto thin-scroll">
          <Waterfall phases={r.phases} total={r.ready} ttfb={r.ttfb} />
        </div>
        <p className="mt-2 text-[12px] text-muted">
          Hover a bar for its details. The HTML needs {r.slowStartRounds} slow-start round{r.slowStartRounds === 1 ? "" : "s"}: the first ~14.6 KB arrive with the first byte, and each later round doubles the amount.
        </p>
      </Panel>

      <Explain tone="neutral">
        {c.transport === "reused"
          ? "On a reused connection there are no handshakes: the request goes out at once. Only the request's own round trip and the server time remain before the first byte, which is why keep-alive and connection pools matter so much."
          : c.cdn
            ? `With the edge ${c.edgeRttMs} ms away, each handshake round trip costs ${c.edgeRttMs} ms instead of ${c.rttMs} ms. The HTML still has to come from the origin, but over the edge's already open connection, so that trip is paid once (${c.edgeOriginRttMs} ms), not once per handshake.`
            : `Before the first byte, ${r.rttsBeforeFirstByte} round trips of ${c.rttMs} ms cost ${r.rttsBeforeFirstByte * c.rttMs} ms, against ${c.serverMs} ms of server time. Round trips, not bandwidth, decide the time to first byte: try TLS 1.3, HTTP/3 or a CDN, and notice how little bandwidth changes it.`}
      </Explain>
    </div>
  );
}
