"use client";
import { useMemo, useState } from "react";
import { RotateCcw, Search, Shuffle } from "lucide-react";
import { Btn, Explain, Field, NumberInput, Panel, Segmented, Stat } from "../ui";
import { cn } from "@/lib/utils";

interface BNode {
  id: number;
  leaf: boolean;
  keys: number[];
  children: number[];
  next: number | null;
}

interface Tree {
  order: number; // max children per node; a node holds at most order - 1 keys
  nodes: Record<number, BNode>;
  root: number;
  nextId: number;
  splits: number;
}

function emptyTree(order: number): Tree {
  return { order, nodes: { 1: { id: 1, leaf: true, keys: [], children: [], next: null } }, root: 1, nextId: 2, splits: 0 };
}

/** Index of the child to descend into: first separator strictly greater than key. */
function childIndex(keys: number[], key: number) {
  let i = 0;
  while (i < keys.length && key >= keys[i]) i++;
  return i;
}

export function insertKey(t: Tree, key: number): { tree: Tree; events: string[] } {
  const nodes = { ...t.nodes };
  let nextId = t.nextId;
  let splits = t.splits;
  const events: string[] = [];
  const maxKeys = t.order - 1;
  const touch = (id: number) => (nodes[id] = { ...nodes[id], keys: [...nodes[id].keys], children: [...nodes[id].children] });

  const ins = (id: number): { sep: number; right: number } | null | "dup" => {
    const n = touch(id);
    if (n.leaf) {
      if (n.keys.includes(key)) return "dup";
      const pos = childIndex(n.keys, key);
      n.keys.splice(pos, 0, key);
      if (n.keys.length <= maxKeys) return null;
      const mid = Math.ceil(n.keys.length / 2);
      const right: BNode = { id: nextId++, leaf: true, keys: n.keys.slice(mid), children: [], next: n.next };
      n.keys = n.keys.slice(0, mid);
      n.next = right.id;
      nodes[right.id] = right;
      splits++;
      events.push(`Leaf [${[...n.keys, ...right.keys].join(" ")}] overflowed → split into [${n.keys.join(" ")}] and [${right.keys.join(" ")}]; separator ${right.keys[0]} goes up.`);
      return { sep: right.keys[0], right: right.id };
    }
    const i = childIndex(n.keys, key);
    const res = ins(n.children[i]);
    if (res === null || res === "dup") return res;
    n.keys.splice(i, 0, res.sep);
    n.children.splice(i + 1, 0, res.right);
    if (n.keys.length <= maxKeys) return null;
    const mid = Math.floor(n.keys.length / 2);
    const sep = n.keys[mid];
    const right: BNode = { id: nextId++, leaf: false, keys: n.keys.slice(mid + 1), children: n.children.slice(mid + 1), next: null };
    n.keys = n.keys.slice(0, mid);
    n.children = n.children.slice(0, mid + 1);
    nodes[right.id] = right;
    splits++;
    events.push(`Internal node overflowed → split; separator ${sep} moves up (it is not kept in either half).`);
    return { sep, right: right.id };
  };

  const res = ins(t.root);
  if (res === "dup") return { tree: t, events: [`${key} is already in the tree (unique index).`] };
  let root = t.root;
  if (res) {
    const newRoot: BNode = { id: nextId++, leaf: false, keys: [res.sep], children: [t.root, res.right], next: null };
    nodes[newRoot.id] = newRoot;
    root = newRoot.id;
    events.push(`The root split → new root [${res.sep}]. The tree grew one level taller (the only way a B+ tree gains height).`);
  }
  if (!events.length) events.push(`Inserted ${key} — the leaf had room, no split.`);
  return { tree: { ...t, nodes, root, nextId, splits }, events };
}

function searchPath(t: Tree, key: number) {
  const path: number[] = [];
  let id = t.root;
  for (;;) {
    path.push(id);
    const n = t.nodes[id];
    if (n.leaf) return { path, found: n.keys.includes(key) };
    id = n.children[childIndex(n.keys, key)];
  }
}

function rangeScan(t: Tree, lo: number, hi: number) {
  const { path } = searchPath(t, lo);
  const leaves: number[] = [];
  const keys: number[] = [];
  let id: number | null = path[path.length - 1];
  while (id !== null) {
    const n: BNode = t.nodes[id];
    leaves.push(id);
    let stop = false;
    for (const k of n.keys) {
      if (k > hi) {
        stop = true;
        break;
      }
      if (k >= lo) keys.push(k);
    }
    if (stop) break;
    id = n.next;
  }
  return { path: path.slice(0, -1), leaves, keys };
}

function levels(t: Tree): number[][] {
  const out: number[][] = [];
  let cur = [t.root];
  while (cur.length) {
    out.push(cur);
    const n0 = t.nodes[cur[0]];
    if (n0.leaf) break;
    cur = cur.flatMap((id) => t.nodes[id].children);
  }
  return out;
}

function seededShuffle(n: number, seed: number) {
  const a = Array.from({ length: n }, (_, i) => i + 1);
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function BTree() {
  const [order, setOrder] = useState(4);
  const [tree, setTree] = useState<Tree>(() => emptyTree(4));
  const [key, setKey] = useState(7);
  const [lo, setLo] = useState(5);
  const [hi, setHi] = useState(12);
  const [log, setLog] = useState<string[]>(["Empty tree: a single empty leaf is the root."]);
  const [hl, setHl] = useState<{ path: number[]; leaves: number[]; keys: number[]; found?: boolean; mode: "search" | "range" } | null>(null);
  const [seed, setSeed] = useState(7);

  const lv = useMemo(() => levels(tree), [tree]);
  const all = Object.values(tree.nodes);
  const leafNodes = all.filter((n) => n.leaf);
  const totalKeys = leafNodes.reduce((s, n) => s + n.keys.length, 0);
  const fill = leafNodes.length ? totalKeys / (leafNodes.length * (tree.order - 1)) : 0;

  const reset = (o = order) => {
    setTree(emptyTree(o));
    setLog(["Empty tree: a single empty leaf is the root."]);
    setHl(null);
  };

  const insertMany = (keys: number[], label: string) => {
    let t = tree;
    const splitsBefore = t.splits;
    for (const k of keys) t = insertKey(t, k).tree;
    setTree(t);
    setHl(null);
    setLog((l) => [`${label}: ${t.splits - splitsBefore} split(s); height now ${levels(t).length}.`, ...l].slice(0, 40));
  };

  const doInsert = () => {
    const r = insertKey(tree, key);
    setTree(r.tree);
    setHl(null);
    setLog((l) => [...r.events.map((e) => `insert ${key}: ${e}`), ...l].slice(0, 40));
    setKey((k) => k + 1);
  };

  const doSearch = () => {
    const r = searchPath(tree, key);
    setHl({ path: r.path, leaves: [], keys: r.found ? [key] : [], found: r.found, mode: "search" });
    setLog((l) => [`search ${key}: visited ${r.path.length} node(s) = ${r.path.length} page read(s) → ${r.found ? "found" : "not found"}.`, ...l].slice(0, 40));
  };

  const doRange = () => {
    const r = rangeScan(tree, Math.min(lo, hi), Math.max(lo, hi));
    setHl({ path: r.path, leaves: r.leaves, keys: r.keys, mode: "range" });
    setLog((l) => [`range ${lo}..${hi}: ${r.path.length} internal page(s) to find the start, then ${r.leaves.length} leaf page(s) along the chain → ${r.keys.length} key(s).`, ...l].slice(0, 40));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Order (max children)">
          <Segmented
            value={String(order)}
            onChange={(v) => {
              setOrder(Number(v));
              reset(Number(v));
            }}
            options={[3, 4, 5, 6].map((o) => ({ value: String(o), label: String(o) }))}
          />
        </Field>
        <Field label="Key">
          <NumberInput value={key} min={-999} max={9999} onChange={setKey} />
        </Field>
        <Btn variant="primary" onClick={doInsert}>
          Insert
        </Btn>
        <Btn onClick={doSearch}>
          <Search className="h-3.5 w-3.5" /> Search
        </Btn>
        <Field label="Range">
          <div className="flex items-center gap-1">
            <NumberInput value={lo} onChange={setLo} className="w-16" />
            <span className="text-subtle">…</span>
            <NumberInput value={hi} onChange={setHi} className="w-16" />
          </div>
        </Field>
        <Btn onClick={doRange}>Range scan</Btn>
      </div>
      <div className="flex flex-wrap gap-2">
        <Btn variant="ghost" onClick={() => insertMany(Array.from({ length: 20 }, (_, i) => i + 1), "Inserted 1..20 in order")}>
          Insert 1..20 in order
        </Btn>
        <Btn
          variant="ghost"
          onClick={() => {
            insertMany(seededShuffle(20, seed), "Inserted 1..20 in random order");
            setSeed((s) => s + 1);
          }}
        >
          <Shuffle className="h-3.5 w-3.5" /> Insert 1..20 shuffled
        </Btn>
        <Btn variant="ghost" onClick={() => reset()}>
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </Btn>
      </div>

      <Panel title={`B+ tree · order ${tree.order} (≤ ${tree.order - 1} keys per node)`}>
        <div className="overflow-x-auto pb-2 thin-scroll">
          <div className="min-w-max space-y-5">
            {lv.map((ids, depth) => (
              <div key={depth} className="flex items-center justify-center gap-2">
                <span className="w-14 shrink-0 text-right font-mono text-[10.5px] text-subtle">{depth === 0 ? "root" : ids.length && tree.nodes[ids[0]].leaf ? "leaves" : `level ${depth}`}</span>
                {ids.map((id, i) => {
                  const n = tree.nodes[id];
                  const onPath = hl?.path.includes(id);
                  const onLeafScan = hl?.leaves.includes(id);
                  const lastOnSearch = hl?.mode === "search" && hl.path[hl.path.length - 1] === id;
                  return (
                    <div key={id} className="flex items-center gap-2">
                      <div
                        className={cn(
                          "flex min-w-10 rounded-md border bg-surface font-mono text-[12px]",
                          n.leaf ? "border-d-core/50" : "border-border-strong",
                          (onPath || onLeafScan || lastOnSearch) && "border-accent ring-2 ring-accent/30",
                        )}
                        title={`node #${id}`}
                      >
                        {n.keys.length ? (
                          n.keys.map((k, j) => (
                            <span key={j} className={cn("border-r border-border px-1.5 py-1 last:border-r-0", hl?.keys.includes(k) && n.leaf && "bg-accent/20 font-semibold text-accent")}>
                              {k}
                            </span>
                          ))
                        ) : (
                          <span className="px-2 py-1 text-subtle">∅</span>
                        )}
                      </div>
                      {n.leaf && i < ids.length - 1 && <span className="text-[11px] text-subtle">→</span>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <p className="mt-2 text-[12px] text-subtle">Leaves hold every key and are linked left→right; internal nodes only route. Blue outline = pages read by the last search/scan.</p>
      </Panel>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Height (page reads per lookup)" value={lv.length} />
        <Stat label="Keys" value={totalKeys} />
        <Stat label="Splits so far" value={tree.splits} />
        <Stat label="Avg leaf fill" value={`${Math.round(fill * 100)}%`} />
      </div>

      <Panel title="Log (newest first)">
        <ol className="max-h-44 space-y-0.5 overflow-y-auto text-[12.5px] thin-scroll">
          {log.map((l, i) => (
            <li key={log.length - i} className={i === 0 ? "text-fg" : "text-muted"}>
              {l}
            </li>
          ))}
        </ol>
      </Panel>
      <Explain>
        Compare &ldquo;in order&rdquo; with &ldquo;shuffled&rdquo;: sequential keys always split the rightmost leaf, leaving half-empty leaves behind in this textbook version (real databases split the
        rightmost leaf unevenly, e.g. 90/10, to keep pages full). Random keys split leaves all over the tree — the effect behind slow random-UUID inserts.
      </Explain>
    </div>
  );
}
