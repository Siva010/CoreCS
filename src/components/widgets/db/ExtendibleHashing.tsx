"use client";
import { useState } from "react";
import { RotateCcw, Undo2 } from "lucide-react";
import { bits, bucketName, deleteKey, emptyHash, insertKey, pointersTo, slotOf, type HashEvent, type HashState } from "@/lib/sim/extendibleHash";
import { Btn, Explain, Field, Panel, Segmented, Stat, colorFor, inputCls } from "../ui";
import { cn } from "@/lib/utils";

const PRESETS: { label: string; capacity: number; depth: number; keys: number[]; note: string }[] = [
  {
    label: "Textbook example",
    capacity: 4,
    depth: 2,
    keys: [4, 12, 32, 16, 1, 5, 21, 13, 10, 15, 7, 19],
    note: "Ramakrishnan & Gehrke's example: global depth 2, four buckets of capacity 4. Now insert 20 — it hashes to slot 00, whose bucket is full and as deep as the directory, so the directory doubles. Then insert 9.",
  },
  {
    label: "Split without doubling",
    capacity: 2,
    depth: 1,
    keys: [4, 6, 1, 3, 5],
    note: "Inserting 5 made the directory double for the odd keys, so the even bucket [4, 6] still has local depth 1 under a global depth of 2 — two slots (00 and 10) point at it. Insert 8: that bucket splits on its second bit without doubling the directory.",
  },
  {
    label: "Skewed keys",
    capacity: 2,
    depth: 1,
    keys: [0, 32],
    note: "0 and 32 end in the same five bits. Insert 64: splitting can never separate keys whose hashes agree on every bit the directory could use, so the bucket needs an overflow page. Duplicate keys behave the same way.",
  },
];

interface Snapshot {
  state: HashState;
  events: HashEvent[];
  lastKey: number | null;
}

function build(capacity: number, depth: number, keys: number[]): Snapshot {
  let state = emptyHash(capacity, depth);
  for (const k of keys) state = insertKey(state, k).state;
  return { state, events: [{ kind: "insert", text: `Loaded ${keys.length} keys: ${keys.join(", ")}.` }], lastKey: null };
}

export default function ExtendibleHashing() {
  const [snap, setSnap] = useState<Snapshot>(() => build(PRESETS[0].capacity, PRESETS[0].depth, PRESETS[0].keys));
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [note, setNote] = useState<string | null>(PRESETS[0].note);
  const [input, setInput] = useState("20");
  const [capacity, setCapacity] = useState(String(PRESETS[0].capacity) as "2" | "3" | "4");
  const { state } = snap;

  const keys = input
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  const valid = keys.length > 0 && keys.every((k) => Number.isInteger(k) && k >= 0 && k < 1_000_000);

  const apply = (op: "insert" | "delete") => {
    if (!valid) return;
    let s = state;
    const events: HashEvent[] = [];
    for (const k of keys) {
      const r = op === "insert" ? insertKey(s, k) : deleteKey(s, k);
      s = r.state;
      events.push(...r.events);
    }
    setHistory((h) => [...h, snap].slice(-50));
    setSnap({ state: s, events, lastKey: keys[keys.length - 1] });
  };

  const load = (p: (typeof PRESETS)[number]) => {
    setHistory([]);
    setCapacity(String(p.capacity) as "2" | "3" | "4");
    setSnap(build(p.capacity, p.depth, p.keys));
    setNote(p.note);
    setInput(p.label === "Textbook example" ? "20" : p.label === "Skewed keys" ? "64" : "8");
  };

  const reset = (cap: number) => {
    setHistory([]);
    setSnap({ state: emptyHash(cap, 1), events: [{ kind: "insert", text: `Empty table: global depth 1, two buckets of capacity ${cap}.` }], lastKey: null });
    setNote(null);
  };

  const used = state.buckets.reduce((n, b) => n + b.keys.length, 0);
  const lastSlot = snap.lastKey === null ? null : slotOf(state, snap.lastKey);
  const lastBucket = lastSlot === null ? null : state.directory[lastSlot];
  const order = [...state.buckets].sort((a, b) => state.directory.indexOf(a.id) - state.directory.indexOf(b.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        {PRESETS.map((p) => (
          <Btn key={p.label} onClick={() => load(p)}>
            {p.label}
          </Btn>
        ))}
        <Field label="Bucket capacity">
          <Segmented
            ariaLabel="Bucket capacity"
            size="sm"
            value={capacity}
            onChange={(v) => {
              setCapacity(v);
              reset(Number(v));
            }}
            options={[
              { value: "2", label: "2" },
              { value: "3", label: "3" },
              { value: "4", label: "4" },
            ]}
          />
        </Field>
        <Btn variant="ghost" onClick={() => reset(Number(capacity))}>
          <RotateCcw className="h-3.5 w-3.5" /> Empty
        </Btn>
      </div>
      {note && <Explain>{note}</Explain>}

      <div className="flex flex-wrap items-end gap-2">
        <Field label="Key(s) — one or several, e.g. 20 or 9, 25, 41">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && apply("insert")}
            className={cn(inputCls, "w-56")}
            aria-label="Keys"
            spellCheck={false}
          />
        </Field>
        <Btn variant="primary" onClick={() => apply("insert")} disabled={!valid}>
          Insert
        </Btn>
        <Btn onClick={() => apply("delete")} disabled={!valid}>
          Delete
        </Btn>
        <Btn variant="ghost" disabled={!history.length} onClick={() => { setSnap(history[history.length - 1]); setHistory((h) => h.slice(0, -1)); }}>
          <Undo2 className="h-3.5 w-3.5" /> Undo
        </Btn>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Global depth" value={state.globalDepth} sub={`directory: ${state.directory.length} slots`} />
        <Stat label="Buckets" value={state.buckets.length} sub={`capacity ${state.capacity} each`} />
        <Stat label="Keys" value={used} />
        <Stat label="Space used" value={`${Math.round((100 * used) / (state.buckets.length * state.capacity))}%`} sub="keys ÷ bucket slots" />
      </div>

      <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
        <Panel title="Directory" right={<span className="text-[11px] text-subtle">last {state.globalDepth} bits</span>}>
          <ul className="space-y-1 font-mono text-[12.5px]">
            {state.directory.map((id, slot) => (
              <li key={slot} className={cn("flex items-center justify-between rounded-md border px-2 py-1", slot === lastSlot ? "border-warn bg-warn/10" : "border-border")}>
                <span className="text-fg">{bits(slot, state.globalDepth)}</span>
                <span className="text-subtle">→</span>
                <span className="font-semibold" style={{ color: colorFor(id) }}>
                  {bucketName(id)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Buckets" right={<span className="text-[11px] text-subtle">local depth = bits its keys share</span>}>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {order.map((b) => {
              const ptrs = pointersTo(state, b.id);
              const over = b.keys.length > state.capacity;
              const suffix = bits(state.directory.indexOf(b.id), b.localDepth);
              return (
                <div key={b.id} className={cn("rounded-lg border bg-surface-2 p-2", b.id === lastBucket ? "border-warn" : "border-border")} style={{ borderLeftWidth: 3, borderLeftColor: colorFor(b.id) }}>
                  <div className="flex items-baseline justify-between font-mono text-[12px]">
                    <span className="font-semibold" style={{ color: colorFor(b.id) }}>
                      {bucketName(b.id)}
                    </span>
                    <span className="text-subtle">
                      local {b.localDepth} · …{suffix}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {Array.from({ length: Math.max(state.capacity, b.keys.length) }, (_, i) => (
                      <span
                        key={i}
                        className={cn(
                          "min-w-9 rounded border px-1.5 py-0.5 text-center font-mono text-[12px]",
                          i >= state.capacity ? "border-bad/50 bg-bad/10 text-bad" : b.keys[i] !== undefined ? "border-border-strong bg-surface text-fg" : "border-dashed border-border text-subtle",
                          b.keys[i] === snap.lastKey && "ring-1 ring-warn",
                        )}
                        title={b.keys[i] !== undefined ? `${b.keys[i]} = ${b.keys[i].toString(2)}₂` : "empty"}
                      >
                        {b.keys[i] ?? "·"}
                      </span>
                    ))}
                  </div>
                  <div className="mt-1 text-[11px] text-subtle">
                    {ptrs} pointer{ptrs === 1 ? "" : "s"} = 2^({state.globalDepth}−{b.localDepth}){over && <span className="text-bad"> · overflow page</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      <Panel title="What happened">
        <ol className="space-y-1.5 text-[13px] leading-relaxed">
          {snap.events.map((e, i) => (
            <li key={i} className={cn("rounded-md px-2 py-1", e.kind === "double" && "bg-accent/10", e.kind === "split" && "bg-warn/10", e.kind === "overflow" && "bg-bad/10", (e.kind === "insert" || e.kind === "delete" || e.kind === "missing") && "bg-surface-2")}>
              <span className="mr-1.5 font-mono text-[11px] font-semibold tracking-wide text-subtle uppercase">{e.kind}</span>
              {e.text}
            </li>
          ))}
        </ol>
      </Panel>
      <p className="text-[12.5px] text-subtle">
        h(k) = k here, so you can read the bits straight off the key. A lookup is always one directory probe plus one bucket read; the directory is small enough to stay in memory. Doubling copies only
        pointers — the expensive part of rehashing everything is exactly what extendible hashing avoids.
      </p>
    </div>
  );
}
