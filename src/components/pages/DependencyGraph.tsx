"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { DagLayout } from "@/lib/content/graph";
import { useHydrated, useProgress } from "@/lib/progress/store";
import type { SubjectId } from "@/lib/content/types";

const NODE_W = 188;
const NODE_H = 40;
const COL_GAP = 64;
const ROW_GAP = 12;

const SUBJECT_VAR: Record<SubjectId, string> = { os: "var(--os)", cn: "var(--cn)", db: "var(--db)", x: "var(--x)" };

export function DependencyGraph({ graphs }: { graphs: { id: string; label: string; layout: DagLayout }[] }) {
  const [tab, setTab] = useState(graphs[0]?.id);
  const g = graphs.find((x) => x.id === tab) ?? graphs[0];
  const router = useRouter();
  const hydrated = useHydrated((s) => s.hydrated);
  const lessons = useProgress((s) => s.lessons);
  const [hover, setHover] = useState<string | null>(null);

  const { nodes, edges } = g.layout;
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const related = useMemo(() => {
    if (!hover) return null;
    const up = new Set<string>([hover]);
    const down = new Set<string>([hover]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const e of edges) {
        if (up.has(e.to) && !up.has(e.from)) {
          up.add(e.from);
          changed = true;
        }
        if (down.has(e.from) && !down.has(e.to)) {
          down.add(e.to);
          changed = true;
        }
      }
    }
    return { up, down };
  }, [hover, edges]);

  const width = g.layout.layers * (NODE_W + COL_GAP) + 20;
  const height = g.layout.maxRows * (NODE_H + ROW_GAP) + 20;
  const x = (layer: number) => 10 + layer * (NODE_W + COL_GAP);
  const y = (row: number) => 10 + row * (NODE_H + ROW_GAP);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {graphs.map((gr) => (
          <button
            key={gr.id}
            type="button"
            onClick={() => setTab(gr.id)}
            className={`rounded-full border px-3 py-1 text-[13px] font-medium ${tab === gr.id ? "border-fg bg-fg text-bg" : "border-border bg-surface text-muted hover:text-fg"}`}
          >
            {gr.label}
          </button>
        ))}
        <span className="ml-auto text-[12px] text-subtle">Hover a concept to trace what it needs (above) and what it unlocks (below). Click to open.</span>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border bg-surface thin-scroll">
        <svg width={width} height={height} role="img" aria-label={`${g.label} prerequisite graph`} className="block">
          {edges.map((e, i) => {
            const a = byId.get(e.from);
            const b = byId.get(e.to);
            if (!a || !b) return null;
            const x1 = x(a.layer) + NODE_W;
            const y1 = y(a.row) + NODE_H / 2;
            const x2 = x(b.layer);
            const y2 = y(b.row) + NODE_H / 2;
            const on = related ? (related.up.has(e.from) && related.up.has(e.to)) || (related.down.has(e.from) && related.down.has(e.to)) : false;
            const dim = related && !on;
            return (
              <path
                key={i}
                d={`M${x1},${y1} C${x1 + COL_GAP / 2},${y1} ${x2 - COL_GAP / 2},${y2} ${x2},${y2}`}
                fill="none"
                stroke={on ? "var(--accent)" : "var(--border-strong)"}
                strokeWidth={on ? 2 : 1}
                opacity={dim ? 0.25 : 1}
              />
            );
          })}
          {nodes.map((n) => {
            const done = hydrated && !!lessons[n.id]?.completedAt;
            const inSet = related ? related.up.has(n.id) || related.down.has(n.id) : true;
            return (
              <g
                key={n.id}
                transform={`translate(${x(n.layer)},${y(n.row)})`}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => router.push(n.href)}
                style={{ cursor: "pointer", opacity: inSet ? 1 : 0.3 }}
                role="link"
                aria-label={n.title}
              >
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={9}
                  fill={done ? "color-mix(in oklab, var(--ok) 14%, var(--surface))" : "var(--surface)"}
                  stroke={hover === n.id ? "var(--accent)" : done ? "var(--ok)" : "var(--border-strong)"}
                  strokeWidth={hover === n.id ? 2 : 1}
                />
                <rect width={4} height={NODE_H - 16} x={8} y={8} rx={2} fill={SUBJECT_VAR[n.subject]} />
                <foreignObject x={18} y={2} width={NODE_W - 24} height={NODE_H - 4}>
                  <div
                    style={{ height: NODE_H - 4, display: "flex", alignItems: "center", fontSize: 11.5, lineHeight: 1.2, color: "var(--fg)", overflow: "hidden" }}
                  >
                    <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{n.title}</span>
                  </div>
                </foreignObject>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
