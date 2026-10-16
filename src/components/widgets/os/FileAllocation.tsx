"use client";
import { useMemo, useState } from "react";
import {
  DISK_BLOCKS,
  FREE,
  USED,
  allocate,
  fmtBytes,
  indexBlocks,
  levels,
  locate,
  maxFileSize,
  parseBytes,
  perBlock,
  readBlock,
  type Geometry,
  type LevelName,
  type Method,
} from "@/lib/sim/fileAlloc";
import { Btn, Explain, Field, NumberInput, Panel, Segmented, Select, Stat, inputCls } from "../ui";
import { cn } from "@/lib/utils";

const PRESETS: { label: string; g: Geometry; note: string }[] = [
  {
    label: "ext2/ext3, 4 KB blocks",
    g: { blockSize: 4096, ptrSize: 4, direct: 12, single: 1, double: 1, triple: 1 },
    note: "The classic Unix inode: 12 direct pointers, then one single, one double and one triple indirect pointer. A 4 KB block holds 1,024 four-byte addresses.",
  },
  {
    label: "ext2/ext3, 1 KB blocks",
    g: { blockSize: 1024, ptrSize: 4, direct: 12, single: 1, double: 1, triple: 1 },
    note: "Same inode with 1 KB blocks: only 256 addresses per index block, so the triple indirect pointer reaches 256³ blocks and the largest file is about 16 GB.",
  },
  {
    label: "Exam style: 10 direct, 8-byte addresses",
    g: { blockSize: 1024, ptrSize: 8, direct: 10, single: 1, double: 1, triple: 0 },
    note: "A typical exam variant. Work out the largest file by hand first: (10 + 128 + 128²) × 1 KB.",
  },
];

const LEVEL_LABEL: Record<LevelName, string> = { direct: "Direct", single: "Single indirect", double: "Double indirect", triple: "Triple indirect" };

function InodeTab() {
  const [g, setG] = useState<Geometry>(PRESETS[0].g);
  const [note, setNote] = useState<string | null>(PRESETS[0].note);
  const [offsetText, setOffsetText] = useState("50000");
  const [sizeText, setSizeText] = useState("1 GB");
  const [inodeCached, setInodeCached] = useState(true);
  const set = (patch: Partial<Geometry>) => {
    setG((x) => ({ ...x, ...patch }));
    setNote(null);
  };

  const p = perBlock(g);
  const lv = levels(g);
  const offset = parseBytes(offsetText);
  const loc = Number.isFinite(offset) ? locate(g, offset) : null;
  const size = parseBytes(sizeText);
  const idx = Number.isFinite(size) ? indexBlocks(g, size) : null;
  const extra = inodeCached ? 0 : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((pr) => (
          <Btn
            key={pr.label}
            onClick={() => {
              setG(pr.g);
              setNote(pr.note);
            }}
          >
            {pr.label}
          </Btn>
        ))}
      </div>
      {note && <Explain>{note}</Explain>}

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Block size">
          <Select
            value={String(g.blockSize)}
            onChange={(v) => set({ blockSize: Number(v) })}
            options={[512, 1024, 2048, 4096, 8192, 16384].map((b) => ({ value: String(b), label: fmtBytes(b) }))}
          />
        </Field>
        <Field label="Block address">
          <Segmented size="sm" value={String(g.ptrSize)} onChange={(v) => set({ ptrSize: Number(v) })} options={[{ value: "4", label: "4 bytes" }, { value: "8", label: "8 bytes" }]} />
        </Field>
        <Field label="Direct">
          <NumberInput value={g.direct} min={0} max={16} onChange={(v) => set({ direct: Math.max(0, Math.min(16, Math.round(v))) })} />
        </Field>
        <Field label="Single">
          <NumberInput value={g.single} min={0} max={2} onChange={(v) => set({ single: Math.max(0, Math.min(2, Math.round(v))) })} />
        </Field>
        <Field label="Double">
          <NumberInput value={g.double} min={0} max={2} onChange={(v) => set({ double: Math.max(0, Math.min(2, Math.round(v))) })} />
        </Field>
        <Field label="Triple">
          <NumberInput value={g.triple} min={0} max={1} onChange={(v) => set({ triple: Math.max(0, Math.min(1, Math.round(v))) })} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Addresses per block" value={p.toLocaleString()} sub={`${fmtBytes(g.blockSize)} ÷ ${g.ptrSize} bytes`} />
        <Stat label="Largest file" value={fmtBytes(maxFileSize(g))} sub={`${maxFileSize(g).toLocaleString()} bytes`} />
        <Stat label="Data blocks reachable" value={lv.reduce((n, l) => n + l.blocks, 0).toLocaleString()} />
      </div>

      <Panel title="What each pointer reaches">
        <div className="overflow-x-auto thin-scroll">
          <table className="w-full min-w-[480px] text-[13px]">
            <thead>
              <tr className="text-left text-[11px] tracking-wide text-subtle uppercase">
                <th className="py-1 pr-3 font-medium">Pointers</th>
                <th className="py-1 pr-3 font-medium">Data blocks</th>
                <th className="py-1 pr-3 font-medium">Bytes</th>
                <th className="py-1 pr-3 font-medium">File blocks covered</th>
                <th className="py-1 font-medium">Disk reads to a byte</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {lv
                .filter((l) => l.pointers > 0)
                .map((l) => {
                  const each = l.name === "direct" ? "1" : l.name === "single" ? `${p}` : l.name === "double" ? `${p}²` : `${p}³`;
                  return (
                    <tr key={l.name} className={cn("border-t border-border", loc?.level === l.name && "bg-accent/10")}>
                      <td className="py-1 pr-3 font-sans">
                        {l.pointers} × {LEVEL_LABEL[l.name].toLowerCase()}
                      </td>
                      <td className="py-1 pr-3">
                        {l.pointers > 1 || l.name !== "single" ? `${l.pointers > 1 ? `${l.pointers} × ` : ""}${each} = ` : ""}
                        {l.blocks.toLocaleString()}
                      </td>
                      <td className="py-1 pr-3">{fmtBytes(l.blocks * g.blockSize)}</td>
                      <td className="py-1 pr-3">
                        {l.firstBlock.toLocaleString()} – {(l.firstBlock + l.blocks - 1).toLocaleString()}
                      </td>
                      <td className="py-1">{l.reads + extra}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        <label className="mt-2 flex items-center gap-2 text-[12.5px] text-muted">
          <input type="checkbox" checked={inodeCached} onChange={(e) => setInodeCached(e.target.checked)} />
          The inode is already in memory (the usual exam assumption once the file is open)
        </label>
      </Panel>

      <Panel title="Find a byte">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Byte offset in the file" hint="e.g. 50000, 5M, 1.5G">
            <input className={cn(inputCls, "w-40")} value={offsetText} onChange={(e) => setOffsetText(e.target.value)} spellCheck={false} aria-label="Byte offset" />
          </Field>
        </div>
        <div className="mt-3">
          {!Number.isFinite(offset) ? (
            <Explain tone="warn">Type a number of bytes, optionally with K, M, G or T.</Explain>
          ) : !loc ? (
            <Explain tone="bad">Byte {offset.toLocaleString()} is past the largest possible file ({fmtBytes(maxFileSize(g))}) for this inode.</Explain>
          ) : (
            <div className="space-y-3">
              <p className="text-[13px] text-muted">
                Logical block = ⌊{offset.toLocaleString()} ÷ {g.blockSize.toLocaleString()}⌋ = <b className="font-mono text-fg">{loc.lbn.toLocaleString()}</b>, byte{" "}
                <span className="font-mono text-fg">{loc.within.toLocaleString()}</span> inside it.
              </p>
              <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
                <Hop title="inode" sub={loc.level === "direct" ? `direct[${loc.pointer}]` : `${loc.level} indirect${pointerSuffix(g, loc.level, loc.pointer)}`} read={!inodeCached} />
                {loc.path.map((e, i) => (
                  <span key={i} className="contents">
                    <Arrow />
                    <Hop title={`index block, level ${i + 1}`} sub={`entry ${e.toLocaleString()}`} read />
                  </span>
                ))}
                <Arrow />
                <Hop title="data block" sub={`byte ${loc.within.toLocaleString()}`} read accent />
              </div>
              <Explain tone="good">
                <b>{loc.reads + extra} disk read{loc.reads + extra === 1 ? "" : "s"}</b>
                {loc.path.length > 0 ? `: ${loc.path.length} index block${loc.path.length === 1 ? "" : "s"}, then the data block` : ": the inode points straight at the data block"}
                {!inodeCached && ", plus the inode itself"}.{" "}
                {loc.level !== "direct" && entryMath(g, loc, lv)}
              </Explain>
            </div>
          )}
        </div>
      </Panel>

      <Panel title="How many index blocks does a file need?">
        <Field label="File size" hint="e.g. 100K, 4M, 1G">
          <input className={cn(inputCls, "w-40")} value={sizeText} onChange={(e) => setSizeText(e.target.value)} spellCheck={false} aria-label="File size" />
        </Field>
        {idx && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Data blocks" value={idx.dataBlocks.toLocaleString()} />
            <Stat label="Index blocks" value={idx.fits ? idx.indexBlocks.toLocaleString() : "—"} sub={idx.fits ? "single + double + triple levels" : "file is too large"} />
            <Stat label="Metadata overhead" value={idx.fits && idx.dataBlocks ? `${((100 * idx.indexBlocks) / idx.dataBlocks).toFixed(2)}%` : "—"} sub="index blocks ÷ data blocks" />
          </div>
        )}
      </Panel>
      <p className="text-[12.5px] text-subtle">
        Real filesystems add other limits: ext3 caps a file at 2 TB with 4 KB blocks, because it counts a file&apos;s 512-byte sectors in a 32-bit field. ext4 and XFS replace most of these pointers
        with extents, one (start, length) entry per contiguous run.
      </p>
    </div>
  );
}

/** "It is block r of that pointer's region: entry ⌊r ÷ 1024⌋ …" */
function entryMath(g: Geometry, loc: NonNullable<ReturnType<typeof locate>>, lv: ReturnType<typeof levels>) {
  const p = perBlock(g);
  const l = lv.find((x) => x.name === loc.level)!;
  const r = loc.lbn - l.firstBlock - loc.pointer * (l.blocks / l.pointers);
  const R = r.toLocaleString();
  if (loc.level === "single") return `It is block ${R} of the single indirect region, so it uses entry ${R} of the index block.`;
  if (loc.level === "double") return `It is block ${R} of the double indirect region: entry ⌊${R} ÷ ${p}⌋ = ${loc.path[0].toLocaleString()} of the top block, then entry ${R} mod ${p} = ${loc.path[1].toLocaleString()}.`;
  return `It is block ${R} of the triple indirect region: entries ⌊${R} ÷ ${p}²⌋ = ${loc.path[0].toLocaleString()}, then ⌊${R} ÷ ${p}⌋ mod ${p} = ${loc.path[1].toLocaleString()}, then ${R} mod ${p} = ${loc.path[2].toLocaleString()}.`;
}

function pointerSuffix(g: Geometry, level: LevelName, pointer: number) {
  const count = level === "single" ? g.single : level === "double" ? g.double : g.triple;
  return count > 1 ? ` #${pointer + 1}` : "";
}

function Hop({ title, sub, read, accent }: { title: string; sub: string; read?: boolean; accent?: boolean }) {
  return (
    <div className={cn("rounded-lg border px-2 py-1", accent ? "border-accent bg-accent/10" : "border-border bg-surface-2")}>
      <div className="font-medium text-fg">{title}</div>
      <div className="font-mono text-[11.5px] text-muted">{sub}</div>
      <div className={cn("text-[10.5px] tracking-wide uppercase", read ? "text-warn" : "text-subtle")}>{read ? "disk read" : "in memory"}</div>
    </div>
  );
}

const Arrow = () => <span className="text-subtle">→</span>;

// ── Allocation methods ─────────────────────────────────────────────────────

const METHODS: { value: Method; label: string }[] = [
  { value: "contiguous", label: "Contiguous" },
  { value: "linked", label: "Linked" },
  { value: "fat", label: "FAT" },
  { value: "indexed", label: "Indexed" },
];

const METHOD_NOTE: Record<Method, string> = {
  contiguous: "The directory stores (start, length). Block k is at start + k, so any block is one read away. But the file needs one run of free blocks, which a fragmented disk may not have.",
  linked: "The directory stores the first block, and each block ends with the address of the next. Any free block will do, but reaching block k means reading every block before it.",
  fat: "Linked allocation with the links moved into one table: FAT[b] is the block after b. The table is small enough to keep in memory, so following the chain costs no disk reads.",
  indexed: "One index block lists all the file's block addresses. Any free blocks will do, and block k is two reads away: the index block, then the data. The Unix inode is this idea made multi-level.",
};

function AllocationTab() {
  const [method, setMethod] = useState<Method>("contiguous");
  const [n, setN] = useState(4);
  const [k, setK] = useState(3);
  // textbook defaults: the FAT is small enough to cache; an index block is read from disk
  const [fatCached, setFatCached] = useState(true);
  const [indexCached, setIndexCached] = useState(false);
  const cachedFor = (m: Method) => (m === "fat" ? fatCached : m === "indexed" ? indexCached : false);
  const alloc = useMemo(() => allocate(method, n), [method, n]);
  const kk = Math.min(k, n - 1);
  const cost = readBlock(method, alloc, kk, cachedFor(method));
  const fileIndex = new Map(alloc.blocks.map((b, i) => [b, i]));
  const reads = new Set(cost.diskReads);
  const all = METHODS.map((m) => {
    const a = allocate(m.value, n);
    return { ...m, a, c: readBlock(m.value, a, kk, cachedFor(m.value)) };
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Segmented ariaLabel="Allocation method" value={method} onChange={setMethod} options={METHODS} />
        <Field label="File size (blocks)">
          <NumberInput value={n} min={1} max={12} onChange={(v) => setN(Math.max(1, Math.min(12, Math.round(v))))} />
        </Field>
        <Field label="Read block k of the file">
          <NumberInput value={kk} min={0} max={n - 1} onChange={(v) => setK(Math.max(0, Math.min(n - 1, Math.round(v))))} />
        </Field>
      </div>
      <Explain>{METHOD_NOTE[method]}</Explain>

      <Panel title={`Disk: ${DISK_BLOCKS} blocks, ${FREE.length} free`} right={<span className="text-[11px] text-subtle">dashed = free · letters = other files</span>}>
        <div className="grid grid-cols-8 gap-1">
          {Array.from({ length: DISK_BLOCKS }, (_, b) => {
            const used = USED[b];
            const fi = fileIndex.get(b);
            const isIndex = alloc.index === b;
            const read = reads.has(b);
            const next = method === "linked" && fi !== undefined ? alloc.blocks[fi + 1] : undefined;
            return (
              <div
                key={b}
                className={cn(
                  "relative flex h-14 flex-col items-center justify-center rounded-md border text-center font-mono text-[11px]",
                  used ? "border-border bg-surface-2 text-subtle" : fi !== undefined || isIndex ? "border-accent bg-accent/10 text-fg" : "border-dashed border-border text-subtle",
                  read && "ring-2 ring-warn",
                )}
                title={`block ${b}`}
              >
                <span className="absolute top-0.5 left-1 text-[9px] text-subtle">{b}</span>
                {used ? (
                  <span className="font-sans text-[11px]">{used === "meta" ? (method === "fat" && b === 0 ? "FAT" : "meta") : used}</span>
                ) : isIndex ? (
                  <span className="font-sans font-semibold">index</span>
                ) : fi !== undefined ? (
                  <>
                    <span className="font-semibold">#{fi}</span>
                    {method === "linked" && <span className="text-[9.5px] text-muted">next: {next ?? "end"}</span>}
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
        {!alloc.ok && (
          <div className="mt-3">
            <Explain tone="bad">{alloc.reason}</Explain>
          </div>
        )}
        {alloc.ok && method === "fat" && (
          <p className="mt-3 font-mono text-[12px] text-muted">
            {alloc.blocks.map((b, i) => `FAT[${b}] = ${alloc.blocks[i + 1] ?? "EOF"}`).join(" · ")}
          </p>
        )}
        {alloc.ok && method === "indexed" && (
          <p className="mt-3 font-mono text-[12px] text-muted">
            index block {alloc.index}: [{alloc.blocks.join(", ")}]
          </p>
        )}
        {alloc.ok && method === "contiguous" && (
          <p className="mt-3 font-mono text-[12px] text-muted">
            directory entry: start {alloc.blocks[0]}, length {n} → block {kk} is at {alloc.blocks[0]} + {kk} = {alloc.blocks[0] + kk}
          </p>
        )}
      </Panel>

      {(method === "fat" || method === "indexed") && (
        <label className="flex items-center gap-2 text-[12.5px] text-muted">
          <input
            type="checkbox"
            checked={method === "fat" ? fatCached : indexCached}
            onChange={(e) => (method === "fat" ? setFatCached : setIndexCached)(e.target.checked)}
          />
          {method === "fat" ? "The FAT is cached in memory" : "The index block is cached in memory"}
        </label>
      )}

      <Panel title={`Reading block ${kk} of a ${n}-block file`}>
        <div className="overflow-x-auto thin-scroll">
          <table className="w-full min-w-[460px] text-[13px]">
            <thead>
              <tr className="text-left text-[11px] tracking-wide text-subtle uppercase">
                <th className="py-1 pr-3 font-medium">Method</th>
                <th className="py-1 pr-3 font-medium">Disk reads</th>
                <th className="py-1 pr-3 font-medium">Blocks read</th>
                <th className="py-1 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {all.map(({ value, label, a, c }) => (
                <tr key={value} className={cn("border-t border-border", value === method && "bg-accent/10")}>
                  <td className="py-1 pr-3">{label}</td>
                  <td className="py-1 pr-3 font-mono">{a.ok ? c.diskReads.length : "—"}</td>
                  <td className="py-1 pr-3 font-mono text-[12px]">{a.ok ? c.diskReads.join(" → ") : "can't allocate"}</td>
                  <td className="py-1 text-[12px] text-muted">
                    {!a.ok
                      ? "no run of free blocks long enough"
                      : value === "fat"
                        ? `${c.memorySteps} table lookups${fatCached ? " in memory" : " (the FAT read once)"}`
                        : value === "linked"
                          ? "follows the chain from the file's first block"
                          : value === "indexed"
                            ? indexCached
                              ? "index block in memory"
                              : "index block, then data"
                            : "start + k"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <p className="text-[12.5px] text-subtle">
        The directory entry (or inode) is assumed to be in memory already. Free space is fragmented on purpose: try a 5-block file with contiguous allocation.
      </p>
    </div>
  );
}

export default function FileAllocation() {
  const [tab, setTab] = useState<"inode" | "methods">("inode");
  return (
    <div className="space-y-4">
      <Segmented
        ariaLabel="View"
        value={tab}
        onChange={setTab}
        options={[
          { value: "inode", label: "Inode pointers" },
          { value: "methods", label: "Allocation methods" },
        ]}
      />
      {tab === "inode" ? <InodeTab /> : <AllocationTab />}
    </div>
  );
}
