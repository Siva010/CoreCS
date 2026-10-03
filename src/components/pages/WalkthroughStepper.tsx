"use client";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, List, Presentation } from "lucide-react";
import { cn } from "@/lib/utils";

export const LAYERS: Record<string, { label: string; color: string }> = {
  user: { label: "User", color: "#64748b" },
  firmware: { label: "Firmware (UEFI)", color: "#78716c" },
  bootloader: { label: "Bootloader", color: "#a8a29e" },
  shell: { label: "Shell", color: "#7c3aed" },
  browser: { label: "Browser", color: "#0ea5e9" },
  app: { label: "Application", color: "#6366f1" },
  runtime: { label: "Runtime / libc", color: "#8b5cf6" },
  driver: { label: "DB driver / pool", color: "#8b5cf6" },
  kernel: { label: "Kernel", color: "#f59e0b" },
  scheduler: { label: "Scheduler", color: "#f59e0b" },
  cpu: { label: "CPU", color: "#ef4444" },
  mmu: { label: "MMU / TLB", color: "#f43f5e" },
  memory: { label: "Memory", color: "#ec4899" },
  fs: { label: "Filesystem", color: "#d97706" },
  disk: { label: "Storage device", color: "#a16207" },
  nic: { label: "NIC / driver", color: "#14b8a6" },
  network: { label: "Network", color: "#0891b2" },
  dns: { label: "DNS", color: "#0284c7" },
  tcp: { label: "TCP", color: "#0369a1" },
  tls: { label: "TLS", color: "#7c3aed" },
  http: { label: "HTTP", color: "#2563eb" },
  lb: { label: "Load balancer / proxy", color: "#0d9488" },
  server: { label: "Server process", color: "#4f46e5" },
  db: { label: "Database engine", color: "#059669" },
  planner: { label: "Query planner", color: "#10b981" },
  executor: { label: "Executor", color: "#047857" },
  buffer: { label: "Buffer pool", color: "#16a34a" },
  wal: { label: "WAL", color: "#15803d" },
  replica: { label: "Replica", color: "#65a30d" },
  locks: { label: "Lock manager", color: "#dc2626" },
};

export function layerMeta(id: string) {
  return LAYERS[id] ?? { label: id.charAt(0).toUpperCase() + id.slice(1), color: "#71717a" };
}

export function WalkthroughStepper({ steps }: { steps: { layer: string; title: string; content: ReactNode }[] }) {
  const [i, setI] = useState(0);
  const [all, setAll] = useState(false);
  const lanes = [...new Set(steps.map((s) => s.layer))];

  useEffect(() => {
    if (all) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea")) return;
      if (e.key === "ArrowRight") setI((x) => Math.min(x + 1, steps.length - 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(x - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [all, steps.length]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5">
          <button type="button" onClick={() => setAll(false)} className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium", !all ? "bg-surface text-fg shadow-sm" : "text-muted")}>
            <Presentation className="h-3.5 w-3.5" /> Step through
          </button>
          <button type="button" onClick={() => setAll(true)} className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium", all ? "bg-surface text-fg shadow-sm" : "text-muted")}>
            <List className="h-3.5 w-3.5" /> Read all
          </button>
        </div>
        {!all && <span className="text-[12px] text-subtle">Use ← → keys</span>}
      </div>

      {/* Layer timeline: one lane per layer, one column per step */}
      <div className="mb-5 overflow-x-auto rounded-xl border border-border bg-surface p-3 thin-scroll">
        <div className="grid gap-y-1" style={{ gridTemplateColumns: `140px repeat(${steps.length}, minmax(22px, 1fr))` }}>
          {lanes.map((lane) => {
            const m = layerMeta(lane);
            return (
              <div key={lane} className="contents">
                <div className="flex items-center gap-2 pr-2 text-[12px] text-muted">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: m.color }} />
                  <span className="truncate">{m.label}</span>
                </div>
                {steps.map((s, k) => (
                  <button
                    key={k}
                    type="button"
                    aria-label={`Step ${k + 1}: ${s.title}`}
                    onClick={() => {
                      setAll(false);
                      setI(k);
                    }}
                    className="flex h-6 items-center justify-center"
                  >
                    {s.layer === lane ? (
                      <span
                        className={cn("h-4 rounded-full transition-all", k === i && !all ? "w-full ring-2 ring-offset-1 ring-offset-surface" : "w-4")}
                        style={{ background: m.color, opacity: all || k <= i ? 1 : 0.35, ["--tw-ring-color" as string]: m.color }}
                      />
                    ) : (
                      <span className="h-px w-full bg-border" />
                    )}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {all ? (
        <ol className="space-y-6">
          {steps.map((s, k) => {
            const m = layerMeta(s.layer);
            return (
              <li key={k} className="rounded-2xl border border-border bg-surface p-5">
                <StepHeader n={k + 1} title={s.title} layer={m} />
                <div className="mt-3">{s.content}</div>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="rounded-2xl border border-border bg-surface p-5">
          <StepHeader n={i + 1} title={steps[i].title} layer={layerMeta(steps[i].layer)} total={steps.length} />
          <div className="mt-3 min-h-40">{steps[i].content}</div>
          <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
            <button
              type="button"
              disabled={i === 0}
              onClick={() => setI(i - 1)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium disabled:opacity-40"
            >
              <ArrowLeft className="h-4 w-4" /> Previous
            </button>
            <div className="hidden text-[12px] text-subtle sm:block">
              {i + 1 < steps.length ? `Next: ${steps[i + 1].title}` : "End of walkthrough"}
            </div>
            <button
              type="button"
              disabled={i === steps.length - 1}
              onClick={() => setI(i + 1)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-accent-fg disabled:opacity-40"
            >
              Next <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StepHeader({ n, title, layer, total }: { n: number; title: string; layer: { label: string; color: string }; total?: number }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full font-mono text-[13px] font-semibold text-white" style={{ background: layer.color }}>
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold tracking-wider uppercase" style={{ color: layer.color }}>
          {layer.label}
          {total ? <span className="ml-2 font-mono text-subtle normal-case">step {n}/{total}</span> : null}
        </div>
        <h3 className="text-lg font-semibold text-fg">{title}</h3>
      </div>
    </div>
  );
}
