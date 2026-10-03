"use client";
import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Btn, Explain, Field, inputCls, Panel, Segmented, Stat } from "../ui";
import { cn } from "@/lib/utils";

// A 32-bit virtual address space, two-level page table (VPN split in half), small TLB.
type PageState = { kind: "present"; pfn: number } | { kind: "swapped" } | { kind: "unmapped" };

const TLB_SIZE = 4;

function pageSizeBits(size: string) {
  return size === "1K" ? 10 : size === "16K" ? 14 : 12;
}

// Deterministic "memory map": a few mapped regions like a real process.
function pageState(vpn: number, bits: number): PageState {
  const addr = vpn * 2 ** bits;
  const inRange = (lo: number, hi: number) => addr >= lo && addr < hi;
  const mapped =
    inRange(0x00400000, 0x00480000) || // text
    inRange(0x00600000, 0x00640000) || // data/heap
    inRange(0x7ffe0000, 0x80000000); // stack
  if (!mapped) return { kind: "unmapped" };
  const h = (vpn * 2654435761) >>> 0;
  if (h % 7 === 0) return { kind: "swapped" };
  return { kind: "present", pfn: 0x100 + (h % 0xefff) };
}

const PRESETS = [
  { label: "code", addr: "0x00401A2C" },
  { label: "code (same page)", addr: "0x00401F00" },
  { label: "heap", addr: "0x00612345" },
  { label: "stack", addr: "0x7FFE1234" },
  { label: "NULL + 16", addr: "0x00000010" },
  { label: "random unmapped", addr: "0x3A7F9000" },
];

interface Entry {
  vpn: number;
  pfn: number;
  last: number;
}

interface Result {
  steps: { text: string; tone: "neutral" | "good" | "bad" | "warn" }[];
  pa?: number;
  outcome: "hit" | "miss" | "fault-minor" | "fault-major" | "segv";
}

export default function AddressTranslation() {
  const [size, setSize] = useState<"1K" | "4K" | "16K">("4K");
  const bits = pageSizeBits(size);
  const vpnBits = 32 - bits;
  const outerBits = Math.ceil(vpnBits / 2);
  const innerBits = vpnBits - outerBits;
  const [input, setInput] = useState("0x00401A2C");
  const [tlb, setTlb] = useState<Entry[]>([]);
  const [clock, setClock] = useState(0);
  const [loaded, setLoaded] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<Result | null>(null);
  const [stats, setStats] = useState({ accesses: 0, hits: 0, misses: 0, faults: 0 });

  const va = useMemo(() => {
    const v = parseInt(input.trim().replace(/^0x/i, ""), 16);
    return Number.isFinite(v) && v >= 0 && v <= 0xffffffff ? v >>> 0 : null;
  }, [input]);

  const reset = () => {
    setTlb([]);
    setLoaded(new Set());
    setResult(null);
    setStats({ accesses: 0, hits: 0, misses: 0, faults: 0 });
  };

  function translate(v: number) {
    const vpn = Math.floor(v / 2 ** bits);
    const offset = v % 2 ** bits;
    const outer = Math.floor(vpn / 2 ** innerBits);
    const inner = vpn % 2 ** innerBits;
    const steps: Result["steps"] = [
      {
        text: `Split: VPN = 0x${vpn.toString(16)} (outer index ${outer}, inner index ${inner}), offset = 0x${offset.toString(16)} (${bits} bits).`,
        tone: "neutral",
      },
    ];
    const t = clock + 1;
    setClock(t);
    const hit = tlb.find((e) => e.vpn === vpn);
    if (hit) {
      const pa = hit.pfn * 2 ** bits + offset;
      steps.push({ text: `TLB lookup for VPN 0x${vpn.toString(16)}: HIT → PFN 0x${hit.pfn.toString(16)}. No page-table access needed.`, tone: "good" });
      steps.push({ text: `Physical address = PFN ‖ offset = 0x${pa.toString(16)}.`, tone: "good" });
      setTlb((tb) => tb.map((e) => (e.vpn === vpn ? { ...e, last: t } : e)));
      setStats((s) => ({ ...s, accesses: s.accesses + 1, hits: s.hits + 1 }));
      setResult({ steps, pa, outcome: "hit" });
      return;
    }
    steps.push({ text: `TLB lookup: MISS. The hardware walks the page table (CR3 → outer table[${outer}] → inner table[${inner}]).`, tone: "warn" });
    const ps = pageState(vpn, bits);
    let st = ps;
    if (ps.kind === "swapped" && loaded.has(vpn)) st = { kind: "present", pfn: 0x100 + (((vpn * 2654435761) >>> 0) % 0xefff) };
    if (st.kind === "unmapped") {
      steps.push({ text: "No valid mapping: the outer or inner entry is not present and the address is in no VMA.", tone: "bad" });
      steps.push({ text: "Page fault → kernel finds no VMA for this address → SIGSEGV (segmentation fault).", tone: "bad" });
      setStats((s) => ({ ...s, accesses: s.accesses + 1, misses: s.misses + 1, faults: s.faults + 1 }));
      setResult({ steps, outcome: "segv" });
      return;
    }
    let pfn: number;
    let outcome: Result["outcome"] = "miss";
    if (st.kind === "swapped") {
      pfn = 0x100 + (((vpn * 2654435761) >>> 0) % 0xefff);
      steps.push({ text: "PTE found but Present bit = 0: the page is valid (inside a VMA) but not in RAM.", tone: "bad" });
      steps.push({
        text: `Major page fault: kernel allocates frame 0x${pfn.toString(16)}, reads the page from disk/swap (~100 µs on NVMe), sets Present=1, and restarts the instruction.`,
        tone: "warn",
      });
      setLoaded((l) => new Set(l).add(vpn));
      outcome = "fault-major";
    } else {
      pfn = st.pfn;
      steps.push({ text: `PTE present → PFN 0x${pfn.toString(16)} (permissions checked: user-accessible).`, tone: "good" });
    }
    const pa = pfn * 2 ** bits + offset;
    // insert into TLB with LRU eviction (computed from current state, no side effects in updaters)
    const nextTlb = [...tlb];
    if (nextTlb.length >= TLB_SIZE) {
      const lru = nextTlb.reduce((m, e, i) => (e.last < nextTlb[m].last ? i : m), 0);
      steps.push({ text: `TLB full: evict LRU entry VPN 0x${nextTlb[lru].vpn.toString(16)}.`, tone: "neutral" });
      nextTlb.splice(lru, 1);
    }
    nextTlb.push({ vpn, pfn, last: t });
    setTlb(nextTlb);
    steps.push({ text: `Insert VPN 0x${vpn.toString(16)} → PFN 0x${pfn.toString(16)} into the TLB. Physical address = 0x${pa.toString(16)}.`, tone: "good" });
    setStats((s) => ({ ...s, accesses: s.accesses + 1, misses: s.misses + 1, faults: s.faults + (outcome === "fault-major" ? 1 : 0) }));
    setResult({ steps, pa, outcome });
  }

  const bin = va !== null ? va.toString(2).padStart(32, "0") : "";
  const hitRatio = stats.accesses ? stats.hits / stats.accesses : 0;
  const eat = stats.accesses ? hitRatio * 100 + (1 - hitRatio) * 500 : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Virtual address (hex, 32-bit)">
          <input className={cn(inputCls, "w-40")} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && va !== null && translate(va)} />
        </Field>
        <Btn variant="primary" disabled={va === null} onClick={() => va !== null && translate(va)}>
          Translate
        </Btn>
        <Field label="Page size">
          <Segmented
            value={size}
            onChange={(v) => {
              setSize(v);
              reset();
            }}
            options={[
              { value: "1K", label: "1 KB" },
              { value: "4K", label: "4 KB" },
              { value: "16K", label: "16 KB" },
            ]}
          />
        </Field>
        <Btn variant="ghost" onClick={reset}>
          <RotateCcw className="h-3.5 w-3.5" /> Reset TLB
        </Btn>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button key={p.label} type="button" onClick={() => setInput(p.addr)} className="rounded-full border border-border px-2.5 py-0.5 font-mono text-[12px] text-muted hover:text-fg">
            {p.label}: {p.addr}
          </button>
        ))}
      </div>

      {va !== null && (
        <Panel title="Address split">
          <div className="overflow-x-auto thin-scroll">
            <div className="flex min-w-[560px] font-mono text-[12px]">
              {bin.split("").map((b, i) => (
                <span
                  key={i}
                  className={cn(
                    "flex-1 border-y border-l py-1 text-center last:border-r",
                    i < outerBits ? "border-d-advanced/40 bg-d-advanced/10" : i < vpnBits ? "border-d-core/40 bg-d-core/10" : "border-ok/40 bg-ok/10",
                  )}
                >
                  {b}
                </span>
              ))}
            </div>
            <div className="mt-1 flex min-w-[560px] text-[11px] text-subtle">
              <span style={{ width: `${(outerBits / 32) * 100}%` }} className="text-d-advanced">outer index ({outerBits} bits)</span>
              <span style={{ width: `${(innerBits / 32) * 100}%` }} className="text-d-core">inner index ({innerBits} bits)</span>
              <span style={{ width: `${(bits / 32) * 100}%` }} className="text-ok">offset ({bits} bits)</span>
            </div>
          </div>
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        <Panel title="Translation steps">
          {result ? (
            <ol className="space-y-2">
              {result.steps.map((s, i) => (
                <li key={i}>
                  <Explain tone={s.tone}>
                    <span className="font-mono text-[11px] text-subtle">{i + 1}.</span> {s.text}
                  </Explain>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[13px] text-subtle">Enter an address and press Translate. Translate the same page twice to see a TLB hit.</p>
          )}
        </Panel>
        <div className="space-y-3">
          <Panel title={`TLB (${TLB_SIZE} entries, LRU)`}>
            <table className="w-full font-mono text-[12px]">
              <thead className="text-left text-[10.5px] text-subtle uppercase">
                <tr>
                  <th>VPN</th>
                  <th>PFN</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: TLB_SIZE }, (_, i) => tlb[i]).map((e, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="py-1">{e ? `0x${e.vpn.toString(16)}` : "—"}</td>
                    <td>{e ? `0x${e.pfn.toString(16)}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Accesses" value={stats.accesses} />
            <Stat label="TLB hits" value={stats.hits} />
            <Stat label="Hit ratio" value={stats.accesses ? `${Math.round(hitRatio * 100)}%` : "—"} />
            <Stat label="Est. EAT" value={stats.accesses ? `${Math.round(eat)} ns` : "—"} sub="100 ns mem, 4-level walk" />
          </div>
        </div>
      </div>
    </div>
  );
}
