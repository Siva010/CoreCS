"use client";
import { useMemo, useState } from "react";
import { Explain, Field, inputCls, NumberInput, Panel, Segmented } from "../ui";
import { cn } from "@/lib/utils";

type Algo = "FCFS" | "SSTF" | "SCAN" | "C-SCAN" | "LOOK" | "C-LOOK";
type Dir = "down" | "up";

/** Returns the head path (including virtual edge stops) and the order requests are serviced. */
export function diskPath(head: number, reqs: number[], algo: Algo, dir: Dir, maxCyl: number) {
  const path = [head];
  const order: number[] = [];
  if (algo === "FCFS") {
    for (const r of reqs) {
      path.push(r);
      order.push(r);
    }
  } else if (algo === "SSTF") {
    const left = [...reqs];
    let cur = head;
    while (left.length) {
      let bi = 0;
      left.forEach((r, i) => {
        if (Math.abs(r - cur) < Math.abs(left[bi] - cur)) bi = i;
      });
      cur = left.splice(bi, 1)[0];
      path.push(cur);
      order.push(cur);
    }
  } else {
    const lower = reqs.filter((r) => r < head).sort((a, b) => b - a); // descending
    const upper = reqs.filter((r) => r >= head).sort((a, b) => a - b); // ascending
    const circular = algo === "C-SCAN" || algo === "C-LOOK";
    const toEdge = algo === "SCAN" || algo === "C-SCAN";
    const first = dir === "up" ? upper : lower;
    const second = dir === "up" ? lower : upper;
    for (const r of first) {
      path.push(r);
      order.push(r);
    }
    if (second.length) {
      if (toEdge) path.push(dir === "up" ? maxCyl : 0);
      if (circular) {
        // jump to the opposite end (or the farthest request) and keep moving in the same direction
        const restart = toEdge ? (dir === "up" ? 0 : maxCyl) : dir === "up" ? Math.min(...second) : Math.max(...second);
        path.push(restart);
        const seq = dir === "up" ? [...second].sort((a, b) => a - b) : [...second].sort((a, b) => b - a);
        for (const r of seq) {
          if (r === restart && !toEdge) {
            order.push(r);
            continue;
          }
          path.push(r);
          order.push(r);
        }
      } else {
        for (const r of second) {
          path.push(r);
          order.push(r);
        }
      }
    }
  }
  const movement = path.slice(1).reduce((s, p, i) => s + Math.abs(p - path[i]), 0);
  return { path, order, movement };
}

const ALGOS: Algo[] = ["FCFS", "SSTF", "SCAN", "C-SCAN", "LOOK", "C-LOOK"];

export default function DiskScheduling() {
  const [head, setHead] = useState(53);
  const [queueText, setQueueText] = useState("98, 183, 37, 122, 14, 124, 65, 67");
  const [maxCyl, setMaxCyl] = useState(199);
  const [algo, setAlgo] = useState<Algo>("SSTF");
  const [dir, setDir] = useState<Dir>("down");
  const reqs = useMemo(
    () =>
      queueText
        .split(/[\s,]+/)
        .map(Number)
        .filter((x) => Number.isFinite(x) && x >= 0 && x <= maxCyl)
        .slice(0, 20),
    [queueText, maxCyl],
  );
  const res = useMemo(() => diskPath(head, reqs, algo, dir, maxCyl), [head, reqs, algo, dir, maxCyl]);
  const all = useMemo(() => ALGOS.map((a) => ({ a, m: diskPath(head, reqs, a, dir, maxCyl).movement })), [head, reqs, dir, maxCyl]);

  const W = 640;
  const H = Math.max(160, res.path.length * 22 + 30);
  const x = (c: number) => 20 + (c / maxCyl) * (W - 40);
  const y = (i: number) => 20 + i * 22;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Request queue (cylinders)">
          <input className={cn(inputCls, "w-72")} value={queueText} onChange={(e) => setQueueText(e.target.value)} />
        </Field>
        <Field label="Head at">
          <NumberInput value={head} min={0} max={maxCyl} onChange={(v) => setHead(Math.max(0, Math.min(maxCyl, v)))} />
        </Field>
        <Field label="Max cylinder">
          <NumberInput value={maxCyl} min={10} max={9999} onChange={(v) => setMaxCyl(Math.max(10, v))} />
        </Field>
        <Field label="Initial direction">
          <Segmented value={dir} onChange={setDir} size="sm" options={[{ value: "down", label: "toward 0" }, { value: "up", label: "toward max" }]} />
        </Field>
      </div>
      <Segmented value={algo} onChange={setAlgo} options={ALGOS.map((a) => ({ value: a, label: a }))} />

      <Panel title={`${algo}: total head movement ${res.movement} cylinders`}>
        <div className="overflow-x-auto thin-scroll">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[520px]" role="img" aria-label="Head movement chart">
            <line x1={20} x2={W - 20} y1={10} y2={10} stroke="var(--border-strong)" />
            {[0, Math.round(maxCyl / 4), Math.round(maxCyl / 2), Math.round((3 * maxCyl) / 4), maxCyl].map((c) => (
              <text key={c} x={x(c)} y={8} fontSize="9" textAnchor="middle" fill="var(--subtle)">
                {c}
              </text>
            ))}
            {reqs.map((r, i) => (
              <line key={i} x1={x(r)} x2={x(r)} y1={12} y2={H - 6} stroke="var(--border)" strokeDasharray="2 4" />
            ))}
            <polyline points={res.path.map((c, i) => `${x(c)},${y(i)}`).join(" ")} fill="none" stroke="var(--accent)" strokeWidth={2} />
            {res.path.map((c, i) => {
              const isReq = i > 0 && reqs.includes(c);
              return (
                <g key={i}>
                  <circle cx={x(c)} cy={y(i)} r={isReq || i === 0 ? 4.5 : 3} fill={i === 0 ? "var(--ok)" : isReq ? "var(--accent)" : "var(--subtle)"} />
                  <text x={x(c) + 7} y={y(i) + 4} fontSize="10" fill="var(--muted)">
                    {c}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <p className="mt-2 text-[12.5px] text-muted">Service order: {res.order.join(" → ")}</p>
      </Panel>
      <Panel title="All algorithms">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {all.map(({ a, m }) => (
            <button key={a} type="button" onClick={() => setAlgo(a)} className={cn("rounded-lg border p-2 text-left", a === algo ? "border-accent bg-accent/5" : "border-border hover:border-border-strong")}>
              <div className="text-[12px] text-muted">{a}</div>
              <div className="font-mono text-lg font-semibold">{m}</div>
            </button>
          ))}
        </div>
        <div className="mt-3">
          <Explain>
            C-SCAN counts the return sweep as head movement here. SSTF looks best but can starve far requests; SCAN/C-SCAN bound the wait. On SSDs none of this
            matters — there is no head.
          </Explain>
        </div>
      </Panel>
    </div>
  );
}
