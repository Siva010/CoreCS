"use client";
import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { MIN_DISKS, dataDisks, hex, layout, recoverStripe, smallWrite, survives, writePenalty, type Cell, type RaidLevel } from "@/lib/sim/raid";
import { Btn, Explain, Field, NumberInput, Panel, Segmented, Stat, inputCls } from "../ui";
import { cn } from "@/lib/utils";

const LEVELS: { value: RaidLevel; label: string }[] = [
  { value: "0", label: "RAID 0" },
  { value: "1", label: "RAID 1" },
  { value: "5", label: "RAID 5" },
  { value: "6", label: "RAID 6" },
  { value: "10", label: "RAID 10" },
];

const NOTE: Record<RaidLevel, string> = {
  "0": "Striping only: consecutive blocks go to different disks, so they can be read and written in parallel. No redundancy, so losing any disk loses data.",
  "1": "Mirroring: every disk holds a full copy. Reads can come from any copy; every write goes to all of them.",
  "5": "Striping with one parity block per stripe, P = XOR of the stripe's data. Parity moves one disk to the left on each stripe, so no single disk takes every parity write.",
  "6": "Two check blocks per stripe: P (XOR) and Q, a Reed–Solomon sum over GF(2⁸) as in Linux md. Two independent equations let it rebuild any two lost blocks.",
  "10": "Mirrored pairs, striped: disks 0+1 hold one copy each of the same blocks, and so do 2+3. It survives one failure per pair.",
};

const BLOCK_NAME = (c: Cell) => (c.kind === "p" ? `P${c.block}` : c.kind === "q" ? `Q${c.block}` : `D${c.block}`);

export default function Raid() {
  const [level, setLevel] = useState<RaidLevel>("5");
  const [disks, setDisks] = useState(5);
  const [sizeTB, setSizeTB] = useState(4);
  const [iops, setIops] = useState(150);
  const [failed, setFailed] = useState<Set<number>>(new Set());
  const [values, setValues] = useState<Record<number, number>>({});
  const [selected, setSelected] = useState<number | null>(1);
  const [newText, setNewText] = useState("FF");

  const n = Math.max(MIN_DISKS[level], level === "10" ? disks - (disks % 2) : disks);
  const stripes = level === "1" ? 4 : Math.max(4, Math.min(n, 8));
  const lay = useMemo(() => layout(level, n, stripes, values), [level, n, stripes, values]);
  const ok = survives(level, n, failed);
  const failedList = [...failed].filter((d) => d < n);

  const changeLevel = (v: RaidLevel) => {
    setLevel(v);
    setDisks((d) => {
      const m = Math.max(MIN_DISKS[v], d);
      return v === "10" ? m + (m % 2) : m;
    });
    setFailed(new Set());
    setValues({});
  };
  const toggleDisk = (d: number) =>
    setFailed((f) => {
      const g = new Set(f);
      if (g.has(d)) g.delete(d);
      else g.add(d);
      return g;
    });

  const newValue = parseInt(newText, 16);
  const validNew = /^[0-9a-f]{1,2}$/i.test(newText.trim()) && Number.isInteger(newValue);
  const steps = selected !== null && validNew ? smallWrite(lay, selected, newValue) : [];
  const blockExists = lay.rows.some((r) => r.some((c) => c.kind === "data" && c.block === selected));

  const usable = dataDisks(level, n) * sizeTB;
  const penalty = writePenalty(level, n);
  const tolerates = level === "0" ? "0" : level === "1" ? `${n - 1}` : level === "5" ? "1" : level === "6" ? "2" : `1 per pair (up to ${n / 2})`;
  // a one-disk rebuild: parity levels read every surviving disk, mirrors read one partner
  const rebuildReadTB = level === "0" ? 0 : level === "1" || level === "10" ? sizeTB : (n - 1) * sizeTB;
  const expectedUre = (rebuildReadTB * 1e12 * 8) / 1e14;
  const pUre = 1 - Math.exp(-expectedUre);
  const rebuildHours = (sizeTB * 1e12) / 150e6 / 3600;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Segmented ariaLabel="RAID level" value={level} onChange={changeLevel} options={LEVELS} />
        <Field label="Disks">
          <NumberInput
            value={n}
            min={MIN_DISKS[level]}
            max={8}
            step={level === "10" ? 2 : 1}
            onChange={(v) => {
              setDisks(Math.max(MIN_DISKS[level], Math.min(8, Math.round(v))));
              setFailed(new Set());
              setValues({});
            }}
          />
        </Field>
        <Field label="Disk size (TB)">
          <NumberInput value={sizeTB} min={1} max={30} onChange={(v) => setSizeTB(Math.max(1, Math.min(30, v)))} />
        </Field>
        <Field label="IOPS per disk">
          <NumberInput value={iops} min={50} max={1000000} step={50} className="w-24" onChange={(v) => setIops(Math.max(1, v))} />
        </Field>
      </div>
      <Explain>{NOTE[level]}</Explain>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Usable capacity" value={`${usable} TB`} sub={`${Math.round((100 * dataDisks(level, n)) / n)}% of ${n * sizeTB} TB raw`} />
        <Stat label="Failures survived" value={tolerates} />
        <Stat label="I/Os per small write" value={penalty} sub={level === "5" || level === "6" ? "read-modify-write" : undefined} />
        <Stat label="Random-write IOPS" value={Math.round((n * iops) / penalty).toLocaleString()} sub={`${n} × ${iops.toLocaleString()} ÷ ${penalty}`} />
      </div>

      <Panel
        title={`Stripe map: ${n} disks`}
        right={
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-subtle">click a disk to fail it · click a data block to write it</span>
            <Btn
              variant="ghost"
              onClick={() => {
                setFailed(new Set());
                setValues({});
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </Btn>
          </div>
        }
      >
        <div className="overflow-x-auto thin-scroll">
          <div className="grid min-w-[420px] gap-1" style={{ gridTemplateColumns: `3.5rem repeat(${n}, minmax(0, 1fr))` }}>
            <div />
            {Array.from({ length: n }, (_, d) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleDisk(d)}
                className={cn(
                  "rounded-md border px-1 py-1 text-[12px] font-medium",
                  failed.has(d) ? "border-bad bg-bad/15 text-bad" : "border-border bg-surface-2 text-fg hover:border-border-strong",
                )}
                title={failed.has(d) ? "Replace this disk" : "Fail this disk"}
              >
                Disk {d}
                {level === "10" && <span className="block text-[10px] text-subtle">pair {Math.floor(d / 2)}</span>}
                {failed.has(d) && <span className="block text-[10px]">failed</span>}
              </button>
            ))}
            {lay.rows.map((row, s) => (
              <Row key={s} s={s} row={row} failed={failed} ok={ok} lay={lay} selected={selected} onSelect={setSelected} level={level} />
            ))}
          </div>
        </div>
        <p className="mt-2 text-[12px] text-subtle">One byte stands in for each block; a real controller does the same XOR for every byte of a 64 KB or larger chunk.</p>
      </Panel>

      {failedList.length > 0 && (
        <Panel title={ok ? `Degraded: rebuilding disk${failedList.length > 1 ? "s" : ""} ${failedList.join(" and ")}` : "Data lost"}>
          {!ok ? (
            <Explain tone="bad">
              {level === "0"
                ? "RAID 0 has no redundancy: every stripe had a block on the failed disk, so the whole volume is gone."
                : level === "10"
                  ? "Both disks of one mirror pair failed. Every block that pair held exists nowhere else."
                  : `RAID ${level} can rebuild at most ${level === "5" ? "one" : level === "6" ? "two" : n - 1} lost block${level === "5" ? "" : "s"} per stripe.`}
            </Explain>
          ) : (
            <ol className="space-y-1 font-mono text-[12.5px]">
              {lay.rows.flatMap((_, s) =>
                recoverStripe(lay, s, new Set(failedList)).map((r) => (
                  <li key={`${s}-${r.disk}`} className="rounded-md bg-surface-2 px-2 py-1">
                    <span className="text-subtle">stripe {s}, disk {r.disk}: </span>
                    {r.how}
                  </li>
                )),
              )}
            </ol>
          )}
        </Panel>
      )}

      {level !== "0" && (
        <Panel title="Rebuild risk for one failed disk">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Stat label="Data read to rebuild" value={`${rebuildReadTB} TB`} sub={level === "1" || level === "10" ? "the mirror partner only" : "every surviving disk"} />
            <Stat label="Rebuild time, at best" value={`${rebuildHours.toFixed(1)} h`} sub="writing the new disk at 150 MB/s, no other load" />
            <Stat
              label="Chance of an unreadable sector"
              value={`${Math.round(100 * pUre)}%`}
              sub={level === "6" ? "still repairable: Q covers it" : "at the spec rate of 1 per 10¹⁴ bits"}
            />
          </div>
          <p className="mt-2 text-[12.5px] text-muted">
            {level === "5"
              ? "In RAID 5 an unreadable sector during the rebuild leaves that stripe unrecoverable, since there is no redundancy left. Real drives usually beat the spec rate, but this is why large arrays use RAID 6 or RAID 10."
              : level === "6"
                ? "RAID 6 still has one redundant block per stripe while one disk is rebuilding, so a bad sector found during the rebuild can be repaired."
                : "A mirror rebuild reads only the partner disk, so far less data is at risk than in a parity rebuild."}
          </p>
        </Panel>
      )}

      <Panel title={selected !== null && blockExists ? `Small write: change D${selected}` : "Small write"}>
        {selected === null || !blockExists ? (
          <p className="text-[13px] text-muted">Click a data block in the stripe map.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <Field label="New value (hex byte)">
                <input className={cn(inputCls, "w-20")} value={newText} onChange={(e) => setNewText(e.target.value)} spellCheck={false} aria-label="New value" />
              </Field>
              <Btn
                variant="primary"
                disabled={!validNew || failedList.length > 0}
                title={failedList.length > 0 ? "Replace the failed disks first" : undefined}
                onClick={() => setValues((v) => ({ ...v, [selected]: newValue }))}
              >
                Apply the write
              </Btn>
            </div>
            <ol className="space-y-1 text-[12.5px]">
              {steps.map((st, i) => (
                <li key={i} className={cn("rounded-md px-2 py-1 font-mono", st.op === "read" ? "bg-accent/10" : st.op === "write" ? "bg-warn/10" : "bg-surface-2")}>
                  <span className="mr-2 font-sans text-[11px] font-semibold tracking-wide text-subtle uppercase">
                    {st.op}
                    {st.disk !== undefined && ` · disk ${st.disk}`}
                  </span>
                  {st.text}
                </li>
              ))}
            </ol>
            <p className="text-[12.5px] text-muted">
              {steps.filter((x) => x.op !== "compute").length} disk I/Os for one logical write.
              {level === "5" || level === "6"
                ? " Only the changed block and the check blocks are touched: the XOR of old and new data is enough to update parity, so the rest of the stripe is never read. A write that fills a whole stripe skips the reads."
                : level === "0"
                  ? " One write, no redundancy to maintain."
                  : " Every copy must be written; no reads are needed."}
            </p>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Row({
  s,
  row,
  failed,
  ok,
  lay,
  selected,
  onSelect,
  level,
}: {
  s: number;
  row: Cell[];
  failed: Set<number>;
  ok: boolean;
  lay: ReturnType<typeof layout>;
  selected: number | null;
  onSelect: (b: number) => void;
  level: RaidLevel;
}) {
  const rec = useMemo(() => (failed.size && ok ? recoverStripe(lay, s, failed) : []), [lay, s, failed, ok]);
  const touched = selected !== null && row.some((c) => c.kind === "data" && c.block === selected);
  return (
    <>
      <div className="flex items-center text-[11px] text-subtle">stripe {s}</div>
      {row.map((c, d) => {
        const down = failed.has(d);
        const rebuilt = rec.find((r) => r.disk === d);
        const isSel = c.kind === "data" && c.block === selected;
        const check = c.kind === "p" || c.kind === "q";
        return (
          <button
            key={d}
            type="button"
            disabled={c.kind !== "data" && c.kind !== "mirror"}
            onClick={() => (c.kind === "data" || c.kind === "mirror") && onSelect(c.block)}
            className={cn(
              "rounded-md border px-1 py-1.5 text-center font-mono text-[12px] transition-colors",
              down ? "border-bad/50 bg-bad/10" : check ? "border-warn/60 bg-warn/10" : c.kind === "mirror" ? "border-border bg-surface-2" : "border-border-strong bg-surface",
              isSel && "ring-2 ring-accent",
              touched && check && !down && "ring-2 ring-warn",
              (c.kind === "data" || c.kind === "mirror") && "hover:border-accent",
            )}
            title={c.kind === "mirror" ? `copy of D${c.block}` : BLOCK_NAME(c)}
          >
            <div className={cn("font-semibold", c.kind === "mirror" ? "text-muted" : check ? "text-warn" : "text-fg")}>
              {BLOCK_NAME(c)}
              {c.kind === "mirror" && "′"}
            </div>
            <div className="text-[11px]">
              {down ? (
                rebuilt && rebuilt.value !== null ? (
                  <span className="text-ok">→ {hex(rebuilt.value)}</span>
                ) : (
                  <span className="text-bad">lost</span>
                )
              ) : (
                <span className="text-muted">{hex(c.value)}</span>
              )}
            </div>
            {level === "6" && c.kind === "q" && !down && <div className="text-[9.5px] text-subtle">GF(2⁸)</div>}
          </button>
        );
      })}
    </>
  );
}
