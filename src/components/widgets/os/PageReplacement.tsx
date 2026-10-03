"use client";
import { useMemo, useState } from "react";
import { Btn, Explain, Field, inputCls, NumberInput, Panel, Segmented, Stat } from "../ui";
import { cn } from "@/lib/utils";

type Algo = "FIFO" | "LRU" | "OPT" | "CLOCK";

interface StepRow {
  ref: number;
  frames: (number | null)[];
  fault: boolean;
  evicted: number | null;
  refBits?: boolean[];
  hand?: number;
}

export function runReplacement(refs: number[], nFrames: number, algo: Algo): StepRow[] {
  const frames: (number | null)[] = Array(nFrames).fill(null);
  const lastUsed: number[] = Array(nFrames).fill(-1);
  const refBit: boolean[] = Array(nFrames).fill(false);
  const fifo: number[] = []; // frame slots in load order
  let hand = 0;
  const rows: StepRow[] = [];
  refs.forEach((r, t) => {
    const idx = frames.indexOf(r);
    let evicted: number | null = null;
    let fault = false;
    if (idx >= 0) {
      lastUsed[idx] = t;
      refBit[idx] = true;
    } else {
      fault = true;
      let slot = frames.indexOf(null);
      if (slot === -1) {
        if (algo === "FIFO") {
          slot = fifo.shift()!;
        } else if (algo === "LRU") {
          slot = lastUsed.indexOf(Math.min(...lastUsed));
        } else if (algo === "OPT") {
          let best = 0;
          let far = -1;
          frames.forEach((p, i) => {
            const nextUse = refs.indexOf(p as number, t + 1);
            const d = nextUse === -1 ? Infinity : nextUse;
            if (d > far) {
              far = d;
              best = i;
            }
          });
          slot = best;
        } else {
          while (refBit[hand]) {
            refBit[hand] = false;
            hand = (hand + 1) % nFrames;
          }
          slot = hand;
          hand = (hand + 1) % nFrames;
        }
        evicted = frames[slot];
      } else if (algo === "CLOCK") {
        hand = (slot + 1) % nFrames;
      }
      frames[slot] = r;
      lastUsed[slot] = t;
      refBit[slot] = true;
      fifo.push(slot);
    }
    rows.push({ ref: r, frames: [...frames], fault, evicted, refBits: algo === "CLOCK" ? [...refBit] : undefined, hand: algo === "CLOCK" ? hand : undefined });
  });
  return rows;
}

const PRESETS = [
  { label: "Textbook (7 0 1 2 …)", refs: "7 0 1 2 0 3 0 4 2 3 0 3 2 1 2 0 1 7 0 1", frames: 3 },
  { label: "Belady's anomaly", refs: "1 2 3 4 1 2 5 1 2 3 4 5", frames: 3 },
  { label: "Loop larger than memory", refs: "1 2 3 4 1 2 3 4 1 2 3 4", frames: 3 },
  { label: "Locality", refs: "1 2 1 3 1 2 1 4 1 2 1 5 1 2", frames: 3 },
];

export default function PageReplacement() {
  const [refText, setRefText] = useState(PRESETS[0].refs);
  const [nFrames, setNFrames] = useState(3);
  const [algo, setAlgo] = useState<Algo>("FIFO");
  const [shown, setShown] = useState<number>(Infinity);

  const refs = useMemo(
    () =>
      refText
        .split(/[\s,]+/)
        .map((x) => parseInt(x, 10))
        .filter((x) => Number.isFinite(x))
        .slice(0, 40),
    [refText],
  );
  const rows = useMemo(() => runReplacement(refs, Math.max(1, Math.min(8, nFrames)), algo), [refs, nFrames, algo]);
  const visible = Math.min(shown, rows.length);
  const faults = rows.slice(0, visible).filter((r) => r.fault).length;
  const compare = useMemo(
    () => (["FIFO", "LRU", "OPT", "CLOCK"] as Algo[]).map((a) => ({ a, faults: runReplacement(refs, nFrames, a).filter((r) => r.fault).length })),
    [refs, nFrames],
  );
  const beladyCheck = useMemo(() => {
    const f = (k: number) => runReplacement(refs, k, "FIFO").filter((r) => r.fault).length;
    return [3, 4].map((k) => ({ k, faults: f(k) }));
  }, [refs]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Reference string">
          <input className={cn(inputCls, "w-full min-w-[260px] sm:w-96")} value={refText} onChange={(e) => { setRefText(e.target.value); setShown(Infinity); }} />
        </Field>
        <Field label="Frames">
          <NumberInput value={nFrames} min={1} max={8} onChange={(v) => { setNFrames(Math.max(1, Math.min(8, v))); setShown(Infinity); }} />
        </Field>
        <Segmented ariaLabel="Algorithm" value={algo} onChange={(v) => setAlgo(v)} options={(["FIFO", "LRU", "OPT", "CLOCK"] as Algo[]).map((a) => ({ value: a, label: a }))} />
      </div>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <Btn key={p.label} onClick={() => { setRefText(p.refs); setNFrames(p.frames); setShown(Infinity); }}>
            {p.label}
          </Btn>
        ))}
        <span className="flex-1" />
        <Btn onClick={() => setShown(0)}>Start stepping</Btn>
        <Btn onClick={() => setShown((s) => Math.min((Number.isFinite(s) ? s : rows.length) + 1, rows.length))} disabled={visible >= rows.length}>
          Next reference
        </Btn>
        <Btn variant="ghost" onClick={() => setShown(Infinity)}>Show all</Btn>
      </div>

      <Panel title={`${algo} with ${nFrames} frames`}>
        <div className="overflow-x-auto thin-scroll">
          <table className="border-separate border-spacing-0.5 font-mono text-[12.5px]">
            <tbody>
              <tr>
                <th className="pr-2 text-left text-[11px] font-medium text-subtle">ref</th>
                {refs.map((r, i) => (
                  <th key={i} className={cn("min-w-8 rounded px-1.5 py-1 text-center", i < visible ? "text-fg" : "text-subtle/50", i === visible - 1 && "bg-accent/15")}>
                    {r}
                  </th>
                ))}
              </tr>
              {Array.from({ length: nFrames }, (_, f) => (
                <tr key={f}>
                  <td className="pr-2 text-[11px] text-subtle">F{f}</td>
                  {rows.map((row, i) => {
                    const v = i < visible ? row.frames[f] : undefined;
                    const isNew = i < visible && row.fault && row.frames[f] === row.ref && (i === 0 || rows[i - 1].frames[f] !== row.ref);
                    return (
                      <td
                        key={i}
                        className={cn(
                          "h-7 min-w-8 rounded text-center",
                          v === undefined ? "bg-transparent" : "bg-surface-2",
                          isNew && "bg-bad/15 font-semibold text-bad",
                          algo === "CLOCK" && i < visible && row.hand === f && "outline outline-1 outline-accent",
                        )}
                        title={algo === "CLOCK" && row.refBits ? `ref bit ${row.refBits[f] ? 1 : 0}` : undefined}
                      >
                        {v === undefined ? "" : v === null ? "·" : v}
                        {algo === "CLOCK" && i < visible && v !== null && v !== undefined && <sup className="ml-0.5 text-[9px] text-subtle">{row.refBits?.[f] ? 1 : 0}</sup>}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <td className="pr-2 text-[11px] text-subtle">fault</td>
                {rows.map((row, i) => (
                  <td key={i} className={cn("text-center text-[11px]", i < visible && row.fault ? "font-bold text-bad" : "text-transparent")}>
                    {i < visible && row.fault ? "F" : "."}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        {visible > 0 && visible <= rows.length && rows[visible - 1] && (
          <p className="mt-2 text-[12.5px] text-muted">
            Reference {rows[visible - 1].ref}:{" "}
            {rows[visible - 1].fault
              ? rows[visible - 1].evicted !== null && rows[visible - 1].evicted !== undefined
                ? `page fault — evicted ${rows[visible - 1].evicted}.`
                : "page fault — loaded into a free frame."
              : "hit."}
            {algo === "CLOCK" && " Superscripts are reference bits; the outlined cell is the clock hand."}
          </p>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Page faults" value={faults} />
          <Stat label="Hits" value={visible - faults} />
          <Stat label="Fault rate" value={visible ? `${Math.round((faults / visible) * 100)}%` : "—"} />
          <Stat label="References" value={`${visible}/${rows.length}`} />
        </div>
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="All algorithms, same input">
          <table className="w-full text-[13px]">
            <tbody>
              {compare.map((c) => (
                <tr key={c.a} className="border-t border-border first:border-0">
                  <td className="py-1.5">{c.a}</td>
                  <td className="text-right font-mono">{c.faults} faults</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Belady check (FIFO)">
          <p className="text-[13px] text-muted">
            3 frames: <span className="font-mono text-fg">{beladyCheck[0].faults}</span> faults · 4 frames:{" "}
            <span className="font-mono text-fg">{beladyCheck[1].faults}</span> faults
          </p>
          {beladyCheck[1].faults > beladyCheck[0].faults ? (
            <div className="mt-2">
              <Explain tone="warn">Belady&apos;s anomaly: FIFO does worse with more memory on this string. LRU and OPT (stack algorithms) never do.</Explain>
            </div>
          ) : (
            <p className="mt-2 text-[12.5px] text-subtle">No anomaly on this string. Try the &quot;Belady&apos;s anomaly&quot; preset.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
