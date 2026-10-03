"use client";
import { useMemo, useState } from "react";
import { Explain, Panel, Segmented, StepControls, useStepper } from "../ui";
import { cn } from "@/lib/utils";

interface Snap {
  title: string;
  text: string;
  running: "A" | "B" | "kernel(A)" | "kernel(B)";
  mode: "user" | "kernel";
  cpu: { pc: string; sp: string; cr3: string };
  pcbA: string;
  pcbB: string;
  tlb: string;
  cache: string;
  changed: string[];
}

function steps(threadSwitch: boolean): Snap[] {
  const cr3B = threadSwitch ? "0x1a3000 (same mm)" : "0x7f1000";
  const s: Snap[] = [
    {
      title: "Task A running in user mode",
      text: "A executes its code; its registers live in the CPU. B sits in the run queue with its registers saved in its task structure.",
      running: "A",
      mode: "user",
      cpu: { pc: "0x401a2c (A)", sp: "0x7ffd…e10 (A)", cr3: "0x1a3000 (A)" },
      pcbA: "running — registers live in CPU",
      pcbB: "Ready — saved PC 0x4028f0, SP 0x7ffc…9a0",
      tlb: "warm for A",
      cache: "warm for A",
      changed: [],
    },
    {
      title: "Timer interrupt fires",
      text: "The local timer raises an interrupt. The CPU finishes the current instruction, switches to kernel mode and to A's kernel stack, and pushes A's user PC, SP and flags.",
      running: "kernel(A)",
      mode: "kernel",
      cpu: { pc: "irq handler", sp: "A's kernel stack", cr3: "0x1a3000 (A)" },
      pcbA: "user registers pushed on A's kernel stack",
      pcbB: "Ready",
      tlb: "warm for A",
      cache: "warm for A",
      changed: ["mode", "pc", "sp", "pcbA"],
    },
    {
      title: "Scheduler decides to switch",
      text: "The handler updates A's runtime accounting. A has used its slice and B is runnable, so the scheduler sets need_resched and picks B.",
      running: "kernel(A)",
      mode: "kernel",
      cpu: { pc: "schedule()", sp: "A's kernel stack", cr3: "0x1a3000 (A)" },
      pcbA: "state → Ready (back in the run queue)",
      pcbB: "chosen to run next",
      tlb: "warm for A",
      cache: "warm for A",
      changed: ["pc", "pcbA", "pcbB"],
    },
    {
      title: "Save A's kernel context",
      text: "switch_to() saves A's callee-saved registers and kernel stack pointer into A's task_struct (FPU/SIMD state is saved too, possibly lazily).",
      running: "kernel(A)",
      mode: "kernel",
      cpu: { pc: "switch_to()", sp: "A's kernel stack", cr3: "0x1a3000 (A)" },
      pcbA: "Ready — full context saved",
      pcbB: "about to run",
      tlb: "warm for A",
      cache: "warm for A",
      changed: ["pc", "pcbA"],
    },
    {
      title: threadSwitch ? "Address space: unchanged" : "Switch address space (load CR3)",
      text: threadSwitch
        ? "B is another thread of the SAME process: same page tables, so CR3 is not reloaded and the TLB stays valid. This step is why thread switches are cheaper."
        : "B belongs to a different process: the kernel loads B's page-table root into CR3. Without PCID tags, non-global TLB entries are flushed; with PCID they stay but don't match.",
      running: "kernel(A)",
      mode: "kernel",
      cpu: { pc: "switch_mm()", sp: "A's kernel stack", cr3: cr3B },
      pcbA: "Ready",
      pcbB: "about to run",
      tlb: threadSwitch ? "still valid (same address space)" : "flushed / cold for B",
      cache: "still full of A's data",
      changed: threadSwitch ? [] : ["cr3", "tlb"],
    },
    {
      title: "Restore B's context",
      text: "The kernel switches to B's kernel stack and restores B's saved registers. From here on, the CPU is executing on B's behalf.",
      running: "kernel(B)",
      mode: "kernel",
      cpu: { pc: "return path", sp: "B's kernel stack", cr3: cr3B },
      pcbA: "Ready",
      pcbB: "running — registers restored",
      tlb: threadSwitch ? "valid" : "cold for B",
      cache: "A's lines, being evicted",
      changed: ["sp", "pcbB"],
    },
    {
      title: "Return to user mode as B",
      text: "iret/sysret pops B's user PC, SP and flags. B resumes exactly where it was paused, unaware. Now come the indirect costs: TLB misses and cache misses while B's working set is re-loaded.",
      running: "B",
      mode: "user",
      cpu: { pc: "0x4028f0 (B)", sp: "0x7ffc…9a0 (B)", cr3: cr3B },
      pcbA: "Ready — waits for its next turn",
      pcbB: "running",
      tlb: threadSwitch ? "warm (shared)" : "warming up — page walks on misses",
      cache: "warming up for B",
      changed: ["mode", "pc", "sp", "tlb", "cache"],
    },
  ];
  return s;
}

function Cell({ label, value, hot }: { label: string; value: string; hot?: boolean }) {
  return (
    <div className={cn("rounded-lg border px-3 py-1.5 transition-colors", hot ? "border-accent bg-accent/10" : "border-border bg-surface-2")}>
      <div className="text-[10.5px] font-semibold tracking-wide text-subtle uppercase">{label}</div>
      <div className="font-mono text-[12.5px] text-fg">{value}</div>
    </div>
  );
}

export default function ContextSwitch() {
  const [kind, setKind] = useState<"process" | "thread">("process");
  const all = useMemo(() => steps(kind === "thread"), [kind]);
  const s = useStepper(all.length, { interval: 2200 });
  const cur = all[s.step];
  const hot = (k: string) => cur.changed.includes(k);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          ariaLabel="Switch type"
          value={kind}
          onChange={(v) => {
            setKind(v);
            s.reset();
          }}
          options={[
            { value: "process", label: "Process switch (A → B different processes)" },
            { value: "thread", label: "Thread switch (same process)" },
          ]}
        />
        <StepControls s={s} total={all.length} />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Panel title="Task A" className={cn(cur.running.includes("A") && "ring-2 ring-accent/40")}>
          <Cell label="PCB / task_struct" value={cur.pcbA} hot={hot("pcbA")} />
        </Panel>
        <Panel title={`CPU 0 — ${cur.mode} mode`}>
          <div className="grid gap-2">
            <Cell label="Program counter" value={cur.cpu.pc} hot={hot("pc")} />
            <Cell label="Stack pointer" value={cur.cpu.sp} hot={hot("sp")} />
            <Cell label="CR3 (page-table root)" value={cur.cpu.cr3} hot={hot("cr3")} />
            <div className="grid grid-cols-2 gap-2">
              <Cell label="TLB" value={cur.tlb} hot={hot("tlb")} />
              <Cell label="L1/L2 cache" value={cur.cache} hot={hot("cache")} />
            </div>
          </div>
        </Panel>
        <Panel title="Task B" className={cn(cur.running.includes("B") && "ring-2 ring-accent/40")}>
          <Cell label="PCB / task_struct" value={cur.pcbB} hot={hot("pcbB")} />
        </Panel>
      </div>

      <Explain>
        <span className="font-semibold">
          Step {s.step + 1}: {cur.title}.
        </span>{" "}
        {cur.text}
      </Explain>
      <p className="text-[12.5px] text-subtle">
        Direct cost of these steps: ~1–3 µs. Indirect cost (cold TLB and caches after the switch) is often larger — and it&apos;s mostly absent in a thread switch within the
        same process.
      </p>
    </div>
  );
}
