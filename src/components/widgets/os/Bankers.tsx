"use client";
import { useMemo, useState } from "react";
import { Btn, Explain, Field, NumberInput, Panel, Segmented, Select } from "../ui";
import { cn } from "@/lib/utils";

type Mode = "safety" | "request" | "detect";
type Matrix = number[][];

const RES = ["A", "B", "C"];

const TEXTBOOK = {
  total: [10, 5, 7],
  alloc: [
    [0, 1, 0],
    [2, 0, 0],
    [3, 0, 2],
    [2, 1, 1],
    [0, 0, 2],
  ],
  max: [
    [7, 5, 3],
    [3, 2, 2],
    [9, 0, 2],
    [2, 2, 2],
    [4, 3, 3],
  ],
};

const DETECT_PRESET = {
  total: [7, 2, 6],
  alloc: [
    [0, 1, 0],
    [2, 0, 0],
    [3, 0, 3],
    [2, 1, 1],
    [0, 0, 2],
  ],
  request: [
    [0, 0, 0],
    [2, 0, 2],
    [0, 0, 1],
    [1, 0, 0],
    [0, 0, 2],
  ],
};

const le = (a: number[], b: number[]) => a.every((x, i) => x <= b[i]);
const add = (a: number[], b: number[]) => a.map((x, i) => x + b[i]);
const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const fmt = (v: number[]) => `(${v.join(", ")})`;

interface Trace {
  steps: { pid: number | null; work: number[]; text: string }[];
  finish: boolean[];
  sequence: number[];
}

/** Safety algorithm (need = Max − Alloc) or detection (need = current Request). */
function check(available: number[], alloc: Matrix, need: Matrix, detection: boolean): Trace {
  const n = alloc.length;
  let work = [...available];
  const finish = alloc.map((row) => (detection ? row.every((x) => x === 0) : false));
  const steps: Trace["steps"] = [{ pid: null, work: [...work], text: `Work = Available = ${fmt(work)}` }];
  const sequence: number[] = [];
  let progress = true;
  while (progress) {
    progress = false;
    for (let i = 0; i < n; i++) {
      if (finish[i]) continue;
      if (le(need[i], work)) {
        const before = work;
        work = add(work, alloc[i]);
        finish[i] = true;
        sequence.push(i);
        steps.push({
          pid: i,
          work: [...work],
          text: `P${i}: ${detection ? "Request" : "Need"} ${fmt(need[i])} ≤ Work ${fmt(before)} ✔ → assume it finishes and releases ${fmt(alloc[i])} → Work = ${fmt(work)}`,
        });
        progress = true;
      }
    }
  }
  return { steps, finish, sequence };
}

function MatrixEditor({ label, m, onChange, readOnly, highlight }: { label: string; m: Matrix; onChange?: (m: Matrix) => void; readOnly?: boolean; highlight?: number | null }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold tracking-wide text-subtle uppercase">{label}</div>
      <table className="font-mono text-[12.5px]">
        <thead>
          <tr className="text-[11px] text-subtle">
            <th />
            {RES.map((r) => (
              <th key={r} className="px-1 font-medium">{r}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {m.map((row, i) => (
            <tr key={i} className={cn(highlight === i && "bg-accent/10")}>
              <td className="pr-2 text-[11px] text-subtle">P{i}</td>
              {row.map((v, j) => (
                <td key={j} className="px-0.5 py-0.5">
                  {readOnly ? (
                    <span className={cn("inline-block w-10 text-center", v < 0 && "text-bad")}>{v}</span>
                  ) : (
                    <input
                      type="number"
                      min={0}
                      value={v}
                      onChange={(e) => {
                        const x = Math.max(0, Math.floor(Number(e.target.value) || 0));
                        onChange?.(m.map((r, a) => (a === i ? r.map((c, b) => (b === j ? x : c)) : r)));
                      }}
                      className="h-7 w-10 rounded-md border border-border bg-surface text-center outline-none focus:border-accent"
                    />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Bankers() {
  const [mode, setMode] = useState<Mode>("safety");
  const [total, setTotal] = useState<number[]>(TEXTBOOK.total);
  const [alloc, setAlloc] = useState<Matrix>(TEXTBOOK.alloc);
  const [max, setMax] = useState<Matrix>(TEXTBOOK.max);
  const [reqMatrix, setReqMatrix] = useState<Matrix>(DETECT_PRESET.request);
  const [reqPid, setReqPid] = useState("1");
  const [req, setReq] = useState<number[]>([1, 0, 2]);
  const [shown, setShown] = useState(Infinity);

  const allocated = RES.map((_, j) => alloc.reduce((s, r) => s + r[j], 0));
  const available = sub(total, allocated);
  const need = alloc.map((r, i) => sub(max[i], r));
  const invalid = available.some((x) => x < 0) || need.some((r) => r.some((x) => x < 0));

  const safety = useMemo(() => check(available, alloc, need, false), [JSON.stringify([available, alloc, need])]); // eslint-disable-line react-hooks/exhaustive-deps
  const detect = useMemo(() => check(available, alloc, reqMatrix, true), [JSON.stringify([available, alloc, reqMatrix])]); // eslint-disable-line react-hooks/exhaustive-deps

  const request = useMemo(() => {
    const i = Number(reqPid);
    const lines: { text: string; tone: "neutral" | "good" | "bad" | "warn" }[] = [];
    if (!le(req, need[i])) {
      lines.push({ text: `Request ${fmt(req)} > Need[P${i}] ${fmt(need[i])}: error — P${i} exceeded its declared maximum.`, tone: "bad" });
      return { lines, verdict: "error" as const };
    }
    lines.push({ text: `Request ${fmt(req)} ≤ Need[P${i}] ${fmt(need[i])} ✔`, tone: "good" });
    if (!le(req, available)) {
      lines.push({ text: `Request ${fmt(req)} > Available ${fmt(available)}: P${i} must wait (resources not free).`, tone: "warn" });
      return { lines, verdict: "wait" as const };
    }
    lines.push({ text: `Request ≤ Available ${fmt(available)} ✔ — pretend to allocate:`, tone: "good" });
    const av2 = sub(available, req);
    const al2 = alloc.map((r, k) => (k === i ? add(r, req) : r));
    const nd2 = need.map((r, k) => (k === i ? sub(r, req) : r));
    lines.push({ text: `Available' = ${fmt(av2)}, Allocation'[P${i}] = ${fmt(al2[i])}, Need'[P${i}] = ${fmt(nd2[i])}. Run the safety algorithm on this state.`, tone: "neutral" });
    const t = check(av2, al2, nd2, false);
    for (const s of t.steps.slice(1)) lines.push({ text: s.text, tone: "neutral" });
    const safe = t.finish.every(Boolean);
    lines.push(
      safe
        ? { text: `Safe (sequence ⟨${t.sequence.map((p) => `P${p}`).join(", ")}⟩) → GRANT the request.`, tone: "good" }
        : { text: `No process can finish from here (${t.finish.map((f, k) => (f ? null : `P${k}`)).filter(Boolean).join(", ")} stuck) → UNSAFE → deny; P${i} waits and the pretend allocation is rolled back.`, tone: "bad" },
    );
    return { lines, verdict: safe ? ("grant" as const) : ("deny" as const) };
  }, [reqPid, req, JSON.stringify([available, alloc, need])]); // eslint-disable-line react-hooks/exhaustive-deps

  const trace = mode === "detect" ? detect : safety;
  const visible = Math.min(shown, trace.steps.length);
  const highlight = visible > 0 ? trace.steps[visible - 1]?.pid ?? null : null;

  const loadTextbook = () => {
    setTotal(TEXTBOOK.total);
    setAlloc(TEXTBOOK.alloc);
    setMax(TEXTBOOK.max);
    setShown(Infinity);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          ariaLabel="Mode"
          value={mode}
          onChange={(m) => {
            setMode(m);
            setShown(Infinity);
            if (m === "detect") {
              setTotal(DETECT_PRESET.total);
              setAlloc(DETECT_PRESET.alloc);
              setReqMatrix(DETECT_PRESET.request);
            } else if (mode === "detect") loadTextbook();
          }}
          options={[
            { value: "safety", label: "Safety check" },
            { value: "request", label: "Resource request" },
            { value: "detect", label: "Deadlock detection" },
          ]}
        />
        <Btn onClick={() => (mode === "detect" ? (setTotal(DETECT_PRESET.total), setAlloc(DETECT_PRESET.alloc), setReqMatrix(DETECT_PRESET.request)) : loadTextbook())}>Load textbook example</Btn>
      </div>

      <Panel title="System state">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-muted">Total instances:</span>
          {RES.map((r, j) => (
            <label key={r} className="flex items-center gap-1 font-mono">
              {r}
              <NumberInput value={total[j]} min={0} onChange={(v) => setTotal(total.map((x, k) => (k === j ? Math.max(0, Math.floor(v)) : x)))} className="w-16" />
            </label>
          ))}
          <span className="ml-2 font-mono text-muted">
            Available = Total − ΣAllocation = <span className={cn("font-semibold", available.some((x) => x < 0) ? "text-bad" : "text-fg")}>{fmt(available)}</span>
          </span>
        </div>
        <div className="flex flex-wrap gap-6 overflow-x-auto thin-scroll">
          <MatrixEditor label="Allocation" m={alloc} onChange={setAlloc} highlight={highlight} />
          {mode === "detect" ? (
            <MatrixEditor label="Request (current)" m={reqMatrix} onChange={setReqMatrix} highlight={highlight} />
          ) : (
            <>
              <MatrixEditor label="Max" m={max} onChange={setMax} highlight={highlight} />
              <MatrixEditor label="Need = Max − Allocation" m={need} readOnly highlight={highlight} />
            </>
          )}
        </div>
        {invalid && mode !== "detect" && (
          <div className="mt-3">
            <Explain tone="bad">Inconsistent state: allocations exceed totals or Max &lt; Allocation somewhere.</Explain>
          </div>
        )}
      </Panel>

      {mode !== "request" ? (
        <Panel
          title={mode === "detect" ? "Detection algorithm" : "Safety algorithm"}
          right={
            <div className="flex gap-2">
              <Btn onClick={() => setShown(1)}>Step</Btn>
              <Btn onClick={() => setShown((s) => Math.min((Number.isFinite(s) ? s : 1) + 1, trace.steps.length))} disabled={visible >= trace.steps.length}>Next</Btn>
              <Btn variant="ghost" onClick={() => setShown(Infinity)}>All</Btn>
            </div>
          }
        >
          <ol className="space-y-1.5 font-mono text-[12.5px]">
            {trace.steps.slice(0, visible).map((s, i) => (
              <li key={i} className={cn(i === visible - 1 ? "text-fg" : "text-muted")}>
                {s.text}
              </li>
            ))}
          </ol>
          {visible >= trace.steps.length && (
            <div className="mt-3">
              {trace.finish.every(Boolean) ? (
                <Explain tone="good">
                  {mode === "detect" ? "No deadlock: every process can eventually finish." : `SAFE. Safe sequence: ⟨${trace.sequence.map((p) => `P${p}`).join(", ")}⟩.`}
                </Explain>
              ) : (
                <Explain tone="bad">
                  {mode === "detect"
                    ? `DEADLOCK: ${trace.finish.map((f, i) => (f ? null : `P${i}`)).filter(Boolean).join(", ")} can never be satisfied.`
                    : `UNSAFE: ${trace.finish.map((f, i) => (f ? null : `P${i}`)).filter(Boolean).join(", ")} cannot be guaranteed to finish. Deadlock is possible (not certain).`}
                </Explain>
              )}
            </div>
          )}
        </Panel>
      ) : (
        <Panel title="Evaluate a request">
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <Field label="Process">
              <Select value={reqPid} onChange={setReqPid} options={alloc.map((_, i) => ({ value: String(i), label: `P${i}` }))} />
            </Field>
            {RES.map((r, j) => (
              <Field key={r} label={`Request ${r}`}>
                <NumberInput value={req[j]} min={0} onChange={(v) => setReq(req.map((x, k) => (k === j ? Math.max(0, Math.floor(v)) : x)))} className="w-16" />
              </Field>
            ))}
          </div>
          <ol className="space-y-1.5">
            {request.lines.map((l, i) => (
              <li key={i}>
                <Explain tone={l.tone}>
                  <span className="font-mono text-[12.5px]">{l.text}</span>
                </Explain>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[12px] text-subtle">Try P1 requesting (1, 0, 2) — granted. Then change the state and try P0 requesting (0, 2, 0), or P4 requesting (3, 3, 0).</p>
        </Panel>
      )}
    </div>
  );
}
