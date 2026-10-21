"use client";
import { useMemo, useState } from "react";
import { idealUtilization, maxWindow, simulateArq, type ArqProtocol } from "@/lib/sim/arq";
import { Btn, Explain, Field, NumberInput, Panel, Segmented, Stat } from "../ui";
import { cn } from "@/lib/utils";

const PROTOCOLS: { value: ArqProtocol; label: string }[] = [
  { value: "stop-and-wait", label: "Stop-and-wait" },
  { value: "go-back-n", label: "Go-Back-N" },
  { value: "selective-repeat", label: "Selective Repeat" },
];

const NOTE: Record<ArqProtocol, string> = {
  "stop-and-wait": "One frame at a time: send, then wait a full round trip for its ACK. The link sits idle for 2a of every 1 + 2a time units.",
  "go-back-n": "Up to W frames in flight. The receiver accepts only the next in-order frame and ACKs cumulatively, so after a loss it discards everything that follows, and the sender resends from the lost frame onward.",
  "selective-repeat": "Up to W frames in flight. The receiver buffers out-of-order frames and ACKs each one, so the sender resends only the frames whose own timers expire.",
};

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export default function ArqProtocols() {
  const [protocol, setProtocol] = useState<ArqProtocol>("go-back-n");
  const [frames, setFrames] = useState(8);
  const [window, setWindow] = useState(4);
  const [a, setA] = useState(1);
  const [k, setK] = useState(3);
  const [lost, setLost] = useState<Set<number>>(new Set([2]));

  const n = clamp(Math.round(frames), 1, 16);
  const W = protocol === "stop-and-wait" ? 1 : clamp(Math.round(window), 1, 8);
  const A = clamp(a, 0, 10);
  const lostIn = useMemo(() => new Set([...lost].filter((f) => f < n)), [lost, n]);
  const res = useMemo(() => simulateArq(protocol, n, W, A, lostIn), [protocol, n, W, A, lostIn]);
  const resends = res.transmissions.length - n;
  const safe = maxWindow(protocol, k);
  const ideal = idealUtilization(W, A);

  const toggle = (f: number) =>
    setLost((s) => {
      const g = new Set(s);
      if (g.has(f)) g.delete(f);
      else g.add(f);
      return g;
    });

  // timeline geometry: one row per frame, time across
  const u = clamp(640 / res.totalTime, 9, 40);
  const labelW = 62;
  const rowH = 22;
  const width = labelW + res.totalTime * u + 16;
  const height = n * rowH + 30;
  const x = (t: number) => labelW + t * u;
  const ticks = Math.ceil(res.totalTime);
  const tickEvery = ticks > 40 ? 10 : ticks > 16 ? 5 : ticks > 8 ? 2 : 1;

  return (
    <div className="space-y-4">
      <Segmented ariaLabel="Protocol" value={protocol} onChange={setProtocol} options={PROTOCOLS} />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Frames">
          <NumberInput value={n} min={1} max={16} onChange={setFrames} />
        </Field>
        <Field label="Window W">
          {protocol === "stop-and-wait" ? (
            <span className="flex h-8 items-center font-mono text-[13px] text-subtle">1</span>
          ) : (
            <NumberInput value={W} min={1} max={8} onChange={setWindow} />
          )}
        </Field>
        <Field label="a = propagation ÷ transmit">
          <NumberInput value={A} min={0} max={10} step={0.5} onChange={setA} />
        </Field>
        <Field label="Sequence bits k">
          <NumberInput value={k} min={1} max={4} onChange={(v) => setK(clamp(Math.round(v), 1, 4))} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[12px] font-medium text-muted">Lose the first send of frame:</span>
        {Array.from({ length: n }, (_, f) => (
          <button
            key={f}
            type="button"
            onClick={() => toggle(f)}
            aria-pressed={lostIn.has(f)}
            className={cn(
              "h-7 w-7 rounded border font-mono text-[12px]",
              lostIn.has(f) ? "border-bad bg-bad/15 text-bad" : "border-border bg-surface-2 text-fg hover:border-border-strong",
            )}
          >
            {f}
          </button>
        ))}
        {lostIn.size > 0 && (
          <Btn variant="ghost" onClick={() => setLost(new Set())}>
            No losses
          </Btn>
        )}
      </div>

      <Explain>{NOTE[protocol]}</Explain>

      <Panel title="Sender's timeline (one row per frame, time in frame-transmission units)">
        <div className="overflow-x-auto thin-scroll">
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Transmission timeline" className="block">
            {Array.from({ length: Math.floor(ticks / tickEvery) + 1 }, (_, i) => i * tickEvery).map((t) => (
              <g key={t}>
                <line x1={x(t)} x2={x(t)} y1={4} y2={n * rowH + 6} stroke="var(--border)" strokeWidth={1} />
                <text x={x(t)} y={n * rowH + 22} textAnchor="middle" fontSize={10} fill="var(--subtle)" fontFamily="var(--font-mono)">
                  {t}
                </text>
              </g>
            ))}
            {Array.from({ length: n }, (_, f) => (
              <text key={f} x={8} y={f * rowH + rowH / 2 + 8} fontSize={11} fill="var(--muted)" fontFamily="var(--font-mono)">
                frame {f}
              </text>
            ))}
            {res.transmissions.map((t, i) => {
              const y = t.frame * rowH + 6;
              const fill = t.lost ? "var(--bad)" : t.delivered ? "var(--ok)" : "var(--subtle)";
              return (
                <g key={i}>
                  {t.ackAt !== null && (
                    <>
                      <line x1={x(t.start + 1)} x2={x(t.ackAt)} y1={y + 7} y2={y + 7} stroke={fill} strokeOpacity={0.5} strokeWidth={1.5} />
                      <circle cx={x(t.ackAt)} cy={y + 7} r={2.5} fill={fill} />
                    </>
                  )}
                  {t.lost && (
                    <text x={x(t.start + 1) + 3} y={y + 11} fontSize={11} fill="var(--bad)">
                      ✕
                    </text>
                  )}
                  <rect
                    x={x(t.start) + 0.5}
                    y={y}
                    width={Math.max(2, u - 1)}
                    height={14}
                    rx={2}
                    fill={fill}
                    fillOpacity={t.attempt > 1 ? 0.55 : 0.85}
                    stroke={t.attempt > 1 ? fill : "none"}
                    strokeDasharray={t.attempt > 1 ? "3 2" : undefined}
                  >
                    <title>
                      {`frame ${t.frame}, ${t.attempt > 1 ? `resend #${t.attempt - 1}` : "first send"} at t=${t.start}: ${t.lost ? "lost" : t.delivered ? "accepted" : "discarded or duplicate"}`}
                    </title>
                  </rect>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
          <span>
            <span className="mr-1 inline-block h-2.5 w-3 rounded-sm bg-ok align-middle" />
            accepted
          </span>
          <span>
            <span className="mr-1 inline-block h-2.5 w-3 rounded-sm bg-bad align-middle" />
            lost
          </span>
          <span>
            <span className="mr-1 inline-block h-2.5 w-3 rounded-sm bg-subtle align-middle" />
            discarded (out of order or duplicate)
          </span>
          <span>faded, dashed = a resend · line = waiting for the ACK · dot = ACK arrives</span>
          <span>A short run stays below the formula even without losses, because it also waits for the last ACK.</span>
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Transmissions" value={res.transmissions.length} sub={resends ? `${n} frames + ${resends} resent` : "no resends"} />
        <Stat label="Finished at" value={`t = ${Number.isInteger(res.totalTime) ? res.totalTime : res.totalTime.toFixed(1)}`} sub="last ACK back" />
        <Stat label="Utilization" value={`${(res.utilization * 100).toFixed(1)}%`} sub="frames ÷ total time" />
        <Stat label="Formula, no loss" value={`${(ideal * 100).toFixed(1)}%`} sub="W ÷ (1 + 2a), capped at 100%" />
      </div>

      {protocol !== "stop-and-wait" && W > safe ? (
        <Explain tone="bad">
          With {k}-bit sequence numbers, {protocol === "go-back-n" ? "Go-Back-N" : "Selective Repeat"} is safe only up to a window of {safe}
          {protocol === "go-back-n" ? " (2^k − 1)" : " (2^(k−1))"}. With W = {W}, if a whole window of ACKs is lost, a resent old frame carries the same number as a new one, and the receiver accepts a duplicate.
        </Explain>
      ) : (
        <Explain tone="good">
          With {k}-bit sequence numbers the largest safe window here is {safe}
          {protocol === "stop-and-wait" ? " (stop-and-wait needs only 1 bit)" : protocol === "go-back-n" ? " (2^k − 1)" : " (2^(k−1))"}, so W = {W} is safe.
          {W < 1 + 2 * A ? ` To keep the link busy without losses you need W ≥ 1 + 2a = ${1 + 2 * A}.` : " The window covers a full round trip, so the link never idles while nothing is lost."}
        </Explain>
      )}

      <Panel title="Event log">
        <ol className="max-h-64 space-y-0.5 overflow-y-auto font-mono text-[12px] text-muted thin-scroll">
          {res.log.map((l, i) => (
            <li key={i} className={cn(l.includes("lost") && "text-bad", l.includes("expires") && "text-warn")}>
              {l}
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
