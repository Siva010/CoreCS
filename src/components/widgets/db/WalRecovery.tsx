"use client";
import { useState } from "react";
import { Power, RotateCcw, Wrench } from "lucide-react";
import { Btn, Explain, Field, NumberInput, Panel, Segmented, Select } from "../ui";
import { cn } from "@/lib/utils";

type Page = "P1" | "P2" | "P3";
type Tx = 1 | 2;
const PAGES: Page[] = ["P1", "P2", "P3"];

interface Rec {
  lsn: number;
  kind: "update" | "commit" | "abort" | "clr" | "checkpoint";
  tx?: Tx;
  page?: Page;
  before?: number;
  after?: number;
}

interface PageImg {
  value: number;
  lsn: number;
}

interface State {
  disk: Record<Page, PageImg>;
  buffer: Partial<Record<Page, PageImg & { dirty: boolean }>>;
  wal: Rec[];
  flushed: number; // WAL records with lsn <= flushed are durable
  tx: Record<Tx, "idle" | "active" | "committed" | "aborted" | "in doubt">;
  crashed: boolean;
  events: { text: string; tone?: "good" | "bad" | "warn" }[];
  recovery: { phase: string; text: string }[];
}

const initial = (): State => ({
  disk: { P1: { value: 100, lsn: 0 }, P2: { value: 200, lsn: 0 }, P3: { value: 300, lsn: 0 } },
  buffer: {},
  wal: [],
  flushed: 0,
  tx: { 1: "idle", 2: "idle" },
  crashed: false,
  events: [{ text: "Disk holds P1 = 100, P2 = 200, P3 = 300. The buffer pool is empty; the WAL is empty." }],
  recovery: [],
});

const copy = (s: State): State => structuredClone(s);
const nextLsn = (s: State) => (s.wal.at(-1)?.lsn ?? 0) + 10;

/** T1/T2 are reused after they finish, so a transaction's "current" updates are those after its last COMMIT/ABORT. */
const lastEnd = (wal: Rec[], tx: Tx) => Math.max(-1, ...wal.filter((r) => r.tx === tx && (r.kind === "commit" || r.kind === "abort")).map((r) => r.lsn));
const openUpdates = (wal: Rec[], tx: Tx) => wal.filter((r) => r.tx === tx && r.kind === "update" && r.lsn > lastEnd(wal, tx));

function load(s: State, p: Page) {
  if (!s.buffer[p]) s.buffer[p] = { ...s.disk[p], dirty: false };
  return s.buffer[p]!;
}

function flushWal(s: State, upTo: number, why: string) {
  const target = Math.min(upTo, s.wal.at(-1)?.lsn ?? 0);
  if (target > s.flushed) {
    s.flushed = target;
    s.events.push({ text: `WAL flushed (fsync) up to LSN ${target} — ${why}.`, tone: "good" });
  }
}

function update(prev: State, tx: Tx, p: Page, value: number): State {
  const s = copy(prev);
  if (s.crashed) return s;
  if (s.tx[tx] === "committed" || s.tx[tx] === "aborted") s.tx[tx] = "idle";
  s.tx[tx] = "active";
  const page = load(s, p);
  const rec: Rec = { lsn: nextLsn(s), kind: "update", tx, page: p, before: page.value, after: value };
  s.wal.push(rec);
  page.value = value;
  page.lsn = rec.lsn;
  page.dirty = true;
  s.events.push({ text: `T${tx} updates ${p}: ${rec.before} → ${value}. WAL record LSN ${rec.lsn} appended (in memory); page changed in the buffer pool only.` });
  return s;
}

function commit(prev: State, tx: Tx): State {
  const s = copy(prev);
  if (s.crashed || s.tx[tx] !== "active") return s;
  const rec: Rec = { lsn: nextLsn(s), kind: "commit", tx };
  s.wal.push(rec);
  flushWal(s, rec.lsn, `T${tx}'s COMMIT must be durable before it's acknowledged`);
  s.tx[tx] = "committed";
  s.events.push({ text: `T${tx} COMMIT acknowledged. Its data pages may still be only in memory — that's fine.`, tone: "good" });
  return s;
}

function abort(prev: State, tx: Tx): State {
  const s = copy(prev);
  if (s.crashed || s.tx[tx] !== "active") return s;
  const mine = openUpdates(s.wal, tx).reverse();
  for (const r of mine) {
    const page = load(s, r.page!);
    const clr: Rec = { lsn: nextLsn(s), kind: "clr", tx, page: r.page, before: page.value, after: r.before };
    s.wal.push(clr);
    page.value = r.before!;
    page.lsn = clr.lsn;
    page.dirty = true;
  }
  s.wal.push({ lsn: nextLsn(s), kind: "abort", tx });
  s.tx[tx] = "aborted";
  s.events.push({ text: `T${tx} ROLLBACK: its changes undone in the buffer pool, each undo logged as a CLR (compensation log record).`, tone: "warn" });
  return s;
}

function flushPage(prev: State, p: Page): State {
  const s = copy(prev);
  const page = s.buffer[p];
  if (s.crashed || !page || !page.dirty) return s;
  if (page.lsn > s.flushed) flushWal(s, page.lsn, `WAL rule: log records up to ${p}'s page LSN ${page.lsn} must be durable before the page is written`);
  s.disk[p] = { value: page.value, lsn: page.lsn };
  page.dirty = false;
  const uncommitted = s.wal.some((r) => r.kind === "update" && r.page === p && r.lsn <= page.lsn && s.tx[r.tx!] === "active");
  s.events.push({ text: `${p} written to disk (value ${page.value}, page LSN ${page.lsn})${uncommitted ? " — it contains an UNCOMMITTED change (steal)" : ""}.`, tone: uncommitted ? "warn" : undefined });
  return s;
}

function checkpoint(prev: State): State {
  let s = copy(prev);
  if (s.crashed) return s;
  for (const p of PAGES) if (s.buffer[p]?.dirty) s = flushPage(s, p);
  const rec: Rec = { lsn: nextLsn(s), kind: "checkpoint" };
  s.wal.push(rec);
  flushWal(s, rec.lsn, "checkpoint record");
  s.events.push({ text: `CHECKPOINT at LSN ${rec.lsn}: every dirty page flushed; recovery can start redo here.`, tone: "good" });
  return s;
}

function crash(prev: State): State {
  const s = copy(prev);
  if (s.crashed) return s;
  const lost = s.wal.filter((r) => r.lsn > s.flushed).length;
  s.wal = s.wal.filter((r) => r.lsn <= s.flushed);
  s.buffer = {};
  for (const t of [1, 2] as Tx[]) if (s.tx[t] === "active") s.tx[t] = "in doubt";
  s.crashed = true;
  s.recovery = [];
  s.events.push({ text: `⚡ CRASH. The buffer pool is gone${lost ? ` and ${lost} unflushed WAL record(s) are lost` : ""}. Only the disk pages and the durable WAL survive.`, tone: "bad" });
  return s;
}

export function recover(prev: State): State {
  const s = copy(prev);
  if (!s.crashed) return s;
  const steps: State["recovery"] = [];
  // 1. Analysis
  const cpIdx = s.wal.map((r) => r.kind).lastIndexOf("checkpoint");
  const start = cpIdx >= 0 ? cpIdx : 0;
  const losers = ([1, 2] as Tx[]).filter((t) => openUpdates(s.wal, t).length > 0);
  const committedTx = ([1, 2] as Tx[]).filter((t) => s.wal.some((r) => r.kind === "commit" && r.tx === t) && !losers.includes(t));
  steps.push({ phase: "Analysis", text: `Scan the log from ${cpIdx >= 0 ? `the checkpoint at LSN ${s.wal[cpIdx].lsn}` : "the beginning"}. Committed: ${committedTx.map((t) => `T${t}`).join(", ") || "none"}. Losers (updates with no later commit/abort record): ${losers.map((t) => `T${t}`).join(", ") || "none"}.` });
  // 2. Redo: repeat history
  let redone = 0;
  for (const r of s.wal.slice(start)) {
    if (r.kind !== "update" && r.kind !== "clr") continue;
    const d = s.disk[r.page!];
    if (d.lsn < r.lsn) {
      steps.push({ phase: "Redo", text: `LSN ${r.lsn}: ${r.page} page LSN ${d.lsn} < ${r.lsn} → apply ${r.page} = ${r.after}${r.kind === "clr" ? " (CLR)" : ""}.` });
      s.disk[r.page!] = { value: r.after!, lsn: r.lsn };
      redone++;
    } else {
      steps.push({ phase: "Redo", text: `LSN ${r.lsn}: ${r.page} already has page LSN ${d.lsn} ≥ ${r.lsn} → skip (idempotent).` });
    }
  }
  if (!redone && !s.wal.slice(start).some((r) => r.kind === "update" || r.kind === "clr")) steps.push({ phase: "Redo", text: "Nothing to redo after the starting point." });
  // 3. Undo losers, newest first, logging CLRs
  const loserRecs = losers.flatMap((t) => openUpdates(s.wal, t)).sort((a, b) => b.lsn - a.lsn);
  for (const r of loserRecs) {
    const clr: Rec = { lsn: nextLsn(s), kind: "clr", tx: r.tx, page: r.page, before: s.disk[r.page!].value, after: r.before };
    s.wal.push(clr);
    s.disk[r.page!] = { value: r.before!, lsn: clr.lsn };
    steps.push({ phase: "Undo", text: `T${r.tx} never committed: undo LSN ${r.lsn} → ${r.page} = ${r.before} (CLR LSN ${clr.lsn}).` });
  }
  for (const t of losers) {
    s.wal.push({ lsn: nextLsn(s), kind: "abort", tx: t });
    s.tx[t] = "aborted";
  }
  if (!losers.length) steps.push({ phase: "Undo", text: "No losers — nothing to undo." });
  s.flushed = s.wal.at(-1)?.lsn ?? 0;
  s.crashed = false;
  s.recovery = steps;
  s.events.push({ text: `Recovery complete: P1 = ${s.disk.P1.value}, P2 = ${s.disk.P2.value}, P3 = ${s.disk.P3.value}. Every committed change is present; no uncommitted change remains.`, tone: "good" });
  return s;
}

export const PRESETS: { label: string; build: () => State; note: string }[] = [
  {
    label: "Crash after COMMIT",
    note: "T1 moves 50 from P1 to P2 and commits. The WAL is durable, but neither page reached disk. After the crash, redo rebuilds both pages from the log.",
    build: () => crash(commit(update(update(initial(), 1, "P1", 50), 1, "P2", 250), 1)),
  },
  {
    label: "Steal, then crash",
    note: "T2 changes P3 and the page is written to disk before T2 commits (steal). The WAL rule forces its log record out first — which is exactly what lets undo remove the change after the crash.",
    build: () => crash(flushPage(update(initial(), 2, "P3", 0), "P3")),
  },
  {
    label: "Checkpoint, then crash",
    note: "T1 commits and a checkpoint flushes everything. T2 then updates P2 and commits; T1 starts another update but crashes mid-way. Redo starts at the checkpoint, and only the later records matter.",
    build: () => crash(update(commit(update(checkpoint(commit(update(initial(), 1, "P1", 110), 1)), 2, "P2", 220), 2), 1, "P3", 330)),
  },
];

export default function WalRecovery() {
  const [s, setS] = useState<State>(initial);
  const [tx, setTx] = useState<Tx>(1);
  const [page, setPage] = useState<Page>("P1");
  const [value, setValue] = useState(150);
  const [note, setNote] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <Btn key={p.label} onClick={() => { setS(p.build()); setNote(p.note); }}>
            {p.label}
          </Btn>
        ))}
        <Btn variant="ghost" onClick={() => { setS(initial()); setNote(null); }}>
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </Btn>
      </div>
      {note && <Explain>{note}</Explain>}

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Transaction">
          <Segmented value={String(tx)} onChange={(v) => setTx(Number(v) as Tx)} options={[{ value: "1", label: "T1" }, { value: "2", label: "T2" }]} />
        </Field>
        <Field label="Page">
          <Select value={page} onChange={setPage} options={PAGES.map((p) => ({ value: p, label: p }))} />
        </Field>
        <Field label="New value">
          <NumberInput value={value} onChange={setValue} />
        </Field>
        <Btn variant="primary" onClick={() => setS((x) => update(x, tx, page, value))} disabled={s.crashed}>
          Update
        </Btn>
        <Btn onClick={() => setS((x) => commit(x, tx))} disabled={s.crashed || s.tx[tx] !== "active"}>
          Commit T{tx}
        </Btn>
        <Btn variant="ghost" onClick={() => setS((x) => abort(x, tx))} disabled={s.crashed || s.tx[tx] !== "active"}>
          Rollback T{tx}
        </Btn>
      </div>
      <div className="flex flex-wrap gap-2">
        {PAGES.map((p) => (
          <Btn key={p} variant="ghost" onClick={() => setS((x) => flushPage(x, p))} disabled={s.crashed || !s.buffer[p]?.dirty}>
            Write {p} to disk
          </Btn>
        ))}
        <Btn variant="ghost" onClick={() => setS(checkpoint)} disabled={s.crashed}>
          Checkpoint
        </Btn>
        <Btn variant="danger" onClick={() => setS(crash)} disabled={s.crashed}>
          <Power className="h-3.5 w-3.5" /> Crash
        </Btn>
        <Btn variant="primary" onClick={() => setS(recover)} disabled={!s.crashed}>
          <Wrench className="h-3.5 w-3.5" /> Restart &amp; recover
        </Btn>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Pages: buffer pool (RAM) vs disk">
          <table className="w-full font-mono text-[12.5px]">
            <thead className="text-left text-[11px] text-subtle">
              <tr>
                <th className="pb-1">page</th>
                <th>buffer pool</th>
                <th>disk</th>
              </tr>
            </thead>
            <tbody>
              {PAGES.map((p) => {
                const b = s.buffer[p];
                return (
                  <tr key={p} className="border-t border-border">
                    <td className="py-1.5 font-semibold">{p}</td>
                    <td className={cn(b?.dirty && "text-warn")}>{s.crashed ? <span className="text-bad">lost</span> : b ? `${b.value} (LSN ${b.lsn})${b.dirty ? " dirty" : ""}` : <span className="text-subtle">not loaded</span>}</td>
                    <td>
                      {s.disk[p].value} <span className="text-subtle">(LSN {s.disk[p].lsn})</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-3 flex gap-4 text-[12px]">
            {([1, 2] as Tx[]).map((t) => (
              <span key={t}>
                T{t}: <span className={cn("font-semibold", s.tx[t] === "committed" && "text-ok", s.tx[t] === "aborted" && "text-bad", s.tx[t] === "in doubt" && "text-warn", s.tx[t] === "active" && "text-accent")}>{s.tx[t]}</span>
              </span>
            ))}
          </div>
        </Panel>
        <Panel title={`Write-ahead log · durable up to LSN ${s.flushed}`}>
          {s.wal.length ? (
            <ol className="max-h-56 space-y-0.5 overflow-y-auto font-mono text-[12px] thin-scroll">
              {s.wal.map((r) => (
                <li key={r.lsn} className={cn("flex gap-2 rounded px-1.5", r.lsn <= s.flushed ? "text-fg" : "text-subtle italic", r.kind === "commit" && "text-ok", r.kind === "abort" && "text-bad", r.kind === "checkpoint" && "text-accent")}>
                  <span className="w-10 shrink-0 text-right text-subtle">{r.lsn}</span>
                  <span>
                    {r.kind === "update" && `T${r.tx} UPDATE ${r.page}: ${r.before} → ${r.after}`}
                    {r.kind === "clr" && `T${r.tx} CLR ${r.page}: → ${r.after} (undo)`}
                    {r.kind === "commit" && `T${r.tx} COMMIT`}
                    {r.kind === "abort" && `T${r.tx} ABORT`}
                    {r.kind === "checkpoint" && "CHECKPOINT"}
                  </span>
                  {r.lsn > s.flushed && <span className="ml-auto text-[10.5px]">in memory</span>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[13px] text-subtle">Empty.</p>
          )}
        </Panel>
      </div>

      {s.recovery.length > 0 && (
        <Panel title="Recovery (ARIES: analysis → redo → undo)">
          <ol className="space-y-1 text-[12.5px]">
            {s.recovery.map((r, i) => (
              <li key={i}>
                <span className={cn("mr-2 inline-block w-16 font-semibold", r.phase === "Analysis" && "text-accent", r.phase === "Redo" && "text-ok", r.phase === "Undo" && "text-warn")}>{r.phase}</span>
                {r.text}
              </li>
            ))}
          </ol>
        </Panel>
      )}

      <Panel title="Events">
        <ol className="max-h-48 space-y-0.5 overflow-y-auto text-[12.5px] thin-scroll">
          {[...s.events].reverse().map((e, i) => (
            <li key={s.events.length - i} className={cn(e.tone === "bad" && "text-bad", e.tone === "good" && "text-ok", e.tone === "warn" && "text-warn", !e.tone && "text-muted")}>
              {e.text}
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
