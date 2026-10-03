"use client";
import { useMemo, useState } from "react";
import { Plus, RotateCcw } from "lucide-react";
import { Btn, Explain, Field, NumberInput, Panel, Segmented, Stat, colorFor } from "../ui";
import { cn } from "@/lib/utils";

const RING = 2 ** 32;

/** FNV-1a — small, fast, well-spread for this purpose. */
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

interface Placement {
  owner: Record<string, string>; // key → node
  tokens: { node: string; pos: number }[];
}

function place(nodes: string[], keys: string[], vnodes: number, mode: "ring" | "mod"): Placement {
  if (!nodes.length) return { owner: {}, tokens: [] };
  if (mode === "mod") {
    const owner: Record<string, string> = {};
    for (const k of keys) owner[k] = nodes[hash(k) % nodes.length];
    return { owner, tokens: [] };
  }
  const tokens = nodes.flatMap((n) => Array.from({ length: vnodes }, (_, i) => ({ node: n, pos: hash(`${n}#${i}`) })));
  tokens.sort((a, b) => a.pos - b.pos);
  const owner: Record<string, string> = {};
  for (const k of keys) {
    const h = hash(k);
    const t = tokens.find((x) => x.pos >= h) ?? tokens[0];
    owner[k] = t.node;
  }
  return { owner, tokens };
}

export default function ConsistentHashing() {
  const [nodes, setNodes] = useState(["node-1", "node-2", "node-3"]);
  const [vnodes, setVnodes] = useState(24);
  const [nKeys, setNKeys] = useState(120);
  const [mode, setMode] = useState<"ring" | "mod">("ring");
  const [hotKey, setHotKey] = useState(false);
  const [lastChange, setLastChange] = useState<{ what: string; moved: number; total: number } | null>(null);

  const keys = useMemo(() => Array.from({ length: nKeys }, (_, i) => `key:${i + 1}`), [nKeys]);
  const placement = useMemo(() => place(nodes, keys, vnodes, mode), [nodes, keys, vnodes, mode]);

  const counts = useMemo(() => {
    const c: Record<string, number> = Object.fromEntries(nodes.map((n) => [n, 0]));
    for (const k of keys) {
      const o = placement.owner[k];
      if (o !== undefined) c[o] = (c[o] ?? 0) + (hotKey && k === "key:1" ? 40 : 1);
    }
    return c;
  }, [nodes, keys, placement, hotKey]);

  const totalLoad = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const ideal = totalLoad / Math.max(1, nodes.length);
  const spread = nodes.length ? Math.max(...Object.values(counts)) / ideal : 1;

  const change = (next: string[], what: string) => {
    const before = place(nodes, keys, vnodes, mode).owner;
    const after = place(next, keys, vnodes, mode).owner;
    const moved = keys.filter((k) => before[k] !== after[k]).length;
    setNodes(next);
    setLastChange({ what, moved, total: keys.length });
  };

  const R = 110;
  const cx = 130;
  const cy = 130;
  const point = (pos: number, r: number) => {
    const a = (pos / RING) * Math.PI * 2 - Math.PI / 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as const;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Placement">
          <Segmented value={mode} onChange={setMode} options={[{ value: "ring", label: "Hash ring" }, { value: "mod", label: "hash mod N" }]} />
        </Field>
        <Field label="Virtual nodes per server" hint="ring only">
          <NumberInput value={vnodes} min={1} max={200} onChange={(v) => setVnodes(Math.max(1, Math.min(200, v)))} />
        </Field>
        <Field label="Keys">
          <NumberInput value={nKeys} min={10} max={600} step={10} onChange={(v) => setNKeys(Math.max(10, Math.min(600, v)))} />
        </Field>
        <Btn onClick={() => change([...nodes, `node-${nodes.length + 1}`], `added node-${nodes.length + 1}`)} disabled={nodes.length >= 8}>
          <Plus className="h-3.5 w-3.5" /> Add node
        </Btn>
        <Btn variant="ghost" onClick={() => { setNodes(["node-1", "node-2", "node-3"]); setLastChange(null); }}>
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </Btn>
        <label className="flex items-center gap-2 pb-1.5 text-[13px] text-muted">
          <input type="checkbox" checked={hotKey} onChange={(e) => setHotKey(e.target.checked)} /> make key:1 hot (40× traffic)
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Panel title={mode === "ring" ? "Hash ring" : "hash(key) mod N"}>
          {mode === "ring" ? (
            <svg viewBox="0 0 260 260" className="w-full" role="img" aria-label="Hash ring with nodes and keys">
              <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--border)" strokeWidth={10} />
              {keys.map((k) => {
                const [x, y] = point(hash(k), R);
                const owner = placement.owner[k];
                const idx = nodes.indexOf(owner);
                return <circle key={k} cx={x} cy={y} r={hotKey && k === "key:1" ? 5 : 2.2} fill={colorFor(idx)} opacity={0.9} />;
              })}
              {placement.tokens.map((t, i) => {
                const [x1, y1] = point(t.pos, R - 9);
                const [x2, y2] = point(t.pos, R + 9);
                return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={colorFor(nodes.indexOf(t.node))} strokeWidth={2} />;
              })}
              <text x={cx} y={cy - 4} textAnchor="middle" fontSize="11" fill="var(--muted)">
                {nodes.length} nodes
              </text>
              <text x={cx} y={cy + 12} textAnchor="middle" fontSize="11" fill="var(--subtle)">
                {vnodes} vnodes each
              </text>
            </svg>
          ) : (
            <div className="grid grid-cols-6 gap-1 py-2">
              {keys.slice(0, 120).map((k) => (
                <span key={k} className="h-3 rounded-sm" style={{ background: colorFor(nodes.indexOf(placement.owner[k])) }} title={`${k} → ${placement.owner[k]}`} />
              ))}
            </div>
          )}
          <p className="mt-1 text-[11.5px] text-subtle">Each key walks clockwise to the next token; a token&apos;s colour is its server.</p>
        </Panel>

        <div className="space-y-3">
          <Panel title="Load per node">
            <ul className="space-y-1.5">
              {nodes.map((n, i) => {
                const share = (counts[n] ?? 0) / totalLoad;
                return (
                  <li key={n} className="flex items-center gap-2 text-[12.5px]">
                    <span className="w-16 font-mono" style={{ color: colorFor(i) }}>
                      {n}
                    </span>
                    <span className="h-3 flex-1 overflow-hidden rounded bg-surface-2">
                      <span className="block h-full" style={{ width: `${share * 100}%`, background: colorFor(i) }} />
                    </span>
                    <span className="w-28 text-right font-mono text-muted">
                      {counts[n] ?? 0} ({Math.round(share * 100)}%)
                    </span>
                    {nodes.length > 1 && (
                      <button type="button" className="text-subtle hover:text-bad" onClick={() => change(nodes.filter((x) => x !== n), `removed ${n}`)}>
                        remove
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </Panel>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Keys moved by last change" value={lastChange ? `${Math.round((lastChange.moved / lastChange.total) * 100)}%` : "—"} sub={lastChange ? `${lastChange.moved}/${lastChange.total} after ${lastChange.what}` : "add or remove a node"} />
            <Stat label="Worst node vs ideal" value={`${spread.toFixed(2)}×`} sub="1.00 = perfectly balanced" />
            <Stat label="Tokens on the ring" value={mode === "ring" ? placement.tokens.length : "—"} />
          </div>
          <Explain>
            Add a node with <strong>hash mod N</strong> and watch almost every key move (a cache would be wiped). Switch to the <strong>ring</strong>: only the new node&apos;s arc moves — about 1/N of
            the keys. Then set virtual nodes to 1 and look at the load bars: few tokens mean lumpy ownership, which is why real systems use many tokens per server. The hot-key switch shows what
            consistent hashing can&apos;t fix: it balances keys, not traffic per key.
          </Explain>
        </div>
      </div>
    </div>
  );
}
