"use client";
import { useMemo, useState } from "react";
import { RotateCcw, Search } from "lucide-react";
import { Btn, Explain, Field, NumberInput, Panel, Stat, inputCls } from "../ui";
import { cn } from "@/lib/utils";

interface Entry {
  key: string;
  value: string | null; // null = tombstone
  seq: number;
}

interface SSTable {
  id: number;
  level: number;
  entries: Entry[];
}

interface State {
  memtable: Entry[];
  tables: SSTable[];
  seq: number;
  nextId: number;
  walBytes: number;
  sstBytes: number;
  logicalBytes: number;
  events: { text: string; tone?: "good" | "warn" | "bad" }[];
  probe: { key: string; steps: { where: string; outcome: string; hit: boolean; skipped: boolean }[] } | null;
}

const MEMTABLE_LIMIT = 4;
const ENTRY_BYTES = 32;

const initial = (): State => ({
  memtable: [],
  tables: [],
  seq: 0,
  nextId: 1,
  walBytes: 0,
  sstBytes: 0,
  logicalBytes: 0,
  events: [{ text: `Writes land in the memtable (sorted, in RAM) after an append to the WAL. It flushes to an immutable SSTable after ${MEMTABLE_LIMIT} entries.` }],
  probe: null,
});

const copy = (s: State): State => structuredClone(s);
const sortEntries = (e: Entry[]) => [...e].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

/** Deterministic "bloom filter": a key is definitely absent unless its fingerprint is in the table's set. */
function fingerprint(key: string) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 64; // 64 slots: small enough that false positives happen, like a real filter
}

function bloomOf(t: SSTable) {
  return new Set(t.entries.map((e) => fingerprint(e.key)));
}

function flush(prev: State): State {
  const s = copy(prev);
  if (!s.memtable.length) return s;
  const t: SSTable = { id: s.nextId++, level: 0, entries: sortEntries(s.memtable) };
  s.tables.unshift(t);
  s.sstBytes += t.entries.length * ENTRY_BYTES;
  s.events.push({ text: `Memtable flushed to SSTable #${t.id} at L0 (${t.entries.length} entries, written sequentially — no random I/O).`, tone: "good" });
  s.memtable = [];
  return s;
}

function put(prev: State, key: string, value: string | null): State {
  let s = copy(prev);
  s.seq++;
  s.walBytes += ENTRY_BYTES;
  s.logicalBytes += ENTRY_BYTES;
  s.memtable = sortEntries([...s.memtable.filter((e) => e.key !== key), { key, value, seq: s.seq }]);
  s.events.push({ text: value === null ? `delete("${key}") → tombstone appended (the old value stays until compaction).` : `put("${key}", "${value}") → WAL append + memtable insert.` });
  s.probe = null;
  if (s.memtable.length >= MEMTABLE_LIMIT) s = flush(s);
  return s;
}

function compact(prev: State): State {
  const s = copy(prev);
  const l0 = s.tables.filter((t) => t.level === 0);
  if (l0.length < 2) {
    s.events.push({ text: "Need at least two L0 SSTables to compact.", tone: "warn" });
    return s;
  }
  const l1 = s.tables.filter((t) => t.level === 1);
  const merged = new Map<string, Entry>();
  // Oldest first so newer entries win; L1 is older than every L0 table here.
  for (const t of [...l1, ...l0].reverse()) for (const e of t.entries) merged.set(e.key, e);
  const bottom = true; // single lower level in this model: tombstones can be dropped
  const kept = [...merged.values()].filter((e) => !(bottom && e.value === null));
  const dropped = merged.size - kept.length;
  const obsolete = [...l0, ...l1].reduce((n, t) => n + t.entries.length, 0) - merged.size;
  const t: SSTable = { id: s.nextId++, level: 1, entries: sortEntries(kept) };
  s.tables = [t];
  s.sstBytes += kept.length * ENTRY_BYTES;
  s.events.push({
    text: `Compaction merged ${l0.length + l1.length} SSTable(s) into #${t.id} at L1: ${obsolete} overwritten version(s) discarded, ${dropped} tombstone(s) finally removed. Everything was rewritten — that's write amplification.`,
    tone: "good",
  });
  return s;
}

function get(prev: State, key: string): State {
  const s = copy(prev);
  const steps: NonNullable<State["probe"]>["steps"] = [];
  const inMem = s.memtable.find((e) => e.key === key);
  if (inMem) {
    steps.push({ where: "memtable (RAM)", outcome: inMem.value === null ? "tombstone → key not found" : `found "${inMem.value}"`, hit: true, skipped: false });
    s.probe = { key, steps };
    return s;
  }
  steps.push({ where: "memtable (RAM)", outcome: "not here", hit: false, skipped: false });
  for (const t of s.tables) {
    const maybe = bloomOf(t).has(fingerprint(key));
    if (!maybe) {
      steps.push({ where: `SSTable #${t.id} (L${t.level})`, outcome: "bloom filter says definitely not here → file not read", hit: false, skipped: true });
      continue;
    }
    const e = t.entries.find((x) => x.key === key);
    if (e) {
      steps.push({ where: `SSTable #${t.id} (L${t.level})`, outcome: e.value === null ? "tombstone → key not found (search stops)" : `found "${e.value}" (newest version wins, search stops)`, hit: true, skipped: false });
      s.probe = { key, steps };
      return s;
    }
    steps.push({ where: `SSTable #${t.id} (L${t.level})`, outcome: "bloom said maybe, block read → false positive, key absent", hit: false, skipped: false });
  }
  steps.push({ where: "result", outcome: "key not found anywhere", hit: false, skipped: false });
  s.probe = { key, steps };
  return s;
}

const PRESET_KEYS = ["user:1", "user:2", "user:3", "user:4", "user:5", "user:6"];

export default function Lsm() {
  const [s, setS] = useState<State>(initial);
  const [key, setKey] = useState("user:3");
  const [value, setValue] = useState("v1");
  const [auto, setAuto] = useState(0);

  const amplification = s.logicalBytes ? (s.walBytes + s.sstBytes) / s.logicalBytes : 0;
  const levels = useMemo(() => [0, 1].map((l) => ({ l, tables: s.tables.filter((t) => t.level === l) })), [s.tables]);

  const writeBurst = () => {
    setS((cur) => {
      let x = cur;
      for (let i = 0; i < 6; i++) {
        const k = PRESET_KEYS[(auto + i) % PRESET_KEYS.length];
        x = put(x, k, `v${Math.floor((auto + i) / PRESET_KEYS.length) + 1}`);
      }
      return x;
    });
    setAuto((a) => a + 6);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Key">
          <input className={cn(inputCls, "w-28")} value={key} onChange={(e) => setKey(e.target.value)} />
        </Field>
        <Field label="Value">
          <input className={cn(inputCls, "w-24")} value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Btn variant="primary" onClick={() => setS((x) => put(x, key, value))}>
          put
        </Btn>
        <Btn onClick={() => setS((x) => put(x, key, null))}>delete (tombstone)</Btn>
        <Btn onClick={() => setS((x) => get(x, key))}>
          <Search className="h-3.5 w-3.5" /> get
        </Btn>
        <Btn variant="ghost" onClick={writeBurst}>
          Write 6 keys
        </Btn>
        <Btn variant="ghost" onClick={() => setS(flush)} disabled={!s.memtable.length}>
          Flush memtable
        </Btn>
        <Btn variant="ghost" onClick={() => setS(compact)}>
          Compact
        </Btn>
        <Btn variant="ghost" onClick={() => { setS(initial()); setAuto(0); }}>
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </Btn>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          <Panel title={`Memtable (RAM, sorted) · ${s.memtable.length}/${MEMTABLE_LIMIT}`}>
            <div className="flex flex-wrap gap-1.5">
              {s.memtable.length ? (
                s.memtable.map((e) => (
                  <span key={e.key} className={cn("rounded px-2 py-0.5 font-mono text-[12px]", e.value === null ? "bg-bad/15 text-bad" : "bg-accent/10 text-accent")}>
                    {e.key} = {e.value ?? "⌫ tombstone"}
                  </span>
                ))
              ) : (
                <span className="text-[13px] text-subtle">empty (just flushed)</span>
              )}
            </div>
          </Panel>
          {levels.map(({ l, tables }) => (
            <Panel key={l} title={`L${l} — ${tables.length} SSTable(s)${l === 0 ? " (newest first, key ranges may overlap)" : " (merged, non-overlapping)"}`}>
              {tables.length ? (
                <div className="space-y-2">
                  {tables.map((t) => (
                    <div key={t.id} className="rounded-lg border border-border p-2">
                      <div className="mb-1 font-mono text-[11.5px] text-subtle">
                        SSTable #{t.id} · {t.entries.length} entries · keys {t.entries[0]?.key} … {t.entries.at(-1)?.key}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {t.entries.map((e) => (
                          <span key={e.key} className={cn("rounded px-1.5 py-0.5 font-mono text-[11.5px]", e.value === null ? "bg-bad/15 text-bad" : "bg-surface-2 text-muted")}>
                            {e.key}={e.value ?? "⌫"}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-subtle">empty</p>
              )}
            </Panel>
          ))}
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Write amplification" value={`${amplification.toFixed(1)}×`} sub="bytes written ÷ bytes of data" />
            <Stat label="Files a read may check" value={1 + s.tables.length} sub="memtable + SSTables" />
          </div>
          <Panel title={s.probe ? `get("${s.probe.key}")` : "Read path"}>
            {s.probe ? (
              <ol className="space-y-1 text-[12.5px]">
                {s.probe.steps.map((st, i) => (
                  <li key={i} className={cn("rounded-md border px-2 py-1", st.hit ? "border-ok/50 bg-ok/5" : st.skipped ? "border-border bg-surface-2/50 text-subtle" : "border-border")}>
                    <span className="font-mono">{st.where}</span>: {st.outcome}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[13px] text-subtle">Run a get to see which files are skipped by bloom filters and where the search stops.</p>
            )}
          </Panel>
          <Panel title="Events">
            <ol className="max-h-56 space-y-0.5 overflow-y-auto text-[12.5px] thin-scroll">
              {[...s.events].reverse().map((e, i) => (
                <li key={s.events.length - i} className={cn(e.tone === "good" && "text-ok", e.tone === "warn" && "text-warn", e.tone === "bad" && "text-bad", !e.tone && "text-muted")}>
                  {e.text}
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>

      <Explain>
        Write the same keys several times, then compact: the obsolete versions disappear and the data shrinks into one sorted file — while the write-amplification counter shows the price of
        rewriting everything. Delete a key and read it before and after compaction to see why tombstones have to survive for a while.
      </Explain>
    </div>
  );
}
