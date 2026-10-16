"use client";
import { useState } from "react";
import { crashAfter, fsck, judge, recover, steps, type DiskState, type Home, type JMode } from "@/lib/sim/journal";
import { Explain, Panel, Segmented } from "../ui";
import { cn } from "@/lib/utils";

const MODES: { value: JMode; label: string }[] = [
  { value: "none", label: "No journal" },
  { value: "writeback", label: "data=writeback" },
  { value: "ordered", label: "data=ordered" },
  { value: "journal", label: "data=journal" },
];

const MODE_NOTE: Record<JMode, string> = {
  none: "Without a journal the three writes go straight to their home locations, and the disk may complete them in any order. A crash can leave any subset on disk. Pick which writes made it.",
  writeback: "Only metadata goes through the journal, and data writes aren't ordered with it. It's the fastest mode, but data can reach the disk after the commit.",
  ordered: "ext4's default. Only metadata goes through the journal, but the data block is written to its home before the metadata commits, so committed metadata never points at a block that wasn't written.",
  journal: "Data and metadata both go through the journal. It's the strongest mode, but every data block is written twice: once to the journal, once home.",
};

// blocks written for one append: journal entries + home writes
const WRITES: Record<JMode, string> = {
  none: "3 blocks: D, I and B, each once.",
  writeback: "7 blocks: TxB, I′, B′, TxE in the journal, then I, B and D home.",
  ordered: "7 blocks: D home, TxB, I′, B′, TxE in the journal, then I and B home.",
  journal: "8 blocks: TxB, I′, B′, D′, TxE in the journal, then I, B and D home. The data is written twice.",
};

const HOME_LABEL: Record<Home, string> = { D: "D: data block", I: "I: inode", B: "B: bitmap" };

export default function Journaling() {
  const [mode, setMode] = useState<JMode>("ordered");
  const [crash, setCrash] = useState(1);
  const [reached, setReached] = useState<Record<Home, boolean>>({ D: false, I: true, B: false });
  const list = steps(mode);
  const at = Math.min(crash, list.length);

  let state: DiskState;
  let repair: ReturnType<typeof recover>;
  if (mode === "none") {
    state = { home: { ...reached }, journal: { txb: false, I: false, B: false, D: false, txe: false } };
    repair = fsck(state);
  } else {
    state = crashAfter(mode, at);
    repair = recover(state);
  }
  const before = judge(state);
  const after = judge(repair.after);

  return (
    <div className="space-y-4">
      <Segmented
        ariaLabel="Journaling mode"
        value={mode}
        onChange={(m) => {
          setMode(m);
          setCrash(1);
        }}
        options={MODES}
      />
      <Explain>
        <b>The operation:</b> append one block to a file. Three blocks must change together: the data block <b>D</b>, the file&apos;s inode <b>I</b> (new size, pointer to D) and the free-space bitmap{" "}
        <b>B</b> (D now in use). {MODE_NOTE[mode]}
      </Explain>

      {mode === "none" ? (
        <Panel title="Which writes reached the disk before the crash?">
          <div className="flex flex-wrap gap-2">
            {(["D", "I", "B"] as Home[]).map((h) => (
              <label key={h} className={cn("flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px]", reached[h] ? "border-accent bg-accent/10" : "border-border")}>
                <input type="checkbox" checked={reached[h]} onChange={(e) => setReached((r) => ({ ...r, [h]: e.target.checked }))} />
                {HOME_LABEL[h]}
              </label>
            ))}
          </div>
        </Panel>
      ) : (
        <Panel title="The protocol: click a step to crash right after it">
          <ol className="space-y-1">
            <li>
              <button type="button" onClick={() => setCrash(0)} className={cn("w-full rounded-md px-2 py-1 text-left text-[12.5px]", at === 0 ? "bg-bad/15 text-bad" : "text-subtle hover:bg-surface-2")}>
                {at === 0 ? "⚡ crash before anything is written" : "crash before anything is written"}
              </button>
            </li>
            {list.map((st, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => setCrash(i + 1)}
                  className={cn("w-full rounded-md border px-3 py-2 text-left transition-colors", i < at ? "border-ok/40 bg-ok/10" : "border-border text-muted hover:border-border-strong")}
                >
                  <div className="text-[13px] font-medium text-fg">
                    {i + 1}. {st.title}
                    {i < at && <span className="ml-2 text-[11px] font-normal text-ok">done</span>}
                  </div>
                  <div className="text-[12.5px]">{st.detail}</div>
                </button>
                {i + 1 === at && <div className="my-1 rounded-md bg-bad/15 px-2 py-1 text-[12.5px] font-medium text-bad">⚡ power fails here</div>}
              </li>
            ))}
          </ol>
        </Panel>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="On disk at the crash">
          <DiskView s={state} showJournal={mode !== "none"} dataInJournal={mode === "journal"} />
          <div className="mt-3">
            <Explain tone={before.tone}>{before.text}</Explain>
          </div>
        </Panel>
        <Panel title={mode === "none" ? "After fsck" : "After journal recovery"}>
          <DiskView s={repair.after} showJournal={mode !== "none"} dataInJournal={mode === "journal"} />
          <p className="mt-3 text-[12.5px] text-muted">{repair.action}</p>
          <div className="mt-2">
            <Explain tone={after.tone}>{after.text}</Explain>
          </div>
        </Panel>
      </div>

      <p className="text-[12.5px] text-subtle">
        Writes for this append: {WRITES[mode]}{" "}
        {mode === "none"
          ? "fsck must read every inode and bitmap on the disk, which takes hours on a large volume; journal recovery reads only the journal."
          : "Journal writes are sequential, and recovery reads only the journal, so it takes seconds."}{" "}
        A Java program gets the same all-or-nothing effect for a whole file with the atomic-replace pattern: write a temporary file, <code>force(true)</code>, move it with <code>ATOMIC_MOVE</code>, then
        fsync the directory.
      </p>
    </div>
  );
}

function DiskView({ s, showJournal, dataInJournal }: { s: DiskState; showJournal: boolean; dataInJournal: boolean }) {
  const journal: [string, boolean][] = [
    ["TxB", s.journal.txb],
    ["I′", s.journal.I],
    ["B′", s.journal.B],
    ...(dataInJournal ? ([["D′", s.journal.D]] as [string, boolean][]) : []),
    ["TxE", s.journal.txe],
  ];
  return (
    <div className="space-y-3">
      {showJournal && (
        <div>
          <div className="mb-1 text-[11px] font-semibold tracking-wide text-subtle uppercase">Journal</div>
          <div className="flex flex-wrap gap-1">
            {journal.map(([name, on]) => (
              <span
                key={name}
                className={cn(
                  "min-w-10 rounded border px-2 py-1 text-center font-mono text-[12px]",
                  on ? (name === "TxE" ? "border-ok bg-ok/15 text-fg" : "border-accent bg-accent/10 text-fg") : "border-dashed border-border text-subtle",
                )}
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      )}
      <div>
        <div className="mb-1 text-[11px] font-semibold tracking-wide text-subtle uppercase">Home locations</div>
        <div className="grid grid-cols-3 gap-1">
          {(["I", "B", "D"] as Home[]).map((h) => (
            <div key={h} className={cn("rounded-md border px-2 py-1.5 text-center", s.home[h] ? "border-accent bg-accent/10" : "border-border bg-surface-2")}>
              <div className="font-mono text-[13px] font-semibold text-fg">{h}</div>
              <div className="text-[11px] text-muted">{s.home[h] ? "new" : h === "D" ? "stale" : "old"}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
